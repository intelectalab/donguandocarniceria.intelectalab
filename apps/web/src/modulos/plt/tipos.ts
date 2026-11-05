// Tipos y catálogos de PLT (Plataforma). Los valores salen de la API (EmpresaController, LocalController).

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
