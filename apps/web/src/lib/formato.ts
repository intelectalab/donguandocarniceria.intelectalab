// Formatos de Perú para mostrar datos: montos en soles, pesos en kg y fechas en hora de Lima
// (la API guarda en UTC, RN-AUD-11). Usarlos siempre en lugar de toLocaleString sueltos.

const ZONA = "America/Lima";

const fmtSoles = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 });
const fmtFecha = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtFechaHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

const vacio = (v: unknown) => v === null || v === undefined || v === "";

/** S/ 1,234.50 */
export function soles(valor: number | string | null | undefined): string {
  return vacio(valor) ? "—" : fmtSoles.format(Number(valor));
}

/** 1,234.5 con los decimales indicados (por defecto, los que tenga, hasta 2). */
export function numero(valor: number | string | null | undefined, decimales?: number): string {
  if (vacio(valor)) return "—";
  return new Intl.NumberFormat("es-PE", {
    minimumFractionDigits: decimales ?? 0, maximumFractionDigits: decimales ?? 2,
  }).format(Number(valor));
}

/** 12.350 kg: el peso siempre con 3 decimales (RN-MAE-10). */
export function kg(valor: number | string | null | undefined): string {
  return vacio(valor) ? "—" : `${numero(valor, 3)} kg`;
}

/** 18 % */
export function porcentaje(valor: number | string | null | undefined, decimales = 0): string {
  return vacio(valor) ? "—" : `${numero(valor, decimales)} %`;
}

/** 05/11/2026 en hora de Lima. Acepta ISO con hora o solo fecha (AAAA-MM-DD). */
export function fecha(valor: string | null | undefined): string {
  if (!valor) return "—";
  // Una fecha sin hora se toma al mediodía de Lima para que no cambie de día por la zona.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T12:00:00-05:00` : valor);
  return Number.isNaN(d.getTime()) ? valor : fmtFecha.format(d);
}

/** 05/11/2026 14:30 en hora de Lima. */
export function fechaHora(valor: string | null | undefined): string {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? valor : fmtFechaHora.format(d);
}
