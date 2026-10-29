"use client";

import { useEffect, useState } from "react";
import { addModel } from "@/lib/api";
import { embedUrl, type SiteModel } from "@/lib/models";
import type { EntityModel } from "@/lib/types";

/** One model to show: a Sketchfab embed or a .glb/.gltf file. */
interface Shown {
  key: string;
  label: string;
  provider: "sketchfab" | "file";
  uid?: string;
  url?: string;
  title: string;
  author?: string | null;
  authorUrl?: string | null;
  pageUrl?: string | null;
  licence?: string | null;
}

function fromCurated(m: SiteModel): Shown {
  return { key: `c-${m.uid}`, label: m.label, provider: "sketchfab", uid: m.uid, title: m.title, author: m.author, authorUrl: m.authorUrl, pageUrl: m.modelUrl };
}

function fromServer(m: EntityModel, i: number): Shown | null {
  if (m.provider === "sketchfab" && m.uid) {
    return {
      key: `s-${m.id}`, label: m.title?.slice(0, 24) || `Model ${i + 1}`, provider: "sketchfab", uid: m.uid, title: m.title,
      author: m.author, authorUrl: m.author_url, pageUrl: `https://sketchfab.com/3d-models/${m.uid}`, licence: m.licence,
    };
  }
  if (m.provider === "file" && m.url) {
    return { key: `s-${m.id}`, label: m.title?.slice(0, 24) || `Model ${i + 1}`, provider: "file", url: m.url, title: m.title, author: m.author, authorUrl: m.author_url, licence: m.licence };
  }
  return null;
}

