"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, Badge, FiltroSelect, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg, numero, porcentaje, soles } from "@/lib/formato";

/** Tarjeta con título para agrupar datos en las pantallas de TAB. */
export function Seccion({ titulo, acciones, children, className = "" }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card break-inside-avoid ${className}`}>
      {(titulo || acciones) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-[14.5px] font-semibold text-ink">{titulo}</h2>}
          {acciones && <div className="flex flex-wrap gap-2 print:hidden">{acciones}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** GET a la API con recarga. Sin url (null) no pide nada. */
export function useDatos<T>(url: string | null) {
  const [estado, setEstado] = useState<{ url: string; datos?: T; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!url) return;
    let vigente = true;
    api<T>(url).then((d) => vigente && setEstado({ url, datos: d })).catch((e) => vigente && setEstado({ url, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [url, version]);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  const actual = estado && estado.url === url ? estado : null;
  return { datos: actual?.datos ?? null, error: actual?.error ?? "", cargando: Boolean(url) && !actual, recargar };
}

/** Aviso cuando el rol entra a un tablero o pantalla que no le toca. */
export function ErrorCarga({ error, que }: { error: string; que: string }) {
  return /permiso|rol|alcance|no es de/i.test(error)
    ? <Alert tone="info" title="Esta pantalla no es de tu rol">{error} {que}</Alert>
    : <Alert tone="bad">{error}</Alert>;
}

export type Unidad = "PEN" | "PCT" | "COUNT" | "KG" | "DAYS" | "HOURS" | "MINUTES" | "RATIO" | "PEN_PER_KG" | "PEN_PER_UNIT" | string;
export type Origen = "SNAPSHOT" | "LIVE" | "CACHE" | "NONE" | "HIDDEN";
export type Luz = "GREEN" | "AMBER" | "RED" | null;

/** Un indicador con su valor, meta y semáforo (Motor::tarjeta). */
export type Indicador = {
  code: string; module_code: string; name: string; formula: string; unit: Unidad; unidad: string; direction: string; sentido: string;
  frequency: string; frecuencia: string; decimals: number; drilldown: string | null; visible_roles: string[]; status: string; modulo_encendido: boolean; con_calculo: boolean;
  value: number | null; numerator: number | null; denominator: number | null; source: Origen; run_no: number | null; nocalc: boolean; error: string | null;
  anterior: number | null; meta: number | null; tolerancia: number | null; meta_id: string | null; semaforo: Luz;
};

/** Valor con su unidad: S/ 12.60, 18.5 %, 340 kg, 3 días. */
export function valorDe(v: number | null | undefined, unidad: Unidad, dec = 2): string {
  if (v === null || v === undefined) return "—";
  switch (unidad) {
    case "PEN": return soles(v);
    case "PCT": return porcentaje(v, Math.min(dec, 2));
    case "KG": return kg(v);
    case "DAYS": return `${numero(v, Math.min(dec, 1))} ${Number(v) === 1 ? "día" : "días"}`;
    case "HOURS": return `${numero(v, Math.min(dec, 1))} h`;
    case "MINUTES": return `${numero(v, Math.min(dec, 1))} min`;
    case "PEN_PER_KG": return `${soles(v)}/kg`;
    case "PEN_PER_UNIT": return `${soles(v)}/u`;
    case "COUNT": return numero(v, Math.min(dec, 0));
    default: return numero(v, dec);
  }
}

export const LUZ: Record<string, [string, Tone]> = { GREEN: ["Verde", "ok"], AMBER: ["Ámbar", "warn"], RED: ["Rojo", "bad"] };
export const TONO: Record<string, "ok" | "warn" | "bad"> = { GREEN: "ok", AMBER: "warn", RED: "bad" };

/** Semáforo con su palabra: nunca solo el color. */
export function Semaforo({ luz }: { luz: Luz | string | undefined }) {
  if (!luz) return <Badge>Sin meta</Badge>;
  const [t, tono] = LUZ[luz] ?? [luz, "neutral" as Tone];
  return <Badge tone={tono} dot>{t}</Badge>;
}

export const ORIGENES: Record<string, [string, Tone]> = {
  SNAPSHOT: ["Congelado", "neutral"], LIVE: ["En vivo", "info" as Tone], CACHE: ["En vivo", "info" as Tone], NONE: ["Sin cálculo", "neutral"], HIDDEN: ["Módulo apagado", "neutral"],
};
export function OrigenBadge({ x }: { x: Pick<Indicador, "source" | "run_no"> }) {
  const [t, tono] = ORIGENES[x.source] ?? [x.source, "neutral" as Tone];
  return <Badge tone={tono}>{t}{x.run_no ? ` · corrida ${x.run_no}` : ""}</Badge>;
}

/** Enlace al detalle de un indicador con los mismos filtros (RN-TAB-02). */
export const rutaDetalle = (code: string, mes: string) => `/m/tab/tab-10?${new URLSearchParams({ kpi: code, mes })}`;

/** Diferencia con el mes anterior, en el sentido del indicador: verde si mejoró. */
export function Cambio({ x }: { x: Indicador }) {
  if (x.value === null || x.anterior === null || x.anterior === undefined) return <span className="text-muted">—</span>;
  const d = x.value - x.anterior;
  if (Math.abs(d) < 1e-9) return <span className="text-muted">igual</span>;
  const mejor = x.direction === "HIGHER_BETTER" ? d > 0 : x.direction === "LOWER_BETTER" ? d < 0 : null;
  const pct = x.anterior !== 0 ? (d / Math.abs(x.anterior)) * 100 : null;
  return (
    <span className={mejor === null ? "text-muted" : mejor ? "text-ok" : "text-bad"}>
      {d > 0 ? "▲" : "▼"} {pct !== null ? porcentaje(Math.abs(pct), 1) : valorDe(Math.abs(d), x.unit, x.decimals)}
    </span>
  );
}

const BORDE: Record<string, string> = { GREEN: "border-l-ok", AMBER: "border-l-warn", RED: "border-l-bad" };

/** Tarjeta de un indicador: valor, semáforo, meta y mes anterior; la fórmula sale al pasar el cursor y lleva al detalle. */
export function Tarjeta({ x, mes }: { x: Indicador; mes: string }) {
  const sinValor = x.value === null;
  return (
    <Link href={rutaDetalle(x.code, mes)} title={`${x.code} · ${x.formula}`}
      className={`group block min-w-0 rounded-xl border border-line bg-surface px-4 py-3 shadow-card transition-colors hover:border-primary break-inside-avoid ${x.semaforo ? `border-l-[3px] ${BORDE[x.semaforo]}` : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-[12px] font-semibold tracking-wide text-muted uppercase">{x.name}</p>
        {x.semaforo && <span className="shrink-0"><Semaforo luz={x.semaforo} /></span>}
      </div>
      <p className={`font-display text-[20px] leading-tight font-bold tabular-nums sm:text-[24px] ${sinValor ? "text-muted" : "text-ink"}`}>
        {sinValor ? (x.nocalc ? "Sin cálculo" : "—") : valorDe(x.value, x.unit, x.decimals)}
      </p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted">
        <span>Meta {x.meta !== null ? valorDe(x.meta, x.unit, x.decimals) : "—"}</span>
        <span>vs. mes anterior <Cambio x={x} /></span>
      </p>
      <p className="mt-1 text-[11px] text-muted group-hover:text-primary">{x.code} · ver detalle</p>
    </Link>
  );
}

