"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { getSource, upload } from "@/lib/api";
import { useEntities } from "@/lib/useEntities";

const MAX_BYTES = 20 * 1024 * 1024; // CONTRACT.md: 413 above 20 MB
const ACCEPT = ".jpg,.jpeg,.png,.webp,.tif,.tiff,.pdf,.txt,.md,.csv"; // same list as the backend
const ALLOWED = /\.(jpe?g|png|webp|tiff?|pdf|txt|md|csv)$/i;
const POLL_MS = 2000;
const MAX_POLLS = 90; // ~3 minutes

type Phase = "queued" | "uploading" | "pending" | "processing" | "done" | "duplicate" | "failed" | "rejected";

interface Item {
  key: string;
  file: File;
  phase: Phase;
  progress: number;
  sourceId?: number;
  message?: string;
  gps?: boolean;
}

const PHASE_TEXT: Record<Phase, string> = {
  queued: "Waiting",
  uploading: "Uploading",
  pending: "Uploaded, waiting to be read",
  processing: "Reading text and extracting facts",
  done: "Added to the archive",
  duplicate: "Already in the archive",
  failed: "Couldn't be processed",
  rejected: "Not uploaded",
};

const PHASE_STYLE: Record<Phase, string> = {
  queued: "text-dust",
  uploading: "text-ink",
  pending: "text-ink",
  processing: "text-ink",
  done: "text-water",
  duplicate: "text-dust",
  failed: "text-rust",
  rejected: "text-rust",
};

function precheck(f: File): string | null {
  if (!ALLOWED.test(f.name)) return "Only photos, PDFs, text notes and CSV files are accepted.";
  if (f.size > MAX_BYTES) return `This file is ${(f.size / 1024 / 1024).toFixed(1)} MB; the limit is 20 MB.`;
  if (f.size === 0) return "This file is empty.";
  return null;
}

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <UploadView />
    </Suspense>
  );
}

