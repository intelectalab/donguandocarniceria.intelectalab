"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton, Select } from "@/components/ui";
import { MESES } from "./tipos";

const largo = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * Selector de mes compacto: «‹ octubre 2026 ▾ ›». Las flechas pasan al mes anterior o siguiente; la lista tiene todos
 * los meses con datos (el más reciente primero), sin límite, y siempre ocupa una sola línea.
 * meses: «AAAA-MM» en orden ascendente (mesesEntre).
 */
export function SelectorMes({ meses, actual, onChange }: { meses: string[]; actual: string; onChange: (m: string) => void }) {
  const i = meses.indexOf(actual);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Mes">
      <IconButton icon={ChevronLeft} label="Mes anterior" disabled={i <= 0} onClick={() => onChange(meses[i - 1])} />
      <div className="w-[170px]">
        <Select aria-label="Elegir mes" value={actual} onChange={(e) => onChange(e.target.value)} searchable={false}
          className="!min-h-9 h-9 py-1.5 text-[13px] first-letter:uppercase"
          options={[...meses].reverse().map((m) => ({ value: m, label: largo(m).replace(/^./, (c) => c.toUpperCase()) }))} />
      </div>
      <IconButton icon={ChevronRight} label="Mes siguiente" disabled={i < 0 || i >= meses.length - 1} onClick={() => onChange(meses[i + 1])} />
    </div>
  );
}
