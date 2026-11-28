"use client";

import { Minus, Plus } from "lucide-react";
import { soles } from "@/lib/formato";
import { r2 } from "./tipos";

/** Suma de un conteo por denominación: { "100": 2, "0.5": 4 } → 202. */
export function sumaConteo(c: Record<string, number>): number {
  return r2(Object.entries(c).reduce((s, [d, q]) => s + Number(d) * (Number(q) || 0), 0));
}

/** Solo las denominaciones con cantidad, para mandar a la API. */
export function limpiarConteo(c: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(c).filter(([, q]) => Number(q) > 0).map(([d, q]) => [d, Math.floor(Number(q))]));
}

const etiqueta = (d: string) => (Number(d) >= 10 ? `Billete S/ ${d}` : Number(d) >= 1 ? `Moneda S/ ${d}` : `Moneda ${Math.round(Number(d) * 100)} cént.`);
const corta = (d: string) => (Number(d) >= 1 ? `S/ ${d}` : `${Math.round(Number(d) * 100)} cént.`);

/** Conteo de efectivo por denominación (POS-01 fondo inicial, POS-07 arqueo). */
export function Conteo({ denominaciones, valor, onChange, disabled }: {
  denominaciones: string[]; valor: Record<string, number>; onChange: (v: Record<string, number>) => void; disabled?: boolean;
}) {
  const poner = (d: string, q: number) => onChange({ ...valor, [d]: Math.max(0, Math.min(9999, Math.floor(q || 0))) });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {denominaciones.map((d) => {
          const q = valor[d] ?? 0;
          return (
            <div key={d} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/50 px-2.5 py-1.5">
              <span className="min-w-0 flex-1 text-[13.5px] font-medium whitespace-nowrap text-ink" title={etiqueta(d)}>{corta(d)}</span>
              <button type="button" aria-label={`Quitar uno de ${etiqueta(d)}`} disabled={disabled || q <= 0} onClick={() => poner(d, q - 1)}
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-40">
                <Minus size={15} />
              </button>
              <input aria-label={`Cantidad de ${etiqueta(d)}`} inputMode="numeric" disabled={disabled} value={q || ""} placeholder="0"
                onChange={(e) => poner(d, Number(e.target.value.replace(/\D/g, "")))}
                className="h-9 w-14 rounded-lg border border-line bg-surface text-center text-[14px] text-ink tabular-nums outline-none focus:border-primary" />
              <button type="button" aria-label={`Agregar uno de ${etiqueta(d)}`} disabled={disabled} onClick={() => poner(d, q + 1)}
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-40">
                <Plus size={15} />
              </button>
              <span className="w-[64px] text-right text-[12.5px] text-muted tabular-nums">{q ? soles(Number(d) * q) : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2 text-[14px] font-semibold text-primary">
        <span>Total contado</span><span className="tabular-nums">{soles(sumaConteo(valor))}</span>
      </div>
    </div>
  );
}
