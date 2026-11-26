import type { Etiquetas, Num } from "@/modulos/canales/comunes";

// CMP · etiquetas con los valores de la base (CHECK de 2026_11_24_000200_cmp_campanas).
export const ESTADO_CAMPANA: Etiquetas = { DRAFT: ["Borrador", "neutral"], PENDING_APPROVAL: ["Por aprobar", "warn"], APPROVED: ["Aprobada", "info"], SENT: ["Enviada", "ok"], CANCELLED: ["Cancelada", "neutral"] };
export const ESTADO_DESTINATARIO: Etiquetas = { QUEUED: ["En cola", "neutral"], CONTROL: ["Grupo de control", "info"], SKIPPED_CONSENT: ["Sin consentimiento", "neutral"], SKIPPED_FREQUENCY: ["Tope semanal", "neutral"],
  SENT: ["Enviado", "info"], DELIVERED: ["Entregado", "info"], READ: ["Leído", "ok"], REPLIED: ["Respondió", "ok"], FAILED: ["Falló", "bad"] };
export const ESTADO_SEGMENTO: Etiquetas = { ACTIVE: ["Activo", "ok"], ARCHIVED: ["Archivado", "neutral"] };
export const ESTADO_CUPON: Etiquetas = { ACTIVE: ["Activo", "ok"], PAUSED: ["Pausado", "warn"], EXPIRED: ["Vencido", "neutral"] };
export const MOVIMIENTO: Etiquetas = { EARN: ["Ganó", "ok"], REDEEM: ["Canjeó", "info"], EXPIRE: ["Venció", "neutral"], REVERSAL: ["Reverso", "bad"], ADJUST: ["Ajuste", "warn"], REFERRAL_BONUS: ["Bono por referido", "ok"] };
export const ESTADO_REFERIDO: Etiquetas = { PENDING: ["Pendiente", "warn"], QUALIFIED: ["En curso", "info"], REWARDED: ["Premiado", "ok"], REJECTED: ["Rechazado", "neutral"] };
export const FUENTE_CONSENTIMIENTO: Record<string, string> = { FIRST_ORDER: "Primer pedido", KEYWORD: "Palabra de baja", MANUAL: "Registro manual", WEB: "Tienda web", PORTAL: "Portal", IMPORT: "Importación" };
export const CANAL_PEDIDO: Record<string, string> = { WHATSAPP: "WhatsApp", FACEBOOK: "Facebook", INSTAGRAM: "Instagram", TIKTOK: "TikTok", WEB: "Tienda web", COUNTER: "Mostrador", PHONE: "Teléfono", B2B: "Empresas" };

export type Opciones = {
  brands: { id: string; name: string }[]; zones: { id: string; name: string }[]; products: { id: string; name: string; brand_id: string; line: string }[]; lines: string[];
  channels: { id: string; brand_id: string; display_name: string; number: string; status: string }[];
  templates: { id: string; brand_id: string; channel_id: string; name: string; body: string; provider_status: string; category: string }[];
  segments: { id: string; code: string; name: string; brand_id: string | null; member_count: number; consent_count: number }[];
  coupons: { id: string; code: string; brand_id: string | null; discount_type: string; value: string; valid_from: string; valid_to: string; campaign_id: string | null }[];
  objectives: Record<string, string>; rfm: Record<string, string>; discount_types: Record<string, string>; order_channels: string[];
  params: { rate: number; fee: number; threshold: number; control_pct: number; window_days: number; max_per_week: number; inactive_days: number; refresh_hours: number; optout_keywords: string[] };
  can: Record<string, boolean>; today: string; me: string;
};

export type Reglas = {
  brands?: string[]; last_purchase_days?: { min?: number | null; max?: number | null }; inactive?: boolean; never_bought?: boolean; rebuy_product?: string; rebuy_due?: boolean;
  products?: string[]; lines?: string[]; zones?: string[]; channels?: string[]; min_avg_ticket?: number | null; min_orders?: number | null; rfm?: string[]; b2b?: "ONLY" | "EXCLUDE" | ""; customer_types?: string[];
};

export type Segmento = { id: string; code: string; name: string; brand_id: string | null; brand_name?: string | null; segment_type: string; rules: Reglas; refresh_hours: number;
  member_count: number; consent_count: number; status: string; last_refreshed_at: string | null; description: string; campaigns?: number; created_name?: string | null };

export type Resultados = { sent: number; delivered: number; read: number; replied: number; optouts: number; orders: number; paid_orders: number; by_coupon: number; collected: number;
  discounts: number; message_cost: number; total_cost: number; roi: number | null; buy_rate: number | null; control_rate: number | null; lift: number | null; control: number;
  window_end: string | null; redemptions: number; cost_per_order: number | null; optout_rate: number | null };

export type Campana = { id: string; code: string; name: string; brand_id: string; brand_name: string; segment_id: string; segment_code: string; segment_name: string; channel_id: string;
  template_id: string; objective: string; coupon_id: string | null; coupon_code: string | null; scheduled_at: string | null; attribution_window_days: number; control_group_pct: Num;
  status: string; created_by_user: string; approved_by: string | null; approved_at: string | null; sent_at: string | null; cancel_reason: string | null; target_count: number | null;
  control_count: number | null; excluded_consent_count: number | null; excluded_frequency_count: number | null; effective_count: number | null; unit_cost: Num; estimated_cost: Num;
  estimated_discount: Num; estimated_at: string | null; actual_cost: Num; history: { at: string; to: string; user: string; reason?: string }[]; results?: Resultados;
  orders?: number; collected?: number; roi?: number | null; total_cost?: number };

/** Retorno: cuánto se ganó, neto, por cada sol gastado en la campaña. */
export const roiTexto = (roi: number | null | undefined) => (roi == null ? "—" : `S/ ${roi.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por sol`);
