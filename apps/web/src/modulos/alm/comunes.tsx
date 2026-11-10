"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input, Select, toast, confirmAction } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { unidad, type Num, type Opciones, type Variante } from "./tipos";

let cacheOpciones: Promise<Opciones> | null = null;

/** Opciones de los formularios de ALM (almacenes, locales, marcas, motivos…), una vez por carga de página. */
export function useOpciones(): Opciones | null {
  const [op, setOp] = useState<Opciones | null>(null);
  useEffect(() => {
    let vigente = true;
    cacheOpciones ??= api<Opciones>("/v1/alm/opciones");
    cacheOpciones.then((o) => vigente && setOp(o)).catch((e) => { cacheOpciones = null; toast.error(mensajeDe(e)); });
    return () => { vigente = false; };
  }, []);
  return op;
}
/** Después de crear o editar un almacén o un motivo, las opciones se vuelven a pedir. */
export const olvidarOpciones = () => { cacheOpciones = null; };

export function FiltroSelect({ label, value, onChange, options, ancho = "sm:w-[160px]" }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; ancho?: string }) {
  return (
    <div className={`w-full ${ancho}`}>
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}

export function FiltroFecha({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="w-full sm:w-[150px]">
      <Input type="date" aria-label={label} title={label} value={value} onChange={(e) => onChange(e.target.value)} className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}

/** Cantidad con su unidad (und o kg). */
export function Cant({ v, modo, signo }: { v: Num; modo?: string | null; signo?: boolean }) {
  const n = Number(v ?? 0);
  return <span className="whitespace-nowrap tabular-nums">{signo && n > 0 ? "+" : ""}{numero(v, modo === "KG" ? 3 : undefined)} <span className="text-[11.5px] text-muted">{unidad(modo)}</span></span>;
}

/** Días de vida: negativo es vencido. */
export function Dias({ d }: { d: number | null | undefined }) {
  if (d === null || d === undefined) return <span className="text-muted">—</span>;
  const clase = d < 0 ? "text-bad" : d <= 3 ? "text-warn" : "text-ink";
  return <span className={`whitespace-nowrap tabular-nums font-medium ${clase}`}>{d < 0 ? `Venció hace ${-d} d` : d === 0 ? "Vence hoy" : `${d} d`}</span>;
}

/** Buscador de variantes por SKU, nombre o código de barras. */
export function BuscaVariante({ value, onChange, invalid }: { value: Variante | null; onChange: (v: Variante | null) => void; invalid?: boolean }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<Variante[]>([]);
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<{ data: Variante[] }>(`/v1/alm/variantes?q=${encodeURIComponent(q.trim())}`).then((r) => vigente && setLista(r.data)).catch(() => vigente && setLista([]));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [q, abierto]);

  if (value) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 py-2 text-[13.5px]">
        <span className="font-mono text-[12px] text-muted">{value.sku}</span>
        <span className="min-w-0 flex-1 truncate">{value.name}</span>
        <button type="button" aria-label="Cambiar producto" onClick={() => onChange(null)} className="cursor-pointer text-muted hover:text-ink"><X size={15} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
      <Input value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)} placeholder="SKU, nombre o código de barras" className="pl-9" aria-invalid={invalid || undefined} />
      {abierto && lista.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-[9px] border border-line bg-surface py-1 shadow-card">
          {lista.map((v) => (
            <li key={v.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(v); setQ(""); setAbierto(false); }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                <span className="font-mono text-[11.5px] text-muted">{v.sku}</span>
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                <span className="text-[11.5px] text-muted">{unidad(v.sale_mode)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Acción con confirmación (y motivo, si se pide): llama a la API, avisa y recarga.
 *   await accion({ title: "¿Anular?", reason: { min: 5 } }, (motivo) => api(..., { body: { reason: motivo } }), "Anulada", recargar)
 */
export async function accion(conf: Parameters<typeof confirmAction>[0], hacer: (motivo?: string) => Promise<unknown>, ok: string, despues?: () => void) {
  const r = await confirmAction(conf);
  if (!r) return false;
  try {
    await hacer(r.reason);
    toast.ok(ok);
    despues?.();
    return true;
  } catch (e) {
    toast.error(mensajeDe(e));
    return false;
  }
}

/** Opciones de almacén para un Select: «CAM-L1 · Cámara de frío Local 1». */
export const opcionesAlmacen = (op: Opciones | null, filtro?: (w: Opciones["warehouses"][number]) => boolean) =>
  (op?.warehouses ?? []).filter(filtro ?? (() => true)).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));

/** Número de un input: vacío es null. */
export const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

/** GET simple con recarga: const { datos, cargando, error, recargar } = useDatos<T>(url). url null no pide nada. */
export function useDatos<T>(url: string | null) {
  const [version, setVersion] = useState(0);
  const [res, setRes] = useState<{ clave: string; datos?: T; error?: string } | null>(null);
  const clave = `${url}#${version}`;
  useEffect(() => {
    if (!url) return;
    let vigente = true;
    api<T>(url).then((datos) => vigente && setRes({ clave, datos })).catch((e) => vigente && setRes({ clave, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [url, clave]);
  const cargando = Boolean(url) && res?.clave !== clave;
  return { datos: res?.datos, cargando, error: cargando ? undefined : res?.error, recargar: () => setVersion((v) => v + 1) };
}

/** Parámetros de URL sin los vacíos. */
export const qs = (p: Record<string, string | number | boolean | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== "" && v !== "ALL") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};
