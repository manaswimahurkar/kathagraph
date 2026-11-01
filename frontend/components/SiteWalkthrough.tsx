"use client";

import { useEffect, useState } from "react";

// Walk through the site in Google Street View, or look at it from above, without leaving the page.
//
// Why not just pass the monument's coordinates to Street View? Google then opens whichever panorama
// is nearest: often the road outside, or a stranger's photo from a nearby field. So we look at every
// panorama around the site and pick the one that's really *at* it (see findPano), facing the monument.
//
// Needs NEXT_PUBLIC_GOOGLE_MAPS_KEY with two APIs enabled: "Maps Embed API" (the viewer) and
// "Maps JavaScript API" (finding the panorama; these lookups are free). Without the second one it
// still works, the old way. Without a key, the same views open on Google in a new tab.

const KEY = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "").trim();

type Mode = "street" | "aerial";

interface Pano {
  id: string;
  heading: number; // compass direction from the panorama to the monument
  official: boolean; // captured by Google, rather than a visitor's 360° photo
  walkable: boolean; // has arrows to other panoramas
  distance: number; // metres from the monument
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let mapsPromise: Promise<any> | null = null;

/** Loads Google's Maps JavaScript API once, just for the Street View lookup (no map is drawn). */
function loadMaps(): Promise<any> {
  const w = window as any;
  if (w.google?.maps?.StreetViewService) return Promise.resolve(w.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const cb = `__kgMapsReady${Date.now()}`;
    w[cb] = () => {
      delete w[cb];
      resolve(w.google.maps);
    };
    // If the key isn't allowed to use this API, Google calls this instead of failing loudly.
    w.gm_authFailure = () => reject(new Error("Maps JavaScript API not enabled for this key"));
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error("Couldn't load Google Maps"));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error("Google Maps took too long")), 12_000);
  });
  mapsPromise.catch(() => (mapsPromise = null));
  return mapsPromise;
}

/** Compass bearing from one point to another, in degrees (0 = north, 90 = east). */
function bearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((toLng - fromLng) * r) * Math.cos(toLat * r);
  const x = Math.cos(fromLat * r) * Math.sin(toLat * r) - Math.sin(fromLat * r) * Math.cos(toLat * r) * Math.cos((toLng - fromLng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const x = (bLng - aLng) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

const cache = new Map<string, Promise<Pano | null>>();

// Words that don't identify a particular site, so they don't count when matching names.
const GENERIC = new Set([
  "the", "and", "ni", "ki", "ka", "of", "at", "temple", "temples", "mosque", "masjid", "fort", "lake", "caves", "cave",
  "palace", "tomb", "stepwell", "vav", "complex", "group", "groups", "jain", "gujarat", "india", "shree", "shri",
]);
/** First 4 letters, so spellings like Saiyyed/Saiyad or Darwaza/Darwaja still match. */
const stem = (w: string) => w.slice(0, 4);
const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w)).map(stem);
const ROAD = /\b(rd|road|highway|hwy|marg|street|st|nh|sh)\b/i;

interface Candidate extends Pano {
  score: number;
}

/**
 * Finds the best panorama for a site. Google's car imagery mostly runs along the road outside a monument,
 * while the views *inside* a site are usually 360° photos and tours visitors took there, labelled with the
 * site's name. So we sample the area around the pin and score every panorama we find:
 *   - a visitor's panorama named after this site: best (more so if it's a tour you can walk through)
 *   - Google's own imagery that isn't on a road: good
 *   - Google imagery on a road: a last resort
 *   - a visitor's panorama named after something else (a shop, a person): never
 * Closer is better throughout.
 */
