"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ErrorState } from "@/components/States";
import { ask } from "@/lib/api";
import type { AskCitation, AskResponse } from "@/lib/types";

const EXAMPLES = [
  "Who built the Adalaj stepwell, and when?",
  "अडालज की वाव किसने बनवाई?",
  "અડાલજની વાવ કોણે બંધાવી?",
  "Which monuments are protected as Monuments of National Importance?",
  "What still needs to be documented at the Sun Temple, Modhera?",
];

const STEPS = ["Finding the closest passages in every language", "Checking each monument's record", "Writing an answer that cites its sources"];

export default function AskPage() {
  return (
    <Suspense fallback={null}>
      <AskView />
    </Suspense>
  );
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AskResponse };

function AskView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const entityParam = params.get("monument");
  const entityId = entityParam ? Number(entityParam) : undefined;
  const [draft, setDraft] = useState(q);
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = useCallback(() => {
    if (!q) return setState({ kind: "idle" });
    setState({ kind: "loading" });
    ask(q, entityId)
      .then((data) => setState({ kind: "ready", data }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, [q, entityId]);

  useEffect(run, [run]);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    document.title = q ? `${q} · Ask · KathaGraph` : "Ask the archive · KathaGraph";
  }, [q]);

  function submit(question: string) {
    const text = question.trim();
    if (!text) return;
    const next = new URLSearchParams({ q: text });
    if (entityId) next.set("monument", String(entityId));
    router.push(`/ask?${next.toString()}`);
  }

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
      <h1 className="font-display text-4xl sm:text-5xl">Ask the archive</h1>
      <p className="mt-2 max-w-2xl text-[17px] text-dust">
        Ask in English, हिन्दी or ગુજરાતી. Answers come <strong className="text-ink">only</strong> from the archive&apos;s own
        records, every sentence is cited, disagreements are shown side by side, and anything not yet recorded is said
        plainly.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="mt-6"
      >
        <label htmlFor="ask-q" className="sr-only">
          Your question
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <textarea
            id="ask-q"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
            rows={2}
            maxLength={500}
            autoFocus={!q}
            placeholder="e.g. Who built the Adalaj stepwell?"
            className="min-h-[3.25rem] flex-1 resize-none rounded-md border border-line bg-paper px-4 py-3 text-[17px] text-ink placeholder:text-dust/70 focus:border-water"
          />
          <button
            type="submit"
            disabled={!draft.trim() || state.kind === "loading"}
            className="rounded-md bg-water px-5 py-3 font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
          >
            {state.kind === "loading" ? "Reading…" : "Ask"}
          </button>
        </div>
        {entityId && (
          <p className="mt-2 text-[13px] text-dust">
            Asking about one monument only.{" "}
            <Link href={q ? `/ask?q=${encodeURIComponent(q)}` : "/ask"} className="text-water underline underline-offset-2">
              Ask the whole archive
            </Link>
          </p>
        )}
      </form>

      {state.kind === "idle" && (
        <div className="mt-8">
          <p className="text-sm text-dust">Try one of these:</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => submit(ex)}
                  className="rounded-full border border-line bg-paper px-3 py-1 text-left text-[15px] hover:border-ink/40"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
          <HowItWorks />
        </div>
      )}

      {state.kind === "loading" && <Thinking />}

      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't answer that right now" message={state.message} onRetry={run} />
        </div>
      )}

      {state.kind === "ready" && <Answer data={state.data} />}
    </main>
  );
}

