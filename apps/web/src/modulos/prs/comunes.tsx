"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, Badge, FiltroFecha, FiltroSelect, StatusBadge, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { porcentaje, numero } from "@/lib/formato";

/** Tarjeta con título para agrupar datos en las pantallas de PRS. */
export function Seccion({ titulo, acciones, children, className = "" }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      {(titulo || acciones) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-[14.5px] font-semibold text-ink">{titulo}</h2>}
          {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
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

export type Concepto = { id: string; code: string; name: string; parent_id: string | null; is_group: boolean; concept_type: Tipo; behavior: "VARIABLE" | "FIXED" | null; status: string; default_cost_center_id: string | null };
export type Tipo = "INCOME" | "COST_OF_SALES" | "EXPENSE";
export type VersionCorta = { id: string; budget_id: string; year: number; version_no: number; status: string; etiqueta: string; name: string; estado: string };
export type Opciones = {
  empresa_id: string; anios: number[]; versiones: VersionCorta[]; conceptos: Concepto[];
  marcas: { id: string; code: string; name: string }[]; locales: { id: string; code: string; name: string }[];
  centros: { id: string; code: string; name: string; area: string; brand_id: string | null; establishment_id: string | null }[];
  categorias: { id: string; code: string; name: string; category_group: string }[];
  puede: { editar: boolean; enviar: boolean; aprobar: boolean; conceptos: boolean; ver_todo: boolean };
  parametros: { ambar: number; alerta: number; metodo: string; mes_inicio: number }; hoy: string;
  tipos: Record<Tipo, string>; fuentes: Record<string, string>; personal: Record<string, string>; estados: Record<string, string>;
};
export type Version = {
  id: string; budget_id: string; year: number; version_no: number; name: string; status: string; estado: string; etiqueta: string; source: string; adjust_pct: number;
  based_on_version_id: string | null; editable: boolean; creada_por: string | null; created_by: string; created_at: string; enviada_por: string | null; submitted_by: string | null;
  submitted_at: string | null; aprobada_por: string | null; approved_at: string | null; rechazada_por: string | null; rejected_at: string | null; decision_comment: string | null;
  history?: { at: string; action: string; user?: string; note?: string }[];
};
export type Totales = { ingreso: number; costo: number; gasto: number; resultado: number };

export function useOpciones() {
  return useDatos<Opciones>("/v1/prs/opciones");
}

/** Aviso cuando el rol entra a una pantalla que no le toca. */
export function ErrorCarga({ error, que }: { error: string; que: string }) {
  return /permiso|rol|corresponde|es de|no tiene acceso/i.test(error)
    ? <Alert tone="info" title="Esta pantalla no es de tu rol">{que} Si lo necesitas, pídelo a quien administra los roles.</Alert>
    : <Alert tone="bad">{error}</Alert>;
}

export const ESTADOS_VERSION: Record<string, [string, Tone]> = {
  DRAFT: ["Borrador", "neutral"], SUBMITTED: ["Por aprobar", "warn"], APPROVED: ["Aprobada · vigente", "ok"], REJECTED: ["Rechazada", "bad"], SUPERSEDED: ["Reemplazada", "neutral"],
};
export const ESTADOS_ALERTA: Record<string, [string, Tone]> = {
  OPEN: ["Abierta", "bad"], ACK: ["En seguimiento", "warn"], CLOSED: ["Cerrada", "neutral"], RESOLVED: ["Resuelta", "ok"],
};
export const EstadoVersion = ({ s }: { s: string }) => <StatusBadge status={s} labels={ESTADOS_VERSION} />;

export const LUZ: Record<string, [string, Tone]> = { GREEN: ["Verde", "ok"], AMBER: ["Ámbar", "warn"], RED: ["Rojo", "bad"] };

/** Semáforo (RN-PRS-07) con su % al lado. */
export function Semaforo({ luz, pct }: { luz: string | null | undefined; pct?: number | null }) {
  if (!luz) return <Badge>Sin dato</Badge>;
  const [t, tono] = LUZ[luz] ?? [luz, "neutral" as Tone];
  return <Badge tone={tono} dot>{t}{pct !== undefined && pct !== null ? ` · ${porcentaje(pct, 1)}` : ""}</Badge>;
}

export const TONO_LUZ: Record<string, "ok" | "warn" | "bad"> = { GREEN: "ok", AMBER: "warn", RED: "bad" };

/** S/ 12 345 sin decimales: los presupuestos se leen en soles enteros. */
export const s0 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `S/ ${numero(Math.round(v), 0)}`);

export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
export const mesCorto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}`;
export const mesLargo = (m: string) => `${MESES_LARGOS[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;

export function FiltroMes({ value, onChange, etiqueta = "Mes" }: { value: string; onChange: (v: string) => void; etiqueta?: string }) {
  return <FiltroFecha etiqueta={etiqueta} tipo="month" visible value={value} onChange={(v) => v && onChange(v)} ancho={150} />;
}

/** Fecha de corte del real: por defecto hoy. Sirve para ver cómo iba un mes a una fecha. */
export function FiltroCorte({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <FiltroFecha etiqueta="Al" visible value={value} onChange={(v) => onChange(v || hoyLima())} ancho={150} />;
}

export function FiltroVersion({ versiones, value, onChange, etiqueta = "Versión", soloEditables, vacio }: {
  versiones: VersionCorta[]; value: string; onChange: (v: string) => void; etiqueta?: string; soloEditables?: boolean; vacio?: string;
}) {
  const vs = versiones.filter((v) => !soloEditables || ["DRAFT", "REJECTED"].includes(v.status));
  return <FiltroSelect etiqueta={etiqueta} value={value} onChange={onChange} ancho={260} vacio={vacio ?? "Elige una versión"}
    options={vs.map((v) => ({ value: v.id, label: `${v.etiqueta} · ${v.estado}` }))} />;
}

export const AlDetalle = ({ concepto, mes, al, modo, dim, valor, children }: { concepto: string; mes: string; al: string; modo?: string; dim?: string; valor?: string | null; children: ReactNode }) => {
  const q = new URLSearchParams({ concepto, mes, al, ...(modo ? { modo } : {}), ...(dim && dim !== "concepto" ? { dim } : {}), ...(valor ? { valor } : {}) });
  return <Link href={`/m/prs/prs-07?${q}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{children}</Link>;
};

/** Texto de la dimensión de una línea: «Don Guando · Surco · MKT-DG». */
export function dimensionDe(op: Opciones | null, x: { brand_id?: string | null; establishment_id?: string | null; cost_center_id?: string | null }) {
  if (!op) return "";
  const p = [
    x.brand_id ? op.marcas.find((m) => m.id === x.brand_id)?.name : null,
    x.establishment_id ? op.locales.find((l) => l.id === x.establishment_id)?.name.replace(/ · .*$/, "") : null,
    x.cost_center_id ? op.centros.find((c) => c.id === x.cost_center_id)?.code : null,
  ].filter(Boolean);
  return p.join(" · ") || "Sin dimensión";
}

export const opcionesDe = (xs: { id: string; code: string; name: string }[], conCodigo = true) =>
  xs.map((x) => ({ value: x.id, label: conCodigo ? `${x.code} · ${x.name}` : x.name }));
