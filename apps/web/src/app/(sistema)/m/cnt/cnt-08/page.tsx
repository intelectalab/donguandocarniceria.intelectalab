"use client";

import { useState } from "react";
import { BadgeCheck, FileCog, Hourglass, XCircle } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { ACCION_SIRE, CifraLink, ENVIO_SIRE, FiltroSelect, REGISTRO, Seccion, nombreMes, opciones, qs, useDatos, useOpcionesCnt } from "@/modulos/cnt/comunes";

type Envio = {
  id: string; register: string; period: string; action: string; file_name: string | null; file_hash: string | null; line_count: number; adjustments: number; generated_at: string | null;
  status: string; ticket: string | null; receipt_number: string | null; submitted_at: string | null; accepted_at: string | null; prepared_by_name: string | null; submitted_by_name: string | null;
};
type Respuesta = { data: Envio[]; ready: { register: string; period: string; proposal_id: string; unresolved: number }[] };
type Cifras = { prepared: number; submitted: number; accepted: number; rejected: number };

/** CNT-08 Envíos SIRE: por período y registro, la acción, el archivo generado, el ticket, la constancia y el estado. */
export default function EnviosSire() {
  const op = useOpcionesCnt();
  const [registro, setRegistro] = useState("");
  const [estado, setEstado] = useState("");
  const { datos: r, recargar } = useDatos<Respuesta>(`/v1/cnt/sire/envios${qs({ register: registro, status: estado })}`);
  const c = useDatos<Cifras>("/v1/cnt/cifras/08");
  const [preparar, setPreparar] = useState<Respuesta["ready"][number] | null>(null);
  const [paso, setPaso] = useState<{ envio: Envio; tipo: "ticket" | "resultado" } | null>(null);
  const listo = () => { recargar(); c.recargar(); };
  const columnas: Column<Envio>[] = [
    { key: "period", header: "Período", cardTitle: true, render: (e) => <div className="min-w-[180px]"><p className="font-medium">{REGISTRO[e.register] ?? e.register}</p><p className="text-[12px] text-muted">{nombreMes(e.period)}</p></div> },
    { key: "action", header: "Acción", render: (e) => ACCION_SIRE[e.action] ?? e.action },
    { key: "file_name", header: "Archivo", hideOnMobile: true, render: (e) => <span className="text-[12.5px]">{e.file_name ?? "—"}<span className="block text-muted">{numero(e.line_count)} comprobantes{e.adjustments ? ` · ${e.adjustments} ajustes` : ""}</span></span> },
    { key: "ticket", header: "Ticket y constancia", render: (e) => <span className="text-[12.5px]">{e.ticket ?? "—"}{e.receipt_number && <span className="block text-muted">{e.receipt_number}</span>}</span> },
    { key: "generated_at", header: "Fechas", hideOnMobile: true, render: (e) => <span className="text-[12.5px] text-muted">Preparado {fechaHora(e.generated_at)}{e.submitted_at && <span className="block">Presentado {fechaHora(e.submitted_at)}</span>}</span> },
    { key: "status", header: "Estado", render: (e) => <StatusBadge status={e.status} labels={ENVIO_SIRE} /> },
    { key: "paso", header: "", render: (e) => e.status === "PREPARED" && op?.can.submit ? <Button size="sm" onClick={(x) => { x.stopPropagation(); setPaso({ envio: e, tipo: "ticket" }); }}>Marcar presentado</Button>
      : e.status === "SUBMITTED" && op?.can.submit ? <Button size="sm" onClick={(x) => { x.stopPropagation(); setPaso({ envio: e, tipo: "resultado" }); }}>Registrar respuesta</Button> : null },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="La respuesta a cada propuesta SIRE: se prepara aquí cuando ya no quedan diferencias sin resolver, se presenta en el portal de SUNAT y se registra el ticket y la constancia." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Preparados" valor={c.datos ? numero(c.datos.prepared) : undefined} icono={FileCog} onClick={() => setEstado("PREPARED")} />
        <CifraLink titulo="Presentados sin respuesta" valor={c.datos ? numero(c.datos.submitted) : undefined} icono={Hourglass} tono={c.datos?.submitted ? "warn" : undefined} onClick={() => setEstado("SUBMITTED")} />
        <CifraLink destacada titulo="Aceptados" valor={c.datos ? numero(c.datos.accepted) : undefined} icono={BadgeCheck} onClick={() => setEstado("ACCEPTED")} />
        <CifraLink titulo="Rechazados" valor={c.datos ? numero(c.datos.rejected) : undefined} icono={XCircle} tono={c.datos?.rejected ? "bad" : undefined} onClick={() => setEstado("REJECTED")} />
      </div>
      {r && r.ready.length > 0 && <Seccion titulo="Propuestas listas para responder">
        <ul className="divide-y divide-line">{r.ready.map((x) => (
          <li key={x.proposal_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
            <span>{REGISTRO[x.register]} · {nombreMes(x.period)}{x.unresolved > 0 && <span className="ml-2 text-warn">{x.unresolved} diferencias sin resolver</span>}</span>
            {op?.can.sire && <Button size="sm" variant="primary" disabled={x.unresolved > 0} onClick={() => setPreparar(x)}>Preparar envío</Button>}
          </li>))}</ul>
      </Seccion>}
      <DataTable rows={r?.data ?? []} rowKey={(e) => e.id} loading={!r} columns={columnas} empty="No hay envíos con esos filtros."
        toolbar={<>
          <FiltroSelect label="Registro" value={registro} onChange={setRegistro} options={opciones(REGISTRO)} ancho="sm:w-[200px]" />
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opciones(Object.fromEntries(Object.entries(ENVIO_SIRE).map(([k, v]) => [k, v[0]])))} />
        </>} />
      {preparar && <Preparar listo={preparar} onClose={() => setPreparar(null)} onListo={() => { setPreparar(null); listo(); }} />}
      {paso && <Paso envio={paso.envio} tipo={paso.tipo} onClose={() => setPaso(null)} onListo={() => { setPaso(null); listo(); }} />}
    </div>
  );
}

