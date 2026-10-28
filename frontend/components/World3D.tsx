"use client";

// The 3D world behind every page: the stepwell, the land around it, trees, kiosks and drifting dust.
// One canvas for the whole site; each page sends the camera to its own "station",
// and the camera glides between stations when you change page.
// Loaded with dynamic(..., { ssr: false }) from WorldBackground.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Chhatri, DIM, StepwellModel } from "./Stepwell3D";

export type Station = "home" | "monument" | "search" | "upload" | "other";

const SKY = "#e6d2ae";

/** Where the camera sits and what it looks at, for each page. */
const STATIONS: Record<Exclude<Station, "home">, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
  // Monument: standing on the first landing, looking down the corridor of pillared frames to the water.
  monument: { pos: new THREE.Vector3(0.4, -0.55, 2.7), look: new THREE.Vector3(0, -4.2, DIM.SHAFT_Z) },
  // Search: high above the well shaft, looking down at the water.
  search: { pos: new THREE.Vector3(1.2, 10, DIM.SHAFT_Z + 4.5), look: new THREE.Vector3(0, -DIM.D - 1, DIM.SHAFT_Z) },
  // Upload: at ground level by the domed entrance pavilion.
  upload: { pos: new THREE.Vector3(6.5, 2.4, -8.5), look: new THREE.Vector3(0, 1.2, -0.5) },
  other: { pos: new THREE.Vector3(18, 12, -12), look: new THREE.Vector3(0, -1, DIM.SHAFT_Z / 2) },
};

const HOME_CENTRE = new THREE.Vector3(0, -1.5, DIM.SHAFT_Z / 2);

function CameraRig({ station, calm }: { station: Station; calm: boolean }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3().copy(HOME_CENTRE));
  const wantPos = useMemo(() => new THREE.Vector3(), []);
  const wantLook = useMemo(() => new THREE.Vector3(), []);
  const first = useRef(true);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (station === "home") {
      // slow orbit around the stepwell
      const a = (calm ? 0 : t * 0.035) + 0.9;
      wantPos.set(Math.sin(a) * 26, 15, HOME_CENTRE.z + Math.cos(a) * 26);
      wantLook.copy(HOME_CENTRE);
      // On wide screens, aim left of the stepwell so it sits to the right of the headline.
      if (size.width >= 1024) {
        const shift = 7;
        wantLook.x += Math.cos(a) * shift * -1;
        wantLook.z += Math.sin(a) * shift;
      }
    } else {
      const s = STATIONS[station];
      wantPos.copy(s.pos);
      wantLook.copy(s.look);
      if (!calm) {
        // a gentle sway, like someone standing and looking around
        wantPos.x += Math.sin(t * 0.3) * 0.25;
        wantPos.y += Math.sin(t * 0.45) * 0.08;
        wantLook.x += Math.sin(t * 0.2) * 0.6;
      }
    }

    // First frame: jump straight there. After that: glide.
    const k = first.current || calm ? 1 : 1 - Math.exp(-dt * 1.6);
    first.current = false;
    camera.position.lerp(wantPos, k);
    look.current.lerp(wantLook, k);
    camera.lookAt(look.current);
  });
  return null;
}

/** Tiny seeded random generator, so the trees are in the same place on every visit. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function Trees({ count }: { count: number }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const r = rng(42);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let placed = 0;
    while (placed < count) {
      const x = (r() - 0.5) * 70;
      const z = (r() - 0.5) * 70 + DIM.SHAFT_Z / 2;
      // keep clear of the stepwell, the pavilion and the kiosks
      if (Math.abs(x) < 6.5 && z > -6 && z < DIM.SHAFT_Z + 5) continue;
      if (Math.hypot(x - 9, z - 4) < 3 || Math.hypot(x + 9, z - 12) < 3) continue;
      const s = 0.7 + r() * 0.8;
      q.setFromEuler(new THREE.Euler(0, r() * Math.PI, 0));
      m.compose(new THREE.Vector3(x, 0.9 * s, z), q, new THREE.Vector3(s, s, s));
      trunks.current?.setMatrixAt(placed, m);
      m.compose(new THREE.Vector3(x, 2.4 * s, z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.4), s));
      crowns.current?.setMatrixAt(placed, m);
      placed++;
    }
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
    if (crowns.current) crowns.current.instanceMatrix.needsUpdate = true;
  }, [count]);

  return (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, count]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 1.8, 6]} />
        <meshStandardMaterial color="#6b4a2e" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, count]} castShadow>
        <icosahedronGeometry args={[1.15, 0]} />
        <meshStandardMaterial color="#8a8752" roughness={1} flatShading />
      </instancedMesh>
    </>
  );
}

/** Dust drifting up out of the well in the late light. */
function Dust({ count }: { count: number }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const r = rng(7);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (r() - 0.5) * 16;
      arr[i * 3 + 1] = -DIM.D + r() * (DIM.D + 8);
      arr[i * 3 + 2] = -4 + r() * (DIM.SHAFT_Z + 8);
    }
    return arr;
  }, [count]);

  useFrame((_, dt) => {
    const geo = points.current?.geometry;
    if (!geo) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + dt * 0.25;
      if (y > 8) y = -DIM.D;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#fff3d6" size={0.07} transparent opacity={0.7} depthWrite={false} />
    </points>
  );
}

export default function World3D({ station }: { station: Station }) {
  const { lite, calm } = useMemo(() => {
    if (typeof window === "undefined") return { lite: false, calm: false };
    const small = window.innerWidth < 768 || window.matchMedia("(pointer: coarse)").matches;
    return { lite: small, calm: window.matchMedia("(prefers-reduced-motion: reduce)").matches };
  }, []);

  return (
    <Canvas
      shadows={!lite}
      dpr={lite ? 1 : [1, 1.5]}
      camera={{ fov: 42, near: 0.1, far: 140, position: [20, 15, -10] }}
      gl={{ antialias: !lite, powerPreference: "high-performance" }}
    >
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 28, 85]} />
      <hemisphereLight args={["#fff1d6", "#5a4129", 1.0]} />
      <directionalLight
        position={[14, 18, -6]}
        intensity={2.3}
        color="#ffd29a"
        castShadow={!lite}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-bias={-0.0005}
      />
      <StepwellModel groundSize={45} />
      <Chhatri position={[9, 0, 4]} scale={1.1} />
      <Chhatri position={[-9, 0, 12]} scale={0.9} />
      <Trees count={lite ? 28 : 70} />
      <Dust count={lite ? 120 : 320} />
      <CameraRig station={station} calm={calm} />
    </Canvas>
  );
}
