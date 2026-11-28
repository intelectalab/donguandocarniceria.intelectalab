"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import qrcode from "qrcode-generator";
import { Search, X } from "lucide-react";
import { Input, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";

/* ------------------------------------------------------------------ textos */

export const TIPOS_CUENTA: Record<string, string> = {
  CASH_REGISTER: "Caja de efectivo", PETTY_CASH: "Caja chica", BANK: "Cuenta bancaria", WALLET: "Billetera (Yape o Plin)",
  GATEWAY: "Pasarela de pago", CARD_ACQUIRER: "POS de tarjeta", DRIVER_CASH: "Caja del repartidor",
};

export const CONCILIACION: Record<string, [string, Tone]> = {
  PENDING: ["Por conciliar", "warn"], MATCHED: ["Conciliado", "ok"], DIFFERENCE: ["Con diferencia", "bad"], NOT_APPLICABLE: ["No aplica", "neutral"],
};

export const ESTADO_COBRO: Record<string, [string, Tone]> = { CONFIRMED: ["Vigente", "ok"], REVERSED: ["Revertido", "bad"] };

export const ESTADO_LIQUIDACION: Record<string, [string, Tone]> = {
  SETTLED: ["Liquidada", "ok"], WITH_DIFFERENCE: ["Con diferencia", "warn"], APPROVED: ["Aprobada", "info"],
};

export const ESTADO_ABONO: Record<string, [string, Tone]> = { OPEN: ["Abierto", "warn"], MATCHED: ["Conciliado", "ok"], WITH_DIFFERENCE: ["Con diferencia", "bad"] };

export const ORIGEN_COBRO: Record<string, string> = { CAJ: "Caja", POS: "Mostrador", DEL: "Contra entrega", WEB: "Tienda web" };

/* ------------------------------------------------------------------ tipos */

export type Cliente = { id: string; full_name: string; doc_type: string; doc_number: string | null; phone: string | null };

export type PedidoPendiente = {
  id: string; number: string; status: string; delivery_date: string | null; estimated_total: string; final_total: string | null; paid_amount: string;
  marca: string | null; pendiente: string; comprobante: string | null;
};
export type DocPendiente = { id: string; full_number: string; doc_type: string; issue_date: string; due_date: string | null; total: string; order_id: string | null; balance: string; saldo: number };
export type Pendientes = { pedidos: PedidoPendiente[]; comprobantes: DocPendiente[]; saldo_a_favor: number };

export type FilaCobro = {
  id: string; number: string; paid_at: string; amount: string; reference: string | null; status: string; reconciliation_status: string; fee_amount: string; fee_igv: string | null;
  card_brand: string | null; card_last4: string | null; to_balance: string | null; pos_ticket: string | null; pos_shift_id: string | null; source: string | null;
  reversal_reason: string | null; voucher_file_id: string | null; medio: string; medio_nombre: string; medio_tipo: string; cuenta: string; cuenta_code: string;
  cliente: string | null; marca: string | null; cobrado_por: string | null; local: string | null; aplicado: string;
};

export type DetalleCobro = FilaCobro & {
  customer_id: string; brand_id: string; establishment_id: string; paid_at: string; notes: string | null; reversed_at: string | null; reversed_by: string | null;
  cuenta_tipo: string; cliente_doc_type: string | null; cliente_doc: string | null; abono: string | null; abono_estado: string | null; liquidacion: string | null;
  aplicaciones: { id: string; line_no: number; amount: string; order_id: string | null; document_id: string | null; pedido: string | null; comprobante: string | null; doc_type: string | null }[];
  sin_aplicar: number; origen: string; pendientes: Pendientes | null;
};

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

export const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

export const n = (v: string | number | null | undefined) => Number(v ?? 0);

/** Redondea a céntimos sin errores de coma flotante. */
export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ piezas */

/** Tarjeta con título para agrupar datos en las pantallas de CAJ. */
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

/** Fila «dato … valor» para resúmenes de montos. */
export function Linea({ t, v, fuerte, tono }: { t: ReactNode; v: ReactNode; fuerte?: boolean; tono?: "ok" | "bad" | "warn" }) {
  const color = tono === "bad" ? "text-bad" : tono === "ok" ? "text-ok" : tono === "warn" ? "text-warn" : "text-ink";
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 text-[13.5px] ${fuerte ? "border-t border-line pt-2 font-semibold" : ""}`}>
      <span className="text-muted">{t}</span>
      <span className={`tabular-nums ${color}`}>{v}</span>
    </div>
  );
}

/** Diferencia con su signo y color. */
export function Diferencia({ valor }: { valor: number | string }) {
  const v = n(valor);
  if (Math.abs(v) < 0.005) return <span className="tabular-nums text-ok">Cuadra</span>;
  return <span className={`tabular-nums ${v < 0 ? "text-bad" : "text-warn"}`}>{v < 0 ? "−" : "+"}{soles(Math.abs(v))}</span>;
}

/** QR oficial de la cuenta (Yape o Plin), dibujado en SVG. */
export function Qr({ texto, tamano = 180 }: { texto: string; tamano?: number }) {
  const dibujo = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(texto);
    q.make();
    const m = q.getModuleCount();
    let ruta = "";
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) if (q.isDark(y, x)) ruta += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { d: ruta, n: m + 4 };
  }, [texto]);
  return (
    <svg viewBox={`0 0 ${dibujo.n} ${dibujo.n}`} width={tamano} height={tamano} role="img" aria-label="Código QR para pagar" className="rounded-lg bg-white p-1" shapeRendering="crispEdges">
      <path d={dibujo.d} fill="#000" />
    </svg>
  );
}

/** Buscador de clientes por nombre, documento o celular. */
export function BuscarCliente({ valor, onElegir, autoFocus }: { valor: Cliente | null; onElegir: (c: Cliente | null) => void; autoFocus?: boolean }) {
  const [texto, setTexto] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) return;
    let vigente = true;
    const t = setTimeout(() => {
      setBuscando(true);
      api<Cliente[]>(`/v1/caj/clientes?q=${encodeURIComponent(q)}`)
        .then((r) => vigente && setLista(r)).catch(() => vigente && setLista([])).finally(() => vigente && setBuscando(false));
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [texto]);

  if (valor) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium">{valor.full_name}</div>
          <div className="text-[12px] text-muted">{valor.doc_type !== "NONE" ? `${valor.doc_type} ${valor.doc_number ?? ""}` : "Sin documento"}{valor.phone ? ` · ${valor.phone}` : ""}</div>
        </div>
        <button type="button" onClick={() => onElegir(null)} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface" aria-label="Cambiar de cliente">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }
  const visibles = texto.trim().length >= 2 ? lista : [];
  return (
    <div className="relative">
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, DNI, RUC o celular…" className="pl-9" autoFocus={autoFocus} aria-label="Buscar cliente" />
      {texto.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-surface shadow-card">
          {buscando && visibles.length === 0 && <p className="px-3 py-2 text-[13px] text-muted">Buscando…</p>}
          {!buscando && visibles.length === 0 && <p className="px-3 py-2 text-[13px] text-muted">Sin resultados.</p>}
          {visibles.map((c) => (
            <button key={c.id} type="button" onClick={() => { onElegir(c); setTexto(""); }}
              className="block w-full cursor-pointer px-3 py-2 text-left hover:bg-surface-2">
              <div className="text-[13.5px]">{c.full_name}</div>
              <div className="text-[12px] text-muted">{c.doc_type !== "NONE" ? `${c.doc_type} ${c.doc_number ?? ""}` : "Sin documento"}{c.phone ? ` · ${c.phone}` : ""}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type Aplicacion = { order_id?: string; document_id?: string; amount: number };

/**
 * Pedidos y comprobantes del cliente con un campo para el monto que se aplica a cada uno. Devuelve las
 * aplicaciones con monto. «Repartir» llena en orden hasta el monto disponible.
 */
export function TablaAplicar({ pendientes, disponible, valores, onChange }: {
  pendientes: Pendientes; disponible: number; valores: Record<string, string>; onChange: (v: Record<string, string>) => void;
}) {
  const filas = [
    ...pendientes.comprobantes.map((d) => ({ clave: `d:${d.id}`, titulo: d.full_number, detalle: `Emitido ${d.issue_date}${d.due_date ? ` · vence ${d.due_date}` : ""}`, falta: d.saldo })),
    ...pendientes.pedidos.map((o) => ({ clave: `o:${o.id}`, titulo: `Pedido ${o.number}`, detalle: `${o.marca ?? ""}${o.delivery_date ? ` · entrega ${o.delivery_date}` : ""} · pagado ${soles(o.paid_amount)}`, falta: n(o.pendiente) })),
  ];
  const usado = r2(Object.values(valores).reduce((s, v) => s + (Number(v) || 0), 0));

  function repartir() {
    let queda = disponible;
    const nuevo: Record<string, string> = {};
    for (const f of filas) {
      if (queda <= 0.004) break;
      const a = r2(Math.min(f.falta, queda));
      nuevo[f.clave] = a.toFixed(2);
      queda = r2(queda - a);
    }
    onChange(nuevo);
  }

  if (!filas.length) return <Vacio>El cliente no tiene pedidos ni comprobantes por pagar.</Vacio>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="text-muted">Aplicado {soles(usado)} de {soles(disponible)} · {usado > disponible + 0.004 ? <span className="text-bad">pasa el monto</span> : `quedan ${soles(Math.max(0, r2(disponible - usado)))}`}</span>
        <button type="button" onClick={repartir} className="cursor-pointer text-primary hover:underline" disabled={disponible <= 0}>Repartir en orden</button>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {filas.map((f) => (
          <li key={f.clave} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1 basis-40">
              <div className="text-[13.5px] font-medium">{f.titulo}</div>
              <div className="truncate text-[12px] text-muted">{f.detalle} · falta {soles(f.falta)}</div>
            </div>
            <Input type="number" inputMode="decimal" min={0} step="0.01" max={f.falta} value={valores[f.clave] ?? ""} placeholder="0.00" aria-label={`Monto para ${f.titulo}`}
              onChange={(e) => onChange({ ...valores, [f.clave]: e.target.value })} className="!w-28 text-right tabular-nums" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function aplicacionesDe(valores: Record<string, string>): Aplicacion[] {
  return Object.entries(valores).filter(([, v]) => Number(v) > 0).map(([k, v]) => (k.startsWith("d:") ? { document_id: k.slice(2), amount: r2(Number(v)) } : { order_id: k.slice(2), amount: r2(Number(v)) }));
}
