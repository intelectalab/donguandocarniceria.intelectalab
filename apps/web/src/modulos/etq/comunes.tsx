"use client";

import { useEffect, useState } from "react";
import { Input, StatusBadge, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { qs, useDatos } from "@/modulos/alm/comunes";
import { ESTADO_LOTE } from "@/modulos/pro/tipos";
import { Qr } from "@/modulos/equ/comunes";

export { useDatos, qs, num, accion, CifraLink, FiltroSelect, Barras, useAlAbrir } from "@/modulos/alm/comunes";
export { Seccion, Tabla } from "@/modulos/pro/comunes";
export { ESTADO_LOTE, Qr };

type Etiquetas = Record<string, [string, Tone]>;
export type Num = number | string | null;

export const FORMATO: Record<string, string> = { ZPL: "ZPL (térmica)", ESCPOS: "ESC/POS (ticket)", PDF: "PDF" };
export const CANAL: Record<string, string> = { COUNTER: "Mostrador", WHATSAPP: "WhatsApp", WEB: "Tienda web", B2B: "Empresas" };
export const RIESGO: Record<string, string> = { CLASS_I: "Clase I · riesgo grave", CLASS_II: "Clase II · riesgo moderado", CLASS_III: "Clase III · riesgo bajo" };
export const ESTADO_RETIRO: Etiquetas = { OPEN: ["En curso", "bad"], CLOSED: ["Cerrado", "ok"] };
export const ESTADO_CONTACTO: Etiquetas = { PENDING: ["Por contactar", "warn"], CONTACTED: ["Contactado", "info"], RECOVERED: ["Recuperado", "ok"], NOT_REACHABLE: ["No ubicable", "bad"] };
export const ORIGEN_LOTE: Record<string, string> = { PURCHASE: "Compra", PRODUCTION: "Producción", FARM: "Granja", RETURN: "Devolución", ADJUSTMENT: "Ajuste", BUTCHERY: "Despiece" };
export const CAMPO: Record<string, string> = {
  product: "Producto", brand: "Marca", net_weight: "Peso neto", lot: "Lote", production_date: "Fecha de producción", expiry_date: "Vencimiento", sanitary_registry: "Registro sanitario",
  qr: "QR", price: "Precio", price_per_kg: "Precio por kg", storage: "Conservación", allergens: "Alérgenos", barcode: "Código de barras", sku: "Código del producto", origin: "Origen", establishment: "Local",
};

export type Opciones = {
  brands: { id: string; code: string; name: string }[];
  templates: { id: string; code: string; name: string; format: string; width_mm: number; height_mm: number; brand_id: string; brand_name: string }[];
  establishments: { id: string; code: string; name: string; short: string | null }[];
  printers: { id: string; code: string; name: string; establishment_id: string; status: string }[];
  scales: { id: string; code: string; name: string; establishment_id: string; status: string }[];
  fields: string[]; required_fields: string[]; channels: string[]; risk_classes: string[];
  can: { manage_templates: boolean; print: boolean; reprint: boolean; start_recall: boolean; close_recall: boolean };
};

export type Lote = { id: string; code: string; origin: string; qc_status: string; production_date: string | null; expiry_date: string | null; variant_id: string; product_name: string;
  sanitary_authority: string | null; sku: string; variant_name: string; sale_mode: string; nominal_weight_kg: Num; stock_qty: Num };

let cache: Promise<Opciones> | null = null;

/** Opciones de ETQ (marcas, plantillas, impresoras, balanzas, permisos), una vez por carga de página. */
export function useOpcionesEtq(): Opciones | null {
  const [op, setOp] = useState<Opciones | null>(null);
  useEffect(() => {
    let vigente = true;
    cache ??= api<Opciones>("/v1/etq/opciones");
    cache.then((o) => vigente && setOp(o)).catch((e) => { cache = null; toast.error(mensajeDe(e)); });
    return () => { vigente = false; };
  }, []);
  return op;
}
export const olvidarOpcionesEtq = () => { cache = null; };

/** Buscador de lotes por código, producto o código del producto; muestra hasta 8 coincidencias. */
export function BuscarLote({ onElegir, estados, placeholder = "Código de lote, producto o código…", autoFocus }:
  { onElegir: (l: Lote) => void; estados?: string; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const { datos, cargando } = useDatos<{ data: Lote[] }>(q.trim().length >= 2 ? `/v1/etq/lotes${qs({ q: q.trim(), per_page: 8, status: estados })}` : null);
  const filas = datos?.data ?? [];
  return (
    <div className="relative">
      <Input value={q} autoFocus={autoFocus} placeholder={placeholder} aria-label="Buscar lote"
        onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} />
      {abierto && q.trim().length >= 2 && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {cargando && !filas.length && <li className="px-3 py-2 text-[13px] text-muted">Buscando…</li>}
          {!cargando && !filas.length && <li className="px-3 py-2 text-[13px] text-muted">Ningún lote coincide.</li>}
          {filas.map((l) => (
            <li key={l.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-2"
                onClick={() => { onElegir(l); setQ(""); setAbierto(false); }}>
                <span className="min-w-0"><span className="block font-mono text-[13px] font-semibold">{l.code}</span>
                  <span className="block truncate text-[12px] text-muted">{l.variant_name} · vence {fecha(l.expiry_date)}</span></span>
                <StatusBadge status={l.qc_status} labels={ESTADO_LOTE} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Texto de la etiqueta tal como sale, en un recuadro con la proporción del papel. */
export function VistaEtiqueta({ texto, ancho, alto, qr }: { texto: string; ancho: number; alto: number; qr?: string | null }) {
  const lineas = texto.split("\n");
  return (
    <div className="mx-auto w-full max-w-[460px]">
      <div className="relative flex gap-3 overflow-hidden rounded-md border-2 border-dashed border-line bg-white p-3 font-mono text-[11.5px] leading-snug text-black shadow-sm"
        style={{ aspectRatio: `${ancho} / ${alto}` }}>
        <div className="min-w-0 flex-1 overflow-hidden">
          {lineas.filter((l) => !(qr && l === qr)).map((l, i) => <p key={i} className={i === 0 ? "font-bold" : i === 1 ? "font-semibold" : ""}>{l || " "}</p>)}
        </div>
        {qr && <div className="shrink-0 self-start">{qr.startsWith("http") ? <Qr texto={qr} tamano={80} titulo="QR de trazabilidad" /> : <div className="grid size-20 place-items-center rounded border border-black/40 text-[10px]">QR</div>}</div>}
      </div>
      <p className="mt-1 text-center text-[11.5px] text-muted">{ancho} × {alto} mm</p>
    </div>
  );
}

/** Avance del contacto de un retiro: hechos de total, con barra. */
export function Avance({ hechos, total }: { hechos: number; total: number }) {
  const pct = total ? Math.round((hechos / total) * 100) : 0;
  return (
    <div className="min-w-[110px]">
      <p className="text-[13px]">{hechos} de {total} clientes</p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${pct === 100 ? "bg-ok" : "bg-warn"}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
