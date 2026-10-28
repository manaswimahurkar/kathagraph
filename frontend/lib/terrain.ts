// Builds the 3D relief of Gujarat.
//
// Elevation comes from AWS Terrain Tiles (public dataset, mostly NASA SRTM), loaded by the browser.
// If those can't be reached, a hand-sculpted approximation of Gujarat's main hills is used instead,
// so the map never fails to appear.

import { GUJARAT_BBOX, GUJARAT_OUTLINE, project } from "./geo";

const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const ZOOM = 7; // ~1.2 km per pixel: plenty for a whole state
const PAD = 0.08; // degrees of margin around the state

/** Vertical exaggeration: real Gujarat is very flat at this scale. */
export const EXAG = 0.00225; // map units per metre (≈ 25× real)

export type ElevationSource = "srtm" | "approximate";

export interface Terrain {
  nx: number;
  nz: number;
  positions: Float32Array; // x, y, z per vertex
  elevation: Float32Array; // metres per vertex
  mask: Float32Array; // 1 inside Gujarat, 0 outside
  lonlat: Float32Array; // longitude, latitude per vertex (for draping map imagery)
  indices: Uint32Array;
  /** Height in map units at any longitude/latitude. */
  heightAt: (lon: number, lat: number) => number;
  source: ElevationSource;
}

const bbox = {
  west: GUJARAT_BBOX.west - PAD,
  east: GUJARAT_BBOX.east + PAD,
  south: GUJARAT_BBOX.south - PAD,
  north: GUJARAT_BBOX.north + PAD,
};

// ---------- web-mercator tile maths ----------
/** Tile coordinates (fractional) of a longitude / latitude at a zoom level. */
export const tileXAt = (lon: number, zoom: number) => ((lon + 180) / 360) * 2 ** zoom;
export const tileYAt = (lat: number, zoom: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** zoom;
};
const tileX = (lon: number) => tileXAt(lon, ZOOM);
const tileY = (lat: number) => tileYAt(lat, ZOOM);

/** The padded area the terrain covers, in degrees. */
export const TERRAIN_BBOX = bbox;

