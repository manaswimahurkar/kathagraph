// Map styles for the 3D relief of Gujarat, like the layer switcher in Google Maps.
// "Ancient" is drawn by our own shader. The others drape map imagery over the same 3D terrain.

import { TERRAIN_BBOX, tileXAt, tileYAt } from "./terrain";

import type { MapBase, Theme } from "./prefs";

export interface MapStyle {
  key: string; // base + theme, e.g. "satellite-dark"
  base: MapBase;
  theme: Theme;
  /** Tile URL template ({s} subdomain, {z}/{x}/{y}); null for the ancient style. */
  tiles: string | null;
  attribution: string;
  /** Colours around the map: background, the table it sits on, its grid, and the slab's top and sides. */
  background: string;
  table: string;
  grid: string;
  wallTop: string;
  wallSide: string;
  /** Multiplies the land colour: used to dim satellite imagery for dark mode. */
  tint: [number, number, number];
  /** Text colour for names on the land, and for names over the sea/table. */
  land: "ink" | "white" | "slate";
  sea: "gold" | "brown" | "white" | "slate";
}

export const MAP_BASES: { id: MapBase; label: string }[] = [
  { id: "ancient", label: "Ancient" },
  { id: "satellite", label: "Satellite" },
  { id: "map", label: "Map" },
];

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const CARTO = (name: string) => `https://{s}.basemaps.cartocdn.com/rastertiles/${name}/{z}/{x}/{y}.png`;
const OSM_CARTO = "© OpenStreetMap contributors © CARTO";

const STYLES: Record<string, Omit<MapStyle, "key" | "base" | "theme">> = {
  "ancient-dark": {
    tiles: null, attribution: "",
    background: "#17110c", table: "#1c150f", grid: "#c9a46a", wallTop: "#8a6a45", wallSide: "#5c3f25",
    tint: [1, 1, 1], land: "ink", sea: "gold",
  },
  "ancient-light": {
    tiles: null, attribution: "",
    background: "#e8dcc4", table: "#dccdb0", grid: "#8a6a45", wallTop: "#a8875c", wallSide: "#7a5a38",
    tint: [1, 1, 1], land: "ink", sea: "brown",
  },
  "satellite-dark": {
    tiles: ESRI, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    background: "#06080b", table: "#0b0f14", grid: "#6f8aa3", wallTop: "#2c2e2a", wallSide: "#1a1b18",
    tint: [0.62, 0.68, 0.82], land: "white", sea: "white",
  },
  "satellite-light": {
    tiles: ESRI, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    background: "#d9e1e7", table: "#c4cfd8", grid: "#7d8d9a", wallTop: "#5b5a50", wallSide: "#3f3e37",
    tint: [1, 1, 1], land: "white", sea: "slate",
  },
  "map-dark": {
    tiles: CARTO("dark_nolabels"), attribution: OSM_CARTO,
    background: "#0b0d10", table: "#101317", grid: "#4b5560", wallTop: "#2a2d31", wallSide: "#16181b",
    tint: [1, 1, 1], land: "white", sea: "white",
  },
  "map-light": {
    tiles: CARTO("voyager_nolabels"), attribution: OSM_CARTO,
    background: "#d6e4ec", table: "#b5d0de", grid: "#ffffff", wallTop: "#e4ddd0", wallSide: "#b9ae9c",
    tint: [1, 1, 1], land: "slate", sea: "slate",
  },
};

export function resolveStyle(base: MapBase, theme: Theme): MapStyle {
  const key = `${base}-${theme}`;
  return { key, base, theme, ...STYLES[key] };
}

/** The stitched imagery for one style, plus how to map a longitude/latitude onto it. */
export interface Imagery {
  canvas: HTMLCanvasElement;
  zoom: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** Fraction of tiles that failed to load (0 = all good). */
  missing: number;
}

function loadTile(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // needed to use the pixels in WebGL
    const timer = setTimeout(() => reject(new Error("timeout")), 15_000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("tile failed"));
    };
    img.src = url;
  });
}

const cache = new Map<string, Promise<Imagery>>();

/** Downloads and stitches the tiles covering Gujarat. Cached per style and zoom. */
export function loadImagery(style: MapStyle, zoom: number): Promise<Imagery> {
  const key = `${style.tiles}@${zoom}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const job = (async () => {
    if (!style.tiles) throw new Error("This style has no imagery");
    const b = TERRAIN_BBOX;
    const x0 = Math.floor(tileXAt(b.west, zoom));
    const x1 = Math.floor(tileXAt(b.east, zoom));
    const y0 = Math.floor(tileYAt(b.north, zoom));
    const y1 = Math.floor(tileYAt(b.south, zoom));
    const cols = x1 - x0 + 1;
    const rows = y1 - y0 + 1;

    const canvas = document.createElement("canvas");
    canvas.width = cols * 256;
    canvas.height = rows * 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = style.table;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const subs = ["a", "b", "c", "d"];
    const jobs: Promise<void>[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const url = style.tiles
          .replace("{s}", subs[(x + y) % subs.length])
          .replace("{z}", String(zoom))
          .replace("{x}", String(x))
          .replace("{y}", String(y));
        jobs.push(loadTile(url).then((img) => ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256)));
      }
    }
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === results.length) throw new Error("The map imagery couldn't be loaded.");
    return { canvas, zoom, x0, y0, cols, rows, missing: failed / results.length };
  })();

  cache.set(key, job);
  job.catch(() => cache.delete(key)); // allow a retry later
  return job;
}

/** Texture coordinates for each vertex, from its longitude/latitude. */
export function imageryUVs(lonlat: Float32Array, img: Imagery): Float32Array {
  const count = lonlat.length / 2;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    uv[i * 2] = (tileXAt(lonlat[i * 2], img.zoom) - img.x0) / img.cols;
    uv[i * 2 + 1] = 1 - (tileYAt(lonlat[i * 2 + 1], img.zoom) - img.y0) / img.rows;
  }
  return uv;
}
