import type { Tone } from "@/components/ui";

/** Tipos y etiquetas del mostrador (POS-01 a POS-12), con la forma que devuelve /v1/pos. */

export type Num = number | string;

export type Medio = { id: string; code: string; name: string; kind: "CASH" | "CARD" | "WALLET" | "INTERNAL" | string; requires_reference: boolean };

export type Caja = {
  id: string; code: string; name: string; establishment_id: string; warehouse_id: string;
  cash_account_id: string | null; card_account_id: string | null; receipt_series_id: string | null; invoice_series_id: string | null;
  default_price_list_id: string | null; scale_mode: "MANUAL" | "SCALE" | "LABEL"; status: "ACTIVE" | "INACTIVE";
  local: string; almacen: string; almacen_code: string; caja_efectivo: string | null; cuenta_tarjeta: string | null;
  serie_boleta: string | null; serie_factura: string | null; lista_precios: string | null;
  turno_abierto: string | null; turno_cajera: string | null;
};

export type PorMedio = { code: string; name: string; kind: string; cobros: number; n: number; esperado: number };

export type Esperado = {
  fondo: number; cobros_efectivo: number; ingresos: number; retiros: number; depositos: number; gastos: number; devoluciones: number;
  efectivo: number; por_medio: PorMedio[]; saldo_a_favor: number;
};

export type Turno = {
  id: string; number: string; terminal_id: string; establishment_id: string; cashier_user_id: string; cashier_name: string;
  opened_at: string; opening_float: Num; opening_counts: Record<string, number>; status: "OPEN" | "CLOSED" | "APPROVED";
  closed_at: string | null; expected_cash: Num | null; counted_cash: Num | null; difference: Num | null; total_difference: Num | null;
  difference_reason: string | null; closing_denoms: Record<string, number> | null; closed_by_name: string | null;
  approved_by_name: string | null; approved_at: string | null; approval_note: string | null; over_limit: boolean;
  caja: { id: string; code: string; name: string; warehouse_id: string; scale_mode: string; establishment_id: string };
  esperado: Esperado; tickets: number; ventas: number;
  conteos: { code: string; name: string; expected_amount: Num; counted_amount: Num; difference: Num }[];
};

export type Movimiento = {
  id: string; moved_at: string; user_name: string; movement_type: string; amount: Num; reason: string;
  authorized_by_name: string | null; document_id: string | null;
};

export type TurnoDetalle = Turno & {
  movimientos: Movimiento[];
  historial: { id: string; number: string; status: string; closed_at: string | null; difference: Num | null; total_difference: Num | null; difference_reason: string | null }[];
  diferencias_cajera: { turnos: number; suma_abs: number };
};

export type Contexto = {
  turno: Turno | null;
  cajas: Caja[];
  abiertos: { id: string; number: string; cashier_name: string; cashier_user_id: string; opened_at: string; caja: string; caja_code: string }[];
  medios: Medio[];
  denominaciones: string[];
  movimientos: Record<string, string>;
  marcas_tarjeta: Record<string, string>;
  lineas: Record<string, string>;
  parametros: { peso_maximo: number; retiro_con_autorizacion: number; diferencia_con_aviso: number; comprobante_por_defecto: "RECEIPT" | "INVOICE"; boleta_con_documento: number };
  puede: { vender: boolean; abrir: boolean; aprobar: boolean; autorizar_retiro: boolean; devolver: boolean; cajas: boolean; peso_fuera_de_rango: boolean };
  cliente_varios: string;
  alertas: { tono: "info" | "warn" | "bad"; texto: string; pantalla: string }[];
};

export type Producto = {
  id: string; sku: string; name: string; barcode: string | null; sale_mode: "UNIT" | "KG" | "UNIT_VARIABLE_WEIGHT" | string;
  nominal_weight_kg: Num | null; min_weight_kg: Num | null; max_weight_kg: Num | null; plu: string | null;
  linea: string; brand_id: string; marca: string; marca_code: string; precio: number | null; base: "KG" | "UNIT" | string; lista: string | null;
  stock: number; reservado: number; disponible: number;
};

/** Línea del carrito tal como se manda a /cotizar y /ventas. */
export type LineaCarrito = {
  key: string; variant_id: string; name: string; sale_mode: string; qty?: number; weight_kg?: string;
  weight_source?: "MANUAL" | "SCALE" | "LABEL"; barcode?: string; override?: boolean;
};

export type LineaCotizada = {
  i: number; variant_id: string; sku: string; name: string; brand_id: string; marca: string; sale_mode: string;
  qty: number; weight_kg: number | null; weight_source: string | null; barcode: string | null; override: boolean;
  price: number; basis: string; stock_qty: number; amount: number; uom: string; doc_qty: number;
};

