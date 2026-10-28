"use client";

// The 3D relief map of Gujarat that sits behind every page.
// Rendered like an old museum relief: parchment and sienna terrain with inked contour lines,
// a carved stone edge, and a graticule on a dark table. Monuments are lit markers on the land.
// Each page sets a "view": the camera glides there. On the home page the map can be dragged and zoomed.
// Loaded with dynamic(..., { ssr: false }) from WorldBackground, because WebGL only exists in the browser.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GUJARAT_OUTLINE, project } from "@/lib/geo";
import { buildTerrain, type ElevationSource, type Terrain } from "@/lib/terrain";
import type { EntitySummary } from "@/lib/types";

export type MapView =
  | { kind: "home" }
  | { kind: "monument"; id: number }
  | { kind: "search" }
  | { kind: "upload" }
  | { kind: "other" };

type Located = EntitySummary & { lat: number; lng: number };

/** Old-map labels. Seas and regions in italic capitals, towns in small serif. */
const PLACES: { name: string; lon: number; lat: number; kind: "sea" | "region" | "town" }[] = [
  { name: "Arabian Sea", lon: 69.1, lat: 20.9, kind: "sea" },
  { name: "Gulf of Kachchh", lon: 69.55, lat: 22.68, kind: "sea" },
  { name: "Gulf of Khambhat", lon: 72.35, lat: 21.55, kind: "sea" },
  { name: "Rann of Kachchh", lon: 70.35, lat: 24.05, kind: "region" },
  { name: "Kachchh", lon: 69.3, lat: 23.35, kind: "region" },
  { name: "Saurashtra", lon: 70.95, lat: 21.95, kind: "region" },
  { name: "Ahmedabad", lon: 72.58, lat: 23.02, kind: "town" },
  { name: "Patan", lon: 72.12, lat: 23.85, kind: "town" },
  { name: "Vadodara", lon: 73.18, lat: 22.31, kind: "town" },
  { name: "Surat", lon: 72.83, lat: 21.17, kind: "town" },
  { name: "Rajkot", lon: 70.8, lat: 22.3, kind: "town" },
  { name: "Bhuj", lon: 69.67, lat: 23.25, kind: "town" },
  { name: "Junagadh", lon: 70.46, lat: 21.52, kind: "town" },
];

// ---------------------------------------------------------------------------
// Terrain shader: parchment → ochre → sienna by height, lit from the north-west,
// contour lines every 50 m (stronger every 250 m), an inked coastline and paper grain.

const vertexShader = /* glsl */ `
  attribute float elev;
  attribute float mask;
  uniform float uRise;
  varying float vElev;
  varying float vMask;
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    vec3 p = position;
    p.y = p.y * uRise + 0.02;
    vElev = elev * uRise;
    vMask = mask;
    vNormal = normalize(normal);
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uLight;
  varying float vElev;
  varying float vMask;
  varying vec3 vNormal;
  varying vec3 vPos;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float contour(float v, float step) {
    float e = v / step;
    float f = abs(fract(e - 0.5) - 0.5) / max(fwidth(e), 1e-4);
    return 1.0 - min(f, 1.0);
  }

  void main() {
    if (vMask < 0.5) discard;

    float t = clamp(vElev / 900.0, 0.0, 1.0);
    vec3 low = vec3(0.925, 0.862, 0.722);
    vec3 mid = vec3(0.792, 0.627, 0.408);
    vec3 high = vec3(0.502, 0.329, 0.196);
    vec3 c = mix(low, mid, smoothstep(0.02, 0.35, t));
    c = mix(c, high, smoothstep(0.35, 1.0, t));

    float diff = max(dot(normalize(vNormal), uLight), 0.0);
    c *= 0.5 + 0.7 * diff;

    float show = smoothstep(10.0, 30.0, vElev);
    vec3 ink = vec3(0.30, 0.19, 0.10);
    c = mix(c, ink, (contour(vElev, 50.0) * 0.2 + contour(vElev, 250.0) * 0.38) * show);

    float edge = 1.0 - smoothstep(0.5, 0.64, vMask);
    c = mix(c, vec3(0.20, 0.12, 0.07), edge * 0.9);

    c *= 0.95 + 0.1 * hash(floor(vPos.xz * 70.0));
    gl_FragColor = vec4(c, 1.0);
  }
`;

