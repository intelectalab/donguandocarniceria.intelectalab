import { useCallback, useEffect, useState } from "react";
import type { Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";

/** Carga una ruta de la API y la vuelve a pedir con recargar() o cuando cambia la ruta. */
export function useDatos<T>(ruta: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!ruta) return;
    let vigente = true;
    api<T>(ruta).then((d) => { if (vigente) { setDatos(d); setError(""); } }).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [ruta, version]);
  const recargar = useCallback(() => setVersion((n) => n + 1), []);

  return { datos, error, recargar };
}

export const DOCUMENTOS = [{ value: "DNI", label: "DNI" }, { value: "CE", label: "Carné de extranjería" }, { value: "PASSPORT", label: "Pasaporte" }];
export const NOMBRE_DOC: Record<string, string> = { DNI: "DNI", CE: "CE", PASSPORT: "Pasaporte" };

export const ESTADOS_TRABAJADOR: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Cesado", "bad"] };
export const ESTADOS_USUARIO: Record<string, [string, Tone]> = {
  ACTIVE: ["Activo", "ok"], LOCKED: ["Bloqueado", "warn"], INVITED: ["Invitado", "info"], INACTIVE: ["Inactivo", "neutral"],
};
export const ESTADOS_MEDIO: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Desactivado", "neutral"] };

export const TIPO_MEDIO: Record<string, string> = {
  CASH: "Efectivo", WALLET: "Billetera", CARD: "Tarjeta", GATEWAY: "Pasarela", BANK: "Banco", CREDIT: "Crédito", INTERNAL: "Interno",
};
export const CANAL: Record<string, string> = {
  COUNTER: "Mostrador", DELIVERY: "Delivery", WHATSAPP: "WhatsApp", TIKTOK: "TikTok", WEB: "Web", B2B: "B2B", CONSIGNMENT: "Consignación",
};
export const TIPO_ENTIDAD: Record<string, string> = { BANK: "Banco", WALLET: "Billetera", ACQUIRER: "Adquirente", GATEWAY: "Pasarela", CAJA: "Caja municipal" };
export const TIPO_UNIDAD: Record<string, string> = { UNIT: "Unidad", WEIGHT: "Peso", VOLUME: "Volumen", SERVICE: "Servicio", PACKAGE: "Empaque" };
export const NIVEL_UBIGEO: Record<string, string> = { DEPARTMENT: "Departamento", PROVINCE: "Provincia", DISTRICT: "Distrito" };

export type Usuario = { id: string; name: string; email: string; status: string; role: string };

export type Trabajador = {
  id: string; doc_type: string; doc_number: string; full_name: string; position: string; establishment_id: string; cost_center_id: string;
  hire_date: string; phone: string | null; email: string | null; status: string; terminated_on: string | null; termination_reason: string | null;
  local: string | null; centro_costo: string | null; centro_costo_nombre: string | null; usuario?: Usuario | null;
};

export type ResumenTrabajadores = {
  activos: number; de_baja: number; con_usuario: number; sin_usuario: number; ceses_del_anio: number; cargos: string[];
  locales: { id: string; code: string; short: string; name: string }[]; centros: { id: string; code: string; name: string }[]; motivos: string[];
};

/** «3,99 %» con coma decimal. */
export const pct = (n: number | null | undefined, d = 2) => n === null || n === undefined ? "—" : `${n.toLocaleString("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
/** Tipo de cambio con 3 decimales: 3,390. */
export const tc = (n: number | null | undefined) => n === null || n === undefined ? "—" : n.toLocaleString("es-PE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
/** Días transcurridos entre dos fechas AAAA-MM-DD. */
export const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);
/** Hoy en Lima, AAAA-MM-DD. */
export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

/**
 * Orden en pantalla para tablas cortas que llegan completas (unidades, catálogos). sort: «campo» o «-campo», como
 * DataTable; sin sort se respeta el orden de la API. Números se comparan como números y textos sin tildes.
 */
export function ordenarFilas<T>(filas: T[], sort: string, valor: (fila: T, campo: string) => string | number | boolean | null | undefined): T[] {
  if (!sort) return filas;
  const campo = sort.replace(/^-/, "");
  const signo = sort.startsWith("-") ? -1 : 1;
  return [...filas].sort((a, b) => {
    const [x, y] = [valor(a, campo), valor(b, campo)];
    if (typeof x === "number" && typeof y === "number") return (x - y) * signo;
    return String(x ?? "").localeCompare(String(y ?? ""), "es", { sensitivity: "base", numeric: true }) * signo;
  });
}

/** Texto para buscar sin distinguir mayúsculas ni tildes: «credito» encuentra «Crédito». */
export const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
/** «2026-10» → «octubre 2026». */
export const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** Meses «AAAA-MM» de desde a hasta, en orden (para el selector de mes). */
export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let [a, m] = [Number(desde.slice(0, 4)), Number(desde.slice(5, 7))]; `${a}-${String(m).padStart(2, "0")}` <= hasta; m === 12 ? (a++, m = 1) : m++) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

