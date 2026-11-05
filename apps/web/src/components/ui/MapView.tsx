"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { capaOsm, colorPrimario, crearMapa, encuadrar, iconoEtiqueta, iconoPin, type LatLng } from "./mapa-base";

export type MapPoint = LatLng & {
  id: string;
  /** Texto corto sobre el pin (código del local). */
  label: string;
  /** Nombre completo, al pasar el mouse. */
  title?: string;
  /** Punto apagado (inactivo): se dibuja gris. */
  muted?: boolean;
};

/**
 * Mapa de solo lectura con varios puntos (todos los locales, las paradas de una ruta…), encuadrados
 * para que se vean todos. Con onSelect, un clic en un punto lo abre.
 *   <MapView points={locales.map((l) => ({ id: l.id, lat: l.lat, lng: l.lng, label: l.code }))} onSelect={editar} />
 */
export function MapView({ points, onSelect, height = 320 }: { points: MapPoint[]; onSelect?: (id: string) => void; height?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const elegir = useRef(onSelect);
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    elegir.current = onSelect;
  });

  // Se redibuja cuando cambian los puntos (filtros, un local nuevo…).
  const clave = JSON.stringify(points);

  useEffect(() => {
    let cancelado = false;
    let quitar = () => {};
    import("leaflet").then(({ default: L }) => {
      if (cancelado || !holder.current) return;
      const puntos: MapPoint[] = JSON.parse(clave);
      // Mientras la persona no lo haya movido, al cambiar de tamaño se vuelve a encuadrar todo.
      let movido = false;
      const m = crearMapa(L, holder.current, () => { if (!movido) encuadrar(L, m, puntos); });
      capaOsm(L, () => { if (!cancelado) setFallo(true); }).addTo(m);
      const color = colorPrimario();
      for (const p of puntos) {
        const marcador = L.marker([p.lat, p.lng], { icon: iconoPin(L, p.muted ? "#8a8a8a" : color), title: p.title ?? p.label, keyboard: false })
          .addTo(m);
        if (elegir.current) marcador.on("click", () => elegir.current?.(p.id));
        L.marker([p.lat, p.lng], { icon: iconoEtiqueta(L, p.label, { encimaDePin: true }), interactive: false, keyboard: false }).addTo(m);
      }
      encuadrar(L, m, puntos);
      m.on("dragstart zoomstart", (e) => { if ((e as { originalEvent?: Event }).originalEvent) movido = true; });
      quitar = () => m.remove();
    }).catch(() => { if (!cancelado) setFallo(true); });
    return () => {
      cancelado = true;
      quitar();
    };
  }, [clave, intento]);

  if (fallo) {
    return (
      <div style={{ height }} className="flex flex-col items-center justify-center gap-2 rounded-[9px] border border-dashed border-line bg-surface-2 px-4 text-center text-[13px] text-muted">
        <MapPin size={20} aria-hidden="true" />
        <p>No se pudo cargar el mapa. Revisa la conexión.</p>
        <button type="button" onClick={() => { setFallo(false); setIntento((n) => n + 1); }} className="cursor-pointer font-medium text-primary hover:underline">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="isolate">
      <div ref={holder} style={{ height }} className="overflow-hidden rounded-[9px] border border-line" role="img"
        aria-label={`Mapa con ${points.length} ${points.length === 1 ? "punto" : "puntos"}: ${points.map((p) => p.title ?? p.label).join(", ")}`} />
    </div>
  );
}
