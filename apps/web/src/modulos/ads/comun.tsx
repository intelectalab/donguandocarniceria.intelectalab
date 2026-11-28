"use client";

import { Badge, Button, FiltroFecha, type Tone } from "@/components/ui";

export type Opcion = { value: string; label: string };

export const PLATAFORMAS: Opcion[] = [
  { value: "GOOGLE", label: "Google Ads" },
  { value: "META", label: "Meta Ads" },
  { value: "TIKTOK", label: "TikTok Ads" },
];

export const TONO_PLATAFORMA: Record<string, Tone> = {
  GOOGLE: "info",
  META: "neutral",
  TIKTOK: "warn",
};

export const TONO_ESTADO: Record<string, Tone> = {
  ACTIVE: "ok",
  PAUSED: "warn",
  DISCONNECTED: "bad",
  ENDED: "neutral",
  REMOVED: "neutral",
  OK: "ok",
  FAILED: "bad",
  PARTIAL: "warn",
  RUNNING: "info",
  RECONCILED: "ok",
  OBSERVED: "warn",
  PENDING: "warn",
  APPROVED: "ok",
  PAID: "ok",
  SUBMITTED: "info",
  REJECTED: "bad",
};

export function InsigniaPlataforma({ p, label }: { p: string; label?: string }) {
  return <Badge tone={TONO_PLATAFORMA[p] ?? "neutral"}>{label || (PLATAFORMAS.find((x) => x.value === p)?.label ?? p)}</Badge>;
}

export function tonoRoas(v: number | null | undefined): Tone {
  if (v === null || v === undefined) return "neutral";
  return v >= 4 ? "ok" : v >= 2 ? "warn" : "bad";
}

/** Barra de selección de período para las pantallas de resultados, embudo, creadores y comparativo. */
export function BarraPeriodo({ desde, hasta, onChange, children }: {
  desde: string;
  hasta: string;
  onChange: (desde: string, hasta: string) => void;
  children?: React.ReactNode;
}) {
  const esSet = desde === "2026-09-01" && hasta === "2026-09-30";
  const esOct = desde === "2026-10-01" && hasta.startsWith("2026-10-");

  return (
    <div className="flex flex-wrap items-end justify-between gap-2 rounded-xl border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
          <Button size="sm" variant={esSet ? "primary" : "ghost"} onClick={() => onChange("2026-09-01", "2026-09-30")}>Setiembre 2026</Button>
          <Button size="sm" variant={esOct ? "primary" : "ghost"} onClick={() => onChange("2026-10-01", "2026-10-09")}>Octubre 2026</Button>
        </div>
        <FiltroFecha etiqueta="Desde" visible value={desde} max={hasta} onChange={(v) => v && onChange(v, hasta)} />
        <FiltroFecha etiqueta="Hasta" visible value={hasta} min={desde} onChange={(v) => v && onChange(desde, v)} />
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Código QR vectorial determinista a partir de una cadena (para afiches y vitrina en ADS-03). */
export function CodigoQr({ valor, size = 168 }: { valor: string; size?: number }) {
  const n = 21;
  let h = 2166136261;
  for (let i = 0; i < valor.length; i++) {
    h ^= valor.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const esEsquina = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const celdaEsquina = (r: number, c: number) => {
    const lr = r < 7 ? r : r - (n - 7);
    const lc = c < 7 ? c : c - (n - 7);
    return lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4);
  };
  const celdas: { r: number; c: number }[] = [];
  let seed = h >>> 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (esEsquina(r, c)) {
        if (celdaEsquina(r, c)) celdas.push({ r, c });
      } else {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        if ((seed & 3) !== 0) celdas.push({ r, c });
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${n + 2} ${n + 2}`} className="rounded-lg border border-line bg-white p-2">
      {celdas.map(({ r, c }) => (
        <rect key={`${r}-${c}`} x={c + 1} y={r + 1} width={1} height={1} fill="#111827" />
      ))}
    </svg>
  );
}
