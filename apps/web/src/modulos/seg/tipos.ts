import type { Tone } from "@/components/ui";

/** Fila de la lista y ficha de SEG-08 / SEG-09 (GET /v1/seg/usuarios). */
export type Usuario = {
  id: string;
  name: string;
  email: string;
  /** Estado guardado: ACTIVE, INVITED, LOCKED, INACTIVE. */
  status: string;
  /** Estado efectivo: un activo con bloqueo por intentos vigente se ve LOCKED. */
  estado: string;
  twofa_enabled: boolean;
  twofa_required: boolean | null;
  mfa_enrolled_at: string | null;
  last_login: string | null;
  locked_until: string | null;
  lock_reason: string | null;
  failed_logins: number;
  deactivated_at: string | null;
  deactivated_reason: string | null;
  invited_at: string | null;
  invited_by: string | null;
  employee_id: string | null;
  employee_name: string | null;
  employee_position: string | null;
  password_changed_at: string | null;
  created_at: string;
  roles_codes: string | null;
  roles_names: string | null;
  exige_2fa: boolean | null;
  alcance_asignado: boolean | null;
  scope_brands: string | null;
  scope_sites: string | null;
  sesiones: number;
};

export type Ficha = Usuario & {
  /** Rol del usuario (uno solo); role_ids trae los guardados, por si datos antiguos tienen más. */
  role_id: string | null;
  role_ids: string[];
  brand_ids: string[];
  establishment_ids: string[];
  sessions: { id: string; name: string; ip: string | null; device: string | null; created_at: string; last_used_at: string | null; expires_at: string | null; activa: boolean; actual: boolean }[];
  devices: { id: string; name: string; platform: string; status: string; fingerprint_hint: string; requested_at: string; approved_at: string | null; approved_by_name: string | null; revoked_at: string | null; revoke_reason: string | null; last_seen_at: string }[];
};

export type Resumen = {
  total: number; activos: number; bloqueados: number; inactivos: number; invitados: number;
  sin_uso: number; dias_sin_uso: number; exigen_2fa: number; con_2fa: number; cobertura_2fa: number;
};

export type Rol = { id: string; code: string; name: string; scope_mode: "ALL" | "ASSIGNED" | "BRAND"; requires_mfa: boolean; is_system: boolean; description: string | null };

export type Opciones = {
  roles: Rol[];
  employees: { id: string; full_name: string; position: string; establishment_id: string; user_id: string | null }[];
  brands: { id: string; code: string; name: string }[];
  establishments: { id: string; code: string; short: string; name: string }[];
};

export type Acceso = {
  id: string; event: string; event_name: string; result: "OK" | "DENIED"; ip: string; device: string; user_agent: string | null;
  detail: string | null; details: Record<string, unknown> | null; at: string; user_name: string;
};

export const ESTADOS_USUARIO: Record<string, [string, Tone]> = {
  ACTIVE: ["Activo", "ok"], INVITED: ["Invitado", "info"], LOCKED: ["Bloqueado", "bad"], INACTIVE: ["Inactivo", "neutral"],
};

export const PLATAFORMAS: Record<string, string> = { ANDROID: "Android", IOS: "iPhone", WEB: "Web" };

/** Cliente de la sesión, como el prototipo: «Web» o «App android». El token se nombra con el cliente al crearse. */
export function clienteDe(nombre: string | null | undefined): string {
  const c = (nombre ?? "").toUpperCase();
  return !c || c === "WEB" ? "Web" : `App ${c.toLowerCase()}`;
}

export const ESTADOS_DISPOSITIVO: Record<string, [string, Tone]> = {
  APPROVED: ["Aprobado", "ok"], PENDING: ["Por aprobar", "warn"], REVOKED: ["Revocado", "bad"],
};

/** Texto del alcance de un usuario: marcas y locales, o «Todo». */
export function alcanceDe(u: Pick<Usuario, "scope_brands" | "scope_sites" | "alcance_asignado">): string {
  const partes = [u.scope_brands, u.scope_sites].filter(Boolean);
  if (partes.length) return partes.join(" · ");
  return u.alcance_asignado ? "Sin asignar" : "Todo";
}

/** Color del evento de la bitácora: lo denegado en rojo, lo correcto en verde. */
export function tonoEvento(a: Pick<Acceso, "event" | "result">): Tone {
  if (a.result === "DENIED" || /FAILED|LOCKED|DENIED|REVOKED|DEACTIVATED/.test(a.event)) return "bad";
  if (/OK|APPROVED|UNLOCKED|REACTIVATED/.test(a.event)) return "ok";
  return "neutral";
}
