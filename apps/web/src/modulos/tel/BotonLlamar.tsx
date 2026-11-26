"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { Button, Field, Input, Modal, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";

export type Llamada = {
  id: string; direction: string; direccion: string; from_e164: string; to_e164: string; cliente: string | null; lead: string | null; marca: string | null; vendedora: string | null;
  pedido: string | null; status: string; estado: string; started_at: string; wait_seconds: number; duration_seconds: number; notice_played: boolean; cost_usd: number | null;
  simulador?: boolean; customer_id?: string | null; lead_id?: string | null; order_id?: string | null; menu_option?: number | null;
};

/**
 * Botón «Llamar» (RN-TEL-05): llama con el número de la marca del cliente o del pedido. No aparece con Telefonía
 * apagada ni sin permiso (RN-TEL-01). En el entorno de prueba, al llamar se elige cómo terminó la llamada.
 */
export function BotonLlamar({ ref_, etiqueta = "Llamar", onListo, size = "sm" }: {
  ref_: { customer_id?: string | null; lead_id?: string | null; order_id?: string | null }; etiqueta?: string; onListo?: (l: Llamada) => void; size?: "sm" | "md";
}) {
  const { puede, can } = useSesion();
  const [llamada, setLlamada] = useState<Llamada | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!puede("TEL") || !can("tel.call.make")) return null;
  const cuerpo = Object.fromEntries(Object.entries(ref_).filter(([, v]) => v));
  async function llamar() {
    setOcupado(true);
    try {
      const l = await api<Llamada>("/v1/tel/llamadas", { method: "POST", body: cuerpo });
      if (l.simulador) setLlamada(l);
      else toast.ok(`Llamando con el número ${l.from_e164}…`);
      onListo?.(l);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <>
      <Button size={size} icon={Phone} loading={ocupado} disabled={!Object.keys(cuerpo).length} onClick={llamar}>{etiqueta}</Button>
      {llamada && <ResultadoDePrueba llamada={llamada} onClose={() => setLlamada(null)} onListo={(l) => { setLlamada(null); onListo?.(l); }} />}
    </>
  );
}

/** Solo en el entorno de prueba: cómo terminó la llamada (lo que en producción avisa el proveedor). */
export function ResultadoDePrueba({ llamada, onClose, onListo }: { llamada: Llamada; onClose: () => void; onListo: (l: Llamada) => void }) {
  const [d, setD] = useState({ estado: "COMPLETED", segundos: "95" });
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setEnviando(true);
    try {
      const l = await api<Llamada>(`/v1/tel/llamadas/${llamada.id}/resultado`, { method: "POST", body: { estado: d.estado, segundos: Number(d.segundos) || 0 } });
      toast.ok(`Llamada ${l.estado.toLowerCase()}`);
      onListo(l);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Llamando a ${llamada.cliente ?? llamada.lead ?? llamada.to_e164}`} description={`Sale con el número ${llamada.from_e164}: el cliente no ve tu celular.`}
      footer={<><Button variant="ghost" onClick={onClose}>Más tarde</Button><Button variant="primary" loading={enviando} onClick={guardar}>Registrar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <p className="text-[12px] text-muted sm:col-span-2">Entorno de prueba: el proveedor todavía no está contratado, así que eliges cómo terminó la llamada.</p>
        <Field label="Resultado"><Select value={d.estado} onChange={(e) => setD({ ...d, estado: e.target.value })}
          options={[{ value: "COMPLETED", label: "Atendió" }, { value: "NO_ANSWER", label: "No contestó" }, { value: "BUSY", label: "Ocupado" }, { value: "FAILED", label: "Falló" }]} /></Field>
        {d.estado === "COMPLETED" && <Field label="Duración (segundos)"><Input type="number" min={1} max={7200} value={d.segundos} onChange={(e) => setD({ ...d, segundos: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}

/** «2 min 05 s». */
export function segundos(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}
