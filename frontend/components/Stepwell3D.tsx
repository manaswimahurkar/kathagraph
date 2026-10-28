"use client";

// A Gujarat-style stepwell, modelled in code (no 3D files to download):
// a long stepped corridor that drops storey by storey towards a round well shaft,
// with pillared frames at every landing, carved into a block of earth like a museum diorama.
// Loaded with dynamic(..., { ssr: false }) because WebGL only exists in the browser.

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

// ---- dimensions (metres-ish) ----
const STOREYS = 4;
const H = 1.4; // height of one storey
const RUN = 2.0; // length of each flight of stairs
const LAND = 1.6; // length of each landing
const SEG = RUN + LAND;
const L = STOREYS * SEG; // corridor length
const W = 3.6; // corridor width
const D = STOREYS * H; // depth of the last landing
const T = D + 0.9; // thickness of the earth block
const SHAFT_R = 2.2;
const SHAFT_Z = L + 2.0;
const STEPS_PER_FLIGHT = 6;

const SAND = "#cfae80";
const SAND_DARK = "#b48c5c";
const SAND_LIGHT = "#e2c9a1";
const WALL = "#b58f60";
const WATER = "#2e5e5b";

/** Ground block with the corridor + well cut out of it. Shape y = -world z, extruded upwards. */
function useGroundGeometry() {
  return useMemo(() => {
    const outer = new THREE.Shape();
    outer.moveTo(-5.5, 3.5);
    outer.lineTo(5.5, 3.5);
    outer.lineTo(5.5, -(SHAFT_Z + SHAFT_R + 1.6));
    outer.lineTo(-5.5, -(SHAFT_Z + SHAFT_R + 1.6));
    outer.closePath();

    const half = W / 2;
    const meet = SHAFT_Z - Math.sqrt(SHAFT_R ** 2 - half ** 2); // where corridor walls meet the shaft
    const a = Math.asin(half / SHAFT_R);
    const hole = new THREE.Path();
    hole.moveTo(-half, 0);
    hole.lineTo(-half, -meet);
    // arc around the far side of the shaft (shape coordinates: centre at y = -SHAFT_Z)
    hole.absarc(0, -SHAFT_Z, SHAFT_R, Math.PI / 2 + a, Math.PI / 2 - a + 2 * Math.PI, false);
    hole.lineTo(half, 0);
    hole.closePath();
    outer.holes.push(hole);

    const g = new THREE.ExtrudeGeometry(outer, { depth: T, bevelEnabled: false, curveSegments: 48 });
    g.rotateX(-Math.PI / 2); // extrusion now points up, shape y -> world -z
    g.translate(0, -T, 0);
    return g;
  }, []);
}

/** Every box in the model (steps, landings, pillars, beams, mouldings) in one list. */
function useBlocks() {
  return useMemo(() => {
    const blocks: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    const floor = -T;
    for (let k = 0; k < STOREYS; k++) {
      const z0 = k * SEG;
      const top = -k * H;
      // flight of stairs: solid blocks down to the bottom of the block
      for (let i = 0; i < STEPS_PER_FLIGHT; i++) {
        const y = top - ((i + 1) * H) / STEPS_PER_FLIGHT;
        const d = RUN / STEPS_PER_FLIGHT;
        blocks.push({ p: [0, (y + floor) / 2, z0 + d * i + d / 2], s: [W, y - floor, d], c: i % 2 ? SAND : SAND_LIGHT });
      }
      // landing
      const ly = top - H;
      blocks.push({ p: [0, (ly + floor) / 2, z0 + RUN + LAND / 2], s: [W, ly - floor, LAND], c: SAND_LIGHT });

      // pillared frame on the landing, rising to ground level, with a cross-beam at every storey
      const za = z0 + RUN + 0.35;
      const zb = z0 + SEG - 0.35;
      for (const x of [-(W / 2 - 0.25), W / 2 - 0.25]) {
        for (const z of [za, zb]) {
          blocks.push({ p: [x, ly / 2, z], s: [0.32, -ly, 0.32], c: SAND_DARK });
        }
      }
      for (let j = 0; j <= k; j++) {
        const by = -j * H - 0.08;
        blocks.push({ p: [0, by, za], s: [W, 0.18, 0.42], c: SAND_DARK });
        blocks.push({ p: [0, by, zb], s: [W, 0.18, 0.42], c: SAND_DARK });
      }
    }
    // entrance pavilion at ground level: four pillars and a roof slab (dome added separately)
    for (const x of [-(W / 2 + 0.2), W / 2 + 0.2]) {
      for (const z of [-2.4, -0.4]) blocks.push({ p: [x, 0.9, z], s: [0.34, 1.8, 0.34], c: SAND_DARK });
    }
    blocks.push({ p: [0, 1.88, -1.4], s: [W + 1.2, 0.22, 2.8], c: SAND });
    blocks.push({ p: [0, 2.06, -1.4], s: [W + 0.6, 0.16, 2.2], c: SAND_LIGHT });
    // low parapet along the corridor edges
    for (const x of [-(W / 2 + 0.18), W / 2 + 0.18]) blocks.push({ p: [x, 0.18, L / 2], s: [0.3, 0.36, L], c: SAND_DARK });
    // carved bands running along both corridor walls
    for (let j = 1; j <= STOREYS; j++) {
      for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) {
        const len = Math.min(L, j * SEG);
        blocks.push({ p: [x, -j * H + H * 0.55, len / 2], s: [0.12, 0.1, len], c: SAND_DARK });
      }
    }
    return blocks;
  }, []);
}

