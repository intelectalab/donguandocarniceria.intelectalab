"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { capaOsm, colorPrimario, crearMapa, encuadrar, iconoEtiqueta, iconoPin, type LatLng } from "@/components/ui/mapa-base";

export type PuntoFlota = LatLng & { id: string; label: string; title?: string; color?: string; chico?: boolean };
export type Trazo = { id: string; puntos: [number, number][]; color?: string; grueso?: number; punteado?: boolean };

const COLORES = { ok: "#1f8a4c", warn: "#c27a00", bad: "#c0392b", info: "#2f6fb5", neutral: "#8a8a8a" } as const;
export const colorTono = (t: keyof typeof COLORES | string) => COLORES[t as keyof typeof COLORES] ?? COLORES.neutral;

/**
 * Mapa de la flota: pines (vehículos, paradas) y trazos (rastro del día, recorrido). Encuadra todo lo que muestra
 * mientras la persona no lo haya movido. Con onSelect, un clic en un pin lo elige.
 */
export function MapaFlota({ puntos, trazos = [], onSelect, height = 380, encuadre }: {
  puntos: PuntoFlota[]; trazos?: Trazo[]; onSelect?: (id: string) => void; height?: number; encuadre?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const elegir = useRef(onSelect);
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    elegir.current = onSelect;
  });
  const clave = JSON.stringify({ puntos, trazos });

  useEffect(() => {
    let cancelado = false;
    let quitar = () => {};
    import("leaflet").then(({ default: L }) => {
      if (cancelado || !holder.current) return;
      const { puntos: ps, trazos: ts } = JSON.parse(clave) as { puntos: PuntoFlota[]; trazos: Trazo[] };
      const todos: LatLng[] = [...ps, ...ts.flatMap((t) => t.puntos.map(([lat, lng]) => ({ lat, lng })))];
      let movido = false;
      const m = crearMapa(L, holder.current, () => { if (!movido) encuadrar(L, m, todos); });
      capaOsm(L, () => { if (!cancelado) setFallo(true); }).addTo(m);
      const primario = colorPrimario();
      for (const t of ts) {
        if (t.puntos.length < 2) continue;
        L.polyline(t.puntos, { color: t.color ?? primario, weight: t.grueso ?? 3, opacity: 0.85, dashArray: t.punteado ? "6 6" : undefined, interactive: false }).addTo(m);
      }
      for (const p of ps) {
        if (p.chico) {
          const c = L.circleMarker([p.lat, p.lng], { radius: 5, color: "#fff", weight: 1.5, fillColor: p.color ?? primario, fillOpacity: 1 }).addTo(m);
          if (p.title) c.bindTooltip(p.title);
          if (elegir.current) c.on("click", () => elegir.current?.(p.id));
          continue;
        }
        const mk = L.marker([p.lat, p.lng], { icon: iconoPin(L, p.color ?? primario), title: p.title ?? p.label, keyboard: false }).addTo(m);
        if (elegir.current) mk.on("click", () => elegir.current?.(p.id));
        if (p.label) L.marker([p.lat, p.lng], { icon: iconoEtiqueta(L, p.label, { encimaDePin: true }), interactive: false, keyboard: false }).addTo(m);
      }
      encuadrar(L, m, todos);
      m.on("dragstart zoomstart", (e) => { if ((e as { originalEvent?: Event }).originalEvent) movido = true; });
      quitar = () => m.remove();
    }).catch(() => { if (!cancelado) setFallo(true); });
    return () => {
      cancelado = true;
      quitar();
    };
  }, [clave, intento, encuadre]);

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
        aria-label={`Mapa con ${puntos.length} ${puntos.length === 1 ? "punto" : "puntos"}${trazos.length ? " y su recorrido" : ""}`} />
    </div>
  );
}

/**
 * Serie en el tiempo (temperatura, velocidad) como línea SVG, con una banda del rango permitido y una línea de límite.
 * Los puntos fuera de rango van en rojo. Al pasar el cursor se ve la hora y el valor.
 */
export function SerieTiempo({ puntos, min, max, limite, unidad, alto = 180, titulo }: {
  puntos: { t: string; v: number }[]; min?: number | null; max?: number | null; limite?: number; unidad: string; alto?: number; titulo: string;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  if (puntos.length === 0) return <p className="text-[13px] text-muted">Sin lecturas.</p>;
  const ts = puntos.map((p) => new Date(p.t.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).getTime());
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts, t0 + 1);
  const vs = puntos.map((p) => p.v);
  const extra = [min, max, limite].filter((x): x is number => typeof x === "number");
  const lo = Math.min(...vs, ...extra) - 1;
  const hi = Math.max(...vs, ...extra) + 1;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * 100;
  const y = (v: number) => alto - ((v - lo) / (hi - lo)) * alto;
  const fuera = (v: number) => (min !== null && min !== undefined && v < min) || (max !== null && max !== undefined && v > max) || (limite !== undefined && v > limite);
  const linea = puntos.map((p, i) => `${x(ts[i])},${y(p.v)}`).join(" ");
  const horaDe = (i: number) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(ts[i]);
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0));
  return (
    <figure className="grid gap-1" aria-label={titulo}>
      <div className="relative" style={{ height: alto }}
        onMouseLeave={() => setFoco(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
          let k = 0;
          for (let i = 1; i < ts.length; i++) if (Math.abs(ts[i] - t) < Math.abs(ts[k] - t)) k = i;
          setFoco(k);
        }}>
        <svg viewBox={`0 0 100 ${alto}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {min !== null && min !== undefined && max !== null && max !== undefined && (
            <rect x={0} width={100} y={y(max)} height={y(min) - y(max)} fill="var(--ok)" opacity={0.1} />
          )}
          {max !== null && max !== undefined && <line x1={0} x2={100} y1={y(max)} y2={y(max)} stroke="var(--ok)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          {min !== null && min !== undefined && <line x1={0} x2={100} y1={y(min)} y2={y(min)} stroke="var(--ok)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          {limite !== undefined && <line x1={0} x2={100} y1={y(limite)} y2={y(limite)} stroke="var(--bad)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
          <polyline points={linea} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {foco !== null && <line x1={x(ts[foco])} x2={x(ts[foco])} y1={0} y2={alto} stroke="var(--line)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {puntos.map((p, i) => fuera(p.v) && (
          <span key={i} aria-hidden="true" className="absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-bad" style={{ left: `${x(ts[i])}%`, top: y(p.v) }} />
        ))}
        {foco !== null && (
          <span className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11.5px] whitespace-nowrap text-ink shadow-card"
            style={{ left: `${Math.min(92, Math.max(8, x(ts[foco])))}%`, top: Math.max(0, y(puntos[foco].v) - 30) }}>
            {horaDe(foco)} · {puntos[foco].v.toLocaleString("es-PE", { maximumFractionDigits: 1 })} {unidad}
          </span>
        )}
        <span className="absolute top-0 left-0 text-[10.5px] text-muted">{hi.toFixed(0)} {unidad}</span>
        <span className="absolute bottom-0 left-0 text-[10.5px] text-muted">{lo.toFixed(0)} {unidad}</span>
      </div>
      <div className="flex justify-between text-[10.5px] text-muted tabular-nums">
        {marcas.map((m) => <span key={m}>{new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(m)}</span>)}
      </div>
    </figure>
  );
}
