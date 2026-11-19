import type { Tone } from "@/components/ui";

// Tipos y etiquetas de EQU. Los valores son los de la base (CHECK de la migración 2026_11_18_000100).
export type Num = number | string | null;
type Etiquetas = Record<string, [string, Tone]>;
const opciones = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

export const CATEGORIA: Record<string, string> = {
  SEALER: "Empacadora al vacío", STOVE: "Cocina u horno", POT: "Marmita u olla", SCALE: "Balanza", COLD_ROOM: "Cámara de frío", FREEZER: "Congeladora",
  GRINDER: "Moledora o cutter", STUFFER: "Embutidora", SAW: "Sierra", SLICER: "Rebanadora", LABEL_PRINTER: "Impresora de etiquetas", THERMOMETER: "Termómetro", OTHER: "Otro",
};
export const CATEGORIAS = opciones(CATEGORIA);
/** RN-EQU-11: cámaras y congeladoras necesitan su punto de temperatura en CAL. */
export const FRIO = ["COLD_ROOM", "FREEZER"];
/** Equipos que no se registran por horas en producción. */
export const SIN_HORAS = ["COLD_ROOM", "FREEZER", "LABEL_PRINTER"];

export const ESTADO: Etiquetas = { ACTIVE: ["Activo", "ok"], OUT_OF_SERVICE: ["Fuera de servicio", "bad"], RETIRED: ["De baja", "neutral"] };
export const ESTADOS = opciones(Object.fromEntries(Object.entries(ESTADO).map(([k, v]) => [k, v[0]])));
export const MOTIVO_FUERA: Record<string, string> = { CORRECTIVE: "orden correctiva", CALIBRATION: "calibración no conforme", MANUAL: "a mano" };

export const RESULTADO: Etiquetas = { PASS: ["Conforme", "ok"], FAIL: ["No conforme", "bad"] };
export const CALIBRACION: Etiquetas = {
  BLOCKED: ["Vencida o bloqueada", "bad"], EXPIRING: ["Por vencer", "warn"], USABLE: ["Vigente", "ok"], NOT_APPLICABLE: ["No exige", "neutral"],
};

export const TIPO_ORDEN: Etiquetas = { PREVENTIVE: ["Preventiva", "info"], CORRECTIVE: ["Correctiva", "warn"] };
export const ESTADO_ORDEN: Etiquetas = { OPEN: ["Abierta", "warn"], IN_PROGRESS: ["En curso", "info"], DONE: ["Terminada", "ok"], VOIDED: ["Anulada", "neutral"] };
export const URGENCIA: Etiquetas = { LOW: ["Baja", "neutral"], NORMAL: ["Normal", "info"], HIGH: ["Alta", "bad"] };
export const URGENCIAS = opciones(Object.fromEntries(Object.entries(URGENCIA).map(([k, v]) => [k, v[0]])));

export const ESTADO_PLAN: Etiquetas = { OK: ["Al día", "ok"], DUE: ["Toca", "warn"], OVERDUE: ["Vencido", "bad"], INACTIVE: ["Inactivo", "neutral"] };

export type Opciones = {
  establishments: { id: string; code: string; name: string; short: string | null; company_id: string }[];
  warehouses: { id: string; code: string; name: string; wh_type: string; establishment_id: string }[];
  cost_centers: { id: string; code: string; name: string; establishment_id: string | null }[];
  equipment: { id: string; code: string; name: string; category: string; status: string; establishment_id: string; requires_calibration: boolean; hourly_rate: Num; hour_meter: Num; qr_code: string }[];
  suppliers: { id: string; legal_name: string; trade_name: string | null; doc_number: string }[];
  employees: { id: string; full_name: string; position: string | null; establishment_id: string | null }[];
  params: { calibration_alert_days: number; preventive_overdue_days: number; scale_calibration_months: number; expiring_days: number };
  today: string; suggested_valid_until: string;
  can: { manage: boolean; calibrate: boolean; maintain: boolean; report: boolean; usage: boolean };
};

export type Equipo = {
  id: string; code: string; name: string; category: string; status: string; establishment_id: string; establishment_name: string; establishment_short?: string | null;
  warehouse_id: string | null; warehouse_code: string | null; warehouse_name?: string | null; brand_name: string | null; model: string | null; serial_number: string | null;
  purchase_date: string | null; purchase_cost: Num; useful_life_months: number | null; hourly_rate: Num; power_kw: Num; capacity: string | null;
  requires_calibration: boolean; cost_center_id: string; cost_center_code?: string; cost_center_name?: string; qr_code: string; hour_meter: Num;
  manual_url: string | null; photos: string[]; oos_reason: string | null; oos_since: string | null; notes: string | null;
};

export type Calibracion = {
  id: string; equipment_id: string; calibrated_on: string; valid_until: string; provider_name: string | null; certificate_number: string; certificate_url: string;
  max_error_g: Num; result: string; cost: Num; notes: string | null; recorded_by: string; created_at: string;
  equipment_code?: string; equipment_name?: string; category?: string; establishment_name?: string;
};

export type Orden = {
  id: string; number: string; kind: string; status: string; urgency: string; description: string; diagnosis: string | null; reported_at: string; finished_at: string | null;
  started_at?: string | null; due_on: string | null; downtime_hours: Num; labor_hours?: Num; labor_cost?: Num; parts?: { description: string; qty: number; unit_cost: number }[];
  parts_cost?: Num; external_cost?: Num; total_cost: Num; external_supplier_id?: string | null; supplier_name?: string | null; cost_center_code?: string; cost_center_name?: string;
  equipment_id: string; equipment_code: string; equipment_name: string; equipment_status?: string; establishment_name?: string; reported_by_name?: string | null;
  finished_by_name?: string | null; plan_id?: string | null; plan_activity?: string | null; photo_url?: string | null; void_reason?: string | null;
};

export type Plan = {
  id: string; equipment_id: string; equipment_code: string; equipment_name: string; activity: string; frequency_days: number | null; frequency_hours: number | null;
  next_due_on: string | null; next_due_hours: Num; responsible_employee_id: string | null; responsible_name: string | null; expected_parts: string | null;
  status: string; last_done_on: string | null; hour_meter: Num; state: string; days_left: number | null; hours_left: Num; establishment_name?: string;
  open_order_id?: string | null; open_order_number?: string | null;
};

export const lista = opciones;