function UploadView() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  // Arriving from a monument page (/upload?monument=1) shows which monument the material is about.
  const monumentId = Number(useSearchParams().get("monument")) || null;
  const { state: entitiesState } = useEntities();
  const monument = entitiesState.kind === "ready" ? entitiesState.entities.find((e) => e.id === monumentId) : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    document.title = "Upload · KathaGraph";
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const patch = (key: string, p: Partial<Item>) =>
    alive.current && setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));

  async function poll(key: string, sourceId: number) {
    for (let i = 0; i < MAX_POLLS && alive.current; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const s = await getSource(sourceId);
        // A finished file can still carry a note, e.g. "OCR skipped": show it, but as a note, not a failure
        if (s.status === "done")
          return patch(key, { phase: "done", gps: s.lat != null && s.lng != null, message: s.error ?? undefined });
        if (s.status === "failed") return patch(key, { phase: "failed", message: s.error ?? "Processing failed." });
        patch(key, { phase: s.status });
      } catch {
        /* keep polling through brief network blips */
      }
    }
    patch(key, { message: "Still processing. Check back on the map in a few minutes." });
  }

  async function send(item: Item) {
    patch(item.key, { phase: "uploading", progress: 0, message: undefined });
    try {
      // One request per file, so each row gets its own progress bar and its own error.
      const res = await upload([item.file], (pct) => patch(item.key, { progress: pct }));
      const src = res.sources[0];
      if (!src) throw new Error("The server didn't return the new file.");
      if (src.status === "duplicate") {
        // The backend recognised identical content (same SHA-256) and did not store it again
        return patch(item.key, {
          phase: "duplicate",
          sourceId: src.duplicate_of ?? src.id,
          progress: 100,
          message: src.error ?? `Identical to a file already in the archive (source #${src.duplicate_of ?? src.id}).`,
        });
      }
      patch(item.key, { phase: src.status, sourceId: src.id, progress: 100 });
      if (src.status === "pending" || src.status === "processing") void poll(item.key, src.id);
    } catch (e) {
      patch(item.key, { phase: "rejected", message: (e as Error).message });
    }
  }

  async function addFiles(files: FileList | File[]) {
    if (!confirmed) return;
    const fresh: Item[] = Array.from(files).map((file, i) => {
      const problem = precheck(file);
      return {
        key: `${Date.now()}-${i}-${file.name}`,
        file,
        phase: problem ? "rejected" : "queued",
        progress: 0,
        message: problem ?? undefined,
      };
    });
    setItems((list) => [...fresh, ...list]);

    // Two uploads at a time.
    const queue = fresh.filter((it) => it.phase === "queued");
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) await send(it);
    };
    await Promise.all([worker(), worker()]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (confirmed && e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  }

  const finished = items.filter((i) => ["done", "duplicate", "failed", "rejected"].includes(i.phase)).length;
  const added = items.filter((i) => i.phase === "done").length;

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
      {monument && (
        <p className="mb-2 text-[14px] text-dust">
          Adding material about{" "}
          <Link href={`/monument/${monument.id}`} className="font-medium text-water underline underline-offset-2">
            {monument.name}
          </Link>
        </p>
      )}
      <h1 className="font-display text-4xl sm:text-5xl">Add new material to the archive</h1>
      <p className="mt-2 max-w-xl text-[17px] text-dust">
        Photos, scanned documents in English or Hindi, and field notes. KathaGraph reads the GPS and text, then links
        each file to its monument.
      </p>

      <div className="mt-6 rounded-sm border border-ochre/40 bg-ochre-soft/50 p-4">
        <p className="font-medium text-ochre">Only upload material that is new</p>
        <p className="mt-1 text-[15px] leading-relaxed">
          The archive is for evidence that isn&apos;t recorded anywhere else yet: your own photos, field notes, sketches, or
          unpublished family and community documents. Please don&apos;t upload files that are already in this archive
          (check the monument&apos;s Sources list) or that are already on the internet, such as photos from websites or
          text from Wikipedia and books. Openly licensed images (for example from Wikimedia Commons) are fine when
          their licence allows it and the author is credited.
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[15px]">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[var(--color-water)]"
          />
          <span>
            I confirm these files are new, or openly licensed and credited, and that I have the right to share them.
          </span>
        </label>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (confirmed) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-disabled={!confirmed}
        className={`mt-6 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-[colors,opacity] ${
          dragging ? "border-water bg-water-soft" : "border-dust/50 bg-paper"
        } ${confirmed ? "" : "opacity-55"}`}
      >
        <p className="font-serif text-xl">
          {!confirmed ? "Tick the box above to start" : dragging ? "Drop to upload" : "Drag files here"}
        </p>
        <p className="mt-1 text-[15px] text-dust">JPG, PNG, PDF, TXT or CSV, up to 20 MB each</p>
        <button
          type="button"
          disabled={!confirmed}
          onClick={() => inputRef.current?.click()}
          className="mt-5 rounded-md bg-water px-5 py-2.5 text-[15px] font-medium text-paper disabled:cursor-not-allowed"
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = ""; // allow choosing the same file again
          }}
        />
      </div>

      {items.length > 0 && (
        <section className="mt-8" aria-label="Upload progress">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl">
              {finished < items.length ? `Uploading ${items.length - finished} of ${items.length}` : `${added} of ${items.length} added`}
            </h2>
            {finished > 0 && (
              <button
                onClick={() => setItems((l) => l.filter((i) => !["done", "duplicate", "failed", "rejected"].includes(i.phase)))}
                className="text-sm text-dust underline-offset-2 hover:text-ink hover:underline"
              >
                Clear finished
              </button>
            )}
          </div>

          <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-paper" aria-live="polite">
            {items.map((it) => (
              <li key={it.key} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[15px]" title={it.file.name}>
                    {it.file.name}
                  </span>
                  <span className="shrink-0 text-[13px] text-dust">{formatSize(it.file.size)}</span>
                </div>
                <p className={`mt-1 flex items-center gap-2 text-[13px] ${PHASE_STYLE[it.phase]}`}>
                  <StatusDot phase={it.phase} />
                  {PHASE_TEXT[it.phase]}
                  {it.phase === "uploading" && ` ${it.progress}%`}
                  {it.phase === "done" && it.gps && ", GPS location found"}
                </p>
                {it.message && <p className="mt-0.5 text-[13px] text-dust">{it.message}</p>}
                {(it.phase === "uploading" || it.phase === "pending" || it.phase === "processing") && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                    <div
                      className={`h-full rounded-full transition-[width] duration-200 ${
                        it.phase === "uploading" ? "bg-water" : "animate-pulse bg-water/50"
                      }`}
                      style={{ width: it.phase === "uploading" ? `${it.progress}%` : "100%" }}
                    />
                  </div>
                )}
                {it.phase === "rejected" && it.message && !precheck(it.file) && (
                  <button
                    onClick={() => void send(it)}
                    className="mt-1.5 text-[13px] font-medium text-water underline-offset-2 hover:underline"
                  >
                    Try again
                  </button>
                )}
              </li>
            ))}
          </ul>

          {added > 0 && finished === items.length && (
            <p className="mt-4 text-[15px]">
              New facts appear on each monument's page.{" "}
              <Link href="/" className="text-water underline underline-offset-2">
                Back to the map
              </Link>
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function StatusDot({ phase }: { phase: Phase }) {
  const color =
    phase === "done" ? "bg-water" : phase === "failed" || phase === "rejected" ? "bg-rust" : phase === "queued" || phase === "duplicate" ? "bg-dust/50" : "bg-ochre";
  return <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${color}`} />;
}
