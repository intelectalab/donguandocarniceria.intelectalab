// Tipos y catálogos de PED (Pedidos de todos los canales). Los valores salen de la API (app/Modulos/Ped).
import type { Tone } from "@/components/ui";

export type Opcion = { value: string; label: string };

export const ESTADOS: Record<string, [string, Tone]> = {
  DRAFT: ["Borrador", "neutral"], CONFIRMED: ["Confirmado", "info"], IN_PREPARATION: ["En preparación", "warn"], WEIGHED: ["Pesado", "warn"],
  READY: ["Listo", "primary"], IN_ROUTE: ["En ruta", "info"], DELIVERED: ["Entregado", "ok"], NOT_DELIVERED: ["No entregado", "bad"],
  CLOSED: ["Cerrado", "neutral"], CANCELLED: ["Cancelado", "bad"],
};
export const ORDEN_ESTADOS = ["DRAFT", "CONFIRMED", "IN_PREPARATION", "WEIGHED", "READY", "IN_ROUTE", "DELIVERED", "NOT_DELIVERED", "CLOSED", "CANCELLED"];

/** Texto del botón para pasar a cada estado (los que se hacen con «Siguiente estado»). */
export const ACCION_ESTADO: Record<string, string> = {
  IN_PREPARATION: "Pasar a preparación", WEIGHED: "Marcar pesado", READY: "Marcar listo", IN_ROUTE: "Salió a ruta", DELIVERED: "Marcar entregado",
};

export const CANALES: Opcion[] = [
  { value: "WHATSAPP", label: "WhatsApp" }, { value: "PHONE", label: "Teléfono" }, { value: "WEB", label: "Web" }, { value: "TIKTOK", label: "TikTok" },
  { value: "FACEBOOK", label: "Facebook" }, { value: "INSTAGRAM", label: "Instagram" }, { value: "COUNTER", label: "Mostrador" },
  { value: "B2B", label: "B2B" }, { value: "CONSIGNMENT", label: "Consignación" },
];
export const ENTREGAS: Opcion[] = [
  { value: "DELIVERY", label: "Delivery" }, { value: "PICKUP", label: "Recojo en local" }, { value: "COUNTER", label: "Mostrador" },
  { value: "PROVINCE_SHIPPING", label: "Envío a provincia" },
];
export const COMPROBANTES: Opcion[] = [{ value: "RECEIPT", label: "Boleta" }, { value: "INVOICE", label: "Factura" }];
export const MODOS_VENTA: Record<string, string> = { UNIT: "Por unidad", KG: "Por kg", UNIT_VARIABLE_WEIGHT: "Unidad de peso variable" };
export const PESO: Record<string, [string, Tone]> = {
  NONE: ["Sin pesar", "neutral"], WITHIN_TOLERANCE: ["Dentro de tolerancia", "ok"], NOTICE_REQUIRED: ["Aviso requerido", "bad"], NOTICE_SENT: ["Aviso enviado", "info"],
};
export const DESCUENTO: Record<string, [string, Tone]> = {
  NONE: ["Sin descuento", "neutral"], APPLIED: ["Aplicado", "ok"], PENDING_APPROVAL: ["Pendiente de aprobación", "warn"], APPROVED: ["Aprobado", "ok"], REJECTED: ["Rechazado", "bad"],
};
export const SALDOS: Record<string, string> = {
  CUSTOMER_CREDIT: "Saldo a favor", REFUND: "Devolución", COLLECT_ON_DELIVERY: "Cobro contra entrega", PAYMENT_LINK: "Enlace de pago", WAIVE: "Condonado",
};
export const RESPUESTAS: Record<string, [string, Tone]> = { NO_RESPONSE: ["Sin respuesta", "neutral"], ACCEPTED: ["Aceptó", "ok"], REJECTED: ["Rechazó", "bad"] };
export const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export const etiqueta = (lista: Opcion[], v: string | null | undefined) => lista.find((o) => o.value === v)?.label ?? v ?? "—";
export const nombreEstado = (s: string) => ESTADOS[s]?.[0] ?? s;

