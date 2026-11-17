"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { capaOsm, colorPrimario, crearMapa, iconoEtiqueta, iconoPin, LIMA } from "@/components/ui/mapa-base";

export type ZonaEnMapa = { id: string; label: string; polygon: [number, number][] | null; centro: { lat: number; lng: number } | null; activa: boolean };

type Props = {
  zonas: ZonaEnMapa[];
  seleccion?: string | null;
  onSelect?: (id: string) => void;
  /** Polígono que se está dibujando: cada clic en el mapa agrega un vértice. */
  dibujo?: [number, number][] | null;
  onPunto?: (p: [number, number]) => void;
  /** Pin de prueba (CLI-09). */
  pin?: { lat: number; lng: number } | null;
  onPin?: (p: { lat: number; lng: number }) => void;
  height?: number;
};

/**
 * Mapa de las zonas de reparto: los polígonos (o el centro de las zonas por distrito), la elegida
 * resaltada, y en modo dibujo cada clic agrega un vértice. Con onPin, un clic pone el pin de prueba.
 */
export function MapaZonas({ zonas, seleccion, onSelect, dibujo, onPunto, pin, onPin, height = 420 }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<Leaflet.Map | null>(null);
  const capa = useRef<Leaflet.LayerGroup | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const encuadrado = useRef(false);
  const props = useRef({ onSelect, onPunto, onPin, dibujando: dibujo != null });
  const [listo, setListo] = useState(false);
  const [fallo, setFallo] = useState(false);
  useEffect(() => { props.current = { onSelect, onPunto, onPin, dibujando: dibujo != null }; });

  useEffect(() => {
    let cancelado = false;
    import("leaflet").then(({ default: L }) => {
      if (cancelado || !caja.current) return;
      lib.current = L;
      const m = crearMapa(L, caja.current);
      capaOsm(L, () => { if (!cancelado) setFallo(true); }).addTo(m);
      m.setView([LIMA.lat, LIMA.lng], 11);
      m.on("click", (e) => {
        const p = props.current;
        if (p.dibujando && p.onPunto) p.onPunto([Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))]);
        else if (p.onPin) p.onPin({ lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) });
      });
      capa.current = L.layerGroup().addTo(m);
      mapa.current = m;
      setListo(true);
    });
    return () => { cancelado = true; mapa.current?.remove(); mapa.current = null; };
  }, []);

  const clave = JSON.stringify([zonas, seleccion, dibujo, pin]);
  useEffect(() => {
    const L = lib.current;
    const m = mapa.current;
    const g = capa.current;
    if (!listo || !L || !m || !g) return;
    g.clearLayers();
    const color = colorPrimario();
    const puntos: [number, number][] = [];
    for (const z of zonas) {
      const elegida = z.id === seleccion;
      const tono = !z.activa ? "#8a8a8a" : elegida ? color : "#2563a8";
      if (z.polygon && z.polygon.length >= 3 && !(elegida && dibujo)) {
        const pol = L.polygon(z.polygon, { color: tono, weight: elegida ? 3 : 1.5, fillOpacity: elegida ? 0.25 : 0.1, dashArray: z.activa ? undefined : "4 4" }).addTo(g);
        pol.on("click", (e) => { if (!props.current.dibujando && props.current.onSelect) { L.DomEvent.stopPropagation(e); props.current.onSelect(z.id); } });
        pol.bindTooltip(z.label, { sticky: true });
        puntos.push(...z.polygon);
      } else if (z.centro) {
        L.circleMarker([z.centro.lat, z.centro.lng], { radius: elegida ? 9 : 6, color: tono, weight: 2, fillOpacity: 0.35 })
          .on("click", (e) => { if (!props.current.dibujando && props.current.onSelect) { L.DomEvent.stopPropagation(e); props.current.onSelect(z.id); } })
          .bindTooltip(z.label).addTo(g);
        puntos.push([z.centro.lat, z.centro.lng]);
      }
      if (elegida && z.centro) L.marker([z.centro.lat, z.centro.lng], { icon: iconoEtiqueta(L, z.label), interactive: false, keyboard: false }).addTo(g);
    }
    if (dibujo && dibujo.length) {
      (dibujo.length >= 3 ? L.polygon(dibujo, { color, weight: 3, fillOpacity: 0.2 }) : L.polyline(dibujo, { color, weight: 3 })).addTo(g);
      for (const v of dibujo) L.circleMarker(v, { radius: 4, color, fillColor: "#fff", fillOpacity: 1, weight: 2, interactive: false }).addTo(g);
    }
    if (pin) L.marker([pin.lat, pin.lng], { icon: iconoPin(L, color), keyboard: false, interactive: false }).addTo(g);
    if (!encuadrado.current && puntos.length > 1) {
      m.fitBounds(L.latLngBounds(puntos), { padding: [24, 24], maxZoom: 14 });
      encuadrado.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, clave]);

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-line">
      <div ref={caja} style={{ height }} className={`w-full ${dibujo ? "cursor-crosshair" : ""}`} role="application"
        aria-label={`Mapa de ${zonas.length} zonas de reparto${dibujo ? ": haz clic para agregar vértices" : ""}`} />
      {fallo && <p className="pointer-events-none absolute inset-x-0 top-0 z-[500] bg-surface/90 py-2 pr-3 pl-14 text-[12.5px] text-muted">No cargaron las calles del mapa (sin internet). Las zonas por distrito siguen funcionando.</p>}
    </div>
  );
}
