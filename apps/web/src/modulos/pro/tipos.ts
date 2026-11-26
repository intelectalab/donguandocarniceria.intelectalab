import type { Tone } from "@/components/ui";

// Tipos y etiquetas de PRO y DES. Los valores son los de la base (migración 2026_11_24_000100).
export type Num = number | string | null;
type Etiquetas = Record<string, [string, Tone]>;
export const opciones = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));
export const opcionesDe = (m: Etiquetas) => Object.entries(m).map(([value, [label]]) => ({ value, label }));

export const ESTADO_ORDEN: Etiquetas = {
  PLANNED: ["Planificada", "neutral"], RELEASED: ["Liberada", "info"], IN_PROGRESS: ["En proceso", "warn"], CLOSED: ["Cerrada", "ok"], VOIDED: ["Anulada", "bad"],
};
export const TIPO_ORDEN: Record<string, string> = { RECIPE: "Receta", CUTTING: "Despiece", PACKING: "Envasado" };
export const TIPO_LINEA: Record<string, string> = {
  CUTTING: "Cortes y despiece", VACUUM_PACK: "Envasado al vacío", LARD: "Manteca", BROTH: "Caldos", SAUSAGE: "Embutidos", JAM: "Mermeladas", OTHER: "Otra",
};
export const FUNCION: Record<string, string> = { CUTTER: "Despostador", SAUSAGE_MAKER: "Embutidor", COOK: "Cocinero", PACKER: "Envasador", HELPER: "Ayudante", SUPERVISOR: "Supervisor" };
export const ROL_SALIDA: Record<string, string> = { MAIN: "Producto principal", CO_PRODUCT: "Corte principal", BY_PRODUCT: "Subproducto", WASTE: "Merma" };
export const ROL_INSUMO: Record<string, string> = { RAW_MATERIAL: "Materia prima", INPUT: "Insumo", PACKAGING: "Empaque" };
export const ESTADO_LOTE: Etiquetas = {
  QUARANTINE: ["En cuarentena", "warn"], RELEASED: ["Liberado", "ok"], BLOCKED: ["Retenido", "bad"], REJECTED: ["Rechazado", "bad"], RECALLED: ["Retirado", "bad"],
};
export const ESTADO_PLANTILLA: Etiquetas = { DRAFT: ["Borrador", "neutral"], ACTIVE: ["Activa", "ok"], RETIRED: ["Retirada", "neutral"] };
export const VARIABLE: Record<string, string> = {
  CORE_TEMP: "Temperatura interna", COOK_TEMP: "Temperatura de cocción", BRIX: "Grados Brix", PH: "pH", TIME: "Tiempo", WEIGHT: "Peso", VACUUM: "Vacío", OTHER: "Otra",
};
export const ESPECIE: Record<string, string> = { CERDO: "Cerdo", RES: "Res", POLLO: "Pollo", CUY: "Cuy", CONEJO: "Conejo", CORDERO: "Cordero", PATO: "Pato" };

export type Opciones = {
  establishments: { id: string; name: string; short: string | null }[];
  lines: { id: string; code: string; name: string; line_type: string; establishment_id: string; input_warehouse_id: string; output_warehouse_id: string; max_waste_pct: Num }[];
  warehouses: { id: string; code: string; name: string; establishment_id: string }[];
  cost_centers: { id: string; code: string; name: string }[];
  recipes: { id: string; code: string; name: string; product_id: string; brand_id: string; output_variant_id: string; sku: string; version: number; base_output_kg: Num; expected_yield_pct: Num }[];
  templates: { id: string; code: string; name: string; version: number; species: string; input_variant_id: string; input_sku: string; input_variant_name: string; brand_id: string }[];
  variants: { id: string; sku: string; name: string; sale_mode: string; product_id: string; brand_id: string; product_type: string; requires_lot: boolean }[];
  supervisors: { id: string; name: string }[];
  employees: { id: string; full_name: string; establishment_id: string | null }[];
  equipment: { id: string; code: string; name: string; category: string; status: string; establishment_id: string; hourly_rate: Num; not_usable: string | null }[];
  brands: { id: string; name: string }[];
  line_types: string[];
  functions: string[];
  labor_rate: Num;
  can: Record<string, boolean>;
};