type FilaBarra = { label: string; value: number };

/** Barras horizontales de una sola serie, ordenadas; el valor va escrito al lado y en el cursor. */
export function Barras({ filas, formato }: { filas: FilaBarra[]; formato: string }) {
  const max = Math.max(...filas.map((f) => Math.abs(Number(f.value ?? 0))), 0);
  if (!filas.length) return <p className="text-[13px] text-muted">Sin datos en el mes.</p>;
  return (
    <ul className="space-y-2">
      {filas.map((f, i) => (
        <li key={`${f.label}-${i}`} title={`${f.label}: ${conFormato(f.value, formato)}`}
          className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-2 text-[13px] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
          <span className="truncate">{f.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${max ? (Math.abs(Number(f.value ?? 0)) / max) * 100 : 0}%` }} />
          </span>
          <span className="tabular-nums text-muted">{conFormato(f.value, formato)}</span>
        </li>
      ))}
    </ul>
  );
}

export function conFormato(v: number | string | null | undefined, formato?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (formato === "soles") return soles(v);
  if (formato === "porcentaje") return porcentaje(v, 1);
  if (formato === "kg") return kg(v);
  if (formato === "fecha") return fecha(String(v));
  if (formato === "dias") return `${numero(v, 0)} días`;
  if (formato === "texto") return String(v);
  return typeof v === "number" ? numero(v) : String(v);
}

const SERIES = ["bg-primary", "bg-warn", "bg-ok", "bg-muted"];

/** Pedidos por franja y estado: barras apiladas con leyenda (máximo 4 series). */
export function Apiladas({ etiquetas, series }: { etiquetas: string[]; series: { name: string; values: number[] }[] }) {
  const alto = 140;
  const totales = etiquetas.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totales);
  if (!etiquetas.length) return <p className="text-[13px] text-muted">Sin pedidos hoy.</p>;
  return (
    <figure className="grid gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {series.map((s, k) => <li key={s.name} className="flex items-center gap-1.5"><span aria-hidden="true" className={`size-2.5 rounded-sm ${SERIES[k % 4]}`} />{s.name}</li>)}
      </ul>
      <div className="flex items-end gap-1.5 border-b border-line" style={{ height: alto }}>
        {etiquetas.map((e, i) => (
          <div key={e} className="flex h-full flex-1 flex-col-reverse items-center" title={[e, ...series.map((s) => `${s.name}: ${s.values[i] ?? 0}`)].join(" · ")}>
            {series.map((s, k) => ((s.values[i] ?? 0) > 0 ? (
              <div key={s.name} className={`w-full max-w-8 ${SERIES[k % 4]}`} style={{ height: Math.max(2, ((s.values[i] ?? 0) / max) * (alto - 8)), marginTop: 2 }} />
            ) : null))}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">{etiquetas.map((e) => <span key={e} className="flex-1 truncate text-center text-[10.5px] text-muted tabular-nums">{e.slice(0, 5)}</span>)}</div>
    </figure>
  );
}

/** Gráficos y tablas propias de cada tablero (Tableros::extras). */
export type Extra =
  | { tipo: "barras"; titulo: string; formato: string; filas: FilaBarra[] }
  | { tipo: "cifras"; titulo: string; filas: { label: string; value: number | null; formato?: string; tono?: "ok" | "warn" | "bad"; detalle?: string | null }[] }
  | { tipo: "tabla"; titulo: string; columnas: [string, string, string][]; filas: Record<string, string | number | null>[] }
  | { tipo: "apiladas"; titulo: string; etiquetas: string[]; series: { name: string; values: number[] }[] }
  | { tipo: "nota"; texto: string; titulo?: string };

const TONO_TEXTO = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

export function Extras({ extras }: { extras: Extra[] }) {
  if (!extras.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {extras.map((e, i) => {
        if (e.tipo === "nota") return <div key={i} className="lg:col-span-2"><Alert tone="info">{e.texto}</Alert></div>;
        return (
          <Seccion key={i} titulo={e.titulo}>
            {e.tipo === "barras" && <Barras filas={e.filas} formato={e.formato} />}
            {e.tipo === "apiladas" && <Apiladas etiquetas={e.etiquetas} series={e.series} />}
            {e.tipo === "cifras" && (
              <dl className="grid grid-cols-2 gap-3">
                {e.filas.map((f) => (
                  <div key={f.label} className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
                    <dt className="truncate text-[12px] text-muted">{f.label}</dt>
                    <dd className={`text-[18px] font-semibold tabular-nums ${f.tono ? TONO_TEXTO[f.tono] : "text-ink"}`}>{conFormato(f.value, f.formato)}</dd>
                    {f.detalle && <dd className="truncate text-[11.5px] text-muted">{f.detalle}</dd>}
                  </div>
                ))}
              </dl>
            )}
            {e.tipo === "tabla" && (e.filas.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-[12px] text-muted">{e.columnas.map(([k, t]) => <th key={k} className="pb-1.5 pr-3 font-medium">{t}</th>)}</tr></thead>
                  <tbody>
                    {e.filas.map((f, j) => (
                      <tr key={j} className="border-t border-line">
                        {e.columnas.map(([k, , tipo]) => <td key={k} className={`py-1.5 pr-3 ${tipo === "texto" ? "" : "tabular-nums"}`}>{conFormato(f[k], tipo)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-[13px] text-muted">Nada por vencer en los próximos 30 días.</p>)}
          </Seccion>
        );
      })}
    </div>
  );
}

/** Mes a elegir: el actual y los 11 anteriores. */
export function FiltroMes({ meses, value, onChange }: { meses: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return <FiltroSelect etiqueta="Mes" value={value} onChange={(v) => v && onChange(v)} options={meses} vacio={meses[0]?.label ?? "Mes actual"} ancho={190} />;
}

export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
export const mesLargo = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Filtros de la URL (?mes=2026-10&kpi=…) y de marca y local del selector superior. */
export function consulta(base: Record<string, string>, marca: string, local: string) {
  const q = new URLSearchParams(Object.entries(base).filter(([, v]) => v));
  if (marca && marca !== "ALL") q.set("marca", marca);
  if (local && local !== "ALL") q.set("local", local);
  return q.toString();
}
