"use client";

import { Input } from "@/components/ui";
import { getToken } from "@/lib/auth";
import { opcionesDe, limpio } from "@/modulos/com/comunes";
import type { Etiquetas, Num } from "@/modulos/com/tipos";

export { useDatos, qs, num, accion, CifraLink, FiltroSelect, FiltroFecha, Barras, Seccion, limpio, mesActual, nombreMes, hoyLima, useParametrosIniciales, useAlAbrir } from "@/modulos/com/comunes";
export { opciones, type Num, type Etiquetas } from "@/modulos/com/tipos";

export type Cuenta = { code: string; name: string; acc_type: string; nature: string; requires_cost_center: boolean; requires_third_party: boolean; requires_brand: boolean };
export type OpcionesCnt = {
  companies: { id: string; legal_name: string; ruc: string }[];
  company_id: string;
  accounts: Cuenta[];
  brands: { id: string; code: string; name: string }[];
  establishments: { id: string; code: string; name: string }[];
  cost_centers: { id: string; code: string; name: string }[];
  cash_accounts: { id: string; code: string; name: string; bank_name: string | null; account_type: string }[];
  team: { id: string; name: string }[];
  periods: { period: string; status: string; closed_at: string | null }[];
  sources: Record<string, string>;
  reasons: Record<string, string>;
  types: Record<string, string>;
  amounts: Record<string, string>;
  books: { code: string; name: string; via: string }[];
  resolutions: Record<string, Record<string, string>>;
  tasks: { code: string; name: string; auto: boolean }[];
  today: string;
  params: { sire_tolerance: number; threshold_uit: number; inbox_max_age_days: number; interunit_account: string };
  can: { accounts: boolean; rules: boolean; prepare: boolean; approve: boolean; close: boolean; reopen: boolean; sire: boolean; submit: boolean; reports: boolean };
};

const cnt = opcionesDe<OpcionesCnt>("/v1/cnt/opciones");
export const useOpcionesCnt = cnt.usar;
export const olvidarOpcionesCnt = cnt.olvidar;

/** Texto de datos para mostrar: sin referencias internas ni nombres técnicos de campos. */
export const texto = (t: string | null | undefined) => {
  const x = limpio(t).replace(/\bauto_approve\b/g, "de aprobación automática").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
  return x.charAt(0).toUpperCase() + x.slice(1);
};

export const ASIENTO: Etiquetas = {
  DRAFT: ["Borrador", "neutral"], PENDING_APPROVAL: ["Por aprobar", "warn"], APPROVED: ["Aprobado", "ok"], VOIDED: ["Anulado", "bad"],
};
export const ITEM: Etiquetas = {
  PENDING: ["Por clasificar", "warn"], CLASSIFIED: ["Clasificado, por aprobar", "primary"], RETURNED: ["Devuelto", "bad"], APPROVED: ["Aprobado", "ok"], DONE: ["Resuelto", "ok"],
};
export const PROPUESTA: Etiquetas = {
  IMPORTED: ["Importada", "neutral"], WITH_DIFFS: ["Con diferencias", "warn"], RECONCILED: ["Conciliada", "ok"], SUBMITTED: ["Respondida", "ok"],
};
export const CRUCE_SIRE: Etiquetas = {
  MATCHED: ["Coincide", "ok"], AMOUNT_DIFF: ["Diferencia de importe", "warn"], MISSING_IN_SYSTEM: ["Falta en el sistema", "bad"], MISSING_IN_PROPOSAL: ["Falta en la propuesta", "bad"],
};
export const ENVIO_SIRE: Etiquetas = { PREPARED: ["Preparado", "primary"], SUBMITTED: ["Presentado", "warn"], ACCEPTED: ["Aceptado", "ok"], REJECTED: ["Rechazado", "bad"] };
export const ACCION_SIRE: Record<string, string> = { ACCEPT: "Aceptar la propuesta", REPLACE: "Reemplazar la propuesta", ADJUST: "Ajustar la propuesta" };
export const REGISTRO: Record<string, string> = { PURCHASES: "Registro de Compras", SALES: "Registro de Ventas" };
export const BANCO: Etiquetas = { OPEN: ["Abierta", "warn"], CLOSED: ["Cerrada", "ok"] };
export const LINEA_BANCO: Etiquetas = { MATCHED: ["Cruzada", "ok"], UNMATCHED: ["Sin cruzar", "warn"], BOOKED: ["Con asiento", "primary"] };
export const TAREA: Etiquetas = { PENDING: ["Pendiente", "warn"], DONE: ["Hecha", "ok"], WAIVED: ["Dispensada", "neutral"] };
export const PERIODO: Etiquetas = { OPEN: ["Abierto", "warn"], CLOSED: ["Cerrado", "ok"] };
export const PLANILLA: Etiquetas = { POSTED: ["Con asiento", "ok"], VOIDED: ["Anulada", "bad"], IMPORTED: ["Importada", "neutral"] };
export const NATURALEZA: Record<string, string> = { DEBIT: "Deudora", CREDIT: "Acreedora" };
export const REGIMEN: Record<string, string> = { SIMPLIFIED: "Libros simplificados", FULL: "Contabilidad completa" };
export const FORMATO: Record<string, string> = { PDF: "PDF", XLSX: "Excel", TXT: "TXT del PLE" };
export const ACCION_ITEM: Record<string, string> = { NOT_DEDUCTIBLE: "Gasto no deducible", DEDUCTIBLE: "Gasto deducible", REQUEST_RECEIPT: "Pedir el comprobante al área" };

/** Primer y último día de un mes AAAA-MM. */
export const rangoMes = (m: string) => {
  const [a, mm] = m.split("-").map(Number);
  const fin = new Date(a, mm, 0).getDate();
  return { from: `${m}-01`, to: `${m}-${String(fin).padStart(2, "0")}` };
};

/** Mes AAAA-MM de una fecha o período (2026-10-01 → 2026-10). */
export const mesDe = (p: string | null | undefined) => (p ?? "").slice(0, 7);

/** Selector de mes para la cabecera. */
export function SelectorMes({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return <div className="w-[170px]"><Input type="month" aria-label="Mes" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} /></div>;
}

/** Cuenta para un Select: «104101 · Cuentas corrientes». */
export const opcionesCuenta = (op: OpcionesCnt | null) => (op?.accounts ?? []).map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }));

/** Importe con signo y color: negativo en rojo. */
export function Importe({ v, formato }: { v: Num; formato: (x: Num) => string }) {
  const n = Number(v ?? 0);
  return <span className={`tabular-nums ${n < -0.004 ? "text-bad" : ""}`}>{formato(v)}</span>;
}

/** GET de una respuesta de texto plano de la API (archivos de ejemplo). */
export async function textoDeApi(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: { "X-Tenant-Host": window.location.host, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error("No se pudo descargar el ejemplo.");
  return res.text();
}
