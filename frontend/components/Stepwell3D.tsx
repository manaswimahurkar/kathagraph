"use client";

// A Gujarat-style stepwell, modelled in code (no 3D files to download):
// a long stepped corridor that drops storey by storey towards a round well shaft,
// with pillared frames at every landing and a domed pavilion at the entrance.
// World coordinates: the entrance is at z = 0, the corridor runs towards +z,
// ground level is y = 0 and everything below it is the well.

import { useFrame } from "@react-three/fiber";
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
const T = D + 3; // thickness of the ground slab
const SHAFT_R = 2.2;
const SHAFT_Z = L + 2.0;
const STEPS_PER_FLIGHT = 6;

/** Key positions, used by the camera to know where things are. */
export const DIM = { STOREYS, H, RUN, LAND, SEG, L, W, D, SHAFT_R, SHAFT_Z, PAVILION_Z: -1.4 };

export const COLORS = {
  sand: "#cfae80",
  sandDark: "#b48c5c",
  sandLight: "#e2c9a1",
  ground: "#d9bf93",
  wall: "#b58f60",
  water: "#2e5e5b",
};

type Box = { p: [number, number, number]; s: [number, number, number]; c: string };

/** The ground for `size` metres around, with the corridor and the well cut out of it. */
function useGroundGeometry(size: number) {
  return useMemo(() => {
    const outer = new THREE.Shape();
    outer.moveTo(-size, size);
    outer.lineTo(size, size);
    outer.lineTo(size, -size - SHAFT_Z);
    outer.lineTo(-size, -size - SHAFT_Z);
    outer.closePath();

    const half = W / 2;
    const meet = SHAFT_Z - Math.sqrt(SHAFT_R ** 2 - half ** 2); // where corridor walls meet the shaft
    const a = Math.asin(half / SHAFT_R);
    const hole = new THREE.Path();
    hole.moveTo(-half, 0);
    hole.lineTo(-half, -meet);
    hole.absarc(0, -SHAFT_Z, SHAFT_R, Math.PI / 2 + a, Math.PI / 2 - a + 2 * Math.PI, false);
    hole.lineTo(half, 0);
    hole.closePath();
    outer.holes.push(hole);

    // Shape y = -world z; extrude upwards, then sink so the top sits at y = 0.
    const g = new THREE.ExtrudeGeometry(outer, { depth: T, bevelEnabled: false, curveSegments: 48 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -T, 0);
    return g;
  }, [size]);
}

/** Every box in the model (steps, landings, pillars, beams, mouldings, pavilion). */
function useBlocks() {
  return useMemo(() => {
    const { sand, sandDark, sandLight } = COLORS;
    const blocks: Box[] = [];
    const floor = -T;
    for (let k = 0; k < STOREYS; k++) {
      const z0 = k * SEG;
      const top = -k * H;
      for (let i = 0; i < STEPS_PER_FLIGHT; i++) {
        const y = top - ((i + 1) * H) / STEPS_PER_FLIGHT;
        const d = RUN / STEPS_PER_FLIGHT;
        blocks.push({ p: [0, (y + floor) / 2, z0 + d * i + d / 2], s: [W, y - floor, d], c: i % 2 ? sand : sandLight });
      }
      const ly = top - H;
      blocks.push({ p: [0, (ly + floor) / 2, z0 + RUN + LAND / 2], s: [W, ly - floor, LAND], c: sandLight });

      // pillared frame on each landing, rising to ground level, with a cross-beam at every storey
      const za = z0 + RUN + 0.35;
      const zb = z0 + SEG - 0.35;
      for (const x of [-(W / 2 - 0.25), W / 2 - 0.25]) {
        for (const z of [za, zb]) blocks.push({ p: [x, ly / 2, z], s: [0.32, -ly, 0.32], c: sandDark });
      }
      for (let j = 0; j <= k; j++) {
        const by = -j * H - 0.08;
        blocks.push({ p: [0, by, za], s: [W, 0.18, 0.42], c: sandDark });
        blocks.push({ p: [0, by, zb], s: [W, 0.18, 0.42], c: sandDark });
      }
    }
    // entrance pavilion
    for (const x of [-(W / 2 + 0.2), W / 2 + 0.2]) {
      for (const z of [-2.4, -0.4]) blocks.push({ p: [x, 0.9, z], s: [0.34, 1.8, 0.34], c: sandDark });
    }
    blocks.push({ p: [0, 1.88, -1.4], s: [W + 1.2, 0.22, 2.8], c: sand });
    blocks.push({ p: [0, 2.06, -1.4], s: [W + 0.6, 0.16, 2.2], c: sandLight });
    // low parapet along the corridor edges
    for (const x of [-(W / 2 + 0.18), W / 2 + 0.18]) blocks.push({ p: [x, 0.18, L / 2], s: [0.3, 0.36, L], c: sandDark });
    // carved bands along both corridor walls
    for (let j = 1; j <= STOREYS; j++) {
      for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) {
        const len = Math.min(L, j * SEG);
        blocks.push({ p: [x, -j * H + H * 0.55, len / 2], s: [0.12, 0.1, len], c: sandDark });
      }
    }
    return blocks;
  }, []);
}