function Water() {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = 0.22 + Math.sin(clock.elapsedTime * 1.6) * 0.06;
  });
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -D - 1.1, SHAFT_Z]}>
        <circleGeometry args={[SHAFT_R - 0.02, 48]} />
        <meshStandardMaterial ref={mat} color={WATER} emissive={WATER} emissiveIntensity={0.25} roughness={0.15} metalness={0.4} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -D + 0.18, L - LAND / 2]}>
        <planeGeometry args={[W - 0.02, LAND]} />
        <meshStandardMaterial color={WATER} emissive={WATER} emissiveIntensity={0.2} roughness={0.15} metalness={0.4} transparent opacity={0.85} />
      </mesh>
    </>
  );
}

function Stepwell({ spin }: { spin: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ground = useGroundGeometry();
  const blocks = useBlocks();
  const drag = useRef({ active: false, x: 0, vel: 0 });

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const d = drag.current;
    if (!d.active) {
      d.vel *= 0.95; // momentum after a drag
      g.rotation.y += d.vel + (spin ? dt * 0.12 : 0);
    }
  });

  return (
    <group
      ref={group}
      rotation-y={-0.65}
      scale={0.8}
      onPointerDown={(e) => {
        drag.current = { active: true, x: e.clientX, vel: 0 };
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d.active || !group.current) return;
        const dx = (e.clientX - d.x) * 0.008;
        group.current.rotation.y += dx;
        d.vel = dx;
        d.x = e.clientX;
      }}
      onPointerUp={() => (drag.current.active = false)}
      onPointerLeave={() => (drag.current.active = false)}
    >
      <group position={[0, 0, -SHAFT_Z / 2 - 0.5]}>
        <mesh geometry={ground} castShadow receiveShadow>
          <meshStandardMaterial attach="material-0" color={SAND_LIGHT} roughness={0.95} />
          <meshStandardMaterial attach="material-1" color={WALL} roughness={1} />
        </mesh>
        {blocks.map((b, i) => (
          <mesh key={i} position={b.p} castShadow receiveShadow>
            <boxGeometry args={b.s} />
            <meshStandardMaterial color={b.c} roughness={0.9} />
          </mesh>
        ))}
        <mesh position={[0, 2.14, -1.4]} castShadow>
          <sphereGeometry args={[1.05, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={SAND_LIGHT} roughness={0.9} />
        </mesh>
        <mesh position={[0, 3.25, -1.4]}>
          <coneGeometry args={[0.16, 0.5, 12]} />
          <meshStandardMaterial color={SAND_DARK} roughness={0.9} />
        </mesh>
        <Water />
      </group>
    </group>
  );
}

export default function Stepwell3D({ className = "" }: { className?: string }) {
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className={className} role="img" aria-label="A 3D model of a Gujarat stepwell: stairs descend storey by storey to a round well">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [25, 19, 25], fov: 30, near: 0.5, far: 160 }}
        onCreated={({ camera }) => camera.lookAt(0, -1, 0)}
        gl={{ antialias: true, alpha: true }}
        style={{ touchAction: "pan-y", cursor: "grab" }}
      >
        <hemisphereLight args={["#fff1d6", "#3b2a1c", 0.9]} />
        <directionalLight
          position={[9, 16, 6]}
          intensity={2.4}
          color="#ffd9a0"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={14}
          shadow-camera-bottom={-14}
          shadow-bias={-0.0005}
        />
        <Stepwell spin={!reduceMotion} />
      </Canvas>
    </div>
  );
}