function Preparar({ listo, onClose, onListo }: { listo: Respuesta["ready"][number]; onClose: () => void; onListo: () => void }) {
  const [accion, setAccion] = useState("");
  const enviar = async () => {
    try { await api("/v1/cnt/sire/envios", { method: "POST", body: { register: listo.register, period: listo.period, action: accion || null } }); toast.ok("Archivo de respuesta preparado"); onListo(); }
    catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Preparar envío" description={`${REGISTRO[listo.register]} · ${nombreMes(listo.period)}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={enviar}>Preparar</Button></>}>
      <div className="space-y-3">
        <Alert tone="info">Si no hubo diferencias se acepta la propuesta tal cual; si se resolvieron diferencias el envío es de ajuste o de reemplazo.</Alert>
        <Field label="Acción"><Select value={accion} placeholder="La que corresponda" onChange={(e) => setAccion(e.target.value)} options={opciones(ACCION_SIRE)} /></Field>
      </div>
    </Modal>
  );
}

function Paso({ envio, tipo, onClose, onListo }: { envio: Envio; tipo: "ticket" | "resultado"; onClose: () => void; onListo: () => void }) {
  const [valor, setValor] = useState("");
  const [aceptado, setAceptado] = useState("1");
  const enviar = async () => {
    try {
      if (tipo === "ticket") await api(`/v1/cnt/sire/envios/${envio.id}/enviado`, { method: "POST", body: { ticket: valor } });
      else await api(`/v1/cnt/sire/envios/${envio.id}/resultado`, { method: "POST", body: { accepted: aceptado === "1", reference: valor } });
      toast.ok(tipo === "ticket" ? "Envío marcado como presentado" : "Respuesta de SUNAT registrada"); onListo();
    } catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title={tipo === "ticket" ? "Marcar presentado" : "Respuesta de SUNAT"} description={`${REGISTRO[envio.register]} · ${nombreMes(envio.period)}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valor.trim()} onClick={enviar}>Guardar</Button></>}>
      <div className="grid gap-4">
        {tipo === "resultado" && <Field label="Resultado"><Select value={aceptado} onChange={(e) => setAceptado(e.target.value)} options={[{ value: "1", label: "Aceptado" }, { value: "0", label: "Rechazado" }]} /></Field>}
        <Field label={tipo === "ticket" ? "Número de ticket" : aceptado === "1" ? "Número de constancia" : "Motivo del rechazo"}><Input value={valor} maxLength={80} onChange={(e) => setValor(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