export type Cotizacion = {
  lineas: LineaCotizada[];
  marcas: { brand_id: string; marca: string; total: number; lineas: number; subtotal: number; igv: number }[];
  total: number; subtotal: number; igv: number;
};

export type Cliente = {
  id: string; full_name: string; trade_name: string | null; doc_type: string | null; doc_number: string | null;
  phone: string | null; email: string | null; status: string; customer_type: string; saldo: number;
};

/** Pago que se manda a la API. */
export type Pago = { method: string; amount: number; reference?: string; card_brand?: string; card_last4?: string };

export type VentaHecha = {
  ticket: string; total: number; vuelto: number; efectivo: number;
  comprobantes: { id: string; full_number: string; doc_type: string; brand_name: string; total: Num; sunat_status: string }[];
  pedidos: string[]; cobros: { number: string; amount: Num }[];
};

export type Documento = {
  id: string; doc_type: "RECEIPT" | "INVOICE" | "CREDIT_NOTE" | string; series: string; full_number: string; issue_date: string; issued_at: string;
  customer_id: string | null; customer_doc_type: string | null; customer_doc_number: string | null; customer_name: string; buyer_address: string | null;
  subtotal: Num; igv: Num; total: Num; sunat_status: string; sunat_message: string | null; status: string; brand_id: string; brand_name: string;
  note_reason: string | null; related_document_id: string | null; pos_ticket: string | null; xml_hash: string | null; needs_review: boolean;
  send_attempts: Num; next_retry_at: string | null; refund_mode: string | null; refund_status: string | null;
};

export type LineaDoc = {
  id: string; line_no: number; variant_id: string; description: string; qty: Num; uom_code: string; unit_price: Num; total: Num;
  subtotal: Num; igv: Num; sku: string; sale_mode: string;
};

export type Comprobante = {
  documento: Documento; tipo: string; lineas: LineaDoc[];
  cobros: { id: string; number: string; code: string; medio: string; amount: Num; monto_cobro: Num; reference: string | null; card_brand: string | null; card_last4: string | null; cash_given: Num | null; change_given: Num | null }[];
  saldo_a_favor: number;
  notas: { id: string; full_number: string; total: Num; sunat_status: string; issued_at: string; note_reason: string | null }[];
  relacionado: { id: string; full_number: string } | null;
  envios: { attempt_no: Num; requested_at: string; result: string; response_code: string | null; message: string | null }[];
  empresa: { ruc: string; razon_social: string; nombre_comercial: string | null; direccion: string | null } | null;
  local: { name: string; address: string | null } | null;
  cliente: { id: string; full_name: string; phone: string | null; email: string | null; doc_type: string | null; doc_number: string | null; customer_type: string } | null;
  turno: { number: string; cashier_name: string } | null;
  caja: { code: string; name: string } | null;
  marca: { id: string; code: string; name: string; color: string | null; logo: boolean; pie: string | null; leyendas: string | null } | null;
  devuelto: Record<string, { qty: number; amount: number }> | [];
};

export type FilaVenta = {
  id: string; full_number: string; doc_type: string; pos_ticket: string | null; customer_name: string; brand_name: string; total: Num;
  sunat_status: string; sunat_message: string | null; issued_at: string; status: string; related_document_id: string | null;
  send_attempts: Num; needs_review: boolean; order_id: string | null; medio: string | null;
};

export const ESTADOS_TURNO: Record<string, [string, Tone]> = {
  OPEN: ["Abierto", "ok"], CLOSED: ["Cerrado, por aprobar", "warn"], APPROVED: ["Aprobado", "neutral"],
};

export const SUNAT: Record<string, [string, Tone]> = {
  ACCEPTED: ["Aceptado", "ok"], PENDING: ["En reintento", "warn"], REJECTED: ["Rechazado", "bad"], OBSERVED: ["Observado", "warn"],
  NOT_SENT: ["Sin enviar", "neutral"], VOIDED: ["Anulado", "bad"],
};

export const TIPOS_DOC: Record<string, string> = { RECEIPT: "Boleta", INVOICE: "Factura", CREDIT_NOTE: "Nota de crédito" };

export const MODOS_BALANZA: Record<string, string> = { MANUAL: "Peso digitado", SCALE: "Balanza conectada", LABEL: "Etiqueta de balanza" };

/** Salidas de efectivo que piden autorización sobre el límite (RN-POS-09). */
export const SALIDAS = ["CASH_OUT", "DEPOSIT", "PETTY_EXPENSE"];

export const esPeso = (saleMode: string) => saleMode === "KG" || saleMode === "UNIT_VARIABLE_WEIGHT";

export const n = (v: Num | null | undefined) => Number(v ?? 0);

/** Redondeo a céntimos para comparar montos. */
export const r2 = (v: number) => Math.round(v * 100) / 100;