function findPano(name: string, lat: number, lng: number): Promise<Pano | null> {
  const key = `${name}|${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const maps = await loadMaps();
    const svc = new maps.StreetViewService();
    const DEFAULT = maps.StreetViewSource?.DEFAULT ?? "default";
    const NEAREST = maps.StreetViewPreference?.NEAREST ?? "nearest";
    // "Kirti Mandir, Porbandar" -> match on "Kirti Mandir", not the town
    const site = [...new Set(words(name.split(",")[0]))];

    async function sample(spread: number): Promise<Candidate[]> {
      const pts: { lat: number; lng: number }[] = [];
      for (const dy of [-1, -0.5, 0, 0.5, 1]) for (const dx of [-1, -0.5, 0, 0.5, 1]) pts.push({ lat: lat + dy * spread, lng: lng + dx * spread });
      const found = new Map<string, Candidate>();
      await Promise.all(
        pts.map(async (p) => {
          try {
            const { data } = await svc.getPanorama({ location: p, radius: 50, sources: [DEFAULT], preference: NEAREST });
            const L = data?.location;
            if (!L?.pano || !L.latLng || found.has(L.pano)) return;
            const pLat = L.latLng.lat();
            const pLng = L.latLng.lng();
            const desc: string = (L.description ?? "").trim();
            const official = /google/i.test(data.copyright ?? "");
            const walkable = (data.links ?? []).length > 0;
            const d = metres(pLat, pLng, lat, lng);
            const w = words(desc);
            const named = site.length ? site.filter((t) => w.includes(t)).length / site.length : 0;
            let score: number;
            if (official) score = ROAD.test(desc) ? -3 : 1;
            else if (named > 0) score = 4 * named + (walkable ? 1.5 : 0);
            else return; // someone else's photo (a shop, a person): not this site
            score -= d / 60;
            const heading = d < 10 ? (data.tiles?.centerHeading ?? 0) : bearing(pLat, pLng, lat, lng);
            found.set(L.pano, { id: L.pano, heading, official, walkable, distance: Math.round(d), score });
          } catch {
            // nothing within 50 m of this point
          }
        }),
      );
      return [...found.values()];
    }

    // about 75 m around the pin first, then about 220 m if nothing turns up
    let all = await sample(0.0007);
    if (all.length === 0) all = await sample(0.002);
    all.sort((a, b) => b.score - a.score);
    return all[0] ?? null;
  })();
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  return job;
}

type Lookup = { kind: "finding" } | { kind: "found"; pano: Pano } | { kind: "none" } | { kind: "fallback" };

export default function SiteWalkthrough({ name, lat, lng }: { name: string; lat: number; lng: number }) {
  const [mode, setMode] = useState<Mode>("street");
  const [lookup, setLookup] = useState<Lookup>({ kind: KEY ? "finding" : "fallback" });

  useEffect(() => {
    if (!KEY) return;
    let alive = true;
    setLookup({ kind: "finding" });
    findPano(name, lat, lng)
      .then((pano) => alive && setLookup(pano ? { kind: "found", pano } : { kind: "none" }))
      .catch(() => alive && setLookup({ kind: "fallback" })); // lookup unavailable: old behaviour
    return () => {
      alive = false;
    };
  }, [name, lat, lng]);

  const loc = `${lat},${lng}`;
  const pano = lookup.kind === "found" ? lookup.pano : null;
  const h = pano ? Math.round(pano.heading) : 0;

  const streetEmbed = pano
    ? `https://www.google.com/maps/embed/v1/streetview?key=${KEY}&pano=${pano.id}&heading=${h}&pitch=5&fov=90`
    : `https://www.google.com/maps/embed/v1/streetview?key=${KEY}&location=${loc}&heading=0&pitch=0&fov=90`;
  const aerialEmbed = `https://www.google.com/maps/embed/v1/view?key=${KEY}&center=${loc}&zoom=18&maptype=satellite`;
  const streetLink = pano
    ? `https://www.google.com/maps/@?api=1&map_action=pano&pano=${pano.id}&heading=${h}`
    : `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${loc}`;
  const earthLink = `https://earth.google.com/web/@${lat},${lng},120a,500d,35y,0h,60t,0r`;

  // No Street View near this site at all: open on the aerial view instead of a black panel.
  const noStreet = lookup.kind === "none";
  const shown: Mode = noStreet ? "aerial" : mode;

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
                aria-selected={shown === m}
                disabled={m === "street" && noStreet}
                onClick={() => setMode(m)}
                className={`rounded px-3 py-1.5 text-[14px] disabled:cursor-not-allowed disabled:opacity-40 ${
                  shown === m ? "bg-ink text-paper" : "text-dust hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-sm border border-line bg-sand">
            {shown === "street" && lookup.kind === "finding" ? (
              <div className="kg-skeleton grid aspect-[16/10] w-full place-items-center text-[14px] text-dust">
                Finding the best Street View spot…
              </div>
            ) : (
              <iframe
                key={`${shown}-${pano?.id ?? "loc"}`}
                title={`${name}: ${shown === "street" ? "Street View" : "aerial view"}`}
                src={shown === "street" ? streetEmbed : aerialEmbed}
                className="aspect-[16/10] w-full"
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
              />
            )}
          </div>
          <p className="mt-2 text-[13px] text-dust">
            {noStreet ? (
              <>Google has no Street View at this site yet, so here it is from above. </>
            ) : pano && !pano.walkable ? (
              <>This is a 360° photo taken at the site: drag to look around. </>
            ) : pano ? (
              <>
                Drag to look around and click the arrows on the ground to walk
                {pano.distance > 60 && `. This view starts about ${pano.distance} m from the site, facing it`}.{" "}
              </>
            ) : (
              <>Drag to look around and click the arrows to walk. </>
            )}
            Or try{" "}
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
        {!noStreet && (
          <a
            href={streetLink}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-water px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90"
          >
            Open Street View
          </a>
        )}
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
