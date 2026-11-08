// Tipos y catálogos de CAT (Catálogo y listas de precio). Los valores salen de la API (app/Modulos/Cat).
import type { Tone } from "@/components/ui";

export type EstadoSanitario = { code: "NA" | "MISSING" | "EXPIRED" | "RED" | "AMBER" | "OK"; label: string; tone: Tone; days: number | null };

export type Producto = {
  id: string;
  brand_id: string;
  brand_name: string | null;
  category_id: string;
  category_name: string | null;
  code: string;
  name: string;
  line: string;
  product_type: string;
  origin: string;
  storage: string;
  status: string;
  web_publishable: boolean | null;
  variantes_activas: number;
  lotes_bloqueados: number;
  se_vende: boolean;
  /** Precio vigente de WhatsApp (RN-CAT-05): mínimo y máximo entre sus variantes. null: no se vende o no tiene precio. */
  precio_whatsapp: { min: number; max: number; basis: "KG" | "UNIT" } | null;
  sanitario: EstadoSanitario;
};

export type ResumenProductos = {
  activos: number;
  en_vista: number;
  variantes_vendibles: number;
  con_precio: number;
  cobertura: number;
  sin_precio: { sku: string; name: string }[];
  sanitario_por_vencer: number;
  sanitario_vencidos: number;
  dias_aviso: number;
  canal: string;
};

export type Categoria = { id: string; code: string; name: string; line: string };

export const LINEAS = [
  { value: "CUY", label: "Cuy" },
  { value: "CONEJO", label: "Conejo" },
  { value: "AVES", label: "Aves de corral" },
  { value: "CORDERO", label: "Cordero" },
  { value: "CERDO", label: "Cerdo" },
  { value: "RES", label: "Res" },
  { value: "CALDOS", label: "Caldos" },
  { value: "EMBUTIDOS", label: "Embutidos" },
  { value: "MANTECA", label: "Mantecas" },
  { value: "ABARROTES", label: "Despensa" },
  { value: "CAFE", label: "Café" },
  { value: "FRUTOS_SECOS", label: "Frutos secos" },
  { value: "MERMELADAS", label: "Mermeladas" },
  { value: "INFUSIONES", label: "Infusiones" },
  { value: "COMBOS", label: "Combos" },
  { value: "OTROS", label: "Insumos y empaques" },
];

export const ALMACENAMIENTO = [
  { value: "CHILLED", label: "Refrigerado" },
  { value: "FROZEN", label: "Congelado" },
  { value: "AMBIENT", label: "Ambiente" },
];

export const etiqueta = (lista: { value: string; label: string }[], valor: string | null | undefined) =>
  lista.find((o) => o.value === valor)?.label ?? valor ?? "—";

export type VarianteFicha = {
  id: string; sku: string; name: string; sale_mode: string; nominal_weight_kg: string | null; min_weight_kg: string | null; max_weight_kg: string | null;
  barcode: string | null; scale_plu: string | null; status: string; web_publishable: boolean | null; sellable: boolean; cut_name: string | null;
  precio_whatsapp: { price: number; basis: "KG" | "UNIT"; list_name: string } | null;
};

export type FichaProducto = Producto & {
  sunat_product_code: string | null;
  igv_affectation: string;
  shelf_life_days: number;
  requires_lot: boolean;
  allow_discount: boolean | null;
  sanitary_authority: string | null;
  sanitary_registry: string | null;
  sanitary_registry_expires: string | null;
  sanitary_certificate: string | null;
  web_title: string | null;
  web_sync_status: string | null;
  tiene_ventas: boolean;
  lotes: { id: string; code: string; qc_status: string; block_reason: string | null }[];
  variantes: VarianteFicha[];
  precios: { id: string; sku: string; variant_name: string; list_id: string; list_name: string; list_status: string; priority: number;
    price: string; basis: string; min_qty: string | null; valid_from: string; valid_to: string | null }[];
  componentes: { id: string; combo_sku: string; sku: string; name: string; qty: string; est_weight_kg: string | null; price_share_pct: string }[];
  historial: { id: number; table_name: string; action: "I" | "U" | "D"; changed_columns: string | null; changed_at: string; user_name: string | null; ref: string | null }[];
};

