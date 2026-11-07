const TONO = { ok: "border-l-ok", warn: "border-l-warn", bad: "border-l-bad" };

/**
 * Cifra de cabecera de una pantalla (series, meses cerrados…): título, valor y una línea de detalle.
 * Con tono, un borde de color a la izquierda llama la atención.
 *   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Cifra titulo="Series" valor="41" detalle="40 activas" /></div>
 */
export function Cifra({ titulo, valor, detalle, tono }: { titulo: string; valor?: string; detalle?: string; tono?: "ok" | "warn" | "bad" }) {
  return (
    <div className={`min-w-0 rounded-xl border border-line bg-surface px-4 py-3 shadow-card ${tono ? `border-l-[3px] ${TONO[tono]}` : ""}`}>
      <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">{titulo}</p>
      <p className="font-display text-[24px] leading-tight font-bold text-ink tabular-nums">{valor ?? "…"}</p>
      {detalle !== undefined && <p className="truncate text-[12px] text-muted" title={detalle}>{detalle || "\u00a0"}</p>}
    </div>
  );
}
