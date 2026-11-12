import { api } from "./api";

export type Notificacion = {
  id: string;
  title: string;
  body: string;
  module: string | null;
  tone: string;
  read: boolean;
  created_at: string;
  link: string | null;
};
/** unread: todas sin leer; importantes: las importantes para tu puesto sin leer (lo que cuenta la campana). */
export type ResumenNotificaciones = { unread: number; importantes: number; latest: Notificacion[]; latest_importantes: Notificacion[] };

// Al marcar como leídas en una pantalla, la campana se actualiza sin esperar su próxima consulta.
const EVENTO = "aycha-notificaciones-cambio";
const avisar = () => window.dispatchEvent(new Event(EVENTO));

export function onNotificacionesCambio(fn: () => void) {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}

export async function marcarLeida(id: string) {
  await api(`/v1/me/notifications/${id}/read`, { method: "POST" });
  avisar();
}

export async function marcarTodas() {
  await api("/v1/me/notifications/read-all", { method: "POST" });
  avisar();
}

/** "hace 5 min", "ayer", "12/10/2026". */
export function haceCuanto(iso: string) {
  const fecha = new Date(iso);
  const min = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  if (h < 48) return "ayer";
  return fecha.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
