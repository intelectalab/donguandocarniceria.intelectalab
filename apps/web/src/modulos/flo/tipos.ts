import type { Tone } from "@/components/ui";

// FLO · Flota avanzada: tipos de las respuestas de /v1/flo y etiquetas de sus estados.

export type Vehiculo = {
  id: string; plate: string; internal_code: string | null; etiqueta: string; vehicle_type: string; tipo: string; ownership: string; modalidad: string;
  refrigerated: boolean; status: string; op_status: string; establishment_id: string; local: string | null; odometro: number; tank_capacity_gal: number;
  expected_km_per_gal: number; tiene_ficha: boolean; bloqueos: string[];
};

export type Opciones = {
  vehiculos: Vehiculo[];
  conductores: { id: string; name: string; employee_id: string | null }[];
  empleados: { id: string; full_name: string; position: string | null }[];
  proveedores: { id: string; nombre: string; tipo: string; ruc: string | null }[];
  locales: { id: string; code: string; name: string }[];
  documentos: { code: string; nombre: string; duenio: "VEHICLE" | "EMPLOYEE"; vence: boolean }[];
  costos: Record<string, string>;
  entidades: Record<string, string>;
  alertas: Record<string, string>;
  checklist: Record<string, string>;
  hoy: string;
  parametros: {
    gps_segundos: number; tolerancia_km: number; tolerancia_rendimiento: number; factor_tanque: number; aviso_km: number; aviso_dias: number; bloqueo_km: number;
    avisos_documentos: number[]; excursion_minutos: number; gps_silencio: number; limite_velocidad: number;
  };
  permisos: {
    vivo: boolean; jornada: boolean; combustible: boolean; mantenimiento: boolean; documentos: boolean; multas: boolean; tablero: boolean; costos: boolean;
    descuento: boolean; gastos: boolean; planificar: boolean;
  };
};

export type Alerta = {
  id: string; number: string; alert_type: string; tipo: string; vehicle_id: string | null; employee_id: string | null; origin: string; title: string; detail: string | null;
  severity: "info" | "warn" | "bad"; first_at: string; last_at: string; occurrences: number; status: "OPEN" | "ACK" | "CLOSED"; ack_note: string | null; ack_at: string | null;
  resolution: string | null; closed_at: string | null; vehiculo: string | null; conductor: string | null; atendio: string | null; cerro: string | null;
  order_reviews: { order_id: string; number: string; status: "PENDING" | "RELEASED" | "REJECTED"; decided_by: string | null; decided_at: string | null; note: string | null }[];
  pendientes: number; excursion_minutes: number | null; max_value: number | null;
};

export const ESTADO_VIVO: Record<string, [string, Tone]> = {
  MOVING: ["En movimiento", "ok"], STOPPED: ["Detenido", "info"], SILENT: ["GPS silencioso", "warn"],
  IDLE: ["Sin jornada", "neutral"], BLOCKED: ["Bloqueado", "bad"], MAINT: ["En mantenimiento", "bad"],
};

export const JORNADA: Record<string, [string, Tone]> = {
  PLANNED: ["Programada", "info"], OPEN: ["Abierta", "ok"], CLOSED: ["Cerrada", "neutral"], CANCELLED: ["Cancelada", "neutral"],
};

export const RENDIMIENTO: Record<string, [string, Tone]> = { OK: ["En rango", "ok"], LOW: ["Bajo", "bad"], NA: ["Sin dato", "neutral"] };

export const PLAN: Record<string, [string, Tone]> = {
  OK: ["Al día", "ok"], DUE_SOON: ["Por vencer", "warn"], OVERDUE: ["Vencido", "bad"], OVERDUE_BLOCK: ["Vencido · bloquea", "bad"], INACTIVE: ["Inactivo", "neutral"],
};

export const ORDEN: Record<string, [string, Tone]> = { IN_PROGRESS: ["En curso", "warn"], DONE: ["Hecha", "ok"], VOIDED: ["Anulada", "neutral"] };

export const SEMAFORO: Record<string, [string, Tone]> = {
  EXPIRED: ["Vencido", "bad"], D7: ["Vence en 7 días", "bad"], D15: ["Vence en 15 días", "warn"], D30: ["Vence en 30 días", "warn"],
  VALID: ["Vigente", "ok"], NO_EXPIRY: ["Sin vencimiento", "neutral"],
};

export const MULTA: Record<string, [string, Tone]> = { PENDING: ["Pendiente", "warn"], PAID: ["Pagada", "ok"], APPEALED: ["Apelada", "info"], VOIDED: ["Anulada", "neutral"] };

export const ALERTA: Record<string, [string, Tone]> = { OPEN: ["Abierta", "bad"], ACK: ["Atendida", "warn"], CLOSED: ["Cerrada", "neutral"] };

export const SEVERIDAD: Record<string, [string, Tone]> = { bad: ["Grave", "bad"], warn: ["Aviso", "warn"], info: ["Info", "info"] };

export const REVISION: Record<string, [string, Tone]> = { PENDING: ["Por revisar", "warn"], RELEASED: ["Liberado", "ok"], REJECTED: ["Rechazado", "bad"] };

export const COSTO: Record<string, [string, Tone]> = { ACTIVE: ["Vigente", "ok"], VOIDED: ["Anulado", "neutral"] };

/** Fecha de hoy en Lima (AAAA-MM-DD). */
export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00-05:00`);
  d.setUTCDate(d.getUTCDate() + dias);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);
}

/** HH:MM en hora de Lima. */
export function hora(valor: string | null | undefined): string {
  if (!valor) return "—";
  const d = new Date(valor.includes("T") || valor.includes(" ") ? valor.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") : valor);
  return Number.isNaN(d.getTime()) ? valor : new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** Momento local (para un input datetime-local) en hora de Lima. */
export function ahoraLocal(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour") === "24" ? "00" : v("hour")}:${v("minute")}`;
}

/** Un datetime-local de Lima a ISO con su zona (-05:00), como lo espera la API. */
export const aIso = (local: string) => (local ? `${local.length === 16 ? `${local}:00` : local}-05:00` : "");

export const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