/** Pulls the 32-character model id out of any Sketchfab model link. */
export function sketchfabUid(link: string): string | null {
  const m = link.trim().match(/sketchfab\.com\/(?:3d-models\/[^/?#]*-|models\/)([0-9a-f]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The 3D model at the top of a monument's page: turn it, zoom and pan. If there's none yet,
 * says so and lets the visitor add one (a Sketchfab link or a .glb/.gltf file).
 */
export default function Model3D({
  entityId,
  name,
  curated,
  fromArchive = [],
}: {
  entityId: number;
  name: string;
  curated: SiteModel[];
  fromArchive?: EntityModel[];
}) {
  const [added, setAdded] = useState<EntityModel[]>([]);
  const models: Shown[] = [
    ...curated.map(fromCurated),
    ...[...fromArchive, ...added].map(fromServer).filter((m): m is Shown => !!m),
  ].filter((m, i, all) => !m.uid || all.findIndex((x) => x.uid === m.uid) === i); // same Sketchfab model only once

  const [i, setI] = useState(0);
  const [adding, setAdding] = useState(false);
  const m = models[Math.min(i, models.length - 1)];

  return (
    <section aria-labelledby="model-h" className="pb-8">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="model-h" className="text-[13px] tracking-wide text-ochre">
            {models.length ? "3D model · drag to turn, scroll or pinch to zoom" : "3D model"}
          </h2>
        </div>
        {models.length > 1 && (
          <div role="tablist" aria-label="Choose a model" className="inline-flex flex-wrap rounded-md border border-line p-0.5">
            {models.map((x, k) => (
              <button
                key={x.key}
                role="tab"
                aria-selected={k === i}
                onClick={() => setI(k)}
                className={`rounded px-3 py-1 text-[13px] ${k === i ? "bg-ink text-paper" : "text-dust hover:text-ink"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {m ? (
        <>
          <div className="overflow-hidden rounded-sm border border-line bg-[#111]">
            {m.provider === "sketchfab" ? (
              <iframe
                key={m.key}
                title={`${name}: 3D model, ${m.label}`}
                src={embedUrl(m.uid!)}
                className="aspect-[4/3] w-full sm:aspect-[16/9]"
                allow="autoplay; fullscreen; xr-spatial-tracking"
                allowFullScreen
              />
            ) : (
              <FileModel key={m.key} url={m.url!} alt={`${name}: 3D model, ${m.title}`} />
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-dust">
            3D model:{" "}
            {m.pageUrl ? (
              <a href={m.pageUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                “{m.title}”
              </a>
            ) : (
              <>“{m.title}”</>
            )}
            {m.author && (
              <>
                {" "}by{" "}
                {m.authorUrl ? (
                  <a href={m.authorUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                    {m.author}
                  </a>
                ) : (
                  m.author
                )}
              </>
            )}
            {m.licence ? `, ${m.licence}.` : m.provider === "sketchfab" ? ", shown with the Sketchfab viewer. All rights remain with the author." : "."}{" "}
            <button type="button" onClick={() => setAdding((a) => !a)} className="text-water underline underline-offset-2">
              Add another model
            </button>
          </p>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-line bg-paper/60 px-5 py-6 text-center">
          <p className="font-serif text-lg">No 3D model of {name} yet</p>
          <p className="mx-auto mt-1 max-w-md text-[15px] text-dust">
            We couldn&apos;t find one online. If you&apos;ve made a 3D scan of this site (for example with a phone
            photogrammetry app), add it here so everyone can explore it.
          </p>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-3 rounded-md bg-water px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90"
            >
              Add a 3D model
            </button>
          )}
        </div>
      )}

      {adding && (
        <AddModel
          entityId={entityId}
          name={name}
          onCancel={() => setAdding(false)}
          onAdded={(model) => {
            setAdded((a) => [...a, model]);
            setAdding(false);
            setI(models.length); // show the new one
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** Shows a .glb/.gltf file with Google's <model-viewer>, loaded only when needed. */
function FileModel({ url, alt }: { url: string; alt: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (customElements.get("model-viewer")) return setReady(true);
    const id = "model-viewer-script";
    let s = document.getElementById(id) as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement("script");
      s.id = id;
      s.type = "module";
      s.src = "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";
      document.head.appendChild(s);
    }
    customElements.whenDefined("model-viewer").then(() => setReady(true));
  }, []);
  if (!ready) return <div className="kg-skeleton aspect-[4/3] w-full sm:aspect-[16/9]" />;
  // model-viewer is a web component; React passes these through as attributes
  return (
    <model-viewer
      src={url}
      alt={alt}
      camera-controls=""
      touch-action="pan-y"
      shadow-intensity="1"
      exposure="1"
      style={{ display: "block", width: "100%", aspectRatio: "16 / 9", background: "#111" }}
    />
  );
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

// ---------------------------------------------------------------------------

function AddModel({
  entityId,
  name,
  onCancel,
  onAdded,
}: {
  entityId: number;
  name: string;
  onCancel: () => void;
  onAdded: (m: EntityModel) => void;
}) {
  const [mode, setMode] = useState<"link" | "file">("link");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uid = sketchfabUid(link);
  const fileOk = !!file && /\.(glb|gltf)$/i.test(file.name) && file.size <= 50 * 1024 * 1024;
  const ready = rights && (mode === "link" ? !!uid : fileOk);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const model = await addModel(entityId, mode === "link" ? { sketchfabUrl: link.trim(), sketchfabUid: uid! } : { file: file! });
      onAdded(model);
    } catch (err) {
      const msg = (err as Error).message;
      setError(/not found|405|404/i.test(msg) ? "Adding 3D models isn't switched on in the archive yet. Please try again later." : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-md border border-line bg-paper p-4">
      <p className="font-medium">Add a 3D model of {name}</p>
      <div role="tablist" aria-label="How to add it" className="mt-2 inline-flex rounded-md border border-line p-0.5">
        {(
          [
            ["link", "Paste a Sketchfab link"],
            ["file", "Upload a .glb / .gltf file"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={`rounded px-3 py-1 text-[13px] ${mode === k ? "bg-ink text-paper" : "text-dust hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "link" ? (
        <label className="mt-3 block text-[14px]">
          <span className="text-dust">Sketchfab model link</span>
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://sketchfab.com/3d-models/…"
            className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[15px] outline-none focus:border-water"
          />
          {link && !uid && <span className="mt-1 block text-[13px] text-rust">That doesn&apos;t look like a Sketchfab model link.</span>}
        </label>
      ) : (
        <label className="mt-3 block text-[14px]">
          <span className="text-dust">3D file (.glb or .gltf, up to 50 MB)</span>
          <input
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-[14px]"
          />
          {file && !fileOk && <span className="mt-1 block text-[13px] text-rust">Choose a .glb or .gltf file under 50 MB.</span>}
        </label>
      )}

      <label className="mt-3 flex items-start gap-2 text-[14px]">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1" />
        <span>I made this model, or I have the right to share it here, and it really shows {name}.</span>
      </label>

      {error && (
        <p role="alert" className="mt-2 text-[14px] text-rust">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={!ready || busy}
          className="rounded-md bg-water px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add model"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-line px-4 py-2 text-[14px] text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
