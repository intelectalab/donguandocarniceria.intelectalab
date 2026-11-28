"use client";

import { useEffect, useRef, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { Alert, Button, toast } from "@/components/ui";
import { mensajeDe } from "@/lib/api";
import { descartar, enviar, nuevoId, sincronizar, useCola } from "./cola";

/** Aviso de pendientes sin señal, con «Sincronizar». Sincroniza solo al volver la conexión. */
export function BarraCola({ onSincronizado }: { onSincronizado?: () => void }) {
  const cola = useCola();
  const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false);

  async function sync(silencio = false) {
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    try {
      const r = await sincronizar();
      if (!r) { if (!silencio) toast.error("Sigues sin conexión: se envía al volver la señal."); return; }
      if (r.enviados || r.rechazados) {
        toast[r.rechazados ? "error" : "ok"](`${r.enviados} enviado(s)${r.rechazados ? `, ${r.rechazados} rechazado(s)` : ""}.`);
        onSincronizado?.();
      }
    } catch (e) {
      if (!silencio) toast.error(mensajeDe(e));
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  }

  useEffect(() => {
    const alVolver = () => void sync(true);
    window.addEventListener("online", alVolver);
    const t = window.setInterval(() => { if (navigator.onLine) void sync(true); }, 60000);
    return () => { window.removeEventListener("online", alVolver); window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cola.length) return null;
  const conError = cola.filter((e) => e.error);
  return (
    <Alert tone="warn" title={`${cola.length} acción(es) guardada(s) en el teléfono`}>
      <span className="block">Se envían solas al volver la señal.</span>
      {conError.map((e) => (
        <span key={e.client_event_id} className="mt-1 flex items-center justify-between gap-2 text-bad">
          <span>{e.resumen}: {e.error}</span>
          <Button size="sm" variant="ghost" onClick={() => descartar(e.client_event_id)}>Quitar</Button>
        </span>
      ))}
      <Button className="mt-2" size="sm" icon={ocupado ? RefreshCw : CloudOff} loading={ocupado} onClick={() => void sync()}>Sincronizar ahora</Button>
    </Alert>
  );
}

/**
 * Posición del repartidor con la app abierta y la ruta en curso (RN-DEL-16): cada intervalo, por la cola
 * (sin señal se guarda y se envía después).
 */
export function usePosicion(rutaId: string | null, activo: boolean, intervaloS: number) {
  useEffect(() => {
    if (!rutaId || !activo || typeof navigator === "undefined" || !navigator.geolocation) return;
    const enviarPosicion = () => navigator.geolocation.getCurrentPosition(
      (p) => void enviar({ type: "POSITION", route_id: rutaId, resumen: "Posición", client_event_id: nuevoId(),
        payload: { lat: p.coords.latitude, lng: p.coords.longitude, occurred_at: new Date().toISOString() } }).catch(() => {}),
      () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
    enviarPosicion();
    const t = window.setInterval(enviarPosicion, Math.max(30, intervaloS) * 1000);
    return () => window.clearInterval(t);
  }, [rutaId, activo, intervaloS]);
}

/** Posición actual (para la prueba de entrega); null si el teléfono no la da. */
export function posicionActual(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((ok) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok(null),
      { enableHighAccuracy: true, maximumAge: 20000, timeout: 10000 });
  });
}
