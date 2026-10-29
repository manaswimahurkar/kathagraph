"use client";

import { useState } from "react";

// Walk through the site in Google Street View, or look at it from above, without leaving the page.
// Uses the Google Maps Embed API, which needs NEXT_PUBLIC_GOOGLE_MAPS_KEY (restrict it to your domains).
// Without a key, the same views open on Google in a new tab.

const KEY = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "").trim();

type Mode = "street" | "aerial";

export default function SiteWalkthrough({ name, lat, lng }: { name: string; lat: number; lng: number }) {
  const [mode, setMode] = useState<Mode>("street");
  const loc = `${lat},${lng}`;

  const embed =
    mode === "street"
      ? `https://www.google.com/maps/embed/v1/streetview?key=${KEY}&location=${loc}&heading=0&pitch=0&fov=90`
      : `https://www.google.com/maps/embed/v1/view?key=${KEY}&center=${loc}&zoom=18&maptype=satellite`;
  const streetLink = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${loc}`;
  const earthLink = `https://earth.google.com/web/@${lat},${lng},120a,500d,35y,0h,60t,0r`;

  return (
    <div>
      {KEY ? (
        <>
          <div role="tablist" aria-label="View" className="mb-3 inline-flex rounded-md border border-line p-0.5">
            {(
              [
                ["street", "Walk through (Street View)"],
                ["aerial", "From above"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`rounded px-3 py-1.5 text-[14px] ${mode === m ? "bg-ink text-paper" : "text-dust hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-sm border border-line bg-sand">
            <iframe
              key={mode}
              title={`${name}: ${mode === "street" ? "Street View" : "aerial view"}`}
              src={embed}
              className="aspect-[16/10] w-full"
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <p className="mt-2 text-[13px] text-dust">
            Drag to look around and click the arrows to walk. If Street View shows nothing, Google has no imagery at this
            exact spot yet; try{" "}
            <a href={earthLink} target="_blank" rel="noreferrer" className="text-water underline underline-offset-2">
              Google Earth
            </a>
            .
          </p>
        </>
      ) : (
        <p className="text-[15px]">See {name} as it looks today, in Street View or from the air:</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={streetLink}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-water px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90"
        >
          Open Street View
        </a>
        <a
          href={earthLink}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-line px-4 py-2 text-[14px] text-ink hover:border-ink/40"
        >
          Fly over in Google Earth
        </a>
      </div>
    </div>
  );
}
