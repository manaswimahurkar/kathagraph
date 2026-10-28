"use client";

import { useEffect, useState } from "react";
import { getSource, USE_MOCK } from "@/lib/api";
import { tagLabel, type EntitySource } from "@/lib/types";

interface Photo {
  source: EntitySource;
  url: string | null;
}

/**
 * Photos linked to a monument. The entity response lists photo sources without URLs,
 * so each one's file_url comes from GET /sources/{id}.
 */
export default function PhotoGallery({ sources, citation }: { sources: EntitySource[]; citation: Map<number, number> }) {
  const photos = sources.filter((s) => s.type === "photo");
  const [items, setItems] = useState<Photo[] | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(
      photos.map((s) =>
        getSource(s.id)
          .then((d) => ({ source: s, url: d.file_url }))
          .catch(() => ({ source: s, url: null })),
      ),
    ).then((r) => alive && setItems(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (photos.length === 0) return null;
  const shown = items?.filter((p): p is Photo & { url: string } => !!p.url) ?? [];
  const noPreview = items?.filter((p) => !p.url) ?? [];
  // Nothing to show once loaded: keep the page tidy (the files are still listed under Sources).
  if (items && shown.length === 0) return null;

  return (
    <section aria-labelledby="photos-h" className="pb-10">
      <h2 id="photos-h" className="sr-only">
        Photographs
      </h2>
      {!items ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Loading photos">
          <div className="kg-skeleton col-span-2 aspect-[4/3] sm:col-span-2" />
          <div className="kg-skeleton aspect-[4/3]" />
        </div>
      ) : (
        <ul className={`grid gap-2 ${shown.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
          {shown.map((p, i) => (
            <li key={p.source.id} className={i === 0 && shown.length > 2 ? "col-span-2 row-span-2" : ""}>
              <figure className="group relative h-full overflow-hidden rounded-sm border border-line bg-sand">
                <button type="button" onClick={() => setOpen(p)} className="block h-full w-full" aria-label={`Enlarge ${p.source.filename}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- files come from the archive's own storage */}
                  <img
                    src={p.url}
                    alt={`${tagLabel(p.source.tag) ?? "Photo"}: ${p.source.filename}`}
                    loading="lazy"
                    onError={(e) => {
                      // a broken link shouldn't leave a broken image: hide that tile
                      const tile = e.currentTarget.closest("li");
                      if (tile) tile.style.display = "none";
                    }}
                    className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] ${
                      shown.length === 1 ? "aspect-[16/9]" : "aspect-[4/3]"
                    }`}
                  />
                </button>
                <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-1.5 pt-6 text-[12px] text-white">
                  [{citation.get(p.source.id) ?? "?"}] {tagLabel(p.source.tag) ?? p.source.filename}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[12px] text-dust">
        {noPreview.length > 0 && `${noPreview.length} more ${noPreview.length === 1 ? "photo has" : "photos have"} no preview yet. `}
        {USE_MOCK && "Demo photos: Wikimedia Commons (CC BY-SA), loaded from Wikipedia."}
      </p>

      {open?.url && (
        <div
          role="dialog"
          aria-label={open.source.filename}
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-[2000] grid place-items-center bg-black/85 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.url} alt={open.source.filename} className="max-h-[85vh] max-w-full rounded-sm shadow-2xl" />
          <p className="mt-3 text-center text-[13px] text-white/80">
            {open.source.filename} · click anywhere or press Esc to close
          </p>
        </div>
      )}
    </section>
  );
}
