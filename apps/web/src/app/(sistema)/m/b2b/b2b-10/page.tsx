"use client";

import { useState } from "react";
import { MessageSquareReply } from "lucide-react";
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { Cifras, CifraLink, FiltroSelect, Panel, Sub, num, opciones, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { DetalleReclamo } from "@/modulos/b2b/Reclamos";
import { ESTADO_RECLAMO, RESOLUCION, TIPO_RECLAMO, type Opciones, type Reclamo } from "@/modulos/b2b/tipos";

/** B2B-10 Reclamos B2B: calidad, peso, atraso o facturación, con plazo de respuesta y resolución con nota de crédito o reposición. */
export default function Reclamos() {
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [cliente, setCliente] = useState("");
  const r = useDatos<{ data: Reclamo[] }>(`/v1/b2b/reclamos${qs({ status: estado, claim_type: tipo, customer_id: cliente })}`);
  const [ver, setVer] = useState<Reclamo | null>(null);
  const filas = r.datos?.data ?? [];
  const abiertos = filas.filter((c) => ["OPEN", "IN_REVIEW"].includes(c.status));

  const columnas: Column<Reclamo>[] = [
    { key: "number", header: "Reclamo", cardTitle: true, render: (c) => <div><p className="font-mono font-semibold">{c.number}</p><Sub>{c.customer_name}</Sub></div> },
    { key: "claim_type", header: "Tipo", render: (c) => c.type_label },
    { key: "description", header: "Detalle", render: (c) => <span className="line-clamp-2 max-w-[280px]">{c.description}</span> },
    { key: "opened_at", header: "Abierto", render: (c) => <div>{fechaHora(c.opened_at)}<Sub>{c.order_number ?? ""}{c.document_number ? ` · ${c.document_number}` : ""}</Sub></div> },
    { key: "due_at", header: "Responder hasta", render: (c) => ["OPEN", "IN_REVIEW"].includes(c.status) ? <Badge tone={c.late ? "bad" : "info"}>{fechaHora(c.due_at)}</Badge> : "—" },
    { key: "status", header: "Estado", render: (c) => <div><StatusBadge status={c.status} labels={ESTADO_RECLAMO} />{c.resolution && <Sub>{RESOLUCION[c.resolution]}{c.credit_amount ? ` ${soles(c.credit_amount)}` : ""}</Sub>}</div> },
    { key: "assigned_name", header: "Atiende", hideOnMobile: true, render: (c) => c.assigned_name ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`El cliente reclama desde el portal. Calidad y peso llegan con foto. Se responde en ${op?.params.claim_hours ?? 48} horas; un abono se resuelve con su nota de crédito.`} />
      <Cifras cols={3}>
        <CifraLink destacada titulo="Abiertos" valor={r.datos ? String(abiertos.length) : undefined} detalle="Por responder o resolver" />
        <CifraLink titulo="Fuera de plazo" valor={r.datos ? String(abiertos.filter((c) => c.late).length) : undefined} detalle={`Más de ${op?.params.claim_hours ?? 48} horas sin respuesta`} tono={abiertos.some((c) => c.late) ? "bad" : "ok"} />
        <CifraLink titulo="Abonado" valor={r.datos ? soles(filas.reduce((a, c) => a + Number(c.credit_amount ?? 0), 0)) : undefined} detalle="En notas de crédito" />
      </Cifras>
      <DataTable columns={columnas} rows={filas} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay reclamos." onRowClick={setVer}
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_RECLAMO)} />
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opciones(TIPO_RECLAMO)} />
          <FiltroSelect label="Cliente" value={cliente} onChange={setCliente} ancho="sm:w-[240px]" options={(op?.customers ?? []).filter((c) => c.customer_type !== "PERSON").map((c) => ({ value: c.id, label: c.full_name }))} />
        </>} />
      {ver && <Atender c={ver} puede={Boolean(op?.can["b2b.claim.resolve"])} onClose={() => setVer(null)} onHecho={() => { setVer(null); r.recargar(); }} />}
    </div>
  );
}

function Atender({ c, puede, onClose, onHecho }: { c: Reclamo; puede: boolean; onClose: () => void; onHecho: () => void }) {
  const [resp, setResp] = useState(c.response ?? "");
  const [f, setF] = useState({ resolution: "CREDIT_NOTE", amount: "", credit_note_number: "", note: "" });
  const [enviando, setEnviando] = useState(false);
  const abierto = ["OPEN", "IN_REVIEW"].includes(c.status);
  async function hacer(url: string, body: object, ok: string) {
    setEnviando(true);
    try { await api(url, { method: "POST", body }); toast.ok(ok); onHecho(); } catch (e) { toast.error(mensajeDe(e)); } finally { setEnviando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={`Reclamo ${c.number}`} description={c.customer_name}>
      <div className="space-y-4">
        <DetalleReclamo c={c} base="/v1/b2b/reclamos" />
        {abierto && puede && <>
          <Panel titulo="Responder al cliente">
            <Textarea rows={3} value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Revisamos el lote y…" />
            <div className="mt-2 flex justify-end"><Button icon={MessageSquareReply} loading={enviando} disabled={resp.trim().length < 5} onClick={() => hacer(`/v1/b2b/reclamos/${c.id}/responder`, { response: resp }, "Respuesta enviada")}>Responder</Button></div>
          </Panel>
          <Panel titulo="Resolver">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Resolución"><Select value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} options={opciones(RESOLUCION)} /></Field>
              {f.resolution === "CREDIT_NOTE" && <>
                <Field label="Monto del abono"><Input inputMode="decimal" prefix="S/" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
                <Field label="Nota de crédito emitida" hint="Serie y número, por ejemplo FC01-00000012."><Input value={f.credit_note_number} onChange={(e) => setF({ ...f, credit_note_number: e.target.value })} /></Field>
              </>}
              <Field label="Nota" className="sm:col-span-2"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" loading={enviando} onClick={() => hacer(`/v1/b2b/reclamos/${c.id}/resolver`, { reject: true, note: f.note }, "Reclamo rechazado")}>Rechazar reclamo</Button>
              <Button variant="primary" loading={enviando} onClick={() => hacer(`/v1/b2b/reclamos/${c.id}/resolver`, { ...f, amount: num(f.amount), credit_note_number: f.credit_note_number.trim().toUpperCase() || null }, "Reclamo resuelto")}>Resolver</Button>
            </div>
          </Panel>
        </>}
      </div>
    </Modal>
  );
}
