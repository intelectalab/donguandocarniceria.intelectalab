"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, IconButton, Input, Modal, Select, StatusBadge, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { ASIENTO, accion, nombreMes, opcionesCuenta, texto, useDatos, type Num, type OpcionesCnt } from "./comunes";

export type FilaAsiento = {
  id: string; number: string | null; period: string; entry_date: string; source_type: string; source_label: string | null; rule_code: string | null; description: string; status: string;
  total_debit: Num; total_credit: Num; blocked: boolean; auto_approved: boolean; prepared_by_name: string | null; approved_by_name: string | null; brand_name: string | null;
  establishment_name: string | null; source_name: string; reversal_of: string | null; reversed_by_id: string | null;
};
type LineaAsiento = {
  id: string; seq: number; account_code: string | null; account_name: string | null; description: string | null; debit: Num; credit: Num; cost_center_id: string | null;
  cost_center_code: string | null; brand_id: string | null; brand_name: string | null; third_party_name: string | null; third_party_doc: string | null; is_destination: boolean;
};
type Asiento = FilaAsiento & {
  currency: string; prepared_at: string | null; approved_at: string | null; blocked_reasons: string[]; void_reason: string | null; reverse_reason: string | null;
  reversed_by_number: string | null; reversal_of_number: string | null; history: { at: string; user: string; action: string }[]; lines: LineaAsiento[];
  can: { approve: boolean; reverse: boolean; edit: boolean; void: boolean }; inbox: { id: string; reason: string; status: string }[];
};

