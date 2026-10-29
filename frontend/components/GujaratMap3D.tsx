"use client";

// The 3D relief map of Gujarat that sits behind every page.
// Rendered like an old museum relief: parchment and sienna terrain with inked contour lines,
// a carved stone edge, and a graticule on a dark table. Monuments are lit markers on the land.
// Each page sets a "view": the camera glides there. On the home page the map can be dragged and zoomed.
// Loaded with dynamic(..., { ssr: false }) from WorldBackground, because WebGL only exists in the browser.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GUJARAT_OUTLINE, project, unproject } from "@/lib/geo";
import { getEntity } from "@/lib/api";
import { imageryUVs, loadImagery, MAP_BASES, resolveStyle, type Imagery, type MapStyle } from "@/lib/mapStyles";
import { usePrefs, type MapBase } from "@/lib/prefs";
import { buildTerrain, type ElevationSource, type Terrain } from "@/lib/terrain";
import { fieldLabel, type EntityDetail, type EntitySummary } from "@/lib/types";
import { CountChips } from "./CountChips";
import { Structure } from "./Structures";
import { categoryOf } from "@/lib/structures";

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
  varying vec2 vUv;
  void main() {
    vUv = uv;
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
  uniform sampler2D uMap;
  uniform float uTexAmt; // 0 = ancient parchment, 1 = draped imagery
  uniform vec3 uEdge;
  uniform vec3 uTint;
  varying vec2 vUv;
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

    c *= 0.95 + 0.1 * hash(floor(vPos.xz * 70.0));

    // Imagery styles: the map image, lit by the same sun so the relief still reads in 3D.
    vec3 tex = texture2D(uMap, vUv).rgb * (0.72 + 0.45 * diff);
    c = mix(c, tex, uTexAmt);

    c *= uTint;
    float edge = 1.0 - smoothstep(0.5, 0.64, vMask);
    c = mix(c, uEdge, edge * 0.85);
    gl_FragColor = vec4(c, 1.0);
  }
