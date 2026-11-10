import type { Tone } from "@/components/ui";

// Tipos y etiquetas de ALM. Los valores son los de la base (CHECK de la migración de ALM).
export type Num = number | string | null;
type Etiquetas = Record<string, [string, Tone]>;

export const TIPOS_ALMACEN = [
  { value: "MAIN", label: "Almacén principal" }, { value: "COLD_ROOM", label: "Cámara de frío" }, { value: "FREEZER", label: "Congeladora" },
  { value: "STORE", label: "Mostrador" }, { value: "PRODUCTION", label: "Producción" }, { value: "QUARANTINE", label: "Cuarentena" },
  { value: "TRANSIT", label: "Tránsito" }, { value: "VEHICLE", label: "Vehículo" }, { value: "RETURNS", label: "Devoluciones" },
  { value: "CONSIGNMENT", label: "Consignación" },
];

export const LOTE: Etiquetas = {
  QUARANTINE: ["Cuarentena", "warn"], RELEASED: ["Liberado", "ok"], BLOCKED: ["Bloqueado", "bad"],
  REJECTED: ["Rechazado", "bad"], RECALLED: ["Retirado", "bad"],
};
export const ESTADOS_LOTE = Object.entries(LOTE).map(([value, [label]]) => ({ value, label }));

export const MOVIMIENTO: Record<string, string> = {
  RECEIPT: "Recepción", SALE: "Venta", RETURN: "Devolución", TRANSFER_OUT: "Salida por traslado", TRANSFER_IN: "Entrada por traslado",
  PRODUCTION_IN: "Entrada de producción", PRODUCTION_OUT: "Salida a producción", ADJUSTMENT: "Ajuste", WASTE: "Merma",
  CONSIGNMENT_OUT: "Salida a consignación", CONSIGNMENT_RETURN: "Retorno de consignación", REVERSAL: "Reverso",
};
export const ORIGEN: Record<string, string> = {
  SALES_ORDER: "Pedido", POS_SALE: "Venta en mostrador", SALES_SUMMARY: "Resumen de ventas", STOCK_RECEIPT: "Recepción", PURCHASE_RECEIPT: "Recepción de compra",
  FARM_RECEIPT: "Recepción de granja", PURCHASE: "Compra", STOCK_TRANSFER: "Transferencia", TRANSFER: "Traslado", STOCK_COUNT: "Conteo", STOCK_WASTE: "Merma",
  EXPIRY: "Vencimiento", LOT_RELEASE: "Liberación de lote", PRODUCTION_ORDER: "Orden de producción", PRODUCTION_REQUEST: "Pedido a producción", PRODUCTION: "Producción",
  CONSIGNMENT_DELIVERY: "Entrega a consignación", CONSIGNMENT_VISIT: "Visita de consignación", CREDIT_NOTE: "Nota de crédito", INTERNAL_USE: "Consumo interno",
  INITIAL_LOAD: "Carga inicial",
};

export const RECEPCION: Etiquetas = { DRAFT: ["Borrador", "neutral"], CONFIRMED: ["Confirmada", "ok"], VOIDED: ["Anulada", "bad"] };
export const ORIGEN_RECEPCION = [
  { value: "PURCHASE", label: "Compra" }, { value: "FARM", label: "Granja" }, { value: "PRODUCTION", label: "Producción" },
  { value: "CUSTOMER_RETURN", label: "Devolución de cliente" }, { value: "OTHER", label: "Otro" },
];
export const ASPECTO = [{ value: "OK", label: "Bien" }, { value: "OBSERVED", label: "Observado" }, { value: "REJECTED", label: "Rechazado" }];
export const CONTROL: Etiquetas = { PENDING: ["Pendiente", "warn"], PASS: ["Aprobado", "ok"], FAIL: ["Rechazado", "bad"] };

export const TRANSFERENCIA: Etiquetas = {
  DRAFT: ["Solicitada", "neutral"], DISPATCHED: ["En tránsito", "info"], RECEIVED: ["Recibida", "ok"],
  RECEIVED_WITH_DIFF: ["Recibida con diferencia", "warn"], CANCELLED: ["Cancelada", "bad"],
};
export const CONTEO: Etiquetas = { OPEN: ["Abierto", "info"], COUNTED: ["Contado", "warn"], APPROVED: ["Aprobado", "ok"], CANCELLED: ["Cancelado", "bad"] };
export const TIPO_CONTEO = [{ value: "CYCLE", label: "Cíclico" }, { value: "SPOT", label: "Puntual" }, { value: "FULL", label: "General" }];
export const MERMA: Etiquetas = { PENDING: ["Por aprobar", "warn"], APPROVED: ["Aprobada", "ok"], REJECTED: ["Rechazada", "bad"] };
export const RESERVA: Etiquetas = { ACTIVE: ["Activa", "info"], RELEASED: ["Liberada", "neutral"], CONSUMED: ["Despachada", "ok"], DISPATCHED: ["Despachada", "ok"] };
export const TRAMO: Etiquetas = { EXPIRED: ["Vencido", "bad"], D3: ["3 días o menos", "warn"], D7: ["7 días o menos", "info"] };