/** Detalle de un asiento con sus líneas, historia y acciones (enviar, aprobar, anular, reversar). */
export function FichaAsiento({ id, op, onClose, onCambio }: { id: string; op: OpcionesCnt | null; onClose: () => void; onCambio?: () => void }) {
  const { datos: a, recargar, error } = useDatos<Asiento>(`/v1/cnt/asientos/${id}`);
  const [linea, setLinea] = useState<LineaAsiento | null>(null);
  const listo = () => { recargar(); onCambio?.(); };
  if (!a) return <Modal open onClose={onClose} title="Asiento" size="xl">{error ? <Alert tone="bad">{error}</Alert> : <p className="text-muted">Cargando…</p>}</Modal>;
  const cuadra = Math.abs(Number(a.total_debit) - Number(a.total_credit)) < 0.005;
  const destino = a.lines.some((l) => l.is_destination);
  return (
    <Modal open onClose={onClose} size="xl" title={a.number ? `Asiento ${a.number}` : "Asiento sin número"} description={`${a.source_name} · ${fecha(a.entry_date)} · ${nombreMes(a.period)}`}
      footer={<>
        {a.can.void && <Button onClick={() => accion({ title: "¿Anular el asiento?", danger: true, confirmLabel: "Anular", reason: { min: 5, label: "Motivo" } },
          (m) => api(`/v1/cnt/asientos/${a.id}/anular`, { method: "POST", body: { reason: m } }), "Asiento anulado", listo)}>Anular</Button>}
        {a.can.reverse && <Button onClick={() => accion({ title: "¿Reversar el asiento?", message: "Se crea un asiento espejo en el período abierto; el original queda como está.", confirmLabel: "Reversar", reason: { min: 5, label: "Motivo" } },
          (m) => api(`/v1/cnt/asientos/${a.id}/reversar`, { method: "POST", body: { reason: m } }), "Reversa creada", listo)}>Reversar</Button>}
        {a.status === "DRAFT" && a.can.edit && <Button variant="primary" onClick={async () => {
          try { await api(`/v1/cnt/asientos/${a.id}/enviar`, { method: "POST" }); toast.ok("Enviado a aprobación"); listo(); } catch (e) { toast.error(mensajeDe(e)); }
        }}>Enviar a aprobación</Button>}
        {a.can.approve && <Button variant="primary" onClick={async () => {
          try { await api(`/v1/cnt/asientos/${a.id}/aprobar`, { method: "POST" }); toast.ok("Asiento aprobado"); listo(); } catch (e) { toast.error(mensajeDe(e)); }
        }}>Aprobar</Button>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={a.status} labels={ASIENTO} />
          {a.auto_approved && <Badge tone="primary">Aprobado por regla</Badge>}
          {a.reversed_by_id && <Badge tone="bad">Reversado{a.reversed_by_number ? ` por ${a.reversed_by_number}` : ""}</Badge>}
          {a.reversal_of && <Badge tone="info">Reversa de {a.reversal_of_number ?? "otro asiento"}</Badge>}
          {!cuadra && <Badge tone="bad">No cuadra</Badge>}
          {a.inbox.length > 0 && <Badge tone="warn">En la bandeja de la contadora</Badge>}
        </div>
        {a.blocked && <Alert tone="warn" title="Bloqueado">{a.blocked_reasons.map(texto).join(" · ") || "Falta información para aprobarlo."}</Alert>}
        {a.void_reason && <Alert tone="bad" title="Anulado">{texto(a.void_reason)}</Alert>}
        <DetailList items={[
          { label: "Glosa", value: texto(a.description) },
          { label: "Documento", value: texto(a.source_label) || "—" },
          { label: "Marca y local", value: [a.brand_name, a.establishment_name].filter(Boolean).join(" · ") || "—" },
          { label: "Preparó", value: a.prepared_by_name ?? "Sistema" },
          { label: "Aprobó", value: a.approved_by_name ? `${a.approved_by_name} · ${fechaHora(a.approved_at)}` : a.auto_approved ? "Regla de aprobación automática" : "—" },
          { label: "Total", value: `${soles(a.total_debit)} al debe · ${soles(a.total_credit)} al haber` },
        ]} />
        <DataTable rows={a.lines} rowKey={(l) => l.id} empty="Sin líneas." columns={[
          { key: "account_code", header: "Cuenta", cardTitle: true, render: (l) => <div className="min-w-[200px]"><p><span className="tabular-nums">{l.account_code ?? <span className="text-bad">Falta</span>}</span> {l.account_name}</p>
            {l.description && <p className="text-[12px] text-muted">{texto(l.description)}</p>}</div> },
          { key: "detalle", header: "Centro, marca y tercero", hideOnMobile: true, render: (l) => <span className="text-[12.5px] text-muted">{[l.cost_center_code, l.brand_name, l.third_party_name].filter(Boolean).join(" · ") || "—"}</span> },
          { key: "debit", header: "Debe", align: "right", render: (l) => Number(l.debit) ? soles(l.debit) : "" },
          { key: "credit", header: "Haber", align: "right", render: (l) => Number(l.credit) ? soles(l.credit) : "" },
          ...(a.can.edit ? [{ key: "editar", header: "", render: (l: LineaAsiento) => <IconButton icon={Pencil} label="Corregir línea" onClick={() => setLinea(l)} /> }] : []),
        ]} />
        {destino && <p className="text-[12.5px] text-muted">Incluye las líneas de destino (clase 9 contra 79).</p>}
        {a.history?.length > 0 && <div>
          <h3 className="mb-2 text-[13px] font-semibold">Historia</h3>
          <ol className="space-y-1.5 text-[12.5px]">{a.history.map((h, i) => <li key={i}><span className="text-muted">{fechaHora(h.at)} · {h.user}</span> — {texto(h.action)}</li>)}</ol>
        </div>}
      </div>
      {linea && <CorregirLinea linea={linea} op={op} onClose={() => setLinea(null)} onListo={() => { setLinea(null); listo(); }} />}
    </Modal>
  );
}

function CorregirLinea({ linea, op, onClose, onListo }: { linea: LineaAsiento; op: OpcionesCnt | null; onClose: () => void; onListo: () => void }) {
  const [f, setF] = useState({ account_code: linea.account_code ?? "", cost_center_id: linea.cost_center_id ?? "", brand_id: linea.brand_id ?? "", debit: String(Number(linea.debit) || ""), credit: String(Number(linea.credit) || "") });
  const guardar = async () => {
    try {
      await api(`/v1/cnt/lineas/${linea.id}`, { method: "PATCH", body: { account_code: f.account_code, cost_center_id: f.cost_center_id || null, brand_id: f.brand_id || null, debit: Number(f.debit || 0), credit: Number(f.credit || 0) } });
      toast.ok("Línea corregida"); onListo();
    } catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Línea ${linea.seq}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cuenta" className="sm:col-span-2"><Select value={f.account_code} placeholder="Elegir" onChange={(e) => setF({ ...f, account_code: e.target.value })} options={opcionesCuenta(op)} /></Field>
        <Field label="Centro de costo"><Select value={f.cost_center_id} placeholder="Ninguno" onChange={(e) => setF({ ...f, cost_center_id: e.target.value })} options={(op?.cost_centers ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>
        <Field label="Marca"><Select value={f.brand_id} placeholder="Ninguna" onChange={(e) => setF({ ...f, brand_id: e.target.value })} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} /></Field>
        <Field label="Debe"><Input inputMode="decimal" prefix="S/" value={f.debit} onChange={(e) => setF({ ...f, debit: e.target.value })} /></Field>
        <Field label="Haber"><Input inputMode="decimal" prefix="S/" value={f.credit} onChange={(e) => setF({ ...f, credit: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
