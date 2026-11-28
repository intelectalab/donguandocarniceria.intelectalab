"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Select, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";

/* ------------------------------------------------------------------ textos */

export const ESTADO_TIENDA: Record<string, [string, Tone]> = {
  ACTIVE: ["Activa", "ok"], TESTING: ["En prueba", "info"], PENDING: ["Por configurar", "warn"], DISABLED: ["Desactivada", "neutral"],
};

export const ESTADO_BANDEJA: Record<string, [string, Tone]> = {
  RECEIVED: ["Recibido", "info"], PROCESSED: ["Procesado", "ok"], ERROR: ["Error", "bad"], IGNORED: ["Ignorado", "neutral"],
};

export const ORIGEN_BANDEJA: Record<string, string> = { WEBHOOK: "Webhook", POLL: "Consulta de respaldo", MANUAL: "Cargado a mano" };

export const ESTADO_MAPEO: Record<string, [string, Tone]> = { LINKED: ["Vinculado", "ok"], UNLINKED: ["Sin vínculo", "warn"], ERROR: ["Error", "bad"] };

export const PROBLEMA: Record<string, string> = {
  ERROR: "Error al enviar", VARIANT_INACTIVE: "Variante inactiva", PRICE_MISSING: "Sin precio", PRICE: "Precio por enviar", STOCK: "Stock por enviar",
};

export const ESTADO_PAGO: Record<string, [string, Tone]> = {
  approved: ["Aprobada", "ok"], pending: ["Pendiente", "warn"], in_process: ["En revisión", "warn"], authorized: ["Autorizada", "info"],
  rejected: ["Rechazada", "bad"], cancelled: ["Cancelada", "neutral"], expired: ["Vencida", "neutral"], refunded: ["Reembolsada", "bad"],
  charged_back: ["Contracargo", "bad"], in_mediation: ["En disputa", "warn"],
};

export const CONCILIACION: Record<string, [string, Tone]> = {
  NA: ["No aplica", "neutral"], NO_PAYMENT: ["Sin cobro", "warn"], MATCHED: ["Conciliado", "ok"], DIFF: ["Con diferencia", "bad"],
  TO_RELEASE: ["Por liberar", "info"], IN_BATCH: ["En liquidación abierta", "info"], RELEASED: ["Liberado, por conciliar", "warn"], REVERSED: ["Cobro revertido", "bad"],
};

export const TIPO_CORRIDA: Record<string, string> = { CATALOG: "Catálogo", PRICES: "Precios", STOCK: "Stock", ORDERS: "Pedidos" };

export const ORIGEN_CORRIDA: Record<string, string> = { SCHEDULE: "Programada", MANUAL: "Manual", SALE: "Tras una venta" };

export const ESTADO_CORRIDA: Record<string, [string, Tone]> = { COMPLETED: ["Completa", "ok"], PARTIAL: ["Parcial", "warn"], FAILED: ["Fallida", "bad"] };

export const RESULTADO_ITEM: Record<string, [string, Tone]> = { OK: ["Enviado", "ok"], ERROR: ["Error", "bad"], SKIPPED: ["Omitido", "neutral"] };

export const ESTADO_EVENTO: Record<string, [string, Tone]> = {
  RECEIVED: ["Recibido", "info"], PROCESSED: ["Procesado", "ok"], FAILED: ["Fallido", "bad"], REJECTED: ["Rechazado", "bad"], IGNORED: ["Ignorado", "neutral"],
};

export const SITUACION_STOCK: Record<string, [string, Tone]> = { AGOTADO: ["Agotado", "bad"], POR_ENVIAR: ["Por enviar", "warn"], AL_DIA: ["Al día", "ok"] };

export const MEDIO_MP: Record<string, string> = {
  visa: "Visa", master: "Mastercard", amex: "American Express", debvisa: "Visa débito", yape: "Yape", pagoefectivo_atm: "PagoEfectivo",
};

/* ------------------------------------------------------------------ tipos */

export type Historia = { at: string; user?: string; action?: string; status?: string; detail: string };

export type TiendaCorta = { id: string; name: string; status?: string };

/* ------------------------------------------------------------------ datos */

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

export const n = (v: string | number | null | undefined) => Number(v ?? 0);

/** Fecha y hora de la API (con zona) o del historial (sin zona, hora de Lima). */
export function cuando(v: string | null | undefined): string {
  if (!v) return "—";
  let t = String(v).trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(t)) t += ":00";
  else if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) t += "-05:00";
  return fechaHora(t);
}

/* ------------------------------------------------------------------ piezas */

/** Tarjeta con título para agrupar datos. */
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

/** Historial: lo más reciente primero. */
export function Historial({ items }: { items: Historia[] }) {
  if (!items.length) return <Vacio>Sin movimientos.</Vacio>;
  const orden = [...items].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return (
    <ol className="space-y-2.5">
      {orden.map((h, i) => (
        <li key={i} className="border-l-2 border-line pl-3 text-[13px]">
          <div className="text-[12px] text-muted">{cuando(h.at)}{h.user ? ` · ${h.user}` : ""}</div>
          <div className="break-words text-ink">{h.detail}</div>
        </li>
      ))}
    </ol>
  );
}

/** Texto crudo (JSON del webhook o de la API), plegado. */
export function Crudo({ titulo, valor }: { titulo: string; valor: unknown }) {
  const [abierto, setAbierto] = useState(false);
  let texto = "";
  if (typeof valor === "string") {
    try { texto = JSON.stringify(JSON.parse(valor), null, 2); } catch { texto = valor; }
  } else {
    texto = JSON.stringify(valor, null, 2);
  }
  const Icono = abierto ? ChevronDown : ChevronRight;
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex cursor-pointer items-center gap-1 text-[13px] font-medium text-primary">
        <Icono size={15} aria-hidden="true" />{titulo}
      </button>
      {abierto && (
        <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg border border-line bg-surface-2 p-3 text-[12px] leading-relaxed text-ink">{texto}</pre>
      )}
    </div>
  );
}

/** Elegir tienda (las que el usuario ve). */
export function ElegirTienda({ tiendas, value, onChange }: { tiendas: TiendaCorta[]; value: string; onChange: (id: string) => void }) {
  if (tiendas.length <= 1) return null;
  return (
    <div className="w-full sm:w-[260px]">
      <Select aria-label="Tienda" value={value} onChange={(e) => onChange(e.target.value)}
        options={tiendas.map((t) => ({ value: t.id, label: t.name }))} />
    </div>
  );
}

/** La tienda elegida: la de la URL o la primera activa. */
export function useTienda(tiendas: TiendaCorta[] | undefined, inicial?: string | null): [string, (id: string) => void] {
  const [elegida, setElegida] = useState(inicial ?? "");
  const valida = tiendas?.some((t) => t.id === elegida) ? elegida : (tiendas?.find((t) => t.status === "ACTIVE") ?? tiendas?.[0])?.id ?? "";
  return [valida, setElegida];
}
