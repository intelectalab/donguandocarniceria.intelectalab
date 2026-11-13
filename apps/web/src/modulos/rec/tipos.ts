import type { Tone } from "@/components/ui";

// Tipos y etiquetas de REC. Los valores son los de la base (CHECK de la migración 2026_11_12_000100).
export type Num = number | string | null;
type Etiquetas = Record<string, [string, Tone]>;
const opciones = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

export const VERSION: Etiquetas = {
  DRAFT: ["Borrador", "neutral"], IN_REVIEW: ["En revisión", "warn"], APPROVED: ["Aprobada", "ok"], RETIRED: ["Retirada", "neutral"],
};

export const TIPO: Record<string, string> = {
  SAUSAGE: "Embutido", BROTH: "Caldo", JAM: "Mermelada", LARD: "Manteca", CURED: "Curado y ahumado", PRESERVE: "Conserva",
  CUT_PACK: "Corte envasado", OTHER: "Otro",
};
export const TIPOS = opciones(TIPO);
/** RN-REC-06: los tipos cocidos o curados necesitan un punto crítico de temperatura o tiempo. */
export const COCIDAS = ["SAUSAGE", "BROTH", "JAM", "LARD", "CURED"];

export const CONSERVACION: Record<string, string> = {
  CHILLED: "Refrigerado (0 a 4 °C)", FROZEN: "Congelado (−18 °C o menos)", AMBIENT: "Ambiente, lugar fresco y seco",
};

export const VARIABLE: Record<string, string> = {
  CORE_TEMP: "Temperatura interna", TIME: "Tiempo", PH: "pH", BRINE_PCT: "% de salmuera", BRIX: "°Brix", WATER_ACTIVITY: "Actividad de agua", OTHER: "Otra",
};
/** Unidad sugerida al elegir la variable. */
export const UNIDAD: Record<string, string> = { CORE_TEMP: "°C", TIME: "min", PH: "pH", BRINE_PCT: "%", BRIX: "°Bx", WATER_ACTIVITY: "aw", OTHER: "" };

export const EQUIPO: Record<string, string> = {
  POT: "Olla o marmita", STOVE: "Cocina", STUFFER: "Embutidora", SEALER: "Selladora", GRINDER: "Molino", SAW: "Sierra", SCALE: "Balanza",
  SMOKER: "Ahumador", COLD_ROOM: "Cámara de frío", ROASTER: "Tostadora", OTHER: "Otro",
};

export const FUNCION: Record<string, string> = {
  PRESERVATIVE: "Conservante", ANTIOXIDANT: "Antioxidante", COLOR: "Colorante", FLAVOR_ENHANCER: "Potenciador del sabor", THICKENER: "Espesante",
  GELLING: "Gelificante", ACIDITY_REGULATOR: "Acidulante", STABILIZER: "Estabilizante", EMULSIFIER: "Emulsionante", SEQUESTRANT: "Secuestrante", OTHER: "Otra",
};

export const lista = opciones;

export type Opciones = {
  products: { id: string; code: string; name: string; brand_id: string; brand_name: string; storage: string; shelf_life_days: number | null }[];
  output_variants: { id: string; product_id: string; sku: string; name: string }[];
  inputs: { id: string; sku: string; name: string; product_type: string; line: string }[];
  packaging: { id: string; sku: string; name: string }[];
  additives: { id: string; sin_code: string; name: string; function_class: string; max_ppm: Num; allergen: string | null; variant_id: string | null; status: string }[];
  brands: { id: string; code: string; name: string }[];
  lines: string[];
  max_yield_pct: number;
  cost_alert_pct: number;
  see_recipe: boolean;
  see_cost: boolean;
};

export type Hito = { at: string; action: string; user?: string; detail?: string };

export type Version = {
  id: string; recipe_id: string; version: number; status: string; base_output_kg: Num; expected_yield_pct: Num; shelf_life_days: number | null;
  storage: string; allergens: string[]; standard_cost_per_kg: Num; recalc_cost_per_kg: Num; notes: string | null;
  packaging: { variant_id: string; per: "KG" | "UNIT"; qty: Num }[]; history: Hito[]; created_by: string; created_by_name: string | null;
  approved_at: string | null; approved_by_name: string | null; submitted_at: string | null; submitted_by_name: string | null;
  retired_at: string | null; retired_by_name: string | null; approval_warnings: string | null;
  recipe_code: string; recipe_name: string; recipe_type: string; brand_id: string; product_id: string;
  total_kg: Num; live_yield_pct: Num; live_allergens: string[]; live_cost_per_kg?: Num; editable: boolean; can_approve: boolean;
};

export type Check = { code: string; level: "ok" | "warn" | "error"; msg: string };
