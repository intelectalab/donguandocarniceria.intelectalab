import type { LucideIcon } from "lucide-react";

const TONO = {
  ok: { borde: "border-l-ok", icono: "bg-ok-soft text-ok" },
  warn: { borde: "border-l-warn", icono: "bg-warn-soft text-warn" },
  bad: { borde: "border-l-bad", icono: "bg-bad-soft text-bad" },
};

/**
 * Cifra de cabecera de una pantalla (series, meses cerrados…): título, valor y una línea de detalle.
 *   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
 *     <Cifra titulo="Series" valor="41" detalle="40 activas" icono={Hash} destacada />
 *   </div>
 * - icono: en un cuadro de color suave, como en erp-saas.
 * - tono: borde de color a la izquierda y el ícono del mismo color, para llamar la atención.
 * - destacada: fondo con el degradado del menú; para la cifra principal de la pantalla (una sola).
 */
export function Cifra({ titulo, valor, detalle, tono, icono: Icono, destacada }: {
  titulo: string; valor?: string; detalle?: string; tono?: "ok" | "warn" | "bad"; icono?: LucideIcon; destacada?: boolean;
}) {
  const t = tono ? TONO[tono] : null;
  return (
    <div style={destacada ? { background: "var(--side-bg)" } : undefined}
      className={`relative min-w-0 overflow-hidden rounded-xl border px-4 py-3 shadow-card ${destacada
        ? "border-transparent text-white"
        : `border-line bg-surface ${t ? `border-l-[3px] ${t.borde}` : ""}`}`}>
      {destacada && <span aria-hidden="true" className="franja absolute inset-x-0 bottom-0 h-1 opacity-90" />}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={`text-[11.5px] font-semibold tracking-wide uppercase ${destacada ? "text-white/75" : "text-muted"}`}>{titulo}</p>
          <p className={`font-display text-[24px] leading-tight font-bold tabular-nums ${destacada ? "text-white" : "text-ink"}`}>{valor ?? "…"}</p>
          {detalle !== undefined && (
            <p className={`truncate text-[12px] ${destacada ? "text-white/75" : "text-muted"}`} title={detalle}>{detalle || " "}</p>
          )}
        </div>
        {Icono && (
          <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${destacada
            ? "bg-white/15 text-white" : t ? t.icono : "bg-primary-soft text-primary"}`}>
            <Icono size={18} />
          </span>
        )}
      </div>
    </div>
  );
}
