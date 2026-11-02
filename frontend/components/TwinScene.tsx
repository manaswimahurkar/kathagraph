"use client";

// WebGL view of a monument's photo coverage: each photo hangs where it was taken from, facing the
// monument, around a compass ring whose sides glow when they are covered. Photos with no location
// float in an upper ring. Loaded with dynamic(..., { ssr: false }) because WebGL only exists in the browser.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { TwinReport } from "@/lib/types";

const MAX_TEXTURES = 24; // full-size photos are heavy; the rest show as frames

function cssColor(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function Photo({ url, position, textured, onHover, active }: {
  url: string; position: THREE.Vector3; textured: boolean; onHover: (on: boolean) => void; active: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [aspect, setAspect] = useState(4 / 3);
  useEffect(() => {
    if (!textured) return;
    let live = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (t) => {
        if (!live) return t.dispose();
        t.colorSpace = THREE.SRGBColorSpace;
        const img = t.image as HTMLImageElement | undefined;
        if (img?.width && img?.height) setAspect(img.width / img.height);
        setTex(t);
      },
      undefined,
      () => undefined, // blocked or missing: keep the plain frame
    );
    return () => {
      live = false;
    };
  }, [url, textured]);
  useEffect(() => () => tex?.dispose(), [tex]);
  useEffect(() => {
    // Face outwards, like a window: seen from outside, each photo shows what its camera saw looking in
    ref.current?.lookAt(position.x * 2, position.y, position.z * 2);
  }, [position]);
  const h = 0.9;
  const w = Math.min(1.6, h * aspect);
  return (
    <group>
      <mesh ref={ref} position={position} scale={active ? 1.35 : 1}
        onPointerOver={(e) => { e.stopPropagation(); onHover(true); }} onPointerOut={() => onHover(false)}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex ?? undefined} color={tex ? "#ffffff" : "#c9b48f"} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Rig({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const drag = useRef<{ x: number; v: number; down: boolean }>({ x: 0, v: 0.12, down: false });
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => { drag.current.down = true; drag.current.x = e.clientX; };
    const move = (e: PointerEvent) => {
      if (!drag.current.down || !group.current) return;
      group.current.rotation.y += (e.clientX - drag.current.x) * 0.008;
      drag.current.x = e.clientX;
    };
    const up = () => { drag.current.down = false; };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [gl]);
  useFrame((_, dt) => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (group.current && !drag.current.down && !reduce) group.current.rotation.y += dt * drag.current.v;
  });
  return <group ref={group}>{children}</group>;
}

function Ring({ coverage }: { coverage: number[] }) {
  const water = useMemo(() => new THREE.Color(cssColor("--color-water", "#2e5e5b")), []);
  const rust = useMemo(() => new THREE.Color(cssColor("--color-rust", "#9b3b2a")), []);
  const max = Math.max(1, ...coverage);
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {coverage.map((n, i) => {
        // Sector i is centred on compass bearing i*45° (0 = north = -z). In the ring's rotated frame,
        // angle a on the XY plane maps to world (cos a, -sin a) on (x, z), so north is a = 90°.
        const centre = Math.PI / 2 - (i * Math.PI) / 4;
        return (
          <mesh key={i}>
            <ringGeometry args={[2.6, 3.2, 16, 1, centre - Math.PI / 8 + 0.02, Math.PI / 4 - 0.04]} />
            <meshBasicMaterial color={n ? water : rust} transparent opacity={n ? 0.35 + 0.6 * (n / max) : 0.35} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}

/** A stepwell-like stepped block standing in for the monument until a real 3D model exists. */
function Monument() {
  const color = useMemo(() => new THREE.Color(cssColor("--color-ochre", "#9a6316")), []);
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 0.18 + i * 0.36, 0]}>
          <boxGeometry args={[1.8 - i * 0.38, 0.34, 1.8 - i * 0.38]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function NorthMarker() {
  return (
    <mesh position={[0, 0.02, -3.6]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.16, 3]} />
      <meshBasicMaterial color="#9b3b2a" />
    </mesh>
  );
}

export default function TwinScene({ report, onHover }: { report: TwinReport; onHover: (id: number | null) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const placed = useMemo(() => {
    let unplaced = 0;
    const perSide = new Array(8).fill(0);
    const count = report.shots.length;
    return report.shots.map((s, idx) => {
      if (s.side != null) {
        const k = perSide[s.side]++;
        const bearing = (s.side * 45 + ((k % 3) - 1) * 12) * (Math.PI / 180);
        const r = 4.1 + Math.floor(k / 3) * 0.9 + (s.distance_m ? Math.min(1.2, s.distance_m / 400) : 0);
        const y = 0.7 + (k % 2) * 0.55;
        return { s, idx, pos: new THREE.Vector3(Math.sin(bearing) * r, y, -Math.cos(bearing) * r) };
      }
      const a = (unplaced++ / Math.max(1, count)) * Math.PI * 2 * 1.618 * 4;
      return { s, idx, pos: new THREE.Vector3(Math.sin(a) * 5.4, 3.1 + (unplaced % 3) * 0.5, -Math.cos(a) * 5.4) };
    });
  }, [report]);

  return (
    <Canvas camera={{ position: [0, 6.5, 10.5], fov: 45 }} dpr={[1, 1.75]} onPointerMissed={() => setActive(null)}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} />
      <Rig>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <circleGeometry args={[7.5, 64]} />
          <meshBasicMaterial color={cssColor("--color-sand", "#ede3d1")} transparent opacity={0.6} />
        </mesh>
        <Ring coverage={report.coverage} />
        <NorthMarker />
        <Monument />
        {placed.map(({ s, idx, pos }) => (
          <Photo
            key={s.id}
            url={s.url}
            position={pos}
            textured={idx < MAX_TEXTURES}
            active={active === s.id}
            onHover={(on) => {
              setActive(on ? s.id : null);
              onHover(on ? s.id : null);
            }}
          />
        ))}
      </Rig>
    </Canvas>
  );
}
