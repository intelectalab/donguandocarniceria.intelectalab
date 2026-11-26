import type { Etiquetas, Num } from "@/modulos/canales/comunes";

// B2B · etiquetas con los valores de la base (CHECK de 2026_11_24_000100_b2b_clientes_empresariales).
export const ESTADO_CREDITO: Etiquetas = { ACTIVE: ["Al día", "ok"], BLOCKED: ["Bloqueado", "bad"], SUSPENDED: ["Suspendido", "warn"], NONE: ["Sin crédito", "neutral"] };
export const ESTADO_EXCEPCION: Etiquetas = { PENDING: ["Por aprobar", "warn"], APPROVED: ["Aprobada", "ok"], REJECTED: ["Rechazada", "bad"], USED: ["Usada", "neutral"], EXPIRED: ["Vencida", "neutral"] };
export const TIPO_EXCEPCION: Record<string, string> = { OVER_LIMIT: "Supera el límite", OVERDUE: "Deuda vencida" };
export const ESTADO_PRECIO: Etiquetas = { PENDING_APPROVAL: ["Por aprobar", "warn"], ACTIVE: ["Vigente", "ok"], REJECTED: ["Rechazado", "bad"] };
export const ESTADO_RECURRENTE: Etiquetas = { ACTIVE: ["Activo", "ok"], PAUSED: ["Pausado", "warn"], ENDED: ["Terminado", "neutral"] };
export const ESTADO_CORRIDA: Etiquetas = { CREATED: ["Pedido creado", "info"], CONFIRMED: ["Confirmado", "ok"], SKIPPED: ["Saltado", "neutral"], BLOCKED_CREDIT: ["Retenido por crédito", "bad"], FAILED: ["Falló", "bad"] };
export const ESTADO_CUENTA: Etiquetas = { INVITED: ["Invitado", "info"], ACTIVE: ["Activo", "ok"], DISABLED: ["Desactivado", "neutral"] };
export const ROL_PORTAL: Record<string, string> = { OWNER: "Dueño", BUYER: "Comprador", ACCOUNTING: "Contabilidad" };
export const ESTADO_RECLAMO: Etiquetas = { OPEN: ["Abierto", "warn"], IN_REVIEW: ["En revisión", "info"], RESOLVED: ["Resuelto", "ok"], REJECTED: ["Rechazado", "neutral"] };
export const TIPO_RECLAMO: Record<string, string> = { QUALITY: "Calidad", WEIGHT: "Peso", LATE: "Atraso", BILLING: "Facturación", OTHER: "Otro" };
export const RESOLUCION: Record<string, string> = { CREDIT_NOTE: "Nota de crédito", REPLACEMENT: "Reposición", NO_ACTION: "Sin acción" };
export const ESTADO_RECORDATORIO: Etiquetas = { SCHEDULED: ["Programado", "info"], SENT: ["Enviado", "ok"], CANCELLED: ["Cancelado", "neutral"], FAILED: ["Falló", "bad"] };
export const ESTADO_PROMESA: Etiquetas = { OPEN: ["Abierta", "info"], KEPT: ["Cumplida", "ok"], BROKEN: ["Incumplida", "bad"], CANCELLED: ["Cancelada", "neutral"] };
export const TIPO_CLIENTE: Record<string, string> = { RESTAURANT: "Restaurante", BUSINESS: "Empresa", CONSIGNMENT_POINT: "Punto de consignación", PERSON: "Persona", OTHER: "Otro" };
export const ESTADO_PEDIDO: Etiquetas = { DRAFT: ["Por confirmar", "warn"], CONFIRMED: ["Confirmado", "info"], IN_PREPARATION: ["En preparación", "info"], READY: ["Listo", "info"],
  WEIGHED: ["Pesado", "info"], IN_ROUTE: ["En camino", "info"], DELIVERED: ["Entregado", "ok"], CLOSED: ["Cerrado", "ok"], CANCELLED: ["Anulado", "neutral"], NOT_DELIVERED: ["No entregado", "bad"] };

export type Opciones = {
  customers: { id: string; full_name: string; doc_type: string; doc_number: string; customer_type: string; has_credit: boolean }[];
  sellers: { id: string; name: string }[]; brands: { id: string; name: string }[]; zones: { id: string; name: string }[];
  variants: { id: string; name: string; sku: string; sale_mode: string; brand_id: string; nominal_weight_kg: Num }[];
  params: { grace_days: number; min_margin_pct: number; exception_hours: number; cutoff: string; min_order: number; run_time: string; lead_days: number; reminder_days_before: number; claim_hours: number };
  can: Record<string, boolean>; today: string; me: string;
};

export type Resumen = { credit_limit: number; term_days: number; grace_days: number; balance: number; unbilled: number; exposure: number; overdue: number; overdue_days: number;
  available: number; status: string; blocked_reason: string | null };

export type Movimiento = { date: string; kind: "DOC" | "NC" | "PAY"; ref: string; document_id?: string; due_date: string | null; charge: number; credit: number; open: number;
  sunat_status?: string | null; days_overdue: number; balance: number };

export type Reclamo = { id: string; number: string; customer_id: string; customer_name: string; claim_type: string; type_label: string; description: string; photo_urls: string[];
  status: string; opened_at: string; due_at: string; late: boolean; order_number: string | null; document_number: string | null; response: string | null; first_response_at: string | null;
  resolution: string | null; resolution_note: string | null; credit_note_number: string | null; credit_amount: Num; resolved_at: string | null; assigned_name: string | null };

export type Acceso = { id: string; customer_id: string; customer_name: string; user_id: string; portal_role: string; can_order: boolean; can_view_statement: boolean;
  status: string; name: string; email: string; last_login: string | null; invited_at: string };
