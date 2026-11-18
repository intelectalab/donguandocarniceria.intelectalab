// Tipos y catálogos de CLI (Clientes, direcciones con pin y zonas de reparto). Los valores salen de la API (app/Modulos/Cli).
import type { Tone } from "@/components/ui";

type Opcion = { value: string; label: string };

export const TIPOS_CLIENTE: Opcion[] = [
  { value: "PERSON", label: "Persona" }, { value: "RESTAURANT", label: "Restaurante" }, { value: "BUSINESS", label: "Negocio" },
  { value: "CONSIGNMENT_POINT", label: "Punto de consignación" }, { value: "RELATED", label: "Parte relacionada" }, { value: "OTHER", label: "Otro" },
];
export const DOCUMENTOS: Opcion[] = [
  { value: "DNI", label: "DNI" }, { value: "RUC", label: "RUC" }, { value: "CE", label: "Carné de extranjería" },
  { value: "PASSPORT", label: "Pasaporte" }, { value: "NONE", label: "Sin documento" },
];
export const CANALES: Opcion[] = [
  { value: "WHATSAPP", label: "WhatsApp" }, { value: "FACEBOOK", label: "Facebook" }, { value: "INSTAGRAM", label: "Instagram" },
  { value: "TIKTOK", label: "TikTok" }, { value: "WEB", label: "Web" }, { value: "POS", label: "Mostrador" }, { value: "PHONE", label: "Teléfono" },
  { value: "B2B", label: "B2B" }, { value: "IMPORT", label: "Importación" }, { value: "OTHER", label: "Otro" },
];
export const ORIGEN_PIN: Record<string, string> = {
  MAP: "Mapa", GPS: "GPS del cliente", WEB: "Web", LINK: "Enlace al cliente", GEOCODE: "Búsqueda por texto",
  IMPORT: "Importación", COORDINATES: "Coordenadas", PENDING_LINK: "Esperando el enlace",
};
export const ESTADOS_CLIENTE: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], BLOCKED: ["Bloqueado", "bad"], INACTIVE: ["Inactivo", "neutral"] };
export const ESTADOS_ENLACE: Record<string, [string, Tone]> = {
  PENDING: ["Pendiente", "warn"], USED: ["Usado", "ok"], EXPIRED: ["Vencido", "neutral"], CANCELLED: ["Anulado", "neutral"],
};
export const ESTADOS_DUPLICADO: Record<string, [string, Tone]> = { OPEN: ["Abierto", "warn"], MERGED: ["Fusionado", "ok"], DISMISSED: ["Descartado", "neutral"] };

export const etiqueta = (lista: Opcion[], v: string | null | undefined) => lista.find((o) => o.value === v)?.label ?? v ?? "—";

/** +51987654321 → +51 987 654 321. */
export function celular(p: string | null | undefined): string {
  if (!p) return "—";
  const m = /^\+51(\d{3})(\d{3})(\d{3})$/.exec(p);
  return m ? `+51 ${m[1]} ${m[2]} ${m[3]}` : p;
}

export type ClienteFila = {
  id: string; full_name: string; trade_name: string | null; phone: string | null; phone_alt: string | null; email: string | null;
  doc_type: string; doc_number: string | null; doc_validated_at: string | null; doc_validation_source: string | null;
  customer_type: string; status: string; merged_into_id: string | null; marketing_opt_in: boolean; created_at: string;
  vendedora: string | null; zona: string | null; pedidos: number; ultima_compra: string | null; ultima_marca: string | null; duplicado: boolean;
};

export type ResumenClientes = {
  mes: string; activos: number; aceptan_publicidad: number; bloqueados: number; nuevos_mes: number;
  recurrentes: { valor: number; numerador: number; denominador: number }; duplicados_abiertos: number;
  opciones: { vendedoras: { id: string; name: string }[]; zonas: { id: string; code: string; name: string }[]; marcas: { id: string; code: string; name: string }[] };
};

export type Direccion = {
  id: string; customer_id: string; label: string; address_line: string; district: string | null; reference: string; lat: number | null; lng: number | null;
  zone_id: string | null; zone_by: string | null; contact_name: string | null; contact_phone: string | null; is_default: boolean;
  pin_source: string | null; geocode_confidence: number | null; zone_code: string | null; zone_name: string | null; ultimo_uso: string | null; confirmado: boolean;
};

export type Consentimiento = { id: string; granted: boolean; channel: string; evidence_text: string; recorded_at: string; recorded_by: string | null };