function Relief({ terrain, calm }: { terrain: Terrain; calm: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(terrain.positions, 3));
    g.setAttribute("elev", new THREE.BufferAttribute(terrain.elevation, 1));
    g.setAttribute("mask", new THREE.BufferAttribute(terrain.mask, 1));
    g.setIndex(new THREE.BufferAttribute(terrain.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [terrain]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uRise: { value: calm ? 1 : 0 },
          uLight: { value: new THREE.Vector3(-0.55, 0.75, -0.35).normalize() },
        },
      }),
    [calm],
  );

  // The land rises out of the slab when the elevation data arrives.
  useFrame((_, dt) => {
    const u = material.uniforms.uRise;
    if (u.value < 1) u.value = Math.min(1, u.value + dt * 0.45);
  });

  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} />;
}

/** The state as a carved slab: its sides are what you see at the coast and borders. */
function Slab() {
  const geometry = useMemo(() => {
    const shapes = GUJARAT_OUTLINE.map((ring) => {
      const s = new THREE.Shape();
      ring.forEach(([lon, lat], i) => {
        const [x, z] = project(lon, lat);
        if (i === 0) s.moveTo(x, -z);
        else s.lineTo(x, -z);
      });
      return s;
    });
    const g = new THREE.ExtrudeGeometry(shapes, { depth: 0.9, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.885, 0);
    return g;
  }, []);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial attach="material-0" color="#8a6a45" roughness={1} />
      <meshStandardMaterial attach="material-1" color="#5c3f25" roughness={1} />
    </mesh>
  );
}

