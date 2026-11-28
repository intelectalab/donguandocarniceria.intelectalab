import type { Tone } from "@/components/ui";

export type EstadoGasto = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID" | "VOIDED";

/** Fila de lista de gastos (la API la arma igual en todas las listas). */
export type FilaGasto = {
  id: string; number: string; status: EstadoGasto; estado: string; issue_date: string; doc_type: string; documento: string; comprobante: string | null;
  currency: string; total: number; amount_pen: number; net_pen: number | null; withholding_amount: number; description: string; categoria: string | null;
  grupo: string | null; centro: string | null; local: string | null; marca: string | null; proveedor: string | null; registro: string | null;
  accounting_flag: string | null; accounting_note: string | null; revisado: boolean; corregido: boolean; pay_source: string | null; required_level: number | null;
  submitted_at: string | null; approved_at: string | null; paid_at: string | null; paid_amount: number | null; payment_reference: string | null;
  rejection_reason: string | null; foto: boolean; repartido: boolean; de_ruta: boolean; created_at: string;
};

export type LineaReparto = {
  id?: string; cost_center_id: string; brand_id: string; sales_channel: string | null; pct: number; amount?: number;
  centro?: string; centro_codigo?: string; marca?: string; canal?: string | null;
};

export type FichaGasto = FilaGasto & {
  subtotal: number; igv: number; other_taxes: number; exchange_rate: number; supplier_doc: string | null; doc_series: string | null; doc_number: string | null;
  establishment_id: string; brand_id: string; category_id: string; cost_center_id: string; vehicle_id: string | null; route_id: string | null;
  employee_id: string | null; ad_campaign_id: string | null; sales_channel: string | null; canal: string | null; vehiculo: string | null; ruta: string | null;
  trabajador: string | null; campana: string | null; fuel_gallons: number | null; fuel_voucher_no: string | null; odometer_km: number | null;
  historia: { at: string; user: string; action: string; note?: string }[]; void_reason: string | null; voided_at: string | null; aprobo: string | null;
  cuenta_pago: string | null; aprobaciones: { level: number; decision: string; comment: string | null; decided_at: string; quien: string | null }[];
  reparto: LineaReparto[]; costo_reparto: { tipo: string; amount: number; fuel_gallons: number | null } | null;
  rendicion: { id: string; number: string; estado: string } | null; nivel_nombre: string | null;
  puede: { editar: boolean; enviar: boolean; aprobar: boolean; anular: boolean; pagar: boolean; revertir: boolean; repartir: boolean; revisar: boolean; corregir: boolean };
};

export type Categoria = {
  id: string; code: string; name: string; category_group: string; default_area: string; delivery_cost_type: string | null; default_cost_center_id: string;
  default_doc_type: string; requires_vehicle: boolean; requires_gallons: boolean; requires_employee: boolean; requires_supplier: boolean; requires_campaign: boolean;
};

export type Opciones = {
  locales: { id: string; code: string; name: string }[];
  marcas: { id: string; code: string; name: string }[];
  centros: { id: string; code: string; name: string; area: string; brand_id: string | null; establishment_id: string | null }[];
  categorias: Categoria[];
  vehiculos: { id: string; plate: string; vehicle_type: string; establishment_id: string | null }[];
  rutas: { id: string; code: string; route_date: string; vehicle_id: string | null; driver_employee_id: string | null }[];
  trabajadores: { id: string; full_name: string; position: string | null }[];
  campanas: { id: string; code: string; name: string }[];
  fondos: { id: string; establishment_id: string; max_expense_amount: number | null }[];
  documentos: Record<string, string>; canales: Record<string, string>; grupos: Record<string, string>; areas: Record<string, string>;
  costos_reparto: Record<string, string>; estados: Record<string, string>; sin_valido: string[]; con_proveedor: string[];
  parametros: { petty_max: number; retencion_pct: number; retencion_desde: number };
  hoy: string; nivel: number;
};

export const ESTADOS: Record<string, [string, Tone]> = {
  DRAFT: ["Borrador", "neutral"], SUBMITTED: ["Enviado", "info"], APPROVED: ["Aprobado", "ok"], REJECTED: ["Rechazado", "bad"],
  PAID: ["Pagado", "primary"], VOIDED: ["Anulado", "neutral"],
};

export const BANDERAS: Record<string, [string, Tone]> = {
  OK: ["Válido", "ok"], NO_VALID_RECEIPT: ["Sin comprobante válido", "warn"], OBSERVED: ["Observado", "bad"],
};

export const RENDICIONES: Record<string, [string, Tone]> = {
  OPEN: ["Abierta", "info"], SUBMITTED: ["Enviada", "warn"], APPROVED: ["Aprobada", "ok"], REIMBURSED: ["Repuesta", "primary"], REJECTED: ["Devuelta", "bad"],
};

export const NIVELES: Record<number, string> = { 1: "Nivel 1 · jefe de área", 2: "Nivel 2 · administración", 3: "Nivel 3 · gerencia" };

export const lista = (r: Record<string, string>) => Object.entries(r).map(([value, label]) => ({ value, label }));

/** Primer día del mes y hoy, en Lima. */
export function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}
export const inicioDeMes = () => `${hoyLima().slice(0, 8)}01`;
