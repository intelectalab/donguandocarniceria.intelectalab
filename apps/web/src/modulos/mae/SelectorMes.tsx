"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton, Select } from "@/components/ui";
import { MESES } from "./tipos";

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const filtro = "!min-h-9 h-9 py-1.5 text-[13px]";

/**
 * Selector de mes compacto: «‹ [Octubre ▾] [2026 ▾] ›». Dos listas cortas (los meses con datos del año elegido y los
 * años con datos) en vez de una larga, así no crece con los años. Las flechas pasan al mes anterior o siguiente,
 * también de un año a otro. Al cambiar de año se queda el mismo mes si ese año lo tiene; si no, el más cercano.
 * meses: «AAAA-MM» en orden ascendente (mesesEntre).
 */
export function SelectorMes({ meses, actual, onChange }: { meses: string[]; actual: string; onChange: (m: string) => void }) {
  const i = meses.indexOf(actual);
  const anio = actual.slice(0, 4);
  const anios = [...new Set(meses.map((m) => m.slice(0, 4)))].reverse();
  const delAnio = meses.filter((m) => m.startsWith(anio)).reverse();

  function cambiarAnio(nuevo: string) {
    const disponibles = meses.filter((m) => m.startsWith(nuevo));
    const mismo = `${nuevo}-${actual.slice(5, 7)}`;
    const cercano = disponibles.includes(mismo) ? mismo
      : disponibles.reduce((a, b) => (Math.abs(Number(b.slice(5, 7)) - Number(actual.slice(5, 7))) < Math.abs(Number(a.slice(5, 7)) - Number(actual.slice(5, 7))) ? b : a));
    onChange(cercano);
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Mes">
      <IconButton icon={ChevronLeft} label="Mes anterior" disabled={i <= 0} onClick={() => onChange(meses[i - 1])} />
      <div className="w-[128px]">
        <Select aria-label="Mes" value={actual} onChange={(e) => onChange(e.target.value)} searchable={false} className={filtro}
          options={delAnio.map((m) => ({ value: m, label: mayuscula(MESES[Number(m.slice(5, 7)) - 1]) }))} />
      </div>
      <div className="w-[88px]">
        <Select aria-label="Año" value={anio} onChange={(e) => cambiarAnio(e.target.value)} searchable={false} className={filtro}
          options={anios.map((a) => ({ value: a, label: a }))} />
      </div>
      <IconButton icon={ChevronRight} label="Mes siguiente" disabled={i < 0 || i >= meses.length - 1} onClick={() => onChange(meses[i + 1])} />
    </div>
  );
}
