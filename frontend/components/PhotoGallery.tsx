"use client";

import { useEffect, useState } from "react";
import { getSource, USE_MOCK } from "@/lib/api";
import { originOf } from "@/lib/insights";
import { tagLabel, type EntitySource } from "@/lib/types";

interface Photo {
  source: EntitySource;
  url: string | null;
}

/**
 * Photos linked to a monument. The backend (v0.5+) includes each photo's file_url in the
 * entity response; older responses and mock data don't, so those fall back to GET /sources/{id}.
 */
export default function PhotoGallery({ sources, citation }: { sources: EntitySource[]; citation: Map<number, number> }) {
  const photos = sources.filter((s) => s.type === "photo");
  const [items, setItems] = useState<Photo[] | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(
      photos.map((s) =>
        s.file_url !== undefined
          ? Promise.resolve({ source: s, url: s.file_url ?? null })
          : getSource(s.id)
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
  const field = shown.filter((p) => originOf(p.source) === "field");
  const web = shown.filter((p) => originOf(p.source) === "web");
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
        <div className="space-y-5">
          {field.length > 0 && (
            <PhotoGroup
              title={web.length ? "Our field photos" : null}
              hint={web.length ? "Taken and uploaded by contributors." : null}
              photos={field}
              citation={citation}
              onOpen={setOpen}
            />
          )}
          {web.length > 0 && (
            <PhotoGroup
              title="Published photos"
              hint="Imported from Wikimedia Commons, with each photographer's name and licence. They show the site, but don't count as our own documentation."
              photos={web}
              citation={citation}
              onOpen={setOpen}
            />
          )}
        </div>
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
          {open.source.description && (
            <p className="mt-3 max-w-2xl text-center text-[14px] text-white/90">
              <span className="mr-1.5 rounded-sm bg-white/15 px-1.5 py-0.5 text-[11px] uppercase tracking-wide">
                AI description
              </span>
              {open.source.description}
            </p>
          )}
          <p className="mt-2 text-center text-[13px] text-white/80">
            {open.source.filename}
            {(open.source.author || open.source.licence) &&
              ` · ${[open.source.author && `by ${open.source.author}`, open.source.licence].filter(Boolean).join(", ")}`}
            {" "}· click anywhere or press Esc to close
          </p>
        </div>
      )}
    </section>
  );
}

function PhotoGroup({
  title,
  hint,
  photos,
  citation,
  onOpen,
}: {
  title: string | null;
  hint: string | null;
  photos: (Photo & { url: string })[];
  citation: Map<number, number>;
  onOpen: (p: Photo) => void;
}) {
  return (
    <div>
      {title && <h3 className="text-[13px] tracking-wide text-ochre">{title}</h3>}
      {hint && <p className="mb-2 text-[13px] text-dust">{hint}</p>}
      <ul className={`grid gap-2 ${photos.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
        {photos.map((p, i) => (
          <li key={p.source.id} className={i === 0 && photos.length > 2 ? "col-span-2 row-span-2" : ""}>
            <figure className="group relative h-full overflow-hidden rounded-sm border border-line bg-sand">
              <button type="button" onClick={() => onOpen(p)} className="block h-full w-full" aria-label={`Enlarge ${p.source.filename}`}>
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
                    photos.length === 1 ? "aspect-[16/9]" : "aspect-[4/3]"
                  }`}
                />
              </button>
              <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-1.5 pt-6 text-[12px] text-white">
                [{citation.get(p.source.id) ?? "?"}] {tagLabel(p.source.tag) ?? p.source.filename}
                {p.source.author && <span className="block text-[11px] text-white/75">by {p.source.author}{p.source.licence ? `, ${p.source.licence}` : ""}</span>}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </div>
  );
}
