"use client";

import { useEffect, useRef, useState } from "react";
import { ask } from "@/lib/api";

// "Listen": an audio guide for a monument, spoken by the voices already built into the visitor's
// phone or computer (free, no extra service). The words come from Ask the archive, so the guide
// only says what the archive's own sources say, in English, Hindi or Gujarati.

const LANGS = [
  { code: "en", bcp: "en-IN", label: "English", short: "EN", q: (n: string) => `In 4 or 5 short sentences, introduce ${n} to a visitor standing there: what it is, who built it and when, and one thing to look for.` },
  { code: "hi", bcp: "hi-IN", label: "हिन्दी", short: "हिं", q: (n: string) => `${n} के बारे में वहाँ खड़े एक पर्यटक को 4-5 छोटे वाक्यों में बताइए: यह क्या है, किसने और कब बनवाया, और वहाँ क्या ज़रूर देखें।` },
  { code: "gu", bcp: "gu-IN", label: "ગુજરાતી", short: "ગુ", q: (n: string) => `${n} વિશે ત્યાં ઊભેલા પ્રવાસીને 4-5 ટૂંકા વાક્યોમાં જણાવો: આ શું છે, કોણે અને ક્યારે બંધાવ્યું, અને ત્યાં શું ખાસ જોવું.` },
] as const;
type Lang = (typeof LANGS)[number]["code"];

type Phase = "idle" | "writing" | "speaking" | "paused" | "error";

const cache = new Map<string, string>();

/** Remove citation marks like [1] or [2, 3] so they aren't read aloud. */
const forSpeech = (t: string) => t.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "").replace(/\s{2,}/g, " ").trim();

function sentences(t: string): string[] {
  return t.match(/[^.!?।]+[.!?।]+["')\]]*|[^.!?।]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [t];
}

function pickVoice(code: Lang): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices();
  const lang = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  if (code === "en")
    return all.find((v) => lang(v) === "en-in") ?? all.find((v) => lang(v).startsWith("en-gb")) ?? all.find((v) => lang(v).startsWith("en")) ?? null;
  return all.find((v) => lang(v).startsWith(code)) ?? null;
}

export default function ListenGuide({ entityId, name, compact = false }: { entityId: number; name: string; compact?: boolean }) {
  const [supported, setSupported] = useState(true);
  const [lang, setLang] = useState<Lang>("en");
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "speechSynthesis" in window;
    setSupported(ok);
    if (!ok) return;
    window.speechSynthesis.getVoices(); // voices load asynchronously in Chrome
    const noop = () => {};
    window.speechSynthesis.addEventListener?.("voiceschanged", noop);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", noop);
      window.speechSynthesis.cancel();
    };
  }, []);

  // switching monument or language stops the guide
  useEffect(() => {
    run.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setPhase("idle");
    setText(cache.get(`${entityId}:${lang}`) ?? null);
    setNote(null);
  }, [entityId, lang]);

  async function play() {
    const synth = window.speechSynthesis;
    if (phase === "paused") {
      synth.resume();
      setPhase("speaking");
      return;
    }
    const my = ++run.current;
    const L = LANGS.find((l) => l.code === lang)!;
    setNote(null);

    let script = cache.get(`${entityId}:${lang}`);
    if (!script) {
      setPhase("writing");
      try {
        const res = await ask(L.q(name), entityId);
        if (!res.answer) throw new Error(res.message ?? "The archive doesn't hold enough about this site yet.");
        script = forSpeech(res.answer);
        cache.set(`${entityId}:${lang}`, script);
      } catch (e) {
        if (my !== run.current) return;
        setPhase("error");
        setNote(e instanceof Error ? e.message : "Couldn't prepare the guide.");
        return;
      }
      if (my !== run.current) return;
    }
    setText(script);

    const voice = pickVoice(lang);
    if (!voice && lang !== "en") {
      setPhase("idle");
      setShowText(true);
      setNote(
        `This device has no ${L.code === "hi" ? "Hindi" : "Gujarati"} voice, so here is the text to read instead. Chrome on Android and Microsoft Edge usually have one.`,
      );
      return;
    }

    synth.cancel();
    const parts = sentences(script); // short pieces: some browsers stop long utterances part-way
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = voice?.lang ?? L.bcp;
      if (voice) u.voice = voice;
      u.rate = 0.95;
      if (i === parts.length - 1) u.onend = () => my === run.current && setPhase("idle");
      u.onerror = (ev) => {
        if (my !== run.current || ev.error === "interrupted" || ev.error === "canceled") return;
        setPhase("error");
        setShowText(true);
        setNote("The voice stopped unexpectedly. Try again, or read the text below.");
      };
      synth.speak(u);
    });
    setPhase("speaking");
  }

  function pause() {
    window.speechSynthesis.pause();
    setPhase("paused");
  }

  function stop() {
    run.current++;
    window.speechSynthesis.cancel();
    setPhase("idle");
  }

  if (!supported) return null;

  const busy = phase === "writing";
  return (
    <div className={`rounded-md border border-line bg-paper/70 ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={phase === "speaking" ? pause : play}
          disabled={busy}
          aria-label={phase === "speaking" ? "Pause the audio guide" : `Listen to the audio guide in ${LANGS.find((l) => l.code === lang)!.label}`}
          className="flex items-center gap-2 rounded-md bg-water px-4 py-2 text-[15px] font-medium text-paper hover:opacity-90 disabled:opacity-70"
        >
          <span aria-hidden="true">{phase === "speaking" ? "❚❚" : busy ? "…" : "▶"}</span>
          {phase === "speaking" ? "Pause" : phase === "paused" ? "Resume" : busy ? "Preparing the guide…" : "Listen"}
        </button>
        {(phase === "speaking" || phase === "paused") && (
          <button type="button" onClick={stop} className="rounded-md border border-line px-3 py-2 text-[14px] text-dust hover:text-ink">
            Stop
          </button>
        )}
        <div role="group" aria-label="Language of the audio guide" className="flex gap-1 text-[14px]">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code)}
              aria-pressed={lang === l.code}
              title={l.label}
              className={`rounded px-2 py-1 ${lang === l.code ? "bg-ink text-paper" : "text-dust hover:text-ink"}`}
            >
              {compact ? l.short : l.label}
            </button>
          ))}
        </div>
        {!compact && <span className="text-[13px] text-dust">Audio guide, spoken by your device</span>}
      </div>

      {busy && <p className="mt-2 text-[13px] text-dust">Writing the guide from this site&apos;s sources. This takes 10 to 20 seconds the first time.</p>}
      {note && (
        <p role="status" className={`mt-2 text-[13px] ${phase === "error" ? "text-rust" : "text-dust"}`}>
          {note}
        </p>
      )}
      {text && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowText((s) => !s)} className="text-[13px] text-water underline-offset-2 hover:underline">
            {showText ? "Hide the text" : "Read along"}
          </button>
          {showText && (
            <div className="mt-1.5">
              <p lang={lang} className="text-[15px] leading-relaxed text-ink">
                {text}
              </p>
              <p className="mt-1 text-[12px] text-dust">
                Written by AI only from this site&apos;s sources in the archive. Check the facts and quotes below before quoting it.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
