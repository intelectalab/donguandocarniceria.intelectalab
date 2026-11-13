"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export type PlanPublico = {
  code: string; name: string; description: string; price_pen: number;
  users_max: number; brands_max: number; sites_max: number; is_featured: boolean;
  includes_previous: string | null; highlights: string[];
  modulos: { code: string; name: string }[];
};

/** Planes de la API (catálogo de la plataforma), como en erp-saas: la página no los escribe a mano. */
export function usePlanes() {
  const [planes, setPlanes] = useState<PlanPublico[]>([]);
  const [pruebaDias, setPruebaDias] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vigente = true;
    api<{ planes: PlanPublico[]; prueba_dias: number }>("/v1/publico/planes")
      .then((r) => { if (vigente) { setPlanes(r.planes); setPruebaDias(r.prueba_dias); } })
      .catch(() => undefined)
      .finally(() => vigente && setCargando(false));
    return () => { vigente = false; };
  }, []);
  return { planes, pruebaDias, cargando };
}

const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { maximumFractionDigits: 0 })}`;

/** Tarjetas de planes como en la página del prototipo: a quién va, precio, lo que incluye y el botón de prueba. */
export function Planes({ planes, cargando, pruebaDias, onElegir }: { planes: PlanPublico[]; cargando: boolean; pruebaDias: number; onElegir: (code: string) => void }) {
  if (cargando) return <div className="flex justify-center py-12"><Loader2 size={30} className="animate-spin text-primary" /></div>;
  if (!planes.length) return <p className="text-center text-[15px] text-muted">Escríbenos para conocer los planes.</p>;

  return (
    <div className="grid items-stretch gap-6 lg:grid-cols-3">
      {planes.map((p) => (
        <article key={p.code} className={`relative flex flex-col rounded-3xl border bg-surface p-7 ${p.is_featured
          ? "border-primary shadow-[0_24px_60px_rgba(110,20,35,.18)] ring-1 ring-primary"
          : "border-line shadow-card"}`}>
          {p.is_featured && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11.5px] font-bold tracking-[.08em] text-primary-ink uppercase">
              Más elegido
            </span>
          )}
          <h3 className="font-display text-[21px] font-bold">Plan {p.name}</h3>
          <p className="mt-1.5 min-h-[44px] text-[14px] leading-relaxed text-muted">{p.description}</p>
          <p className="mt-5 flex items-baseline gap-1.5">
            <span className="font-display text-[44px] leading-none font-bold tracking-[-0.02em]">{soles(p.price_pen)}</span>
            <span className="text-[14px] text-muted">/ mes</span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-muted">Más IGV. Sin contrato de permanencia.</p>
          {p.includes_previous && <p className="mt-5 text-[13.5px] font-semibold">{p.includes_previous}</p>}
          <ul className={`${p.includes_previous ? "mt-3" : "mt-5"} flex-1 space-y-2.5 text-[14px]`}>
            {p.highlights.map((h) => <li key={h} className="flex gap-2.5"><Check size={17} className="mt-0.5 shrink-0 text-ok" />{h}</li>)}
          </ul>
          <button type="button" onClick={() => onElegir(p.code)}
            className={`mt-7 w-full cursor-pointer rounded-xl py-3 text-[15px] font-semibold transition-[filter,background-color] ${p.is_featured
              ? "bg-primary text-primary-ink hover:brightness-110" : "border border-line bg-surface text-ink hover:bg-surface-2"}`}>
            Empezar prueba gratis
          </button>
          <p className="mt-2 text-center text-[12.5px] text-muted">{pruebaDias} días gratis, sin tarjeta</p>
        </article>
      ))}
    </div>
  );
}