function Thinking() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);
    return () => clearInterval(t);
  }, []);
  return (
    <div role="status" aria-live="polite" className="mt-8 rounded-md border border-line bg-paper p-5">
      <ol className="space-y-2">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 text-[15px] ${i <= step ? "text-ink" : "text-dust/60"}`}>
            <span
              aria-hidden="true"
              className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] ${
                i < step ? "border-water bg-water text-paper" : i === step ? "animate-pulse border-water text-water" : "border-line"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[13px] text-dust">This takes 5–20 seconds. The free server may need longer to wake up.</p>
    </div>
  );
}

const CONFIDENCE: Record<AskResponse["confidence"], { label: string; className: string; title: string }> = {
  high: { label: "Well supported", className: "bg-water-soft text-water", title: "The passages state this directly and agree" },
  medium: { label: "Partly supported", className: "bg-ochre-soft text-ochre", title: "Partly covered, or sources disagree" },
  low: { label: "Thinly supported", className: "bg-rust-soft text-rust", title: "The archive barely covers this" },
};

function Answer({ data }: { data: AskResponse }) {
  const [active, setActive] = useState<number | null>(null);
  const refs = useRef(new Map<number, HTMLLIElement>());
  const used = data.citations.filter((c) => c.used);
  const others = data.citations.filter((c) => !c.used);

  function focus(n: number) {
    setActive(n);
    refs.current.get(n)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (!data.answer) {
    return (
      <section className="mt-8 rounded-md border border-dashed border-line px-5 py-8 text-center" aria-live="polite">
        <p className="font-serif text-lg text-ink">Not recorded yet</p>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-dust">{data.message}</p>
        <Link href="/upload" className="mt-4 inline-block rounded-md bg-water px-4 py-2 text-sm font-medium text-paper">
          Add to the archive
        </Link>
      </section>
    );
  }

  const conf = CONFIDENCE[data.confidence] ?? CONFIDENCE.low;
  return (
    <section className="mt-8 space-y-5" aria-live="polite">
      <article className="rounded-md border border-line bg-paper p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] uppercase tracking-wide text-dust">Answer from the archive</h2>
          <span title={conf.title} className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${conf.className}`}>
            {conf.label}
          </span>
        </div>
        <p className="mt-3 font-serif text-[19px] leading-relaxed text-ink">
          <CitedText text={data.answer} onCite={focus} />
        </p>
        {data.monuments.length > 0 && (
          <p className="mt-4 text-[14px] text-dust">
            About:{" "}
            {data.monuments.map((m, i) => (
              <Fragment key={m.id}>
                {i > 0 && ", "}
                <Link href={`/monument/${m.id}`} className="text-water underline-offset-2 hover:underline">
                  {m.name}
                </Link>
              </Fragment>
            ))}
          </p>
        )}
      </article>

      {data.disagreements.length > 0 && (
        <aside className="rounded-md border border-rust/30 bg-rust-soft p-5">
          <h3 className="font-medium text-rust">Sources disagree</h3>
          <p className="mt-1 text-[14px] text-ink/80">The archive shows every version instead of picking one. A field visit or a reviewer can settle it.</p>
          <ul className="mt-2 space-y-1 text-[15px] text-ink">
            {data.disagreements.map((d) => (
              <li key={d} className="flex gap-2">
                <span aria-hidden="true" className="text-rust">
                  ≠
                </span>
                <span>
                  <CitedText text={d} onCite={focus} />
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {data.not_recorded.length > 0 && (
        <aside className="rounded-md border border-ochre/30 bg-ochre-soft p-5">
          <h3 className="font-medium text-ochre">Not recorded yet</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-ink">
            {data.not_recorded.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <p className="mt-3 text-[14px]">
            <Link href="/upload" className="font-medium text-water underline underline-offset-2">
              Add a photo, scan or field note
            </Link>{" "}
            or see{" "}
            <Link href="/next" className="font-medium text-water underline underline-offset-2">
              what to document next
            </Link>
            .
          </p>
        </aside>
      )}

      <section aria-labelledby="sources-h">
        <h3 id="sources-h" className="text-[13px] uppercase tracking-wide text-dust">
          Evidence the answer cites
        </h3>
        <ol className="mt-2 space-y-3">
          {used.map((c) => (
            <SourceCard
              key={c.n}
              c={c}
              active={active === c.n}
              refCb={(el) => {
                if (el) refs.current.set(c.n, el);
              }}
            />
          ))}
        </ol>
        {others.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[14px] text-water">
              {others.length} more {others.length === 1 ? "passage" : "passages"} read but not cited
            </summary>
            <ol className="mt-2 space-y-3">
              {others.map((c) => (
                <SourceCard key={c.n} c={c} active={false} refCb={() => {}} />
              ))}
            </ol>
          </details>
        )}
      </section>
    </section>
  );
}

/** Turns "[2]" in the answer into small buttons that jump to that source. */
function CitedText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  // "[2]" and grouped "[1, 2]" both become one small button per number
  const parts = text.split(/(\[\d+(?:\s*[,;]\s*\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^\[\d/.test(part)) return <Fragment key={i}>{part}</Fragment>;
        const nums = (part.match(/\d+/g) ?? []).map(Number);
        return (
          <Fragment key={i}>
            {nums.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onCite(n)}
                aria-label={`Show source ${n}`}
                className="mx-0.5 inline-grid h-5 min-w-5 place-items-center rounded bg-water-soft px-1 align-super text-[11px] font-semibold text-water hover:bg-water hover:text-paper"
              >
                {n}
              </button>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

function SourceCard({ c, active, refCb }: { c: AskCitation; active: boolean; refCb: (el: HTMLLIElement | null) => void }) {
  const isWeb = c.source.origin === "web" || c.source.type === "web";
  const link = c.source.source_url || c.source.file_url;
  return (
    <li
      ref={refCb}
      className={`rounded-md border bg-paper p-4 transition ${active ? "border-water ring-2 ring-water/30" : "border-line"}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="grid h-6 min-w-6 place-items-center rounded bg-water px-1.5 font-semibold text-paper">{c.n}</span>
        <span
          className={`rounded-full px-2 py-0.5 ${isWeb ? "bg-sand text-dust" : "bg-ochre-soft text-ochre"}`}
          title={isWeb ? "Imported published reference" : "Recorded by a contributor"}
        >
          {isWeb ? "Published reference" : "Field record"}
        </span>
        <span className="text-ink">{c.source.filename}</span>
        {c.source.page != null && <span className="text-dust">p. {c.source.page}</span>}
      </div>
      <p className="mt-2 line-clamp-5 font-serif text-[15px] leading-relaxed text-ink/90">{c.excerpt}</p>
      <p className="mt-2 text-[12px] text-dust">
        {c.source.author && <>by {c.source.author}</>}
        {c.source.author && c.source.licence && " · "}
        {c.source.licence}
        {link && (
          <>
            {(c.source.author || c.source.licence) && " · "}
            <a href={link} target="_blank" rel="noreferrer" className="text-water underline underline-offset-2">
              Open source
            </a>
          </>
        )}
      </p>
    </li>
  );
}

function HowItWorks() {
  const items = [
    ["Evidence only", "No outside knowledge: if it isn't in the archive, the answer says so."],
    ["Every sentence cited", "Click a number to see the exact passage and where it came from."],
    ["Disagreements kept", "When records differ, you see each version, not a guess."],
    ["Any language", "Questions and records in English, Hindi and Gujarati are matched by meaning."],
  ];
  return (
    <ul className="mt-10 grid gap-3 sm:grid-cols-2">
      {items.map(([t, d]) => (
        <li key={t} className="rounded-md border border-line bg-paper p-4">
          <p className="font-medium text-ink">{t}</p>
          <p className="mt-1 text-[14px] text-dust">{d}</p>
        </li>
      ))}
    </ul>
  );
}