export type Resumen = {
  input_kg: Num; output_kg: Num; main_kg: Num; by_product_kg: Num; waste_kg: Num; waste_recorded_kg: Num; waste_pct: Num; max_waste_pct: Num; actual_yield_pct: Num;
  expected_yield_pct: Num; yield_deviation_pp: Num; yield_tolerance_pp: Num; needs_yield_reason: boolean; needs_waste_reason: boolean; raw_material_cost: Num; input_cost: Num;
  packaging_cost: Num; material_cost: Num; labor_cost: Num; equipment_cost: Num; total_cost: Num; cost_per_kg: Num; standard_cost_per_kg: Num; cost_deviation_pct: Num;
  ingredient_cost_per_kg: Num; critical_deviation: boolean;
};
export type Balance = { input_kg: Num; registered_kg: Num; co_product_kg: Num; by_product_kg: Num; waste_kg: Num; difference_kg: Num; difference_pct: Num; tolerance_pct: Num; ok: boolean; override: boolean };
export type Costeo = {
  date: string; input_cost: Num; labor_cost: Num; equipment_cost: Num; joint_cost: Num; nrv_total: Num; to_allocate: Num; market_value_total: Num; rounding: Num; allocated_total: Num;
  rows: { output_id: string; role: string; cut: string; sku: string; lot_code: string | null; weight_kg: Num; standard_yield_pct: Num; actual_yield_pct: Num; price_per_kg: Num;
    market_value: Num; nrv: Num; allocated_cost: Num; cost_per_kg: Num }[];
  errors: string[];
  alerts: { cut: string; standard_pct: Num; actual_pct: Num; deviation_pp: Num; operator?: string | null }[];
};
export type Teorico = {
  variant_id: string; sku: string; name: string; sale_mode: string; role: string; theoretical_kg: Num; tolerance_kg: Num; is_additive: boolean; consumed_kg: Num; difference_kg: Num;
  fefo: { lot_id: string; lot_code: string; expiry_date: string | null; available_qty: Num } | null;
};
export type PuntoControl = { id: string; step_seq: number; code: string; variable: string; min_value: Num; max_value: Num; unit: string | null; is_critical: boolean; corrective_action: string | null };
export type Orden = {
  id: string; number: string; order_type: string; status: string; planned_date: string; planned_output_kg: Num; expected_yield_pct: Num; establishment_id: string; line_id: string;
  line_code: string; line_name: string; line_type: string; input_warehouse_id: string; output_warehouse_id: string; establishment_name: string; product_name: string | null;
  brand_name: string | null; supervisor_name: string | null; output_sku: string | null; output_variant_name: string | null; output_variant_id: string | null; recipe_code: string | null;
  recipe_name: string | null; recipe_version: number | null; template_code: string | null; template_name: string | null; template_version: number | null; species: string | null;
  released_at: string | null; started_at: string | null; closed_at: string | null; close_date: string | null; closed_by_name: string | null; void_reason: string | null;
  voided_at: string | null; yield_deviation_reason: string | null; waste_reason: string | null; notes: string | null; critical_deviation: boolean; mass_balance_pct: Num;
  history: { at: string; user: string; action: string; detail: string }[] | null;
};
export type Consumo = { id: string; role: string; sku: string; variant_name: string; lot_code: string | null; expiry_date: string | null; qty: Num; weight_kg: Num; unit_cost: Num;
  total_cost: Num; consumed_at: string; fefo_override_reason: string | null; recorded_by_name: string | null; supplier_name: string | null; warehouse_code: string | null };
export type Salida = { id: string; output_role: string; sku: string | null; variant_name: string | null; lot_id: string | null; lot_code: string | null; qty: Num; weight_kg: Num;
  waste_reason: string | null; at: string; recorded_by_name: string | null; allocated_cost: Num; unit_cost: Num; template_line_id: string | null; qc_status?: string | null };
export type Lectura = { id: string; control_point_id: string; value: Num; read_at: string; reader_name: string | null; in_range: boolean; corrective_action: string | null; code: string;
  variable: string; unit: string | null; min_value: Num; max_value: Num; is_critical: boolean };
export type Ficha = {
  order: Orden; summary: Resumen; theoretical: Teorico[]; consumptions: Consumo[]; outputs: Salida[]; readings: Lectura[]; control_points: PuntoControl[];
  labor: { id: string; employee_name: string; task_role: string; work_date: string; hours: Num; hourly_rate: Num; cost: Num }[];
  equipment: { id: string; equipment_code: string; equipment_name: string; hours: Num; hourly_rate: Num; cost: Num }[];
  quality: { id: string; lot_code: string; decision: string; decided_at: string; new_status: string; reason: string | null }[];
  nonconformities: { id: string; number: string; severity: string; status: string; description: string }[];
  can: { cost: boolean; record: boolean; close: boolean; void: boolean; release: boolean; fefo: boolean };
  mass_balance?: Balance; costing?: Costeo | null;
  template_lines?: { id: string; seq: number; name: string; role: string; output_variant_id: string | null; standard_yield_pct: Num; sku: string | null; variant_name: string | null }[];
};
