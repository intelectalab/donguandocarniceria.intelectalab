"use client";

import { useSyncExternalStore } from "react";
import { ApiError, api } from "@/lib/api";

/**
 * Cola sin conexión de la app del repartidor (RN-DEL-06, CA-DEL-09). Cada acción lleva un id del teléfono
 * (client_event_id). Si no hay señal, queda guardada en el teléfono (con su foto en base64) y se envía al
 * volver la conexión; el servidor registra cada id una sola vez aunque llegue dos veces.
 */
export type EventoApp = {
  client_event_id: string;
  type: "ARRIVED" | "COD_COLLECTED" | "DELIVERED" | "FAILED" | "INCIDENT" | "POSITION" | "EXPENSE" | "MESSAGE" | "TICKET";
  stop_id?: string;
  route_id?: string;
  payload: Record<string, unknown>;
  /** Lo que se muestra en la lista de pendientes. */
  resumen: string;
  creado: string;
  error?: string;
};

const CLAVE = "del:cola";
const oyentes = new Set<() => void>();
let cache: EventoApp[] | null = null;
const VACIA: EventoApp[] = [];

function leer(): EventoApp[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CLAVE) ?? "[]") as EventoApp[];
  } catch {
    cache = [];
  }
  return cache;
}

function guardar(c: EventoApp[]) {
  cache = c;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(c));
  } catch {
    // Sin espacio en el teléfono: quedan en memoria hasta sincronizar.
  }
  oyentes.forEach((f) => f());
}

export function nuevoId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Pendientes de enviar, para mostrarlos en la app. */
export function useCola() {
  return useSyncExternalStore((f) => { oyentes.add(f); return () => oyentes.delete(f); }, leer, () => VACIA);
}

const RUTAS: Record<EventoApp["type"], (e: EventoApp) => string> = {
  ARRIVED: (e) => `/v1/del/app/paradas/${e.stop_id}/llegar`,
  COD_COLLECTED: (e) => `/v1/del/app/paradas/${e.stop_id}/cobrar`,
  DELIVERED: (e) => `/v1/del/app/paradas/${e.stop_id}/entregar`,
  FAILED: (e) => `/v1/del/app/paradas/${e.stop_id}/no-entregar`,
  INCIDENT: (e) => `/v1/del/app/paradas/${e.stop_id}/incidencia`,
  POSITION: (e) => `/v1/del/app/rutas/${e.route_id}/posicion`,
  EXPENSE: (e) => `/v1/del/app/rutas/${e.route_id}/gastos`,
  MESSAGE: (e) => `/v1/del/app/rutas/${e.route_id}/mensajes`,
  TICKET: (e) => `/v1/del/paradas/${e.stop_id}/ticket`,
};

/** Sin red (no es un rechazo del servidor): el navegador no llegó a la API. */
const sinRed = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 502;

/**
 * Envía la acción. Con señal, la respuesta del servidor (un rechazo por regla vuelve como error para mostrarlo).
 * Sin señal, la guarda en la cola y devuelve null.
 */
export async function enviar<T = unknown>(e: Omit<EventoApp, "creado" | "client_event_id"> & { client_event_id?: string }): Promise<T | null> {
  const ev: EventoApp = { ...e, client_event_id: e.client_event_id ?? nuevoId(), creado: new Date().toISOString() };
  const cuerpo = { ...ev.payload, client_event_id: ev.client_event_id };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    guardar([...leer(), ev]);
    return null;
  }
  try {
    return await api<T>(RUTAS[ev.type](ev), { method: "POST", body: cuerpo });
  } catch (err) {
    if (sinRed(err)) {
      guardar([...leer(), ev]);
      return null;
    }
    throw err;
  }
}

/** Envía la cola al servidor. Devuelve cuántos quedaron registrados y cuántos rechazados (con su motivo). */
export async function sincronizar(): Promise<{ enviados: number; rechazados: number } | null> {
  const c = leer();
  if (!c.length) return { enviados: 0, rechazados: 0 };
  let enviados = 0;
  let rechazados = 0;
  for (let i = 0; i < c.length; i += 20) {
    const parte = c.slice(i, i + 20);
    try {
      const r = await api<{ results: { client_event_id: string; ok: boolean; message?: string }[] }>("/v1/del/app/sincronizar", {
        method: "POST",
        body: { events: parte.map(({ client_event_id, type, stop_id, route_id, payload }) => ({ client_event_id, type, stop_id, route_id, payload })) },
      });
      const porId = new Map(r.results.map((x) => [x.client_event_id, x]));
      const resto = leer().flatMap((ev) => {
        const x = porId.get(ev.client_event_id);
        if (!x) return [ev];
        if (x.ok) { enviados++; return []; }
        rechazados++;
        return [{ ...ev, error: x.message ?? "Rechazado" }];
      });
      guardar(resto);
    } catch (err) {
      if (sinRed(err)) return null;
      throw err;
    }
  }
  return { enviados, rechazados };
}

/** Quita de la cola un evento rechazado (después de verlo). */
export function descartar(id: string) {
  guardar(leer().filter((e) => e.client_event_id !== id));
}
