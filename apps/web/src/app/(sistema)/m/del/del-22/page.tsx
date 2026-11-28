"use client";

import { useState } from "react";
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, VerArchivo, useDatos } from "@/modulos/del/comunes";
import { MENSAJE } from "@/modulos/del/tipos";

type Mensaje = {
  id: string; kind: string; text: string | null; audio_file_id: string | null; audio_sec: number | null; photo_file_id: string | null; amount: number | null; to_role: string;
  para: string; status: string; reply: string | null; confirmed_amount: number | null; ruta: string; de: string | null; seq: number | null; pedido: string | null;
  atendido_por: string | null; ack_at: string | null; created_at: string;
};
type Estado = "ABIERTOS" | "CONFIRMED" | "REJECTED" | "READ";

/** DEL-22 Mensajes de los repartidores: leer, confirmar capturas de pago con el monto recibido o rechazarlas (RN-DEL-17). */
export default function Mensajes() {
  const { can } = useSesion();
  const [estado, setEstado] = useState<Estado>("ABIERTOS");
  const { datos, error, cargando, recargar } = useDatos<{ data: Mensaje[]; pendientes: number }>(`/v1/del/mensajes?estado=${estado}`);
  const [abrir, setAbrir] = useState<Mensaje | null>(null);
  const atiende = can("del.route.plan") || can("del.tracking.view");
  return (
    <div className="space-y-5">
      <PageHeader description="Una captura de pago se confirma solo con el monto que ves recibido en la cuenta; si no coincide, escribe el motivo." />
      <Tabs value={estado} onChange={setEstado} tabs={[{ key: "ABIERTOS", label: "Por atender", count: datos?.pendientes }, { key: "READ", label: "Leídos" }, { key: "CONFIRMED", label: "Confirmados" }, { key: "REJECTED", label: "Rechazados" }]} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No hay mensajes aquí.</Vacio> : (
        <div className="grid gap-3 md:grid-cols-2">
          {datos.data.map((m) => (
            <Seccion key={m.id} titulo={`${m.ruta} · ${m.de ?? "—"}`} acciones={<StatusBadge status={m.status} labels={MENSAJE} />}>
              <p className="text-[12.5px] text-muted">Para {m.para} · {fechaHora(m.created_at)}{m.pedido ? ` · ${m.pedido} (parada ${m.seq})` : ""}</p>
              <p className="mt-1 font-medium text-ink">{m.kind === "AUDIO" ? `Audio de ${m.audio_sec ?? "?"} s` : m.kind === "CAPTURE" ? `Captura de pago por ${soles(m.amount)}` : "Mensaje"}</p>
              {m.text && <p className="text-[13.5px]">{m.text}</p>}
              <div className="mt-1 flex flex-wrap gap-3">
                {m.audio_file_id && <VerArchivo id={m.audio_file_id} texto="Escuchar" />}
                {m.photo_file_id && <VerArchivo id={m.photo_file_id} texto="Ver captura" />}
              </div>
              {m.reply && <p className="mt-1 rounded-lg bg-surface-2 px-2 py-1 text-[12.5px]">{m.atendido_por ?? "—"}: {m.reply}</p>}
              {m.confirmed_amount != null && <Badge tone="ok">Recibido {soles(m.confirmed_amount)}</Badge>}
              {atiende && m.status === "SENT" && <Button className="mt-2" size="sm" variant="primary" onClick={() => setAbrir(m)}>Atender</Button>}
            </Seccion>
          ))}
        </div>
      )}
      {abrir && <Responder m={abrir} onClose={() => setAbrir(null)} onListo={() => { setAbrir(null); recargar(); }} />}
    </div>
  );
}

function Responder({ m, onClose, onListo }: { m: Mensaje; onClose: () => void; onListo: () => void }) {
  const captura = m.kind === "CAPTURE";
  const [d, setD] = useState({ status: captura ? "CONFIRMED" : "READ", reply: "", confirmed_amount: captura && m.amount != null ? String(m.amount) : "" });
  const [ocupado, setOcupado] = useState(false);
  const distinto = captura && d.status === "CONFIRMED" && d.confirmed_amount !== "" && Math.abs(Number(d.confirmed_amount) - Number(m.amount ?? 0)) > 0.004;
  const falta = (d.status === "REJECTED" && !d.reply.trim()) || (captura && d.status === "CONFIRMED" && (d.confirmed_amount === "" || (distinto && !d.reply.trim())));
  const opciones = captura
    ? [{ value: "CONFIRMED", label: "Confirmar: el pago llegó" }, { value: "REJECTED", label: "Rechazar" }, { value: "READ", label: "Solo marcar leído" }]
    : [{ value: "READ", label: "Leído" }, { value: "REJECTED", label: "Rechazar" }];
  return (
    <Modal open onClose={onClose} title="Atender mensaje" size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={falta} onClick={async () => {
          setOcupado(true);
          try {
            await api(`/v1/del/mensajes/${m.id}/responder`, { method: "POST", body: { status: d.status, reply: d.reply || null,
              confirmed_amount: captura && d.status === "CONFIRMED" ? Number(d.confirmed_amount) : null } });
            toast.ok("Mensaje atendido."); onListo();
          } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Guardar</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Respuesta"><Select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })} options={opciones} /></Field>
        {captura && d.status === "CONFIRMED" && (
          <Field label="Monto que ves recibido (S/)" required hint={`La captura dice ${soles(m.amount)}`}>
            <Input type="number" inputMode="decimal" min={0} step="0.1" value={d.confirmed_amount} onChange={(e) => setD({ ...d, confirmed_amount: e.target.value })} />
          </Field>
        )}
        <Field label={distinto ? "Motivo de la diferencia" : "Respuesta al repartidor"} required={d.status === "REJECTED" || distinto}>
          <Textarea rows={2} value={d.reply} onChange={(e) => setD({ ...d, reply: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
