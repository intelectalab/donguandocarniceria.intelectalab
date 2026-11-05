"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { capaOsm, colorPrimario, crearMapa, encuadrar, iconoEtiqueta, iconoPin, type LatLng } from "./mapa-base";

export type { LatLng };
export type MapReference = LatLng & { label: string; title?: string };

type Props = {
  /** Pin elegido; null si todavía no hay. */
  value: LatLng | null;
  onChange: (v: LatLng) => void;
  /** Otros puntos para orientarse (los demás locales, por ejemplo). No se pueden mover. */
  references?: MapReference[];
  height?: number;
  disabled?: boolean;
};

/**
 * Mapa para fijar una ubicación: un clic pone el pin y se puede arrastrar para ajustarlo. Usa las
 * calles de OpenStreetMap (Leaflet), así que necesita internet; si el mapa no carga, lo dice y la
 * ubicación se sigue pudiendo escribir a mano.
 *   <MapPicker value={pin} onChange={setPin} references={otrosLocales} />
 */
export function MapPicker({ value, onChange, references = [], height = 260, disabled }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const cambiar = useRef(onChange);
  const bloqueado = useRef(disabled);
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);
  // Lo que el mapa necesita al crearse (o recrearse con «Reintentar»).
  const actual = useRef({ value, references });
  useEffect(() => {
    cambiar.current = onChange;
    bloqueado.current = disabled;
    actual.current = { value, references };
  });

  // El mapa se crea una vez (Leaflet usa window: se carga solo en el navegador).
  useEffect(() => {
    let cancelado = false;
    let quitar = () => {};
    import("leaflet").then(({ default: L }) => {
      if (cancelado || !holder.current) return;
      const { value: v, references: refs } = actual.current;
      const m = crearMapa(L, holder.current);
      capaOsm(L, () => { if (!cancelado) setFallo(true); }).addTo(m);

      for (const r of refs) {
        L.marker([r.lat, r.lng], { keyboard: false, interactive: false, icon: iconoEtiqueta(L, r.label) }).addTo(m);
      }

      const crearPin = (p: LatLng) => {
        marker.current = L.marker([p.lat, p.lng], {
          draggable: !bloqueado.current,
          icon: iconoPin(L, colorPrimario()),
        })
          .on("dragend", (e) => {
            const { lat, lng } = (e.target as Marker).getLatLng();
            cambiar.current({ lat: redondear(lat), lng: redondear(lng) });
          })
          .addTo(m);
      };
      if (v) crearPin(v);

      m.on("click", (e) => {
        if (bloqueado.current) return;
        const p = { lat: redondear(e.latlng.lat), lng: redondear(e.latlng.lng) };
        if (marker.current) marker.current.setLatLng([p.lat, p.lng]);
        else crearPin(p);
        cambiar.current(p);
      });

      if (v) m.setView([v.lat, v.lng], 16);
      else encuadrar(L, m, refs, 14);

      map.current = m;
      quitar = () => {
        m.remove();
        map.current = null;
        marker.current = null;
      };
    }).catch(() => { if (!cancelado) setFallo(true); });

    return () => {
      cancelado = true;
      quitar();
    };
  }, [intento]);

  // Si la ubicación cambia desde afuera (se escribió a mano), el pin la sigue.
  useEffect(() => {
    if (!value || !marker.current || !map.current) return;
    const actual = marker.current.getLatLng();
    if (actual.lat !== value.lat || actual.lng !== value.lng) {
      marker.current.setLatLng([value.lat, value.lng]);
      map.current.panTo([value.lat, value.lng]);
    }
  }, [value]);

  if (fallo) {
    return (
      <div style={{ height }} className="flex flex-col items-center justify-center gap-2 rounded-[9px] border border-dashed border-line bg-surface-2 px-4 text-center text-[13px] text-muted">
        <MapPin size={20} aria-hidden="true" />
        <p>No se pudo cargar el mapa. Revisa la conexión o escribe la latitud y la longitud.</p>
        <button type="button" onClick={() => { setFallo(false); setIntento((n) => n + 1); }} className="cursor-pointer font-medium text-primary hover:underline">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="isolate">
      <div ref={holder} style={{ height }} className="overflow-hidden rounded-[9px] border border-line"
        role="application" aria-label="Mapa: haz clic para fijar la ubicación" />
      {!disabled && <p className="mt-1.5 text-[12px] text-muted">{value ? "Arrastra el pin para ajustarlo." : "Haz clic en el mapa para fijar la ubicación."}</p>}
    </div>
  );
}

// 5 decimales: alrededor de 1 metro.
const redondear = (n: number) => Math.round(n * 1e5) / 1e5;