`;

function Relief({
  terrain,
  calm,
  imagery,
  edge,
  tint,
}: {
  terrain: Terrain;
  calm: boolean;
  imagery: Imagery | null;
  edge: string;
  tint: [number, number, number];
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(terrain.positions, 3));
    g.setAttribute("elev", new THREE.BufferAttribute(terrain.elevation, 1));
    g.setAttribute("mask", new THREE.BufferAttribute(terrain.mask, 1));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(terrain.mask.length * 2), 2));
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
          uMap: { value: null as THREE.Texture | null },
          uTexAmt: { value: 0 },
          uEdge: { value: new THREE.Color(edge) },
          uTint: { value: new THREE.Vector3(1, 1, 1) },
        },
      }),
    [calm],
  );

  // Drape new imagery: work out where each vertex falls on the image, then fade it in.
  useEffect(() => {
    if (!imagery) return;
    geometry.setAttribute("uv", new THREE.BufferAttribute(imageryUVs(terrain.lonlat, imagery), 2));
    const tex = new THREE.CanvasTexture(imagery.canvas);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace; // the shader writes these colours straight out
    const old = material.uniforms.uMap.value as THREE.Texture | null;
    material.uniforms.uMap.value = tex;
    old?.dispose();
  }, [imagery, geometry, material, terrain]);

  useEffect(() => {
    (material.uniforms.uEdge.value as THREE.Color).set(edge);
  }, [edge, material]);

  useFrame((_, dt) => {
    // Ease the colour tint (used to dim the land in dark mode).
    const tv = material.uniforms.uTint.value as THREE.Vector3;
    const k = calm ? 1 : Math.min(1, dt * 3);
    tv.set(tv.x + (tint[0] - tv.x) * k, tv.y + (tint[1] - tv.y) * k, tv.z + (tint[2] - tv.z) * k);
    // The land rises out of the slab when the elevation data arrives.
    const u = material.uniforms.uRise;
    if (u.value < 1) u.value = Math.min(1, u.value + dt * 0.45);
    // Cross-fade between parchment and imagery when the style changes.
    const t = material.uniforms.uTexAmt;
    const want = imagery ? 1 : 0;
    t.value = calm ? want : t.value + (want - t.value) * Math.min(1, dt * 3);
  });

  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} />;
}

/** The state as a carved slab: its sides are what you see at the coast and borders. */
function Slab({ style }: { style: MapStyle }) {
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
      <meshStandardMaterial attach="material-0" color={style.wallTop} roughness={1} />
      <meshStandardMaterial attach="material-1" color={style.wallSide} roughness={1} />
    </mesh>
  );
}

/** Dark table under the map, with a degree grid like an old chart. */
function Table({ style }: { style: MapStyle }) {
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
        <meshStandardMaterial color={style.table} roughness={1} />
      </mesh>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={style.grid} transparent opacity={0.22} />
      </lineSegments>
    </>
  );
}

/** A small 3D model of each monument on its spot, with a beam of light and a pulsing ring. */
function Markers({
  points,
  heightAt,
  selected,
  onPick,
}: {
  points: Located[];
  heightAt: (lon: number, lat: number) => number;
  selected: number | null;
  onPick?: (id: number) => void;
}) {
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
          <group
            key={e.id}
            position={[x, y, z]}
            onClick={(ev) => {
              if (!onPick || ev.delta > 5) return; // ignore the end of a drag
              ev.stopPropagation();
              onPick(e.id);
            }}
          >
            <group scale={on ? 1.7 : 1.25} rotation-y={(e.id * 1.7) % Math.PI}>
              <Structure kind={categoryOf(e.name, e.category)} highlight={on} />
            </group>
            <mesh position={[0, on ? 3.4 : 2.6, 0]}>
              <cylinderGeometry args={[0.03, on ? 0.12 : 0.08, on ? 3.6 : 2.6, 12, 1, true]} />
              <meshBasicMaterial color={color} transparent opacity={on ? 0.85 : 0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]} ref={(m) => void (m && (rings.current[i] = m))}>
              <ringGeometry args={[0.62, 0.7, 40]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
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
const MIN_DIST = 6;
const MAX_DIST = 130;
/** Just short of 90°: lets you tilt right down to a horizontal view along the land. */
const MAX_POL = 1.53;
const PAN_LIMIT = 70;
const MOVE_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
/** Fired by the "Reset view" button; the camera rig listens for it. */
export const RESET_EVENT = "kg-reset-view";

function clampPan(v: THREE.Vector3) {
  v.x = THREE.MathUtils.clamp(v.x, -PAN_LIMIT, PAN_LIMIT);
  v.z = THREE.MathUtils.clamp(v.z, -PAN_LIMIT, PAN_LIMIT);
}

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
  const user = useRef({ ...HOME, lastInput: -10, dragging: false, pan: new THREE.Vector3() });
  const keys = useRef(new Set<string>());
  const clock = useRef(0);
  /** Land height under a point on the map (x/z in map units). */
  const groundAt = (x: number, z: number) => heightAt(...unproject(x, z));

  // Home page controls:
  //   drag = turn and tilt (all the way down to a horizontal, eye-level view)
  //   right-drag, Shift+drag or two fingers = move across the map
  //   W A S D / arrow keys = walk forward, back and sideways; Q / E = turn
  //   wheel or pinch = zoom;  R or "Reset view" = back to the start
  useEffect(() => {
    if (!interactive) return;
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    let panning = false;

    /** Moves the view across the ground, relative to where the camera faces. */
    const pan = (dx: number, dy: number) => {
      const u = user.current;
      const s = u.dist * 0.0016;
      // screen right = (cos az, -sin az); screen up = away from the camera = (-sin az, -cos az)
      u.pan.x += (-dx * Math.cos(u.az) - dy * Math.sin(u.az)) * s;
      u.pan.z += (dx * Math.sin(u.az) - dy * Math.cos(u.az)) * s;
      clampPan(u.pan);
    };

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      panning = e.button === 2 || e.shiftKey;
      user.current.dragging = true;
      user.current.lastInput = clock.current;
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const u = user.current;
      if (pointers.size === 2) {
        // two fingers: pinch to zoom, and move together to slide the map
        const [a, b] = [...pointers.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        const m0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...pointers.values()];
        const d1 = Math.hypot(c.x - d.x, c.y - d.y);
        const m1 = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
        if (pinch && d0 > 0) u.dist = THREE.MathUtils.clamp(u.dist * (d0 / d1), MIN_DIST, MAX_DIST);
        if (pinch) pan(m1.x - m0.x, m1.y - m0.y);
        pinch = d1;
      } else if (panning) {
        pan(e.clientX - p.x, e.clientY - p.y);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      } else {
        u.az -= (e.clientX - p.x) * 0.005;
        u.pol = THREE.MathUtils.clamp(u.pol - (e.clientY - p.y) * 0.004, 0.15, MAX_POL);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      u.lastInput = clock.current;
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
      if (pointers.size === 0) {
        user.current.dragging = false;
        panning = false;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const u = user.current;
      u.dist = THREE.MathUtils.clamp(u.dist * (1 + e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
      u.lastInput = clock.current;
    };
    const noMenu = (e: MouseEvent) => e.preventDefault(); // right-drag pans instead of opening a menu
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    };
    const keydown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "r") {
        reset();
        return;
      }
      if (MOVE_KEYS.has(k)) {
        keys.current.add(k);
        user.current.lastInput = clock.current;
        if (k.startsWith("arrow")) e.preventDefault(); // don't scroll the page
      }
    };
    const keyup = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    const reset = () => {
      Object.assign(user.current, HOME);
      user.current.pan.set(0, 0, 0);
      user.current.lastInput = clock.current;
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    window.addEventListener(RESET_EVENT, reset);
    el.style.touchAction = "none";
    el.style.cursor = "grab";
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      window.removeEventListener(RESET_EVENT, reset);
      keys.current.clear();
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
        // keyboard: walk forward/back/sideways relative to where the camera faces, Q/E to turn
        const held = keys.current;
        if (held.size > 0) {
          const step = u.dist * 0.7 * dt;
          let f = 0;
          let r = 0;
          if (held.has("w") || held.has("arrowup")) f += 1;
          if (held.has("s") || held.has("arrowdown")) f -= 1;
          if (held.has("d") || held.has("arrowright")) r += 1;
          if (held.has("a") || held.has("arrowleft")) r -= 1;
          if (held.has("q")) u.az += dt * 0.9;
          if (held.has("e")) u.az -= dt * 0.9;
          u.pan.x += (-f * Math.sin(u.az) + r * Math.cos(u.az)) * step;
          u.pan.z += (-f * Math.cos(u.az) - r * Math.sin(u.az)) * step;
          clampPan(u.pan);
          u.lastInput = clock.current;
        }
        // drift slowly when nobody has touched the map for a while
        if (!calm && !u.dragging && clock.current - u.lastInput > 5) u.az += dt * 0.025;
        want.az = u.az;
        want.pol = u.pol;
        want.dist = u.dist;
        want.target.copy(u.pan);
        // stand on the land, not under it, when looking along the ground
        want.target.y = Math.max(0, groundAt(u.pan.x, u.pan.z));
        if (wide) {
          // aim slightly left of centre so Gujarat clears the search box
          const shift = want.dist * 0.07;
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

    // Glide towards the wanted view (fast while you steer it, slow for page changes).
    const steering = u.dragging || keys.current.size > 0;
    const k = calm ? 1 : 1 - Math.exp(-dt * (steering ? 12 : 1.8));
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
    // keep the eye just above the ground at the flattest, eye-level angles
    const floor = Math.max(0, groundAt(camera.position.x, camera.position.z)) + 0.6;
    if (camera.position.y < floor) camera.position.y = floor;
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
      // Monument labels must never cover each other: a clashing one (lower priority) is hidden
      // until zooming in makes room for it. The monument's 3D model stays visible.
      let clash = false;
      if (p.key.startsWith("m-") && visible) {
        const w = p.el.offsetWidth;
        clash = placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 4 && Math.abs(q.y - y) < 28);
        if (!clash) placed.push({ x, y, w });
      }
      let px = x;
      if (p.key === "popup") {
        // The pop-up card sits above its monument's label, kept inside the screen;
        // if there's no room above, it flips below the monument.
        const w = p.el.offsetWidth;
        const h = p.el.offsetHeight;
        px = Math.min(Math.max(x, w / 2 + 12), size.width - w / 2 - 12);
        y = y - 44 - h < 110 ? y + h + 24 : y - 44;
      }
      p.el.style.transform = `translate(-50%, -100%) translate(${px}px, ${y}px)`;
      const show = visible && !clash;
      p.el.style.opacity = show ? "" : "0";
      p.el.style.pointerEvents = show ? "" : "none";
    }
  });
  return null;
}

// ---------------------------------------------------------------------------

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

export default function GujaratMap3D({
  view,
  entities,
  interactive,
}: {
  view: MapView;
  entities: EntitySummary[];
  interactive: boolean;
}) {
  const { base, theme, setBase } = usePrefs();
  const style = resolveStyle(base, theme);
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [source, setSource] = useState<ElevationSource | null>(null);
  const [imagery, setImagery] = useState<Imagery | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [picked, setPicked] = useState<number | null>(null);
  const lastPick = useRef(0);

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

  // Load the imagery for the chosen style (cached, so switching back is instant).
  useEffect(() => {
    if (!style.tiles) {
      setImagery(null);
      const t = setTimeout(() => setStatus({ kind: "idle" }), 5000); // let an error message linger
      setStatus((prev) => (prev.kind === "error" ? prev : { kind: "idle" }));
      return () => clearTimeout(t);
    }
    let alive = true;
    setStatus({ kind: "loading" });
    loadImagery(style, lite ? 8 : 9)
      .then((img) => {
        if (!alive) return;
        setImagery(img);
        setStatus(img.missing > 0.2 ? { kind: "error", message: "Some map tiles didn't load." } : { kind: "idle" });
      })
      .catch((e: Error) => {
        if (!alive) return;
        setStatus({ kind: "error", message: `${e.message} Showing the Ancient style.` });
        setBase("ancient");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style.tiles, lite]);

  // The pop-up only exists on the home page; Escape closes it.
  useEffect(() => {
    if (!interactive) setPicked(null);
  }, [interactive]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicked(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (id: number) => {
    lastPick.current = performance.now();
    setPicked(id);
  };

  const heightAt = terrain?.heightAt ?? (() => 0);
  const points = entities.filter((e): e is Located => e.lat != null && e.lng != null);
  const selected = view.kind === "monument" ? view.id : picked;
  const pickedEntity = points.find((e) => e.id === picked) ?? null;

  // Everything pinned to the map: place names, monument labels, and the pop-up card.
  const pins = useRef<Pin[]>([]);
  const pinList = useMemo(() => {
    const list: Pin[] = PLACES.map((p) => {
      const [x, z] = project(p.lon, p.lat);
      const y = p.kind === "town" ? heightAt(p.lon, p.lat) + 0.05 : p.kind === "sea" ? -0.85 : heightAt(p.lon, p.lat) + 0.3;
      return { key: `place-${p.name}`, pos: new THREE.Vector3(x, y, z), el: null };
    });
    // Labels are placed in priority order: the chosen monument, then the best-documented ones.
    // When they'd overlap, the later ones are hidden until you zoom in.
    const ranked = [...points].sort((a, b) => (b.id === selected ? 1 : 0) - (a.id === selected ? 1 : 0) || b.n_sources - a.n_sources);
    for (const e of ranked) {
      const [x, z] = project(e.lng, e.lat);
      list.push({ key: `m-${e.id}`, pos: new THREE.Vector3(x, heightAt(e.lng, e.lat) + 1.3, z), el: null });
    }
    if (pickedEntity) {
      const [x, z] = project(pickedEntity.lng, pickedEntity.lat);
      list.push({ key: "popup", pos: new THREE.Vector3(x, heightAt(pickedEntity.lng, pickedEntity.lat) + 1.3, z), el: null });
    }
    return list;
    // heightAt changes identity when the terrain arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, entities, pickedEntity, selected]);
  pins.current = pinList;
  const pinRef = (key: string) => (el: HTMLElement | null) => {
    const p = pins.current.find((x) => x.key === key);
    if (p) p.el = el;
  };

  const darkUi = style.land === "white" || style.theme === "dark";

  return (
    <div
      className="absolute inset-0"
      onClick={(e) => {
        // A plain click on the map (not on a monument) closes the pop-up.
        if (!interactive || e.target instanceof HTMLElement === false) return;
        if ((e.target as HTMLElement).tagName === "CANVAS" && performance.now() - lastPick.current > 80) setPicked(null);
      }}
    >
      <Canvas
        dpr={lite ? 1 : [1, 1.75]}
        camera={{ fov: 34, near: 0.5, far: 400, position: [30, 60, 90] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={[style.background]} />
        <fog attach="fog" args={[style.background, 90, 220]} />
        <hemisphereLight args={["#fff0d4", "#3a2816", 0.9]} />
        <directionalLight position={[-30, 40, -20]} intensity={1.6} color="#ffd9a6" />
        <Table style={style} />
        <Slab style={style} />
        {terrain && (
          <Relief
            terrain={terrain}
            calm={calm}
            imagery={imagery}
            edge={style.base === "ancient" ? "#33200f" : style.wallSide}
            tint={style.tint}
          />
        )}
        <Markers points={points} heightAt={heightAt} selected={selected} onPick={interactive ? pick : undefined} />
        <CameraRig view={view} points={points} heightAt={heightAt} interactive={interactive} calm={calm} />
        <Projector pins={pins} />
      </Canvas>

      {/* vignette: candle-lit in dark mode, a soft edge in light mode */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${style.theme === "light" ? "opacity-25" : "opacity-100"} bg-[radial-gradient(ellipse_at_55%_45%,transparent_35%,rgb(12_8_5/0.75)_100%)]`}
      />

      {/* labels */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {PLACES.map((p) => (
          <span
            key={p.name}
            ref={pinRef(`place-${p.name}`)}
            className={`absolute left-0 top-0 whitespace-nowrap font-serif italic transition-[opacity,color] duration-300 ${placeClass(style, p.kind)}`}
          >
            {p.kind === "town" && <span className="mr-1 inline-block size-1.5 rounded-full bg-current align-middle opacity-80" />}
            {p.name}
          </span>
        ))}
        {points.map((e) => (
          <button
            key={e.id}
            ref={pinRef(`m-${e.id}`)}
            type="button"
            tabIndex={interactive ? 0 : -1}
            aria-expanded={picked === e.id}
            onClick={(ev) => {
              ev.stopPropagation();
              pick(e.id);
            }}
            title={
              e.coord_precision === "approximate"
                ? "Rare site: no public record of its exact location. Shown at the larger site it belongs to."
                : undefined
            }
            className={`absolute left-0 top-0 whitespace-nowrap rounded-sm border px-2.5 py-1 font-display text-[14px] shadow-[0_4px_14px_rgb(0_0_0/0.4)] transition-[opacity,background-color] duration-300 ${
              e.coord_precision === "approximate"
                ? "border-dashed border-[#8fc7bf]/80 bg-[#14231f]/85 text-[#cfe9e4] hover:bg-[#1d3530]"
                : "border-[#e8c27a]/60 bg-[#1f160e]/85 text-[#f6e7c8] hover:bg-[#3a2814]"
            } ${interactive ? "pointer-events-auto cursor-pointer" : ""} ${selected === e.id ? "ring-2 ring-[#e8a33c]" : ""}`}
          >
            {e.coord_precision === "approximate" && (
              <span aria-label="Rare site, approximate location" className="mr-1.5 text-[#8fc7bf]">
                ◌
              </span>
            )}
            {e.name}
            {e.n_conflicts > 0 && <span className="ml-1.5 text-[#e8a33c]">◆</span>}
          </button>
        ))}
      </div>

      {interactive && pickedEntity && (
        <MonumentPopup key={pickedEntity.id} entity={pickedEntity} elRef={pinRef("popup")} onClose={() => setPicked(null)} />
      )}

      {/* compass rose */}
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-6 right-6 hidden size-20 sm:block ${darkUi ? "text-[#c9a46a]/70" : "text-[#5c3f25]/70"}`}
      >
        <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="0.8" />
        <circle cx="50" cy="50" r="24" fill="none" stroke="currentColor" strokeWidth="0.4" />
        <path d="M50 8 L56 50 L50 92 L44 50 Z" fill="currentColor" opacity="0.85" />
        <path d="M8 50 L50 44 L92 50 L50 56 Z" fill="currentColor" opacity="0.5" />
        <text x="50" y="6" textAnchor="middle" fontSize="9" fill="currentColor" fontFamily="serif">
          N
        </text>
      </svg>

      {interactive && (
        <>
          {/* cartouche: the map's title, in Gujarati and English */}
          <div
            className={`kg-cartouche pointer-events-none absolute right-10 top-[7.5rem] hidden text-center transition-opacity duration-300 lg:block ${
              pickedEntity ? "opacity-0" : ""
            }`}
          >
            <p lang="gu" className={`font-gujarati text-2xl leading-none ${darkUi ? "text-[#f3dfb8]" : "text-[#2b2118]"}`}>
              ગુજરાત
            </p>
            <p className={`mt-1 font-display text-lg tracking-[0.3em] uppercase ${darkUi ? "text-[#e8c27a]" : "text-[#6b4a1c]"}`}>Gujarat</p>
            <p className={`mt-0.5 font-serif text-[12px] italic ${darkUi ? "text-[#c9a46a]/80" : "text-[#4a3a2a]"}`}>
              Drag to turn and tilt · scroll to zoom · click a monument
            </p>
            <p className={`mt-0.5 hidden font-serif text-[12px] italic sm:block ${darkUi ? "text-[#c9a46a]/80" : "text-[#4a3a2a]"}`}>
              Right-drag or W A S D to move · Q / E to turn
            </p>
          </div>
          <StyleSwitcher current={base} onChange={setBase} status={status} />
        </>
      )}

      {source && (
        <p className={`pointer-events-none absolute bottom-2 left-3 right-3 text-[11px] ${darkUi ? "text-[#c9a46a]/60" : "text-black/55"}`}>
          {source === "srtm" ? "Elevation: NASA SRTM via AWS Terrain Tiles" : "Elevation approximated (live data unavailable)"} · Boundary:
          Census 2011 districts · Relief exaggerated 25×{style.attribution && ` · ${style.attribution}`}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function placeClass(style: MapStyle, kind: "sea" | "region" | "town") {
  const tones = {
    ink: "text-[#3a2616]/85",
    white: "text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]",
    slate: "text-[#263038]/85 [text-shadow:0_0_3px_rgb(255_255_255/0.9)]",
    gold: "text-[#c9a46a]/75",
    brown: "text-[#5c3f25]/80",
  };
  if (kind === "sea") return `text-[13px] tracking-[0.3em] uppercase ${tones[style.sea]}`;
  if (kind === "region") return `text-[12px] tracking-[0.25em] uppercase ${tones[style.land]}`;
  return `text-[12px] ${style.base === "ancient" ? "" : "not-italic"} ${tones[style.land]}`;
}

/** Layer switcher, like the one in Google Maps. Light/dark is in the site header. */
function StyleSwitcher({ current, onChange, status }: { current: MapBase; onChange: (b: MapBase) => void; status: Status }) {
  return (
    <div className="pointer-events-auto absolute bottom-10 right-3 flex flex-col items-end gap-2 sm:bottom-8 sm:right-28">
      <div
        role="radiogroup"
        aria-label="Map style"
        className="flex rounded-md border border-[#b48c5c]/70 bg-[#1f160e]/85 p-0.5 shadow-[0_6px_20px_rgb(0_0_0/0.45)] backdrop-blur"
      >
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(RESET_EVENT))}
          title="Back to the starting view (R)"
          className="mr-0.5 rounded border-r border-[#b48c5c]/40 px-2.5 py-1.5 text-[13px] text-[#f3dfb8]/85 hover:bg-white/10"
        >
          Reset view
        </button>
        {MAP_BASES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={current === s.id}
            onClick={() => onChange(s.id)}
            className={`rounded px-2.5 py-1.5 text-[13px] transition-colors sm:px-3 ${
              current === s.id ? "bg-[#e8c27a] font-medium text-[#1f160e]" : "text-[#f3dfb8]/85 hover:bg-white/10"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {status.kind !== "idle" && (
        <p role="status" className="rounded bg-[#1f160e]/85 px-2.5 py-1 text-[12px] text-[#f3dfb8]">
          {status.kind === "loading" ? "Loading map imagery…" : status.message}
        </p>
      )}
    </div>
  );
}

