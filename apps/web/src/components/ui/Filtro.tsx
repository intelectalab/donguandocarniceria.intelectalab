"use client";

import type { CSSProperties } from "react";
import { Input, Select } from "./Field";

/**
 * Filtros de la barra de una tabla: compactos, con su nombre en el texto vacío («Estado: todos»). Van en el toolbar
 * del DataTable, a la derecha del buscador, igual en todas las pantallas:
 *
 *   <DataTable search={{ value, onChange, placeholder: "Buscar…" }}
 *     toolbar={<>
 *       <FiltroSelect etiqueta="Estado" value={f.status} onChange={(v) => setF({ ...f, status: v })} options={…} />
 *       <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} … />
 *       <FiltroFecha etiqueta="Fecha" value={f.dia} onChange={…} />
 *     </>} … />
 *
 * En el celular ocupan una columna cada uno (la barra los pone de dos en dos).
 */
const COMPACTO = "!min-h-9 h-9 py-1.5 text-[13px]";
const caja = (ancho: number) => ({ className: "w-full sm:w-[var(--ancho-filtro)]", style: { "--ancho-filtro": `${ancho}px` } as CSSProperties });

export function FiltroSelect({ etiqueta, todos = "todos", value, onChange, options, ancho = 160, vacio }: {
  etiqueta: string;
  /** «todos» o «todas», según el nombre. */
  todos?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ancho?: number;
  /** Texto de la opción vacía cuando no es «Etiqueta: todos» (por ejemplo «Vigentes y revocadas»). */
  vacio?: string;
}) {
  return (
    <div {...caja(ancho)}>
      <Select aria-label={etiqueta} title={etiqueta} value={value} onChange={(e) => onChange(e.target.value)} placeholder={vacio ?? `${etiqueta}: ${todos}`}
        options={options} className={COMPACTO} />
    </div>
  );
}

/** Fecha o mes. Con `visible`, la etiqueta se ve delante (para rangos «Desde» y «Hasta», que si no se confunden). */
export function FiltroFecha({ etiqueta, value, onChange, tipo = "date", min, max, ancho = 160, visible }: {
  etiqueta: string;
  value: string;
  onChange: (v: string) => void;
  tipo?: "date" | "month";
  min?: string;
  max?: string;
  ancho?: number;
  visible?: boolean;
}) {
  const campo = <Input type={tipo} aria-label={etiqueta} title={etiqueta} value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} className={COMPACTO} />;
  if (!visible) return <div {...caja(ancho)}>{campo}</div>;
  const c = caja(ancho + 50);
  return (
    <label className={`${c.className} flex items-center gap-1.5 text-[12.5px] text-muted`} style={c.style}>
      <span className="shrink-0">{etiqueta}</span>
      <span className="min-w-0 flex-1">{campo}</span>
    </label>
  );
}
