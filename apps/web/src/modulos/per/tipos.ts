import type { Tone } from "@/components/ui";

/** Respuesta de GET /v1/per/opciones: listas para los formularios, permisos de la persona y parámetros de PER. */
export type Opciones = {
  puestos: { id: string; code: string; name: string; area: string; establishment_id: string | null }[];
  locales: { id: string; code: string; short: string; name: string; lat: string | null; lng: string | null }[];
  centros: { id: string; code: string; name: string; area: string | null }[];
  trabajadores: { id: string; full_name: string }[];
  supervisores: { id: string; full_name: string }[];
  turnos: { id: string; code: string; name: string; establishment_id: string; start_time: string; end_time: string; local: string }[];
  cuentas: { id: string; code: string; name: string }[];
  marcas: { id: string; name: string }[];
  roles: { code: string; name: string }[];
  yo: string | null;
  hoy: string;
  permisos: { ve_sueldos: boolean; gestiona: boolean; aprueba_asistencia: boolean; aprueba_adelantos: boolean; comisiones: boolean; aprueba_pagos: boolean;
    supervision: boolean; intercambio: boolean; marca: boolean };
  parametros: { radio_m: number; qr_segundos: number; tolerancia: number; adelanto_pct: number; bono: number; cierre_dia: number; retener: boolean; fuente: string };
};

export const AREAS: Record<string, string> = {
  PRODUCTION: "Producción", QUALITY: "Calidad", WAREHOUSE: "Almacén y preparación", DELIVERY: "Reparto", SALES: "Ventas",
  MARKETING: "Marketing", ADMIN: "Administración", FINANCE: "Finanzas", HR: "RR. HH.", OTHER: "Otro",
};
export const FORMAS: Record<string, string> = { MONTHLY: "Sueldo mensual", DAILY: "Jornal diario", HOURLY: "Tarifa por hora" };
export const FUENTES: Record<string, string> = { AYNI_HR: "Ayni HR (API)", ACCOUNTANT_FILE: "Archivo del contador", NONE: "Sin planilla (externo)" };
export const MARCAS: Record<string, string> = { IN: "Entrada", BREAK_OUT: "Salida a refrigerio", BREAK_IN: "Regreso de refrigerio", OUT: "Salida" };
export const PERMISOS: Record<string, string> = { VACATION: "Vacaciones", PERMISSION: "Permiso personal", MEDICAL: "Descanso médico" };
export const ACCIONES: Record<string, string> = {
  OBSERVATION: "Observación", VERBAL_WARNING: "Llamada de atención verbal", WRITTEN_WARNING: "Llamada de atención escrita", TRAINING: "Capacitación", NO_ACTION: "Sin acción",
};
export const ORIGENES: Record<string, string> = {
  CRM_CONTROL_ALERT: "Alerta de control CRM", TEL_CALL: "Llamada (TEL)", FLO_ALERT: "Alerta de flota", FLO_FINE: "Multa de tránsito", ATTENDANCE: "Asistencia", OTHER: "Otro",
};

export const ESTADO_DIA: Record<string, [string, Tone]> = {
  PRESENT: ["Asistió", "ok"], LATE: ["Tardanza", "warn"], ABSENT: ["Falta", "bad"], LEAVE: ["Permiso", "info"], REST: ["Descanso", "neutral"],
  HOLIDAY: ["Feriado", "neutral"], INCOMPLETE: ["Incompleto", "warn"], PENDING: ["Pendiente", "neutral"],
};
export const ESTADO_PERMISO: Record<string, [string, Tone]> = {
  REQUESTED: ["Por aprobar", "warn"], APPROVED: ["Aprobado", "ok"], REJECTED: ["Rechazado", "bad"], CANCELLED: ["Anulado", "neutral"],
};
export const ESTADO_ADELANTO: Record<string, [string, Tone]> = {
  REQUESTED: ["Por aprobar", "warn"], APPROVED: ["Por pagar", "info"], REJECTED: ["Rechazado", "bad"], PAID: ["Pagado · por descontar", "primary"],
  DEDUCTED: ["Descontado", "ok"], CANCELLED: ["Anulado", "neutral"],
};
export const ESTADO_PAGO: Record<string, [string, Tone]> = {
  DRAFT: ["Por aprobar", "warn"], HELD: ["Retenido", "bad"], APPROVED: ["Aprobado", "info"], PAID: ["Pagado", "ok"], VOIDED: ["Anulado", "neutral"],
};
export const ESTADO_PROG: Record<string, [string, Tone]> = {
  PLANNED: ["Turno", "ok"], SWAPPED: ["Cambio de turno", "info"], REST: ["Descanso", "neutral"], CANCELLED: ["Sin turno", "neutral"],
};
export const SEVERIDAD: Record<string, [string, Tone]> = { HIGH: ["Grave", "bad"], MEDIUM: ["Media", "warn"], LOW: ["Leve", "neutral"] };
export const ESTADO_SUP: Record<string, [string, Tone]> = { OPEN: ["Por atender", "warn"], CLOSED: ["Atendida", "ok"] };
export const ACTIVO: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Inactivo", "neutral"] };
export const VIGENCIA: Record<string, [string, Tone]> = { CURRENT: ["Vigente", "ok"], FUTURE: ["Programada", "info"], PAST: ["Anterior", "neutral"] };

export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00-05:00`);
  d.setUTCDate(d.getUTCDate() + dias);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);
}

/** Primer día del mes de una fecha (AAAA-MM-01). */
export const inicioMes = (f: string) => `${f.slice(0, 7)}-01`;

export function sumarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function nombreMes(mes: string): string {
  return new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes.slice(0, 7)}-01T00:00:00Z`));
}

/** Hora de Lima (HH:MM) de una fecha ISO. */
export function hora(valor: string | null | undefined): string {
  if (!valor) return "—";
  return new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }).format(new Date(valor));
}

/** 125 → «2 h 05 min». */
export function minutos(m: number | null | undefined): string {
  const v = Math.round(Number(m ?? 0));
  if (!v) return "—";
  const h = Math.floor(v / 60);
  const r = v % 60;
  return h ? `${h} h${r ? ` ${String(r).padStart(2, "0")} min` : ""}` : `${r} min`;
}

export const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