/** The card that pops up when you click a monument on the map. */
function MonumentPopup({
  entity,
  elRef,
  onClose,
}: {
  entity: Located;
  elRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getEntity(entity.id)
      .then(setDetail)
      .catch(() => setFailed(true));
  }, [entity.id]);

  // Headline facts: construction date and builder, showing every value when sources disagree.
  const headline = ["built_date", "builder"].map((field) => {
    const values = [...new Set((detail?.claims ?? []).filter((c) => c.field === field && c.status !== "rejected").map((c) => c.value))];
    return { field, values };
  });

  return (
    <div
      ref={elRef}
      role="dialog"
      aria-label={entity.name}
      onClick={(e) => e.stopPropagation()}
      className="kg-panel kg-pop pointer-events-auto fixed inset-x-3 bottom-3 z-20 p-4 sm:absolute sm:inset-auto sm:left-0 sm:top-0 sm:w-[340px] max-sm:!transform-none max-sm:!opacity-100"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2 top-2 grid size-8 place-items-center rounded text-dust hover:bg-ink/10 hover:text-ink"
      >
        ✕
      </button>
      <p className="text-[12px] tracking-wide text-ochre">Record no. {String(entity.id).padStart(3, "0")}</p>
      <h2 className="pr-8 font-display text-2xl leading-tight text-ink">{entity.name}</h2>
      {entity.coord_precision === "approximate" && (
        <p className="mt-1.5 rounded border border-dashed border-water/60 bg-water-soft/40 px-2 py-1 text-[13px] text-ink">
          <span className="mr-1 text-water">◌</span>
          <b>Rare site:</b> no public record of its exact location. Shown at the larger site it belongs to; a GPS photo
          from a field visit would fix it.
        </p>
      )}
      {detail && detail.aliases.length > 0 && (
        <p className="mt-0.5 text-[13px] text-dust">
          {detail.aliases.map((a, i) => (
            <span key={a.alias} lang={a.language ?? undefined}>
              {i > 0 && ", "}
              {a.alias}
            </span>
          ))}
        </p>
      )}

      <dl className="mt-3 space-y-1.5 text-[14px]">
        {!detail && !failed && (
          <>
            <div className="kg-skeleton h-4 w-3/4" />
            <div className="kg-skeleton h-4 w-2/3" />
          </>
        )}
        {failed && <p className="text-[13px] text-dust">Couldn&apos;t load the details. Open the record to try again.</p>}
        {detail &&
          headline.map(({ field, values }) => (
            <div key={field} className="flex gap-2">
              <dt className="w-24 shrink-0 text-dust">{fieldLabel(field)}</dt>
              <dd className="font-serif text-ink">
                {values.length === 0 ? (
                  <span className="text-dust italic">not recorded yet</span>
                ) : values.length > 1 ? (
                  <>
                    {values.join(" or ")} <span className="text-[12px] text-ochre">(sources disagree)</span>
                  </>
                ) : (
                  values[0]
                )}
              </dd>
            </div>
          ))}
      </dl>

      <div className="mt-3">
        <CountChips entity={entity} />
      </div>
      <Link
        href={`/monument/${entity.id}`}
        className="mt-4 block rounded-md bg-water px-4 py-2.5 text-center text-[15px] font-medium text-paper hover:opacity-90"
      >
        Open the full record
      </Link>
    </div>
  );
}