export const TIPOS_PRODUCTO = [
  { value: "GOODS", label: "Bien (producto de venta)" },
  { value: "SERVICE", label: "Servicio" },
  { value: "COMBO", label: "Combo" },
  { value: "INPUT", label: "Insumo" },
  { value: "PACKAGING", label: "Empaque" },
];

export const ORIGENES = [
  { value: "PRODUCED", label: "Producido" },
  { value: "RESALE", label: "Reventa" },
  { value: "RAW_MATERIAL", label: "Materia prima" },
];

export const AFECTACION_IGV = [
  { value: "10", label: "10 · Gravado" },
  { value: "20", label: "20 · Exonerado" },
  { value: "30", label: "30 · Inafecto" },
];

export const AUTORIDADES = [
  { value: "SENASA", label: "SENASA" },
  { value: "DIGESA", label: "DIGESA" },
  { value: "NONE", label: "No requiere" },
];

export const MODOS_VENTA = [
  { value: "UNIT", label: "Por unidad" },
  { value: "KG", label: "Por kg" },
  { value: "UNIT_VARIABLE_WEIGHT", label: "Unidad de peso variable" },
];

export const SINCRONIZACION: Record<string, string> = {
  NOT_PUBLISHED: "No publicado", PENDING: "Pendiente", SYNCED: "Sincronizado", REMOVED: "Retirado",
};

export type Variante = {
  id: string; product_id: string; product_name: string | null; product_code: string | null; brand_id: string; brand_name: string | null;
  sku: string; name: string; cut_type_id: string | null; cut_name: string | null; sale_mode: string;
  nominal_weight_kg: string | null; min_weight_kg: string | null; max_weight_kg: string | null; weight_tolerance_pct: string | null;
  tolerancia: number | null; barcode: string | null; scale_plu: string | null; min_order_qty: string | null; qty_step: string | null;
  std_cost: string; web_publishable: boolean | null; sellable: boolean; status: string; line: string;
  precio_whatsapp: { price: number; basis: "KG" | "UNIT"; list_name: string } | null;
};

export type DetalleVariante = Variante & {
  producto: { id: string; code: string; name: string; line: string; status: string; product_type: string };
  con_movimientos: boolean;
  stock: number;
  precios: { list_id: string; list_name: string; list_status: string; price: string; basis: string; min_qty: string | null }[];
};

export type Corte = { id: string; code: string; name: string; applies_to_lines: string[] };

/** Tipo de corte con sus líneas y cuántas variantes lo usan (CAT-04). */
export type TipoCorte = {
  id: string; code: string; name: string; applies_to_lines: string[]; sort_order: number; status: string;
  updated_at: string | null; variantes: number; variantes_activas: number;
};

export const CANALES = [
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "WEB", label: "Web" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "PHONE", label: "Teléfono" },
  { value: "COUNTER", label: "Mostrador" },
  { value: "B2B", label: "B2B" },
  { value: "CONSIGNMENT", label: "Consignación" },
];

export const TIPOS_CLIENTE = [
  { value: "PERSON", label: "Persona" },
  { value: "RESTAURANT", label: "Restaurante" },
  { value: "BUSINESS", label: "Negocio" },
  { value: "CONSIGNMENT_POINT", label: "Punto de consignación" },
  { value: "RELATED", label: "Parte relacionada" },
  { value: "OTHER", label: "Otro" },
];

export const ESTADOS_LISTA = [
  { value: "ACTIVE", label: "Activa" },
  { value: "DRAFT", label: "Borrador" },
  { value: "INACTIVE", label: "Inactiva" },
];

/** Lista de precio (CAT-05). Canales o tipos de cliente vacíos = cualquiera. */
export type ListaPrecio = {
  id: string; code: string; name: string; brand_id: string | null; brand_name: string | null;
  channels: string[]; customer_types: string[]; includes_igv: boolean; priority: number | null;
  valid_from: string | null; valid_to: string | null; status: string; currency: string | null;
  vigentes: number; programados: number; historicos?: number;
};

