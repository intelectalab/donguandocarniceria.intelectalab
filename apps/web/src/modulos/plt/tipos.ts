// Tipos y catálogos de PLT (Plataforma). Los valores salen de la API (controladores de app/Modulos/Plt).

export type Empresa = {
  id: string;
  legal_name: string;
  trade_name: string;
  ruc: string;
  tax_regime: string;
  fiscal_address: string;
  fiscal_ubigeo: string | null;
  fiscal_district: string | null;
  default_currency: string;
  timezone: string;
  status: string;
  brands_count: number;
  active_brands_count: number;
  establishments_count: number;
  series_count: number;
  electronic_series_count: number;
  brands: { id: string; code: string; name: string; status: string; primary_color: string | null }[];
  establishments: { id: string; code: string; short: string; est_type: string; status: string }[];
};

export type Local = {
  id: string;
  company_id: string;
  company_name: string | null;
  code: string;
  name: string;
  short: string;
  est_type: string;
  sunat_code: string;
  address: string;
  ubigeo: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  has_counter: boolean;
  status: string;
  warehouses_count: number;
  zones_count: number;
};

export const REGIMENES = [
  { value: "MYPE", label: "Régimen MYPE Tributario" },
  { value: "RER", label: "Régimen Especial (RER)" },
  { value: "GENERAL", label: "Régimen General" },
  { value: "NRUS", label: "Nuevo RUS" },
];

export const TIPOS_LOCAL = [
  { value: "PLANT", label: "Planta" },
  { value: "STORE", label: "Tienda" },
  { value: "WAREHOUSE", label: "Almacén" },
  { value: "OFFICE", label: "Oficina" },
  { value: "MIXED", label: "Mixto (planta y mostrador)" },
];

export const etiqueta = (lista: { value: string; label: string }[], valor: string | null | undefined) =>
  lista.find((o) => o.value === valor)?.label ?? valor ?? "—";

/**
 * RN-PLT-13 en el navegador, solo para avisar mientras se escribe (la API valida igual):
 * 11 dígitos, empieza en 10, 15, 17 o 20 y dígito verificador módulo 11.
 */
export function problemaRuc(ruc: string): string | null {
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return "Tiene 11 dígitos y empieza en 10, 15, 17 o 20.";
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + Number(ruc[i]) * p, 0);
  let d = 11 - (suma % 11);
  if (d === 10) d = 0;
  if (d === 11) d = 1;
  return Number(ruc[10]) === d ? null : `El RUC no es válido: con esos primeros 10 dígitos debería terminar en ${d}.`;
}

export type Marca = {
  id: string;
  company_id: string;
  company_name: string | null;
  code: string;
  name: string;
  primary_color: string;
  description: string | null;
  website: string | null;
  legal_footer: string | null;
  print_legends: string | null;
  print_show_logo: boolean | null;
  whatsapp_display_name: string | null;
  status: string;
  sort_order: number;
  series_count: number;
  products_count: number;
  orders_count: number;
  documents_count: number;
  /** Archivo del logo ({código}.png); la imagen sale de GET /marcas/{id}/logo. */
  logo_url: string | null;
  /** Nombre del tema propio (PLT-06); null si usa el de la empresa. */
  theme_name: string | null;
  /** Solo en el detalle (GET /marcas/{id}). */
  series?: string[];
};

export type Serie = {
  id: string;
  company_id: string;
  company_name: string | null;
  establishment_id: string | null;
  establishment_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  doc_type: string;
  series: string;
  next_number: number;
  is_electronic: boolean;
  status: string;
  applies_to: string | null;
  note: string | null;
  status_reason: string | null;
  /** Solo en el detalle (GET /series/{id}). */
  ultimos?: { id: string; full_number: string; customer_name: string | null; total: string; issue_date: string; status: string }[];
};

export const TIPOS_DOCUMENTO = [
  { value: "INVOICE", label: "Factura" },
  { value: "RECEIPT", label: "Boleta" },
  { value: "CREDIT_NOTE", label: "Nota de crédito" },
  { value: "DEBIT_NOTE", label: "Nota de débito" },
  { value: "DISPATCH_GUIDE", label: "Guía de remisión" },
  { value: "INTERNAL_NOTE", label: "Nota interna" },
  { value: "PURCHASE_ORDER", label: "Orden de compra" },
  { value: "PRODUCTION_ORDER", label: "Orden de producción" },
  { value: "QUOTE", label: "Cotización" },
  { value: "CONSIGNMENT_NOTE", label: "Nota de consignación" },
  { value: "JOURNAL", label: "Asiento contable" },
];

/** Formato de serie que pide SUNAT a los comprobantes electrónicos (RN-PLT-04); los demás son internos. */
export const FORMATO_SERIE: Record<string, { re: RegExp; ejemplo: string }> = {
  INVOICE: { re: /^F[A-Z0-9]{3}$/, ejemplo: "F y 3 letras o números, por ejemplo F006" },
  RECEIPT: { re: /^B[A-Z0-9]{3}$/, ejemplo: "B y 3 letras o números, por ejemplo B011" },
  CREDIT_NOTE: { re: /^[FB]C[A-Z0-9]{2}$/, ejemplo: "FC o BC y 2 letras o números, por ejemplo FC01" },
  DEBIT_NOTE: { re: /^[FB]D[A-Z0-9]{2}$/, ejemplo: "FD o BD y 2 letras o números, por ejemplo FD01" },
  DISPATCH_GUIDE: { re: /^T[A-Z0-9]{3}$/, ejemplo: "T y 3 letras o números, por ejemplo T003" },
};

/** Último número de una serie (8 dígitos). */
export const MAXIMO_SERIE = 99_999_999;

/** Porcentaje del rango que ya usó la serie. */
export const usoSerie = (siguiente: number) => ((siguiente - 1) / MAXIMO_SERIE) * 100;

/** Aviso mientras se escribe la serie (la API valida igual). */
export function problemaSerie(serie: string, tipo: string, electronica: boolean): string | null {
  if (!serie) return null;
  const f = FORMATO_SERIE[tipo];
  if (electronica && f) return f.re.test(serie) ? null : `No tiene el formato que pide SUNAT: ${f.ejemplo}.`;
  return /^[A-Z0-9]{2,4}$/.test(serie) ? null : "Una serie interna tiene de 2 a 4 letras o números.";
}

/** Áreas de los centros de costo (PLT-07), en el orden del árbol. */
export const AREAS_COSTO = [
  { value: "PRODUCTION", label: "Producción" },
  { value: "QUALITY", label: "Calidad" },
  { value: "WAREHOUSE", label: "Almacén" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "SALES", label: "Ventas" },
  { value: "MARKETING", label: "Marketing" },
  { value: "ADMIN", label: "Administración" },
  { value: "FINANCE", label: "Finanzas" },
  { value: "HR", label: "RR. HH." },
];

export type CentroCosto = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  area: string;
  parent_id: string | null;
  parent_code: string | null;
  establishment_id: string | null;
  establishment_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  status: string;
  /** 1 = raíz. */
  nivel: number;
  hijos_count: number;
  gastos_count: number;
  /** Solo en el detalle (GET /centros-costo/{id}). */
  hijos?: string[];
};
