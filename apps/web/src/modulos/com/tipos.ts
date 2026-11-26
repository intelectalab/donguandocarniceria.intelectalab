import type { Tone } from "@/components/ui";

// Etiquetas de COM, GRJ y CNT. Los valores son los de la base (migraciones 2026_11_24_3001xx).
export type Num = number | string | null;
export type Etiquetas = Record<string, [string, Tone]>;
export const opciones = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

export const TIPO_PROVEEDOR: Record<string, string> = {
  PRODUCER: "Productor", SLAUGHTERHOUSE: "Camal", RELATED_FARM: "Granja relacionada", PACKAGING: "Envases y empaques", INPUTS: "Insumos",
  SERVICES: "Servicios", ADVERTISING: "Publicidad", CONTENT_CREATOR: "Creador de contenido", DELIVERY_COMPANY: "Empresa de reparto", VEHICLE_RENTAL: "Alquiler de vehículos", OTHER: "Otro",
};
export const SUNAT: Etiquetas = {
  ACTIVE: ["Activo y habido", "ok"], SUSPENDED: ["Suspendido", "bad"], LOW: ["De baja", "bad"], NOT_LOCATED: ["No habido", "bad"], UNKNOWN: ["Sin consultar", "neutral"],
};
export const ORDEN: Etiquetas = {
  DRAFT: ["Borrador", "neutral"], PENDING_APPROVAL: ["Por aprobar", "warn"], APPROVED: ["Aprobada", "primary"], PARTIALLY_RECEIVED: ["Recibida en parte", "warn"],
  RECEIVED: ["Recibida", "ok"], CLOSED: ["Cerrada", "neutral"], CANCELLED: ["Anulada", "bad"], RETURNED: ["Devuelta", "warn"],
};
export const REQUERIMIENTO: Etiquetas = { PENDING: ["Pendiente", "warn"], ORDERED: ["Con orden", "ok"], CANCELLED: ["Cancelado", "neutral"] };
export const ORIGEN_REQ: Record<string, string> = { MANUAL: "Manual", WAREHOUSE: "Stock mínimo del almacén", "PRO-03": "Plan de producción" };
export const RECEPCION: Record<string, string> = { PURCHASE: "Compra", FARM_NTI: "Envío de la granja", FARM_INVOICE: "Factura de la granja" };
export const INSPECCION: Etiquetas = { OK: ["Conforme", "ok"], PENDING: ["Por inspeccionar", "warn"], OBSERVED: ["Observada", "bad"] };
export const CRUCE: Etiquetas = {
  MATCHED: ["Cuadra", "ok"], OBSERVED: ["Observado", "bad"], APPROVED_DIFF: ["Diferencia aprobada", "warn"], NOT_CHECKED: ["Sin cruce", "neutral"],
};
export const COMPROBANTE: Etiquetas = { REGISTERED: ["Registrado", "primary"], PAID: ["Pagado", "ok"], PARTIALLY_PAID: ["Pagado en parte", "warn"], VOIDED: ["Anulado", "bad"] };
export const PAGO: Etiquetas = { CONFIRMED: ["Confirmado", "ok"], REVERSED: ["Revertido", "bad"] };
export const METODO: Record<string, string> = {
  TRANSFER: "Transferencia", CASH: "Efectivo", CHECK: "Cheque", YAPE: "Yape", PLIN: "Plin", INTERNAL_SETTLEMENT: "Liquidación interna", OTHER: "Otro",
};
export const TRAMO: Record<string, string> = { NOT_DUE: "Por vencer", D0_30: "Vencido 0–30 días", D31_60: "Vencido 31–60 días", D60: "Vencido más de 60 días" };
export const DECISION: Record<string, string> = { ACCEPT: "Aceptar", REJECT: "Rechazar", QUALITY_HOLD: "Retener para Calidad" };

export type Opciones = {
  suppliers: { id: string; doc_type: string; doc_number: string; legal_name: string; trade_name: string | null; supplier_type: string; status: string; sunat_status: string;
    payment_terms_days: number; bank_account: string | null; default_cost_center_id: string | null; name: string; can_order: boolean; no_igv: boolean }[];
  warehouses: { id: string; code: string; name: string; wh_type: string; establishment_id: string; max_temp_c: Num }[];
  establishments: { id: string; name: string; short: string; company_id: string }[];
  brands: { id: string; name: string }[];
  cost_centers: { id: string; code: string; name: string; area: string }[];
  cash_accounts: { id: string; code: string; name: string; account_type: string; bank_name: string | null; currency: string }[];
  scales: { id: string; code: string; name: string; establishment_id: string }[];
  companies: { id: string; legal_name: string; ruc: string }[];
  lines: string[]; supplier_types: string[]; methods: string[];
  doc_types: { code: string; name: string; sunat: string }[];
  params: Record<string, number>;
  can: { order_create: boolean; order_approve: boolean; receipt_record: boolean; document_record: boolean; payment_record: boolean; bank_change: boolean; approve_diff: boolean };
};

export type Variante = { id: string; sku: string; name: string; sale_mode: string; std_cost: Num; storage: string | null; line: string | null; price_basis: string | null };
