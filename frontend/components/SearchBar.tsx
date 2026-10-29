"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Voice search uses the browser's built-in speech recognition (Chrome, Edge, Safari, Android).
// Where the browser doesn't support it (e.g. Firefox), the microphone button simply isn't shown.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Recognition = any;

function getRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANGS = [
  { code: "en-IN", label: "EN", name: "English" },
  { code: "hi-IN", label: "हिं", name: "Hindi" },
  { code: "gu-IN", label: "ગુ", name: "Gujarati" },
] as const;

export default function SearchBar({ initial = "", autoFocus = false }: { initial?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState<(typeof LANGS)[number]["code"]>("en-IN");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setSupported(!!getRecognition());
    return () => rec.current?.abort?.();
  }, []);

  function go(query: string) {
    const t = query.trim();
    if (t) router.push(`/search?q=${encodeURIComponent(t)}`);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    go(q);
  }

  function toggleVoice() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = getRecognition();
    if (!Ctor) return;
    const r: Recognition = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let finalText = "";
    r.onresult = (ev: any) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      setQ(text);
      if (ev.results[ev.results.length - 1].isFinal) finalText = text;
    };
    r.onerror = (ev: any) => {
      setVoiceError(
        ev.error === "not-allowed" || ev.error === "service-not-allowed"
          ? "Microphone access was blocked. Allow it in your browser's site settings to search by voice."
          : ev.error === "no-speech"
            ? "Didn't hear anything. Tap the microphone and try again."
            : "Voice search didn't work this time. Please type instead.",
      );
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (finalText) go(finalText); // search as soon as you finish speaking
    };
    setVoiceError(null);
    rec.current = r;
    setListening(true);
    r.start();
  }

  const langName = LANGS.find((l) => l.code === lang)?.name;

  return (
    <div className="w-full">
      <form role="search" onSubmit={submit} className="flex w-full gap-2">
        <label htmlFor="kg-search" className="sr-only">
          Search the archive
        </label>
        <div className="relative flex min-w-0 flex-1">
          <input
            id="kg-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus={autoFocus}
            placeholder={listening ? `Listening (${langName})…` : "Search, e.g. Rudabai or बावड़ी"}
            className={`min-w-0 flex-1 rounded-md border bg-paper px-4 py-2.5 text-[15px] text-ink placeholder:text-dust/70 focus:border-water focus:outline-none ${
              supported ? "pr-12" : ""
            } ${listening ? "border-rust" : "border-line"}`}
          />
          {supported && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening" : `Search by voice in ${langName}`}
              title={listening ? "Stop listening" : `Search by voice (${langName})`}
              className={`absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md transition-colors ${
                listening ? "animate-pulse bg-rust text-paper" : "text-dust hover:bg-sand hover:text-ink"
              }`}
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
              </svg>
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={!q.trim()}
          className="shrink-0 rounded-md bg-water px-5 py-2.5 text-[15px] font-medium text-paper transition-opacity disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {supported && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-dust">
          <span>Voice language:</span>
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code)}
              aria-pressed={lang === l.code}
              title={l.name}
              className={`rounded px-1.5 py-0.5 ${lang === l.code ? "bg-ink text-paper" : "hover:text-ink"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
      {voiceError && (
        <p role="alert" className="mt-1 text-[13px] text-rust">
          {voiceError}
        </p>
      )}
    </div>
  );
}