/** +51987654321 → 987 654 321. */
export function celular(p: string | null | undefined): string {
  if (!p) return "—";
  const m = /^\+51(\d{3})(\d{3})(\d{3})$/.exec(p);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : p;
}
export const hora = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
export const franjaTexto = (desde: string | null | undefined, hasta: string | null | undefined) => (desde ? `${hora(desde)}–${hora(hasta)}` : "—");
export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
export const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00-05:00`);
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);
};

export type Id = { id: string };
export type Nombre = { id: string; name: string };

export type Opciones = {
  marcas: { id: string; code: string; name: string }[];
  locales: { id: string; code: string; name: string; short: string | null; has_counter: boolean }[];
  zonas: { id: string; code: string; name: string; establishment_id: string; province: boolean }[];
  vendedoras: Nombre[];
  formas_pago: { id: string; code: string; name: string; kind: string }[];
  agencias: Nombre[];
  franjas: { id: string; name: string; establishment_id: string; zone_id: string | null; slot_from: string; slot_to: string }[];
};

export type PedidoFila = {
  id: string; number: string; status: string; channel: string; fulfillment: string; delivery_date: string | null; slot_from: string | null; slot_to: string | null;
  estimated_total: number; final_total: number | null; paid_amount: number; weight_diff_status: string; discount_status: string; needs_stock: boolean;
  reschedule_count: number; created_at: string; confirmed_at: string | null; customer_confirmed_at: string | null; imported: boolean | null;
  cliente: string | null; celular: string | null; marca: string | null; marca_code: string | null; zona: string | null; vendedora: string | null;
  faltan_datos: boolean; franja_llena: boolean;
};

export type Pedido = {
  id: string; number: string; status: string; brand_id: string; establishment_id: string; channel: string; customer_id: string; address_id: string | null;
  seller_id: string | null; fulfillment: string; delivery_date: string | null; slot_id: string | null; slot_from: string | null; slot_to: string | null;
  requested_doc_type: string; billing_customer_id: string; payment_method_id: string | null; estimated_total: string; final_total: string | null;
  delivery_fee: string; paid_amount: string; discount_total: string; discount_status: string; weight_diff_status: string; contact_phone: string | null;
  zone_id: string | null; pickup_establishment_id: string | null; notes: string | null; prep_notes_ok: boolean | null; origin_wa_number: string | null;
  origin_ad_code: string | null; external_ref: string | null; origin_locked: boolean | null; confirmed_at: string | null; customer_confirmed_at: string | null;
  confirmation_channel: string | null; reschedule_count: number; units: number; est_kg: string; delivered_at: string | null; closed_at: string | null;
  cancel_reason: string | null; cancel_note: string | null; cancelled_at: string | null; balance_mode: string | null; balance_amount: string | null;
  balance_decided_at: string | null; balance_decided_by_name: string | null; balance_note: string | null; order_discount: string | null;
  order_discount_pct: string | null; discount_reason: string | null; not_delivered_reason_code: string | null; province_agency: string | null;
  province_destination: string | null; thermal_packaging: boolean | null; tracking_number: string | null; dispatch_guide_number: string | null;
  needs_stock: boolean; created_at: string;
};

export type Linea = {
  id: string; line_no: number; variant_id: string; qty: string; unit_price: string; price_basis: string; est_weight_kg: string | null; tolerance_pct: string | null;
  weighed_kg: string | null; final_amount: string | null; est_amount: string; cut_notes: string | null; sku: string; name: string; sale_mode: string;
  nominal_weight_kg: string | null; corte: string | null; lista: string | null;
};

export type Falta = { codigo: string; texto: string };
export type LineaPeso = {
  line_id: string; name: string; sku: string; qty: number; estimado_kg: number; real_kg: number | null; diferencia_pct: number | null;
  tolerancia_pct: number; excede: boolean; importe_estimado: number; importe_final: number | null;
};

export type Detalle = {
  pedido: Pedido;
  marca: { id: string; code: string; name: string } | null;
  local: string | null;
  cliente: { id: string; full_name: string; trade_name: string | null; phone: string | null; doc_type: string; doc_number: string | null; customer_type: string; status: string; blocked_reason: string | null; email: string | null } | null;
  direccion: { id: string; label: string | null; address_line: string; district: string; reference: string | null; lat: number; lng: number; contact_name: string | null; contact_phone: string | null } | null;
  zona: { id: string; code: string; name: string } | null;
  recojo: string | null;
  franja: { id: string; name: string; slot_from: string; slot_to: string; cutoff: string; capacity: number } | null;
  forma_pago: { id: string; code: string; name: string } | null;
  vendedora: string | null;
  agencia: string | null;
  lineas: Linea[];
  subtotal: number;
  pagos: { id: string; number: string; paid_at: string; reference: string | null; status: string; amount: string; forma: string | null }[];
  comprobantes: { id: string; doc_type: string; full_number: string; issue_date: string; total: string; status: string; sunat_status: string | null }[];
  guias: { id: string; full_number: string; status: string; issued_at: string | null }[];
  historial: { id: string; from_status: string; to_status: string; reason: string | null; changed_at: string; changed_by_name: string }[];
  reprogramaciones: { id: string; old_date: string | null; old_slot_from: string | null; new_date: string; new_slot_from: string; reason: string; rescheduled_by_name: string; at: string }[];
  avisos: { id: string; channel: string; message: string; sent_at: string; customer_response: string; responded_at: string | null; estimated_total: string; final_total: string; diff_pct: string }[];
  descuentos: { id: string; requested_by_name: string; requested_pct: string; requested_amount: string; reason: string; status: string; requested_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null }[];
  reservas: { order_line_id: string; qty: string; lote: string | null }[];
  faltan: Falta[];
  siguientes: string[];
  saldo: { total: number; pagado: number; diferencia: number; tipo: "A_FAVOR" | "POR_COBRAR" | "CUADRA" };
  peso: { completo: boolean; estado: string; lineas: LineaPeso[] } | null;
  max_reprogramaciones: number;
};

export type FranjaDisponible = {
  id: string; name: string; slot_from: string; slot_to: string; cutoff: string; capacity: number; ocupados: number; zone_id: string | null; llena: boolean; paso_corte: boolean;
};

export type Motivo = { code: string; name: string; applies_to: string; requires_note: boolean; counts_as_loss: boolean };

export type Producto = {
  id: string; sku: string; name: string; barcode: string | null; sale_mode: string; nominal_weight_kg: string | null; weight_tolerance_pct: string | null;
  corte: string | null; precio: number | null; base: string | null; lista: string | null; disponible: number;
};
