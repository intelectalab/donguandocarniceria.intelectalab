import type { Tone } from "@/components/ui";

/** Tipos y etiquetas de FAC (FAC-01 a FAC-12), con la forma que devuelve /v1/fac. */

export type Num = number | string;
export const n = (v: Num | null | undefined) => Number(v ?? 0);

export const TIPOS: Record<string, string> = { INVOICE: "Factura", RECEIPT: "Boleta", CREDIT_NOTE: "Nota de crédito", DEBIT_NOTE: "Nota de débito" };
export const TIPOS_CORTO: Record<string, string> = { INVOICE: "Factura", RECEIPT: "Boleta", CREDIT_NOTE: "N. crédito", DEBIT_NOTE: "N. débito" };
export const TONO_TIPO: Record<string, Tone> = { INVOICE: "info", RECEIPT: "neutral", CREDIT_NOTE: "warn", DEBIT_NOTE: "warn" };

export const SUNAT: Record<string, [string, Tone]> = {
  PENDING: ["Pendiente", "warn"], ACCEPTED: ["Aceptado", "ok"], OBSERVED: ["Observado", "info"], REJECTED: ["Rechazado", "bad"], VOIDED: ["De baja", "neutral"],
  SENT: ["Enviado", "info"], ISSUED: ["Emitido", "ok"],
};

export const ORIGEN: Record<string, string> = { POS: "Mostrador", ORDER: "Pedido", DIRECT: "Directa", NOTE: "Nota" };

export const DOC_ID: Record<string, string> = { RUC: "RUC", DNI: "DNI", CE: "C. E.", PAS: "Pasaporte", NONE: "Sin documento" };

export const ESTADO_PEDIDO: Record<string, [string, Tone]> = {
  READY: ["Listo", "info"], IN_ROUTE: ["En ruta", "info"], DELIVERED: ["Entregado", "ok"], CLOSED: ["Cerrado", "neutral"],
};

export type FilaComprobante = {
  id: string; doc_type: string; series: string; number: number; full_number: string; issue_date: string; issued_at: string | null;
  customer_name: string; customer_doc_type: string; customer_doc_number: string | null; brand_id: string; brand_name: string; site: string | null;
  subtotal: Num; igv: Num; total: Num; payment_terms: string; due_date: string | null; sunat_status: string; status: string;
  send_attempts: Num; next_retry_at: string | null; needs_review: boolean | null; sunat_code: string | null; sunat_message: string | null;
  order_id: string | null; related_document_id: string | null; pos_ticket: string | null; source: string | null; summary_pending: boolean;
  reissued_by: string | null; note_reason_code: string | null;
};

export type Documento = FilaComprobante & {
  company_id: string; establishment_id: string; customer_id: string; buyer_address: string | null; xml_hash: string; cdr_hash: string | null;
  note_reason: string | null; void_reason: string | null; voided_at: string | null; voided_by: string | null; accepted_at: string | null;
  last_attempt_at: string | null; credit_days: number | null; issued_by_name: string | null; reissue_of: string | null; balance: Num; brand_logo: string | null;
};

export type Linea = {
  id: string; line_no: number; variant_id: string | null; description: string; qty: Num; uom_code: string; unit_price: Num; igv_affectation: string;
  subtotal: Num; igv: Num; total: Num; sku: string | null; lot: string | null;
};

export type Envio = { attempt_no: Num; requested_at: string; provider?: string; result: string; response_code: string; message: string; duration_ms?: number; manual?: boolean; requested_by_name?: string | null };

export type Marca = { id: string; code: string; name: string; color: string | null; logo: boolean; mostrar_logo: boolean; pie: string | null; leyendas: string | null; status?: string };

export type Empresa = { ruc: string; razon_social: string; nombre_comercial?: string | null; direccion: string | null };

export type Ficha = {
  documento: Documento; tipo: string; lineas: Linea[];
  cobros: { id: string; number: string; paid_at: string; status: string; medio: string | null; amount: Num; reference: string | null }[];
  envios: Envio[];
  notas: { id: string; doc_type: string; full_number: string; total: Num; note_reason_code: string; note_reason: string | null; issue_date: string; sunat_status: string; status: string }[];
  relacionado: { id: string; doc_type: string; full_number: string; total: Num; sunat_status: string; status: string } | null;
  reemitido_por: { id: string; full_number: string } | null; reemite_a: { id: string; full_number: string } | null;
  pedido: { id: string; number: string; status: string; channel: string; delivery_date: string | null } | null;
  resumenes: { id: string; identifier: string; summary_type: string; status: string; ticket: string | null; action: string }[];
  guias: { id: string; full_number: string; transfer_reason_code: string; sunat_status: string; status: string }[];
  acreditado: Num; disponible_nc: Num; acreditado_por_linea: Record<string, number>; motivo: string | null; almacen_reingreso: string | null; seller: string | null;
  empresa: Empresa | null; local: { name: string; address: string | null; short: string | null } | null; marca: Marca | null; codigo_sunat: string | null; doc_id: string;
};

/** GET /v1/fac/comprobantes/{id}/notas: la ficha con los catálogos y las series de notas (FAC-05 y FAC-06). */
export type Motivos = Ficha & {
  cat09: Record<string, string>; cat10: Record<string, string>; devolucion: string[]; peso: string; serie_nc: string | null; serie_nd: string | null;
  almacenes: { id: string; code: string; name: string; wh_type: string }[];
};

export const CANTIDAD = (q: Num, uom: string) => (uom === "KGM" ? `${Number(q).toLocaleString("es-PE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg` : uom === "ZZ" ? `${Number(q).toLocaleString("es-PE")} serv.` : `${Number(q).toLocaleString("es-PE")} u`);

export const MOTIVOS_GUIA: Record<string, string> = {
  "01": "Venta", "02": "Compra", "04": "Traslado entre establecimientos de la misma empresa", "05": "Consignación", "06": "Devolución",
  "08": "Importación", "09": "Exportación", "13": "Otros", "14": "Venta sujeta a confirmación del comprador", "17": "Traslado para transformación",
};

/** Hoy en Lima, AAAA-MM-DD. */
export function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}