export type FichaCliente = {
  id: string; full_name: string; trade_name: string | null; nombre: string; phone: string | null; phone_alt: string | null; email: string | null;
  doc_type: string; doc_number: string | null; doc_validated_at: string | null; doc_validation_source: string | null; doc_validation_state: string | null;
  fiscal_address: string | null; taxpayer_condition: string | null; customer_type: string; source_channel: string | null; origin_wa_number: string | null;
  status: string; blocked_reason: string | null; blocked_at: string | null; blocked_by: string | null; merged_into_id: string | null; merged_at: string | null;
  marketing_opt_in: boolean; marketing_opt_in_at: string | null; seller_user_id: string | null; notes: string | null; created_at: string; first_order_at: string | null;
  vendedora: string | null; fusionado_en: { id: string; full_name: string; trade_name: string | null } | null;
  direcciones: Direccion[];
  duplicados: { id: string; match_reason: string; motivo: string; score: number; otro_id: string; otro_nombre: string; otro_phone: string | null }[];
  cifras: {
    pedidos: number; entregados: number; compras: number; ticket: number | null; saldo: number;
    por_cobrar: { total: number; comprobantes: { id: string; full_number: string; issue_date: string; due_date: string | null; balance: number }[]; pedidos: { id: string; number: string; delivery_date: string | null; saldo: number }[] };
  };
  por_marca: { nombre: string; n: number }[];
  por_canal: { canal: string; n: number }[];
  consentimientos: Consentimiento[];
};

export type Zona = {
  id: string; code: string; name: string; establishment_id: string; local: string | null; local_code: string | null; districts: string[] | null;
  polygon: [number, number][] | null; delivery_fee: number; min_order_amount: number; free_from_units: number | null; free_from_kg: number | null;
  free_from_amount: number | null; priority: number | null; province: boolean; lat: number | null; lng: number | null; status: string;
  direcciones: number; pedidos_mes: number; pedidos: number;
};

export type Local = { id: string; code: string; name: string; lat: number | null; lng: number | null };

export type ZonaDelPin = { en_peru: boolean; zona: (Omit<Zona, "local" | "local_code" | "direcciones" | "pedidos_mes" | "pedidos"> & { local: string | null }) | null; por: string | null };

export type Tarifa = {
  unidades: number; kg: number; monto: number;
  lineas: { variant_id: string; sku: string; name: string; sale_mode: string; qty: number; kg: number; precio: number | null; base: string | null; importe: number }[];
  zona: (ZonaDelPin["zona"]) | null; por: string | null; tarifa: number | null; gratis: boolean; cubierto: boolean; bajo_minimo: boolean; motivo: string;
};

export type Enlace = {
  id: string; customer_id: string; cliente: string; phone: string | null; created_at: string; expires_at: string; used_at: string | null;
  created_by: string | null; sent_via: string | null; resultado: string | null; estado: string;
};

export type Duplicado = {
  id: string; customer_id: string; duplicate_of_id: string; match_reason: string; motivo: string; score: number; status: string; created_at: string;
  resolved_at: string | null; resolution_note: string | null; resuelto_por: string | null;
  cliente_nombre: string; cliente_phone: string | null; cliente_wa: string | null; cliente_pedidos: number;
  original_nombre: string; original_phone: string | null; original_wa: string | null; original_pedidos: number;
};

export type LadoFusion = {
  id: string; full_name: string; trade_name: string | null; nombre: string; phone: string | null; phone_alt: string | null; email: string | null;
  doc_type: string; doc_number: string | null; doc_validated_at: string | null; customer_type: string; source_channel: string | null; origin_wa_number: string | null;
  doc_validation_source: string | null; merged_into_id: string | null; status: string; pedidos: number; saldo: number; direcciones: number;
};

export type VistaFusion = {
  par: { a: string; b: string } | null; sobreviviente?: LadoFusion; fusionado?: LadoFusion;
  mueve?: { conteo: { tabla: string; nombre: string; filas: number }[]; consentimientos: number; saldo: number; por_cobrar: number };
};

export type Fusion = {
  id: string; survivor_id: string; merged_id: string; survivor_name: string; merged_name: string; reason: string; merged_at: string; merged_by: string; movido: string;
};

export type FilaImportada = {
  fila: number; full_name: string; phone_raw: string; phone: string | null; email: string | null; doc_type: string; doc_number: string | null;
  district: string | null; error: string | null; existe: { id: string; nombre: string; phone: string } | null; motivo: string | null; motivo_texto: string | null;
  repetida_en: number | null; accion: "CREATE" | "SKIP";
};