function loadImage(url: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
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

/** Downloads the SRTM tiles covering Gujarat and returns an elevation sampler, or throws. */
async function loadSrtm(): Promise<(lon: number, lat: number) => number> {
  const x0 = Math.floor(tileX(bbox.west));
  const x1 = Math.floor(tileX(bbox.east));
  const y0 = Math.floor(tileY(bbox.north));
  const y1 = Math.floor(tileY(bbox.south));
  const w = (x1 - x0 + 1) * 256;
  const h = (y1 - y0 + 1) * 256;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");

  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const url = TILE_URL.replace("{z}", String(ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
      jobs.push(loadImage(url, 10_000).then((img) => ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256)));
    }
  }
  await Promise.all(jobs);

  const px = ctx.getImageData(0, 0, w, h).data;
  const elev = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Terrarium encoding: (R * 256 + G + B / 256) - 32768
    elev[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  }

  return (lon, lat) => {
    const fx = (tileX(lon) - x0) * 256 - 0.5;
    const fy = (tileY(lat) - y0) * 256 - 0.5;
    const ix = Math.max(0, Math.min(w - 2, Math.floor(fx)));
    const iy = Math.max(0, Math.min(h - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - ix));
    const ty = Math.min(1, Math.max(0, fy - iy));
    const a = elev[iy * w + ix];
    const b = elev[iy * w + ix + 1];
    const c = elev[(iy + 1) * w + ix];
    const d = elev[(iy + 1) * w + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

// ---------- fallback: Gujarat's main hills, sculpted by hand ----------
const HILLS: [lon: number, lat: number, metres: number, radiusDeg: number][] = [
  [70.53, 21.53, 1050, 0.16], // Girnar
  [70.85, 21.15, 420, 0.45], // Gir hills
  [69.77, 21.85, 560, 0.13], // Barda
  [71.8, 21.48, 380, 0.16], // Shetrunjaya
  [73.53, 22.46, 780, 0.08], // Pavagadh
  [73.75, 20.62, 950, 0.3], // Saputara, Western Ghats
  [73.45, 20.95, 560, 0.3],
  [72.85, 24.3, 900, 0.32], // Aravallis near Ambaji
  [73.25, 23.9, 600, 0.4],
  [74.05, 22.85, 480, 0.4], // Panchmahal / Dahod
  [73.65, 21.75, 680, 0.3], // Rajpipla hills
  [69.75, 23.5, 330, 0.35], // Kachchh ridges
  [69.85, 23.95, 460, 0.12], // Kalo Dungar
];

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function approximateElevation(lon: number, lat: number) {
  // the plain rises gently from the coast towards the north-east
  let e = 8 + Math.max(0, lon - 70.2) * 28 + Math.max(0, lat - 21) * 22;
  // the Rann of Kachchh is a salt flat barely above sea level
  const rann = Math.min(1, Math.max(0, (lat - 23.7) / 0.15)) * Math.min(1, Math.max(0, (lon - 69.3) / 0.2, 0)) * Math.min(1, Math.max(0, (71.7 - lon) / 0.2));
  e = e * (1 - rann) + 4 * rann;
  for (const [hx, hy, m, r] of HILLS) {
    const d2 = ((lon - hx) ** 2 + (lat - hy) ** 2) / (r * r);
    e += m * Math.exp(-d2 * 1.6);
  }
  const ridges = noise(lon * 6, lat * 6) * 0.6 + noise(lon * 14, lat * 14) * 0.3 + noise(lon * 30, lat * 30) * 0.1;
  return e * (0.75 + ridges * 0.5);
}

// ---------- the mesh ----------

/** 1 inside the state outline, 0 outside, rasterised at the grid's resolution. */
function rasteriseMask(nx: number, nz: number) {
  const canvas = document.createElement("canvas");
  canvas.width = nx;
  canvas.height = nz;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  for (const ring of GUJARAT_OUTLINE) {
    ring.forEach(([lon, lat], i) => {
      const x = ((lon - bbox.west) / (bbox.east - bbox.west)) * (nx - 1) + 0.5;
      const y = ((bbox.north - lat) / (bbox.north - bbox.south)) * (nz - 1) + 0.5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.fill();
  const px = ctx.getImageData(0, 0, nx, nz).data;
  const mask = new Float32Array(nx * nz);
  for (let i = 0; i < nx * nz; i++) mask[i] = px[i * 4 + 3] / 255;
  return mask;
}

export async function buildTerrain(detail: "full" | "lite"): Promise<Terrain> {
  let sample: (lon: number, lat: number) => number;
  let source: ElevationSource = "srtm";
  try {
    sample = await loadSrtm();
  } catch {
    sample = approximateElevation;
    source = "approximate";
  }

  const nx = detail === "full" ? 340 : 170;
  const nz = Math.round(nx * ((bbox.north - bbox.south) / (bbox.east - bbox.west)) * 1.08);
  const positions = new Float32Array(nx * nz * 3);
  const elevation = new Float32Array(nx * nz);
  const lonlat = new Float32Array(nx * nz * 2);
  const mask = rasteriseMask(nx, nz);

  for (let j = 0; j < nz; j++) {
    const lat = bbox.north - (j / (nz - 1)) * (bbox.north - bbox.south);
    for (let i = 0; i < nx; i++) {
      const lon = bbox.west + (i / (nx - 1)) * (bbox.east - bbox.west);
      const k = j * nx + i;
      const e = Math.max(0, sample(lon, lat));
      const [x, z] = project(lon, lat);
      elevation[k] = e;
      lonlat[k * 2] = lon;
      lonlat[k * 2 + 1] = lat;
      positions[k * 3] = x;
      positions[k * 3 + 1] = e * EXAG;
      positions[k * 3 + 2] = z;
    }
  }

  // Only keep triangles that touch the state, so the mesh is just Gujarat.
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (mask[a] + mask[b] + mask[c] + mask[d] === 0) continue;
      idx.push(a, c, b, b, c, d);
    }
  }

  return {
    nx,
    nz,
    positions,
    elevation,
    mask,
    lonlat,
    indices: new Uint32Array(idx),
    heightAt: (lon, lat) => Math.max(0, sample(lon, lat)) * EXAG,
    source,
  };
}
