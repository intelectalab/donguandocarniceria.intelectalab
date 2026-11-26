import type { Tone } from "@/components/ui";

// Etiquetas de CAL. Los valores son los de la base (migración 2026_11_24_000200).
export type Num = number | string | null;
type Etiquetas = Record<string, [string, Tone]>;

export const ETAPA: Record<string, string> = {
  RECEPTION: "Recepción", PROCESS: "Proceso", PRODUCTION: "Producción", PACKING: "Empaque", STORAGE: "Almacenamiento", DISPATCH: "Despacho", CLEANING: "Limpieza", BPM: "Buenas prácticas",
};
export const TIPO_RESPUESTA: Record<string, string> = { YES_NO: "Sí o no", NUMBER: "Número", TEXT: "Texto", PHOTO: "Foto" };
export const FRECUENCIA: Record<string, string> = { PER_SHIFT: "Por turno", DAILY: "Diaria", WEEKLY: "Semanal", MONTHLY: "Mensual" };
export const TURNO: Record<string, string> = { M: "Mañana", T: "Tarde", N: "Noche", D: "Del día" };
export const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const TIPO_PUNTO: Record<string, string> = { COLD_ROOM: "Cámara de frío", FREEZER: "Congeladora", POT: "Olla o marmita", VEHICLE: "Vehículo", DISPLAY: "Vitrina", PRODUCT: "Producto" };
export const RESULTADO: Etiquetas = { PASS: ["Conforme", "ok"], FAIL: ["No conforme", "bad"] };
export const ESTADO_TAREA: Etiquetas = { PENDING: ["Pendiente", "warn"], DONE: ["Hecha", "ok"], MISSED: ["Incumplida", "bad"] };
export const GRAVEDAD: Etiquetas = { MINOR: ["Menor", "neutral"], MAJOR: ["Mayor", "warn"], CRITICAL: ["Crítica", "bad"] };
export const ESTADO_NC: Etiquetas = { OPEN: ["Abierta", "warn"], IN_PROGRESS: ["En curso", "info"], VERIFICATION: ["En verificación", "info"], CLOSED: ["Cerrada", "ok"] };
export const ORIGEN_NC: Record<string, string> = {
  RECEPTION: "Recepción", PROCESS: "Proceso", PACKING: "Empaque", TEMPERATURE: "Temperatura", SUPPLIER: "Proveedor", CUSTOMER_CLAIM: "Reclamo de cliente", AUDIT: "Auditoría",
  EQUIPMENT: "Equipo", CCP: "Punto crítico", OTHER: "Otro",
};
export const TIPO_ACCION: Record<string, string> = { CORRECTION: "Corrección", CORRECTIVE: "Acción correctiva", PREVENTIVE: "Acción preventiva" };
export const ESTADO_ACCION: Etiquetas = { PENDING: ["Pendiente", "warn"], DONE: ["Hecha", "info"], VERIFIED: ["Verificada", "ok"], CANCELLED: ["Anulada", "neutral"] };
export const TIPO_RECLAMO: Record<string, string> = {
  SPOILED: "Producto en mal estado", FOREIGN_BODY: "Cuerpo extraño", TEMPERATURE: "Temperatura", WRONG_WEIGHT: "Peso", PACKAGING: "Envase", TASTE: "Sabor", LABEL: "Etiqueta", OTHER: "Otro",
};
export const ESTADO_RECLAMO: Etiquetas = { OPEN: ["Abierto", "warn"], INVESTIGATING: ["En investigación", "info"], RESOLVED: ["Resuelto", "ok"], REJECTED: ["No procede", "neutral"] };
export const RESOLUCION: Record<string, string> = { NONE: "Sin compensación", REPLACEMENT: "Reposición", CREDIT_NOTE: "Nota de crédito", REFUND: "Devolución de dinero", RETURN: "Devolución del producto" };
export const DECISION: Record<string, string> = { RELEASE: "Liberar", RELEASE_WITH_NOTE: "Liberar con observación", HOLD: "Retener", REJECT: "Rechazar" };
export const ESTADO_EXC: Etiquetas = { OPEN: ["Abierta", "bad"], CLOSED: ["Cerrada", "ok"] };

export type Opciones = {
  establishments: { id: string; name: string; short: string | null }[];
  checklists: { id: string; code: string; name: string; stage: string; version: number }[];
  schedules: { id: string; checklist_id: string; establishment_id: string; area: string; frequency: string }[];
  users: { id: string; name: string }[];
  roles: { code: string; name: string }[];
  suppliers: { id: string; name: string }[];
  equipment: { id: string; code: string; name: string; establishment_id: string }[];
  warehouses: { id: string; code: string; name: string; establishment_id: string }[];
  vehicles: { id: string; plate: string }[];
  products: { id: string; code: string; name: string; brand_id: string; sanitary_authority: string | null }[];
  customers: { id: string; name: string; doc_number: string | null; phone: string | null }[];
  brands: { id: string; name: string }[];
  min_score_pct: Num;
  can: { release: boolean; record: boolean; close: boolean; sanitary: boolean; claim: boolean; checklist: boolean };
};

export type Punto = { id: string; code: string; name: string; point_type: string; establishment_id: string; equipment_id: string | null; warehouse_id: string | null; vehicle_id: string | null;
  min_c: Num; max_c: Num; reading_frequency_min: Num; status: string; sensor: boolean; establishment_name: string; equipment_code: string | null; vehicle_plate: string | null;
  last_value_c: Num; last_read_at: string | null; last_in_range: boolean | null; open_excursion_id: string | null; overdue: boolean; light: string; next_due_at: string | null };
