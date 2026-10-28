"use client";

// Leaflet touches `window`, so this file is only ever loaded with dynamic(..., { ssr: false }).
import L from "leaflet";
import Link from "next/link";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { EntitySummary } from "@/lib/types";
import { CountChips } from "./CountChips";

type Located = EntitySummary & { lat: number; lng: number };

function pinIcon(e: EntitySummary) {
  return L.divIcon({
    className: "", // drop Leaflet's default white square
    html: `<div class="kg-pin${e.n_conflicts > 0 ? " has-conflict" : ""}"><span>${e.n_sources}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -20],
  });
}

function FitToPins({ points }: { points: Located[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [48, 48] });
  }, [map, points]);
  return null;
}

export default function MonumentMap({ entities }: { entities: EntitySummary[] }) {
  const located = entities.filter((e): e is Located => e.lat != null && e.lng != null);

  return (
    <div className="kg-map h-full w-full">
      <MapContainer
        center={[23.2, 72.4]} // Gujarat
        zoom={8}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToPins points={located} />
        {located.map((e) => (
          <Marker key={e.id} position={[e.lat, e.lng]} icon={pinIcon(e)} title={e.name} alt={e.name}>
            <Popup>
              <p className="font-serif text-[17px] font-semibold leading-tight">{e.name}</p>
              <div className="mt-2.5">
                <CountChips entity={e} />
              </div>
              <Link
                href={`/monument/${e.id}`}
                className="mt-3 inline-block rounded bg-water px-3 py-1.5 text-[13px] font-medium !text-paper no-underline"
              >
                Open the record
              </Link>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
