"use client";

// Small carved-stone models that stand on the 3D map at each monument, one shape per kind of
// structure (temple, stepwell, fort…). Built from simple shapes so 80+ of them stay fast.

import { useMemo } from "react";
import * as THREE from "three";
import type { Category } from "@/lib/structures";

const STONE = "#d2ae78";
const STONE_DARK = "#a77d4b";
const ROOF = "#b5823f";
const WATER = "#3f7f8f";

function useMats(highlight: boolean) {
  return useMemo(() => {
    const e = highlight ? new THREE.Color("#5a3a10") : new THREE.Color("#000000");
    const m = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, emissive: e });
    return { stone: m(STONE), dark: m(STONE_DARK), roof: m(ROOF), water: new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.3 }) };
  }, [highlight]);
}

/** One model, about one map unit tall, standing on y = 0. */
export function Structure({ kind, highlight = false }: { kind: Category; highlight?: boolean }) {
  const m = useMats(highlight);
  switch (kind) {
    case "temple":
      // plinth, hall, and a tall curved spire (shikhara)
      return (
        <group>
          <mesh material={m.dark} position={[0, 0.06, 0]}><boxGeometry args={[0.9, 0.12, 0.7]} /></mesh>
          <mesh material={m.stone} position={[-0.15, 0.27, 0]}><boxGeometry args={[0.5, 0.3, 0.5]} /></mesh>
          <mesh material={m.stone} position={[0.22, 0.27, 0]}><boxGeometry args={[0.36, 0.3, 0.42]} /></mesh>
          <mesh material={m.roof} position={[-0.15, 0.72, 0]}><coneGeometry args={[0.26, 0.62, 8]} /></mesh>
          <mesh material={m.roof} position={[0.22, 0.5, 0]}><coneGeometry args={[0.18, 0.18, 4]} /></mesh>
        </group>
      );
    case "stepwell":
      // a stepped pavilion at ground level and terraces going down to the water
      return (
        <group>
          {[0, 1, 2].map((i) => (
            <mesh key={i} material={i % 2 ? m.dark : m.stone} position={[0, 0.05 + i * 0.09, 0]}>
              <boxGeometry args={[1.0 - i * 0.22, 0.09, 0.62 - i * 0.12]} />
            </mesh>
          ))}
          <mesh material={m.water} position={[0, 0.31, 0]}><boxGeometry args={[0.2, 0.02, 0.16]} /></mesh>
          {[-0.4, 0.4].map((x) => (
            <mesh key={x} material={m.stone} position={[x, 0.3, 0]}><cylinderGeometry args={[0.035, 0.035, 0.4, 6]} /></mesh>
          ))}
          <mesh material={m.roof} position={[0, 0.52, 0]}><boxGeometry args={[0.94, 0.05, 0.3]} /></mesh>
        </group>
      );
    case "fort":
      return (
        <group>
          <mesh material={m.dark} position={[0, 0.2, 0]}><boxGeometry args={[0.9, 0.4, 0.9]} /></mesh>
          {[[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].map(([x, z]) => (
            <mesh key={`${x}${z}`} material={m.stone} position={[x, 0.3, z]}><cylinderGeometry args={[0.13, 0.15, 0.6, 10]} /></mesh>
          ))}
          <mesh material={m.stone} position={[0, 0.46, 0]}><boxGeometry args={[0.36, 0.16, 0.36]} /></mesh>
        </group>
      );
    case "mosque":
      return (
        <group>
          <mesh material={m.stone} position={[0, 0.17, 0]}><boxGeometry args={[0.8, 0.34, 0.5]} /></mesh>
          <mesh material={m.roof} position={[0, 0.34, 0]}><sphereGeometry args={[0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          {[-0.36, 0.36].map((x) => (
            <group key={x}>
              <mesh material={m.stone} position={[x, 0.42, -0.22]}><cylinderGeometry args={[0.04, 0.05, 0.84, 8]} /></mesh>
              <mesh material={m.roof} position={[x, 0.88, -0.22]}><coneGeometry args={[0.06, 0.12, 8]} /></mesh>
            </group>
          ))}
        </group>
      );
    case "tomb":
      return (
        <group>
          <mesh material={m.dark} position={[0, 0.05, 0]}><boxGeometry args={[0.8, 0.1, 0.8]} /></mesh>
          <mesh material={m.stone} position={[0, 0.25, 0]}><boxGeometry args={[0.56, 0.3, 0.56]} /></mesh>
          <mesh material={m.roof} position={[0, 0.4, 0]}><sphereGeometry args={[0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          <mesh material={m.roof} position={[0, 0.72, 0]}><coneGeometry args={[0.04, 0.12, 6]} /></mesh>
        </group>
      );
    case "cave":
      // a rock outcrop with dark openings
      return (
        <group>
          <mesh material={m.dark} position={[0, 0.22, 0]} scale={[1, 0.6, 0.8]}><dodecahedronGeometry args={[0.45, 0]} /></mesh>
          {[-0.16, 0.12].map((x) => (
            <mesh key={x} position={[x, 0.16, 0.33]}>
              <boxGeometry args={[0.14, 0.18, 0.06]} />
              <meshBasicMaterial color="#1b120a" />
            </mesh>
          ))}
        </group>
      );
    case "lake":
      return (
        <group>
          <mesh material={m.stone} position={[0, 0.04, 0]}><cylinderGeometry args={[0.55, 0.6, 0.08, 24]} /></mesh>
          <mesh material={m.water} position={[0, 0.085, 0]}><cylinderGeometry args={[0.45, 0.45, 0.02, 24]} /></mesh>
          <mesh material={m.roof} position={[0.12, 0.2, 0]}><sphereGeometry args={[0.08, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          <mesh material={m.stone} position={[0.12, 0.14, 0]}><cylinderGeometry args={[0.07, 0.07, 0.12, 8]} /></mesh>
        </group>
      );
    case "palace":
      return (
        <group>
          <mesh material={m.stone} position={[0, 0.2, 0]}><boxGeometry args={[1.1, 0.4, 0.5]} /></mesh>
          <mesh material={m.stone} position={[0, 0.5, 0]}><boxGeometry args={[0.3, 0.2, 0.3]} /></mesh>
          {[-0.45, 0, 0.45].map((x) => (
            <mesh key={x} material={m.roof} position={[x, x === 0 ? 0.6 : 0.4, 0]}>
              <sphereGeometry args={[x === 0 ? 0.15 : 0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
          ))}
        </group>
      );
    case "museum":
      return (
        <group>
          <mesh material={m.dark} position={[0, 0.05, 0]}><boxGeometry args={[0.8, 0.1, 0.6]} /></mesh>
          <mesh material={m.stone} position={[0, 0.22, 0]}><boxGeometry args={[0.66, 0.24, 0.46]} /></mesh>
          <mesh material={m.roof} position={[0, 0.42, 0]} rotation-y={Math.PI / 4}><coneGeometry args={[0.5, 0.2, 4]} /></mesh>
        </group>
      );
    default:
      // a simple pavilion (chhatri)
      return (
        <group>
          <mesh material={m.dark} position={[0, 0.06, 0]}><boxGeometry args={[0.6, 0.12, 0.6]} /></mesh>
          {[[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].map(([x, z]) => (
            <mesh key={`${x}${z}`} material={m.stone} position={[x, 0.27, z]}><cylinderGeometry args={[0.03, 0.03, 0.3, 6]} /></mesh>
          ))}
          <mesh material={m.roof} position={[0, 0.44, 0]}><sphereGeometry args={[0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        </group>
      );
  }
}