/** A small domed kiosk (chhatri), as found around Gujarat stepwells. */
export function Chhatri({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  const { sand, sandDark, sandLight } = COLORS;
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[2.2, 0.3, 2.2]} />
        <meshStandardMaterial color={sand} roughness={0.95} />
      </mesh>
      {[-0.8, 0.8].flatMap((x) =>
        [-0.8, 0.8].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 1.0, z]} castShadow>
            <boxGeometry args={[0.22, 1.4, 0.22]} />
            <meshStandardMaterial color={sandDark} roughness={0.9} />
          </mesh>
        )),
      )}
      <mesh position={[0, 1.8, 0]} castShadow>
        <boxGeometry args={[2.3, 0.2, 2.3]} />
        <meshStandardMaterial color={sand} roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.9, 0]} castShadow>
        <sphereGeometry args={[0.85, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={sandLight} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Water() {
  const a = useRef<THREE.MeshStandardMaterial>(null);
  const b = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const v = 0.22 + Math.sin(clock.elapsedTime * 1.6) * 0.07;
    if (a.current) a.current.emissiveIntensity = v;
    if (b.current) b.current.emissiveIntensity = v * 0.9;
  });
  const { water } = COLORS;
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -D - 1.1, SHAFT_Z]}>
        <circleGeometry args={[SHAFT_R - 0.02, 48]} />
        <meshStandardMaterial ref={a} color={water} emissive={water} emissiveIntensity={0.25} roughness={0.12} metalness={0.45} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -D + 0.18, L - LAND / 2]}>
        <planeGeometry args={[W - 0.02, LAND]} />
        <meshStandardMaterial ref={b} color={water} emissive={water} emissiveIntensity={0.2} roughness={0.12} metalness={0.45} transparent opacity={0.85} />
      </mesh>
    </>
  );
}

/** The stepwell and the ground around it. `groundSize` is how far the ground extends, in metres. */
export function StepwellModel({ groundSize = 40 }: { groundSize?: number }) {
  const ground = useGroundGeometry(groundSize);
  const blocks = useBlocks();
  const { sandDark, sandLight, ground: groundColor, wall } = COLORS;
  return (
    <group>
      <mesh geometry={ground} receiveShadow>
        <meshStandardMaterial attach="material-0" color={groundColor} roughness={1} />
        <meshStandardMaterial attach="material-1" color={wall} roughness={1} />
      </mesh>
      {blocks.map((b, i) => (
        <mesh key={i} position={b.p} castShadow receiveShadow>
          <boxGeometry args={b.s} />
          <meshStandardMaterial color={b.c} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 2.14, -1.4]} castShadow>
        <sphereGeometry args={[1.05, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={sandLight} roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.25, -1.4]}>
        <coneGeometry args={[0.16, 0.5, 12]} />
        <meshStandardMaterial color={sandDark} roughness={0.9} />
      </mesh>
      <Water />
    </group>
  );
}