/** Precio de una lista (CAT-06). */
export type PrecioLista = {
  id: string; variant_id: string; sku: string; name: string; sale_mode: string; price: number; basis: "KG" | "UNIT";
  min_qty: number | null; valid_from: string; valid_to: string | null; previous_price: number | null;
  created_by: string | null; reason: string | null; closed_by: string | null; closed_reason: string | null;
};

/** Fila de la vista previa del CSV (CAT-06). */
export type FilaCsv = {
  linea: number; sku: string; variant_id: string | null; name: string | null; price: number; valid_from: string;
  min_qty: number; current: number | null; diff_pct: number | null; error: string | null;
};

/** Texto de los canales o tipos de cliente de una lista: vacío = cualquiera. */
export function alcance(valores: string[], opciones: { value: string; label: string }[]): string {
  return valores.length ? valores.map((v) => etiqueta(opciones, v)).join(", ") : "Cualquiera";
}

/** Resultado del simulador de precio (CAT-07). */
export type Simulacion = {
  elegido: { price: number; basis: "KG" | "UNIT"; list_id: string; list_code: string; list_name: string; min_qty: number; reason: string } | null;
  traza: { list_id: string; list_code: string; list_name: string; priority: number; criterios: number; aplica: boolean; porque: string; elegida: boolean; price: number | null; basis: string | null; min_qty: number | null }[];
  tipo_cliente: string;
  variante: { id: string; sku: string; name: string; sale_mode: string; nominal_weight_kg: number | null };
  kg_estimado: number | null; importe_estimado: number | null; admite_descuento: boolean; aviso_cantidad: string | null;
};

/** Combo con sus componentes, revisión RN-CAT-08 y cuántos alcanzan con el stock (CAT-08). */
export type Combo = {
  id: string; sku: string; name: string; status: string; brand_id: string; brand_name: string | null; product_id: string;
  precio_whatsapp: { price: number; list_name: string } | null;
  revision: { ok: boolean; suma: number; problemas: string[] };
  alcanza: number;
  componentes: {
    id: string; component_variant_id: string; sku: string; name: string; sale_mode: string; qty: number;
    est_weight_kg: number | null; price_share_pct: number; stock: number; importe: number | null;
  }[];
};

/** Producto en la publicación web (CAT-09). */
export type ProductoWeb = {
  id: string; code: string; name: string; brand_id: string; brand_name: string | null; status: string;
  web_publishable: boolean; web_title: string | null; web_description: string | null; image_url: string | null;
  web_sync_status: string | null; web_synced_at: string | null; sanitario: EstadoSanitario;
  variantes: { id: string; sku: string; name: string; web_publishable: boolean; stock: number }[];
  variantes_web: number; stock_publicable: number;
};

/** Producto con registro sanitario (CAT-10). */
export type RegistroSanitarioFila = {
  id: string; code: string; name: string; brand_id: string; brand_name: string | null; status: string;
  sanitary_authority: string; sanitary_registry: string | null; sanitary_registry_expires: string | null;
  sanitary_alert_days: number | null; sanitary_certificate: string | null; web_publishable: boolean; sanitario: EstadoSanitario;
};

/** Formato de la etiqueta de balanza (parámetro cat_scale_barcode_layout, CAT-11). */
export type FormatoBalanza = { prefix: string; plu_start: number; plu_len: number; value_start: number; value_len: number; value_type: "WEIGHT_G" | "PRICE_CENTS" };

/** Lectura de una etiqueta de balanza (CAT-11). */
export type LecturaBalanza = {
  ok: boolean; plu: string | null; error: string | null; value_type: string; weight_kg: number | null; amount: number | null;
  variant: { id: string; sku: string; name: string; sale_mode: string; min_weight_kg: string | null; max_weight_kg: string | null } | null;
  precio: { price: number; basis: string; list_name: string } | null; importe: number | null; fuera_de_rango: boolean;
};

/** Fila del historial de precios (CAT-12). */
export type CambioPrecio = {
  id: string; list_id: string; list_code: string; list_name: string; variant_id: string; sku: string; variant_name: string;
  basis: string; min_qty: number | null; price: number; precio_anterior: number | null; cambio_pct: number | null;
  valid_from: string; valid_to: string | null; created_by: string | null; created_at: string; reason: string | null;
};