/** Dark table under the map, with a degree grid like an old chart. */
function Table() {
  const lines = useMemo(() => {
    const pts: number[] = [];
    const y = -0.88;
    for (let lon = 66; lon <= 77; lon++) {
      const [x1, z1] = project(lon, 18.5);
      const [x2, z2] = project(lon, 26.5);
      pts.push(x1, y, z1, x2, y, z2);
    }
    for (let lat = 19; lat <= 26; lat++) {
      const [x1, z1] = project(65.5, lat);
      const [x2, z2] = project(77.5, lat);
      pts.push(x1, y, z1, x2, y, z2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.9, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#1c150f" roughness={1} />
      </mesh>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#c9a46a" transparent opacity={0.2} />
      </lineSegments>
    </>
  );
}

/** A beam of light and a pulsing ring over each monument. */
function Markers({ points, heightAt, selected }: { points: Located[]; heightAt: (lon: number, lat: number) => number; selected: number | null }) {
  const rings = useRef<THREE.Mesh[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    rings.current.forEach((m, i) => {
      if (!m) return;
      const s = 1 + ((t * 0.6 + i * 0.37) % 1) * 2.2;
      m.scale.setScalar(s);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - ((t * 0.6 + i * 0.37) % 1));
    });
  });
  return (
    <>
      {points.map((e, i) => {
        const [x, z] = project(e.lng, e.lat);
        const y = heightAt(e.lng, e.lat) + 0.02;
        const on = selected === e.id;
        const color = e.n_conflicts > 0 ? "#e8a33c" : "#f3d27a";
        return (
          <group key={e.id} position={[x, y, z]}>
            <mesh position={[0, on ? 2.4 : 1.6, 0]}>
              <cylinderGeometry args={[0.04, on ? 0.18 : 0.13, on ? 4.8 : 3.2, 12, 1, true]} />
              <meshBasicMaterial color={color} transparent opacity={on ? 0.85 : 0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]} ref={(m) => void (m && (rings.current[i] = m))}>
              <ringGeometry args={[0.18, 0.24, 32]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0.06, 0]}>
              <sphereGeometry args={[on ? 0.16 : 0.11, 16, 12]} />
              <meshBasicMaterial color={color} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera: spherical coordinates around a target. Each view has its own, and the camera glides.

interface Orbit {
  az: number; // around the vertical; 0 = from the south
  pol: number; // from straight above
  dist: number;
  target: THREE.Vector3;
}

const HOME: Omit<Orbit, "target"> = { az: 0.3, pol: 0.78, dist: 96 };

function CameraRig({
  view,
  points,
  heightAt,
  interactive,
  calm,
}: {
  view: MapView;
  points: Located[];
  heightAt: (lon: number, lat: number) => number;
  interactive: boolean;
  calm: boolean;
}) {
  const { camera, gl, size } = useThree();
  const cur = useRef<Orbit>({ az: 0.9, pol: 0.5, dist: 120, target: new THREE.Vector3() });
  const user = useRef({ ...HOME, lastInput: -10, dragging: false });
  const clock = useRef(0);

  // Drag to turn, wheel or pinch to zoom: only on the home page.
  useEffect(() => {
    if (!interactive) return;
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      user.current.dragging = true;
      user.current.lastInput = clock.current;
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const u = user.current;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...pointers.values()];
        const d1 = Math.hypot(c.x - d.x, c.y - d.y);
        if (pinch && d0 > 0) u.dist = THREE.MathUtils.clamp(u.dist * (d0 / d1), 16, 120);
        pinch = d1;
      } else {
        u.az -= (e.clientX - p.x) * 0.005;
        u.pol = THREE.MathUtils.clamp(u.pol - (e.clientY - p.y) * 0.004, 0.2, 1.22);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      u.lastInput = clock.current;
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
      if (pointers.size === 0) user.current.dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const u = user.current;
      u.dist = THREE.MathUtils.clamp(u.dist * (1 + e.deltaY * 0.0012), 16, 120);
      u.lastInput = clock.current;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.style.touchAction = "none";
    el.style.cursor = "grab";
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.style.touchAction = "";
      el.style.cursor = "";
    };
  }, [interactive, gl]);

  const want = useMemo<Orbit>(() => ({ ...HOME, target: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    clock.current += dt;
    const u = user.current;
    const wide = size.width >= 1024;

    switch (view.kind) {
      case "home": {
        // drift slowly when nobody has touched the map for a while
        if (!calm && !u.dragging && clock.current - u.lastInput > 5) u.az += dt * 0.025;
        want.az = u.az;
        want.pol = u.pol;
        want.dist = u.dist;
        want.target.set(0, 0, 0);
        if (wide) {
          // aim left of centre so Gujarat sits to the right of the side panel
          const shift = want.dist * 0.17;
          want.target.x -= Math.cos(want.az) * shift;
          want.target.z += Math.sin(want.az) * shift;
        } else {
          // narrow screens: pull back, and lift the map into the space above the bottom panel
          want.dist = u.dist * 1.6;
          const ahead = want.dist * 0.14;
          want.target.x += Math.sin(want.az) * ahead;
          want.target.z += Math.cos(want.az) * ahead;
        }
        break;
      }
      case "monument": {
        const e = points.find((p) => p.id === view.id);
        if (e) {
          const [x, z] = project(e.lng, e.lat);
          want.az = 0.55 + (calm ? 0 : Math.sin(clock.current * 0.15) * 0.12);
          want.pol = 0.92;
          want.dist = 24;
          // Aim a little in front of the monument so it shows in the open space above the page's panel.
          const ahead = want.dist * 0.32;
          want.target.set(x + Math.sin(want.az) * ahead, heightAt(e.lng, e.lat), z + Math.cos(want.az) * ahead);
        } else {
          Object.assign(want, { az: HOME.az, pol: 0.7, dist: 70 });
          want.target.set(0, 0, 0);
        }
        break;
      }
      case "search":
        Object.assign(want, { az: calm ? 0 : clock.current * 0.02, pol: 0.32, dist: 72 });
        want.target.set(0, 0, 2);
        break;
      case "upload":
        Object.assign(want, { az: -0.55, pol: 1.12, dist: 46 });
        want.target.set(1, 0, 6);
        break;
      default:
        Object.assign(want, { az: HOME.az, pol: 0.75, dist: 70 });
        want.target.set(0, 0, 0);
    }

    // Glide towards the wanted view (fast while dragging, slow for page changes).
    const k = calm ? 1 : 1 - Math.exp(-dt * (u.dragging ? 12 : 1.8));
    const c = cur.current;
    let dAz = want.az - c.az;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz)); // shortest way round
    c.az += dAz * k;
    c.pol += (want.pol - c.pol) * k;
    c.dist += (want.dist - c.dist) * k;
    c.target.lerp(want.target, k);

    camera.position.set(
      c.target.x + c.dist * Math.sin(c.pol) * Math.sin(c.az),
      c.target.y + c.dist * Math.cos(c.pol),
      c.target.z + c.dist * Math.sin(c.pol) * Math.cos(c.az),
    );
    camera.lookAt(c.target);
  });
  return null;
}

// ---------------------------------------------------------------------------
// HTML labels pinned to 3D positions (text stays crisp and readable, never 3D).

interface Pin {
  key: string;
  pos: THREE.Vector3;
  el: HTMLElement | null;
}

function Projector({ pins }: { pins: React.RefObject<Pin[]> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const placed: { x: number; y: number; w: number }[] = [];
    for (const p of pins.current ?? []) {
      if (!p.el) continue;
      v.copy(p.pos).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      const x = (v.x * 0.5 + 0.5) * size.width;
      let y = (-v.y * 0.5 + 0.5) * size.height;
      // Monument labels must never cover each other: push a clashing one below the last.
      if (p.key.startsWith("m-")) {
        const w = p.el.offsetWidth;
        for (const q of placed) {
          if (Math.abs(q.x - x) < (q.w + w) / 2 + 4 && Math.abs(q.y - y) < 30) y = q.y + 32;
        }
        placed.push({ x, y, w });
      }
      p.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      p.el.style.opacity = visible ? "" : "0";
    }
  });
  return null;
}

// ---------------------------------------------------------------------------

export default function GujaratMap3D({
  view,
  entities,
  interactive,
}: {
  view: MapView;
  entities: EntitySummary[];
  interactive: boolean;
}) {
  const router = useRouter();
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [source, setSource] = useState<ElevationSource | null>(null);

  const { lite, calm } = useMemo(() => {
    if (typeof window === "undefined") return { lite: false, calm: false };
    return {
      lite: window.innerWidth < 768 || window.matchMedia("(pointer: coarse)").matches,
      calm: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  }, []);

  useEffect(() => {
    let alive = true;
    buildTerrain(lite ? "lite" : "full").then((t) => {
      if (!alive) return;
      setTerrain(t);
      setSource(t.source);
    });
    return () => {
      alive = false;
    };
  }, [lite]);

  const heightAt = terrain?.heightAt ?? (() => 0);
  const points = entities.filter((e): e is Located => e.lat != null && e.lng != null);
  const selected = view.kind === "monument" ? view.id : null;

  // One list of everything pinned to the map: place names and monument labels.
  const pins = useRef<Pin[]>([]);
  const pinList = useMemo(() => {
    const list: Pin[] = PLACES.map((p) => {
      const [x, z] = project(p.lon, p.lat);
      const y = p.kind === "town" ? heightAt(p.lon, p.lat) + 0.05 : p.kind === "sea" ? -0.85 : heightAt(p.lon, p.lat) + 0.3;
      return { key: `place-${p.name}`, pos: new THREE.Vector3(x, y, z), el: null };
    });
    for (const e of points) {
      const [x, z] = project(e.lng, e.lat);
      list.push({ key: `m-${e.id}`, pos: new THREE.Vector3(x, heightAt(e.lng, e.lat) + 0.25, z), el: null });
    }
    return list;
    // heightAt changes identity when the terrain arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, entities]);
  pins.current = pinList;
  const pinRef = (key: string) => (el: HTMLElement | null) => {
    const p = pins.current.find((x) => x.key === key);
    if (p) p.el = el;
  };

  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={lite ? 1 : [1, 1.75]}
        camera={{ fov: 34, near: 0.5, far: 400, position: [30, 60, 90] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#17110c"]} />
        <fog attach="fog" args={["#17110c", 90, 220]} />
        <hemisphereLight args={["#fff0d4", "#3a2816", 0.9]} />
        <directionalLight position={[-30, 40, -20]} intensity={1.6} color="#ffd9a6" />
        <Table />
        <Slab />
        {terrain && <Relief terrain={terrain} calm={calm} />}
        <Markers points={points} heightAt={heightAt} selected={selected} />
        <CameraRig view={view} points={points} heightAt={heightAt} interactive={interactive} calm={calm} />
        <Projector pins={pins} />
      </Canvas>

      {/* candle-lit vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_55%_45%,transparent_35%,rgb(12_8_5/0.75)_100%)]" />

      {/* labels */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {PLACES.map((p) => (
          <span
            key={p.name}
            ref={pinRef(`place-${p.name}`)}
            className={`absolute left-0 top-0 whitespace-nowrap font-serif italic transition-opacity duration-300 ${
              p.kind === "sea"
                ? "text-[13px] tracking-[0.3em] text-[#c9a46a]/70 uppercase"
                : p.kind === "region"
                  ? "text-[12px] tracking-[0.25em] text-[#4a3220]/80 uppercase"
                  : "text-[12px] text-[#3a2616]/85"
            }`}
          >
            {p.kind === "town" && <span className="mr-1 inline-block size-1.5 rounded-full bg-[#3a2616]/80 align-middle" />}
            {p.name}
          </span>
        ))}
        {points.map((e) => (
          <button
            key={e.id}
            ref={pinRef(`m-${e.id}`)}
            type="button"
            tabIndex={interactive ? 0 : -1}
            onClick={() => router.push(`/monument/${e.id}`)}
            className={`absolute left-0 top-0 whitespace-nowrap rounded-sm border border-[#e8c27a]/60 bg-[#1f160e]/80 px-2.5 py-1 font-display text-[14px] text-[#f6e7c8] shadow-[0_4px_14px_rgb(0_0_0/0.4)] transition-[opacity,background-color] duration-300 hover:bg-[#3a2814] ${
              interactive ? "pointer-events-auto cursor-pointer" : ""
            } ${selected === e.id ? "ring-2 ring-[#e8a33c]" : ""}`}
          >
            {e.name}
            {e.n_conflicts > 0 && <span className="ml-1.5 text-[#e8a33c]">◆</span>}
          </button>
        ))}
      </div>

      {/* compass rose and data credits */}
      <svg viewBox="0 0 100 100" aria-hidden="true" className="pointer-events-none absolute bottom-6 right-6 hidden size-20 text-[#c9a46a]/70 sm:block">
        <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="0.8" />
        <circle cx="50" cy="50" r="24" fill="none" stroke="currentColor" strokeWidth="0.4" />
        <path d="M50 8 L56 50 L50 92 L44 50 Z" fill="currentColor" opacity="0.85" />
        <path d="M8 50 L50 44 L92 50 L50 56 Z" fill="currentColor" opacity="0.5" />
        <text x="50" y="6" textAnchor="middle" fontSize="9" fill="currentColor" fontFamily="serif">N</text>
      </svg>
      {source && (
        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-[#c9a46a]/55">
          {source === "srtm" ? "Elevation: NASA SRTM via AWS Terrain Tiles" : "Elevation approximated (live data unavailable)"} · Boundary:
          Census 2011 districts · Relief exaggerated 25×
        </p>
      )}
    </div>
  );
}
