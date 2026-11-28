// Tipos y catálogos de PRE (Preparación con escaneo, bolsas numeradas y carga verificada).
// Los datos salen de la API (app/Modulos/Pre). Las fechas de la API vienen en hora de Lima.
import type { Tone } from "@/components/ui";
import { fechaHora, kg, numero } from "@/lib/formato";

export const TAREA: Record<string, [string, Tone]> = {
  PENDING: ["Pendiente", "neutral"], PICKING: ["En armado", "warn"], PICKED: ["Armada", "info"], PACKED: ["Embolsada", "info"],
  VERIFIED: ["Verificada", "ok"], LOADED: ["Cargada", "primary"], CANCELLED: ["Anulada", "bad"],
};
export const OLA: Record<string, [string, Tone]> = {
  DRAFT: ["Borrador", "neutral"], RELEASED: ["Liberada", "info"], PICKING: ["En armado", "warn"], PACKED: ["Embolsada", "info"],
  LOADED: ["Cargada", "primary"], CLOSED: ["Cerrada", "ok"], CANCELLED: ["Cancelada", "bad"],
};
export const LINEA: Record<string, [string, Tone]> = {
  PENDING: ["Pendiente", "neutral"], PARTIAL: ["En curso", "warn"], DONE: ["Completa", "ok"], SHORT_APPROVED: ["Faltante aprobado", "info"],
};
export const RESULTADOS: Record<string, [string, Tone]> = {
  OK: ["Correcto", "ok"], WRONG_PRODUCT: ["Producto equivocado", "bad"], WRONG_ORDER: ["Pedido cruzado", "bad"], WRONG_ROUTE: ["Ruta equivocada", "bad"],
  LOT_NOT_RELEASED: ["Lote no liberado", "bad"], NOT_FEFO: ["Fuera de FEFO", "warn"], EXCESS: ["Exceso", "bad"], DUPLICATE: ["Etiqueta repetida", "bad"],
  LOAD_ORDER: ["Fuera de orden", "bad"], UNKNOWN: ["Código desconocido", "bad"],
};
export const BOLSAS: { value: string; label: string }[] = [
  { value: "BAG", label: "Bolsa" }, { value: "THERMAL_BOX", label: "Caja térmica" }, { value: "BOX", label: "Caja" }, { value: "COOLER", label: "Cooler" },
];
export const nombreBolsa = (v: string | null | undefined) => BOLSAS.find((b) => b.value === v)?.label ?? "Bolsa";

export type Lote = { code: string; vence: string | null; almacen: string | null; disponible: number };

export type Linea = {
  id: string; sku: string; name: string; sale_mode: string; requires_lot: boolean; qty_required: number; qty_picked: number;
  est_weight_kg: number | null; weighed_kg: number | null; status: string; cut_notes: string | null; weighted: boolean; price_basis: string;
  complete: boolean; avance: number; short_reason: string | null; short_qty: number | null; short_requested_at: string | null; lote_sugerido: Lote | null;
};

export type Lectura = {
  id: string; scan_type: string; barcode: string; result: string; error_code: string | null; message: string | null; weight_kg: string | null;
  qty: string | null; scanned_at: string; override_of: string | null; usuario: string | null; lote: string | null;
};

export type Bolsa = {
  id: string; task_id: string; order_id: string; parcel_no: number; parcel_count: number; parcel_type: string; label_code: string;
  route_code: string | null; route_key: string | null; stop_seq: number | null; weight_kg: string | null; status: string; loaded_at: string | null;
  leyenda: string; pedido: string; cliente: string | null;
};

export type Tarea = {
  id: string; estado: string; wave: { id: string; number: string; status: string }; ruta: string | null; parada: number | null; route_key: string | null;
  ruta_nombre: string | null; preparador: string | null; verificador: string | null; preparer_user_id: string | null;
  started_at: string | null; picked_at: string | null; packed_at: string | null; verified_at: string | null; loaded_at: string | null;
  parcel_count: number | null; parcel_type: string | null; foto: boolean; stock_moved: boolean; stock_error: string | null; cancel_note: string | null;
  pedido: {
    id: string; number: string; status: string; fulfillment: string; delivery_date: string | null; slot_from: string | null; slot_to: string | null;
    notes: string | null; weight_diff_status: string; contact_phone: string | null; estimated_total: string; final_total: string | null;
    cliente: string | null; direccion: string | null; referencia: string | null; marca: string | null; zona: string | null; estado_nombre: string;
  };
  lineas: Linea[]; lecturas: Lectura[]; bolsas: Bolsa[]; sugerido: { count: number; type: string }; avance: number; verifica_otro: boolean;
};

/** Fila de la lista de tareas (GET /pre/tareas). */
export type TareaFila = {
  id: string; pedido: string; cliente: string | null; estado: string; estado_pedido: string; ola: string; ruta: string | null;
  parada: number | null; avance: number; franja: string | null;
};

export type Escaneo = {
  result: string; ok: boolean; code?: string | null; message: string; scan_id?: string; resultado?: string; finished?: boolean;
  over?: boolean; diff_pct?: number | null; tarea: Tarea;
};

export type OlaResumen = {
  id: string; number: string; status: string; local: string | null; almacen: string | null; wave_date: string; franja: string;
  route_code: string | null; pedidos: number; verificados: number; avance: number; cancel_reason: string | null;
};
export type OlaOpcion = { id: string; number: string; status: string; wave_date: string; local: string | null; etiqueta: string };

/** Pantallas de PRE, para enlazar entre ellas. */
export const R = {
  planificador: "/m/pre/pre-01", consolidada: "/m/pre/pre-02", ticket: "/m/pre/pre-03", armado: "/m/pre/pre-04", pesado: "/m/pre/pre-05",
  bolsas: "/m/pre/pre-06", verificacion: "/m/pre/pre-07", carga: "/m/pre/pre-08", faltantes: "/m/pre/pre-09", errores: "/m/pre/pre-10",
  tablero: "/m/pre/pre-11", fefo: "/m/pre/pre-12",
};

/** Fecha con hora de la API («2026-10-12 06:00:00-05») en formato ISO que todos los navegadores leen. */
export const iso = (v: string | null | undefined) => (v ? v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") : v);
export const cuando = (v: string | null | undefined) => fechaHora(iso(v));

/** Cantidad de la línea según cómo se vende: «2 u» o «1,800 kg». */
export function cantidad(l: Pick<Linea, "sale_mode" | "qty_required" | "est_weight_kg">): string {
  if (l.sale_mode === "KG") return kg(l.qty_required);
  return `${numero(l.qty_required)} u`;
}

/** Lo que va armado de la línea: unidades leídas o kg pesados. */
export function hecho(l: Pick<Linea, "sale_mode" | "qty_picked" | "weighed_kg">): string {
  if (l.sale_mode === "KG") return kg(l.weighed_kg ?? 0);
  return `${numero(l.qty_picked)} u`;
}

export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
export const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00-05:00`);
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);
};
/** «2026-10-12 06:00:00-05» → «06:00» (la API ya la da en hora de Lima). */
export const horaDe = (v: string | null | undefined) => (v ? v.slice(11, 16) : "");
