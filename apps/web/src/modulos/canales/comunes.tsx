"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Badge, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { getToken } from "@/lib/auth";

// Piezas comunes de CON, B2B y CMP. Las de listas y acciones son las de ALM.
export { useDatos, qs, num, accion, CifraLink, FiltroSelect, FiltroFecha, Barras, useParametrosIniciales, useAlAbrir } from "@/modulos/alm/comunes";

export type Num = number | string | null;
export type Etiquetas = Record<string, [string, Tone]>;
export const opciones = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));
export const opcionesDe = (m: Etiquetas) => Object.entries(m).map(([value, [label]]) => ({ value, label }));
export const n = (v: Num | undefined) => Number(v ?? 0);

const cache = new Map<string, Promise<unknown>>();

/** Opciones de formularios de un módulo (/v1/con/opciones…), una vez por carga de página. */
export function useOpcionesDe<T>(url: string): T | null {
  const [op, setOp] = useState<T | null>(null);
  useEffect(() => {
    let vigente = true;
    if (!cache.has(url)) cache.set(url, api<T>(url));
    (cache.get(url) as Promise<T>).then((o) => vigente && setOp(o)).catch((e) => { cache.delete(url); toast.error(mensajeDe(e)); });
    return () => { vigente = false; };
  }, [url]);
  return op;
}
export const olvidarOpcionesDe = (url: string) => cache.delete(url);

/** Tarjeta con título para agrupar una sección de la pantalla. */
export function Panel({ titulo, acciones, children, className = "" }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      {(titulo || acciones) && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {titulo && <h2 className="text-[14px] font-semibold">{titulo}</h2>}
        {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
      </div>}
      {children}
    </section>
  );
}

/** Fila de cifras: 2 columnas en el celular, 4 en pantalla ancha. */
export function Cifras({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 }) {
  const c = cols === 5 ? "lg:grid-cols-5" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4";
  return <div className={`grid grid-cols-2 gap-3 ${c}`}>{children}</div>;
}

/** Barra de filtros sobre una tabla. */
export function Filtros({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}

/** Línea de texto secundaria debajo de un dato de tabla. */
export function Sub({ children }: { children: ReactNode }) {
  return <span className="block text-[12px] text-muted">{children}</span>;
}

/** Semáforo que calcula la API: { code, tone, label }. */
export function Semaforo({ s }: { s: { code: string; tone: string; label: string } | null | undefined }) {
  if (!s) return <span className="text-muted">—</span>;
  const tono: Tone = s.tone === "success" ? "ok" : s.tone === "warning" ? "warn" : s.tone === "danger" ? "bad" : s.tone === "info" ? "info" : "neutral";
  return <Badge tone={tono} dot>{s.label}</Badge>;
}

/** Días de mora o para vencer, con color. */
export function DiasMora({ d }: { d: number | null | undefined }) {
  if (d === null || d === undefined) return <span className="text-muted">—</span>;
  if (d <= 0) return <Badge tone="ok">Al día</Badge>;
  return <Badge tone={d > 30 ? "bad" : "warn"}>{d} {d === 1 ? "día" : "días"}</Badge>;
}

export const DIAS_SEMANA = [
  { value: "1", label: "Lun" }, { value: "2", label: "Mar" }, { value: "3", label: "Mié" }, { value: "4", label: "Jue" },
  { value: "5", label: "Vie" }, { value: "6", label: "Sáb" }, { value: "7", label: "Dom" },
];
export const diasTexto = (d: (number | string)[] | null | undefined) =>
  (d ?? []).map((x) => DIAS_SEMANA.find((s) => s.value === String(x))?.label ?? x).join(", ") || "—";

/** Botones de día de la semana (1 = lunes … 7 = domingo). */
export function DiasSemana({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Días de la semana">
      {DIAS_SEMANA.map((d) => {
        const on = value.includes(Number(d.value));
        return (
          <button key={d.value} type="button" aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== Number(d.value)) : [...value, Number(d.value)].sort())}
            className={`min-h-9 min-w-11 cursor-pointer rounded-lg border px-2 text-[13px] font-medium ${on ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-muted hover:text-ink"}`}>
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

/** Descarga de un archivo de la API con el token de la sesión (CSV, comprobantes). */
export async function descargar(path: string, nombre: string) {
  try {
    const token = getToken();
    const r = await fetch(`/api${path}`, { headers: { "X-Tenant-Host": window.location.host, Accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      throw new Error(j?.message ?? "No se pudo descargar el archivo.");
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = r.headers.get("X-File-Name") ? `${r.headers.get("X-File-Name")}.txt` : nombre;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    toast.error(mensajeDe(e));
  }
}
