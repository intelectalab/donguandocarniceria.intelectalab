"use client";

/**
 * Gráficos de barras por día, livianos y sin librería (como los demás del sistema). Cada barra muestra su detalle al
 * pasar el cursor; las series apiladas llevan leyenda con su nombre, así el color nunca va solo.
 */

const etiquetaDia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ALTO = 150;

/**
 * Una serie por día como línea (2 px) con sus puntos y una línea de meta punteada. Los días sin dato cortan la línea,
 * no la bajan a cero. Los puntos por encima de la meta van en el color de aviso. Al pasar el cursor por cada día se ve
 * su valor (toda la columna del día responde, no solo el punto).
 */
export function LineaPorDia({ dias, valor, meta, formato, titulo }: {
  dias: string[]; valor: (i: number) => number | null; meta?: number; formato: (v: number) => string; titulo: string;
}) {
  const valores = dias.map((_, i) => valor(i));
  const max = Math.max(meta ?? 0, ...valores.map((v) => v ?? 0), 1) * 1.15;
  const n = Math.max(1, dias.length);
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => ALTO - (v / max) * ALTO;
  // Tramos seguidos con dato: cada uno es una polilínea.
  const tramos: string[] = [];
  let actual: string[] = [];
  valores.forEach((v, i) => {
    if (v === null) {
      if (actual.length > 1) tramos.push(actual.join(" "));
      actual = [];
    } else actual.push(`${x(i)},${y(v)}`);
  });
  if (actual.length > 1) tramos.push(actual.join(" "));

  return (
    <figure className="grid gap-2" aria-label={titulo}>
      <div className="relative border-b border-line" style={{ height: ALTO }}>
        {meta !== undefined && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-warn" style={{ top: y(meta) }}>
            <span className="absolute -top-4 right-0 text-[11px] text-muted">Meta {formato(meta)}</span>
          </div>
        )}
        <svg viewBox={`0 0 100 ${ALTO}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {tramos.map((t, k) => (
            <polyline key={k} points={t} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <div className="absolute inset-0 flex">
          {dias.map((d, i) => {
            const v = valores[i];
            const alto = v !== null && meta !== undefined && v > meta;
            return (
              <div key={d} className="group relative h-full flex-1" title={`${etiquetaDia(d)}: ${v === null ? "sin datos" : formato(v)}`}>
                {v !== null && (
                  <>
                    <span aria-hidden="true" className={`absolute left-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface transition-transform group-hover:scale-125 ${alto ? "bg-warn" : "bg-primary"}`}
                      style={{ top: y(v) }} />
                    <span className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] whitespace-nowrap text-ink shadow-card group-hover:block"
                      style={{ top: Math.max(0, y(v) - 30) }}>{formato(v)}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex">{dias.map((d) => <span key={d} className="flex-1 text-center text-[10.5px] text-muted tabular-nums">{etiquetaDia(d)}</span>)}</div>
    </figure>
  );
}

/** Una serie por día en barras, con una línea de meta (por ejemplo, 60 s). Los días sin dato quedan vacíos, no en cero. */
export function BarrasPorDia({ dias, valor, meta, formato, titulo }: {
  dias: string[]; valor: (i: number) => number | null; meta?: number; formato: (v: number) => string; titulo: string;
}) {
  const valores = dias.map((_, i) => valor(i));
  const max = Math.max(meta ?? 0, ...valores.map((v) => v ?? 0), 1) * 1.1;
  return (
    <figure className="grid gap-2" aria-label={titulo}>
      <div className="relative flex items-end gap-1.5 border-b border-line" style={{ height: ALTO }}>
        {meta !== undefined && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-warn" style={{ bottom: (meta / max) * ALTO }}>
            <span className="absolute -top-4 right-0 text-[11px] text-muted">Meta {formato(meta)}</span>
          </div>
        )}
        {dias.map((d, i) => {
          const v = valores[i];
          return (
            <div key={d} className="group relative flex h-full flex-1 items-end justify-center" title={`${etiquetaDia(d)}: ${v === null ? "sin datos" : formato(v)}`}>
              {v !== null && (
                <div className={`w-full max-w-7 rounded-t-[4px] ${meta !== undefined && v > meta ? "bg-warn" : "bg-primary"} opacity-90 group-hover:opacity-100`}
                  style={{ height: Math.max(2, (v / max) * ALTO) }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">{dias.map((d) => <span key={d} className="flex-1 text-center text-[10.5px] text-muted tabular-nums">{etiquetaDia(d)}</span>)}</div>
    </figure>
  );
}

/** Varias series apiladas por día (por ejemplo, enviados, reintentando y cola muerta), con leyenda. */
export function BarrasApiladas({ dias, series, titulo }: {
  dias: string[]; series: { nombre: string; clase: string; valores: number[] }[]; titulo: string;
}) {
  const totales = dias.map((_, i) => series.reduce((n, s) => n + s.valores[i], 0));
  const max = Math.max(1, ...totales) * 1.1;
  return (
    <figure className="grid gap-2" aria-label={titulo}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {series.map((s) => <li key={s.nombre} className="flex items-center gap-1.5"><span aria-hidden="true" className={`size-2.5 rounded-sm ${s.clase}`} />{s.nombre}</li>)}
      </ul>
      <div className="flex items-end gap-1.5 border-b border-line" style={{ height: ALTO }}>
        {dias.map((d, i) => (
          <div key={d} className="group flex h-full flex-1 flex-col-reverse items-center" title={[etiquetaDia(d), ...series.map((s) => `${s.nombre}: ${s.valores[i]}`)].join(" · ")}>
            {series.map((s, k) => (s.valores[i] > 0 ? (
              <div key={s.nombre} className={`w-full max-w-7 ${s.clase} opacity-90 group-hover:opacity-100 ${k === series.length - 1 || series.slice(k + 1).every((x) => !x.valores[i]) ? "rounded-t-[4px]" : ""}`}
                style={{ height: Math.max(2, (s.valores[i] / max) * ALTO), marginTop: 2 }} />
            ) : null))}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">{dias.map((d) => <span key={d} className="flex-1 text-center text-[10.5px] text-muted tabular-nums">{etiquetaDia(d)}</span>)}</div>
    </figure>
  );
}