export const etiqueta = (lista: { value: string; label: string }[], v: string | null | undefined) => lista.find((x) => x.value === v)?.label ?? v ?? "—";

/** Unidad de la cantidad según el modo de venta. */
export const unidad = (saleMode: string | null | undefined) => (saleMode === "KG" ? "kg" : "und");

export type Opciones = {
  warehouses: { id: string; code: string; name: string; wh_type: string; establishment_id: string | null; allows_sale: boolean; min_temp_c: Num; max_temp_c: Num }[];
  establishments: { id: string; name: string; short: string }[];
  brands: { id: string; name: string }[];
  lines: string[];
  suppliers: { id: string; trade_name: string; supplier_type: string | null }[];
  waste_reasons: { id: string; code: string; name: string; requires_photo: boolean; approval_above_pen: Num; counts_as_expired: boolean }[];
  vehicles: { id: string; plate: string }[];
  params: { alm_max_temp_chilled_c: number; alm_max_temp_frozen_c: number; alm_expiry_alert_days: number };
};

export type Variante = {
  id: string; sku: string; name: string; sale_mode: string; nominal_weight_kg: Num; std_cost: Num; brand_id: string;
  requires_lot: boolean; storage: string | null; line: string | null; shelf_life_days: number | null;
};

export type Almacen = Opciones["warehouses"][number] & {
  status: string; pick_priority: number | null; parent_id: string | null; vehicle_id: string | null; establishment_name: string | null;
  establishment_short: string | null; vehicle_plate: string | null; balances: number; lots: number; stock_value: Num;
};

export type Saldo = {
  id: string; warehouse_id: string; warehouse_code: string; warehouse_name: string; wh_type: string; establishment_short: string | null;
  variant_id: string; sku: string; variant_name: string; sale_mode: string; brand_name: string | null; line: string | null;
  lot_id: string | null; lot_code: string | null; qc_status: string | null; expiry_date: string | null; days_left: number | null;
  qty: Num; reserved_qty: Num; available_qty: Num; weight_kg: Num; avg_cost: Num; value: Num;
};

export type Movimiento = {
  id: string; moved_at: string; movement_type: string; source_type: string | null; source_id: string | null; reason: string | null; user_name: string | null;
  qty: Num; weight_kg: Num; unit_cost: Num; total_cost: Num; bal_qty: Num; reversal_of: string | null; warehouse_code: string;
  sku: string; variant_name: string; sale_mode: string; lot_code: string | null; reversed: boolean; document: string | null; brand_name: string | null;
};

export type Lote = {
  id: string; code: string; qc_status: string; origin: string | null; production_date: string | null; expiry_date: string | null; days_left: number | null;
  block_reason: string | null; released_at: string | null; released_by: string | null; variant_id: string; sku: string; variant_name: string;
  sale_mode: string; supplier_name: string | null; stock_qty: Num; reserved_qty: Num; stock_by_warehouse: string | null;
  brand_name: string | null; line: string | null; value: Num;
};

export type FichaLote = Lote & {
  unit_cost: Num; received_weight_kg: Num; storage: string | null; supplier_lot_code: string | null; farm_lot_code: string | null; notes: string | null;
  movements: { id: string; moved_at: string; movement_type: string; reason: string | null; user_name: string | null; qty: Num; bal_qty: Num; warehouse_code: string }[];
  stock: { id: string; warehouse_id: string; warehouse_code: string; warehouse_name: string; wh_type: string; qty: Num; reserved_qty: Num; weight_kg: Num }[];
  history: { id: string; from_status: string | null; to_status: string; reason: string | null; changed_at: string; changed_by_name: string | null }[];
  orders: { order_id: string; order_number: string; status: string; qty: Num }[];
  flow: string[];
};

export type Disponible = { balance_id: string; lot_id: string | null; lot_code: string | null; expiry_date: string | null; qc_status?: string | null;
  qty?: Num; available_qty?: Num; reserved_qty?: Num; weight_kg?: Num; warehouse_id?: string; warehouse_code?: string; avg_cost?: Num };

export type Pagina<T> = { data: T[] };

/** Estados del pedido de venta (PED), solo para mostrarlos en ALM. */
export const PEDIDO: Etiquetas = {
  DRAFT: ["Borrador", "neutral"], CONFIRMED: ["Confirmado", "info"], IN_PREPARATION: ["En preparación", "info"], WEIGHED: ["Pesado", "info"],
  READY: ["Listo", "ok"], IN_ROUTE: ["En ruta", "info"], DELIVERED: ["Entregado", "ok"], NOT_DELIVERED: ["No entregado", "bad"],
  CLOSED: ["Cerrado", "neutral"], CANCELLED: ["Anulado", "bad"],
};
