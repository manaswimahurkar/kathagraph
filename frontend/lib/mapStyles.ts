// Map styles for the 3D relief of Gujarat, like the layer switcher in Google Maps.
// "Ancient" is drawn by our own shader. The others drape map imagery over the same 3D terrain.

import { TERRAIN_BBOX, tileXAt, tileYAt } from "./terrain";

export type MapStyleId = "ancient" | "satellite" | "map" | "light" | "dark";

export interface MapStyle {
  id: MapStyleId;
  label: string;
  /** Tile URL template ({s} subdomain, {z}/{x}/{y}); null for the ancient style. */
  tiles: string | null;
  attribution: string;
  /** Colours around the map: background, the table it sits on, the slab's sides. */
  background: string;
  table: string;
  grid: string;
  wallTop: string;
  wallSide: string;
  /** Whether labels on the map should be light (on dark imagery) or dark. */
  labels: "ancient" | "light" | "dark";
}

export const MAP_STYLES: MapStyle[] = [
  {
    id: "ancient",
    label: "Ancient",
    tiles: null,
    attribution: "",
    background: "#17110c",
    table: "#1c150f",
    grid: "#c9a46a",
    wallTop: "#8a6a45",
    wallSide: "#5c3f25",
    labels: "ancient",
  },
  {
    id: "satellite",
    label: "Satellite",
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    background: "#06080b",
    table: "#0b0f14",
    grid: "#6f8aa3",
    wallTop: "#3a3b33",
    wallSide: "#24251f",
    labels: "light",
  },
  {
    id: "map",
    label: "Map",
    tiles: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    background: "#cfdde6",
    table: "#aac8d9",
    grid: "#ffffff",
    wallTop: "#e4ddd0",
    wallSide: "#b9ae9c",
    labels: "dark",
  },
  {
    id: "light",
    label: "Light",
    tiles: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    background: "#eef0f1",
    table: "#d9dee2",
    grid: "#9aa5ae",
    wallTop: "#f2f2f0",
    wallSide: "#c9cbcc",
    labels: "dark",
  },
  {
    id: "dark",
    label: "Dark",
    tiles: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    background: "#0b0d10",
    table: "#101317",
    grid: "#4b5560",
    wallTop: "#2a2d31",
    wallSide: "#16181b",
    labels: "light",
  },
];

export const styleById = (id: MapStyleId) => MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];

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
  const key = `${style.id}@${zoom}`;
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
    if (failed === results.length) throw new Error(`${style.label} imagery couldn't be loaded.`);
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
