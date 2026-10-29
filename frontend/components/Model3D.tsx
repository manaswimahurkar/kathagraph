"use client";

import { useState } from "react";
import { embedUrl, type SiteModel } from "@/lib/models";

/**
 * A 3D scan of the monument that you can turn, zoom and pan, at the top of its page.
 * Uses Sketchfab's player: drag to rotate, scroll or pinch to zoom, right-drag or two fingers to pan,
 * double-click to focus on a spot, and the corner button for full screen.
 */
export default function Model3D({ name, models }: { name: string; models: SiteModel[] }) {
  const [i, setI] = useState(0);
  if (models.length === 0) return null;
  const m = models[Math.min(i, models.length - 1)];

  return (
    <section aria-labelledby="model-h" className="pb-8">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 id="model-h" className="text-[13px] tracking-wide text-ochre">
          3D scan · drag to turn, scroll or pinch to zoom
        </h2>
        {models.length > 1 && (
          <div role="tablist" aria-label="Choose a scan" className="inline-flex flex-wrap rounded-md border border-line p-0.5">
            {models.map((x, k) => (
              <button
                key={x.uid}
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

      <div className="overflow-hidden rounded-sm border border-line bg-[#111]">
        <iframe
          key={m.uid}
          title={`${name}: 3D scan, ${m.label}`}
          src={embedUrl(m.uid)}
          className="aspect-[4/3] w-full sm:aspect-[16/9]"
          allow="autoplay; fullscreen; xr-spatial-tracking"
          allowFullScreen
        />
      </div>

      <p className="mt-1.5 text-[12px] text-dust">
        3D model:{" "}
        <a href={m.modelUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
          “{m.title}”
        </a>{" "}
        by{" "}
        <a href={m.authorUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
          {m.author}
        </a>
        , shown with the Sketchfab viewer. All rights remain with the author.
      </p>
    </section>
  );
}
