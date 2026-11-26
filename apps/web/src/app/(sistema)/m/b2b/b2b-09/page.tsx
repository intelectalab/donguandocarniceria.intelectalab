"use client";

import { useState } from "react";
import { BellRing, CalendarCheck, HandCoins, Plus, X } from "lucide-react";
import { Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Tabs, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { Cifras, CifraLink, FiltroSelect, Sub, accion, num, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { ESTADO_PROMESA, ESTADO_RECORDATORIO, type Opciones } from "@/modulos/b2b/tipos";

type Rec = { id: string; customer_name: string; full_number: string; reminder_type: string; channel: string; scheduled_for: string; sent_at: string | null; status: string; due_date: string; balance: string };
type Prom = { id: string; customer_name: string; full_number: string | null; promised_date: string; amount: string; status: string; notes: string | null; recorded_name: string; balance: string | null };
type Doc = { document_id: string; full_number: string; customer_id: string; customer_name: string; balance: string; due_date: string };
type Resp = { reminders: Rec[]; promises: Prom[]; types: Record<string, string>; open_documents: Doc[] };

/** B2B-09 Recordatorios y promesas: avisos de cobranza por WhatsApp antes y después del vencimiento, y promesas de pago con su seguimiento. */
export default function Cobranza() {
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [tab, setTab] = useState<"rec" | "prom">("rec");
  const [estado, setEstado] = useState("");
  const [cliente, setCliente] = useState("");
  const r = useDatos<Resp>(`/v1/b2b/cobranza${qs({ status: estado, customer_id: cliente })}`);
  const [nueva, setNueva] = useState(false);
  const gestiona = Boolean(op?.can["b2b.collection.manage"]);
  const d = r.datos;
  const pendientes = (d?.reminders ?? []).filter((x) => x.status === "SCHEDULED" && x.scheduled_for <= (op?.today ?? "")).length;

  async function enviar() {
    try { const x = await api<{ sent: number; cancelled: number; failed: number }>("/v1/b2b/cobranza/enviar", { method: "POST" });
      toast.ok(`Enviados ${x.sent}${x.cancelled ? ` · ${x.cancelled} cancelados porque ya pagaron` : ""}${x.failed ? ` · ${x.failed} fallaron` : ""}`); r.recargar(); }
    catch (e) { toast.error(mensajeDe(e)); }
  }
  async function evaluar() {
    try { const x = await api<{ updated: number }>("/v1/b2b/cobranza/evaluar", { method: "POST" }); toast.ok(`${x.updated} promesas revisadas`); r.recargar(); } catch (e) { toast.error(mensajeDe(e)); }
  }

  const recCols: Column<Rec>[] = [
    { key: "scheduled_for", header: "Fecha", render: (x) => <div>{fecha(x.scheduled_for)}{x.sent_at && <Sub>enviado {fechaHora(x.sent_at)}</Sub>}</div> },
    { key: "customer_name", header: "Cliente", cardTitle: true, render: (x) => <div>{x.customer_name}<Sub>{x.full_number} · vence {fecha(x.due_date)}</Sub></div> },
    { key: "reminder_type", header: "Aviso", render: (x) => d?.types[x.reminder_type] ?? x.reminder_type },
    { key: "balance", header: "Saldo", align: "right", render: (x) => soles(x.balance) },
    { key: "status", header: "Estado", render: (x) => <StatusBadge status={x.status} labels={ESTADO_RECORDATORIO} /> },
  ];
  const promCols: Column<Prom>[] = [
    { key: "promised_date", header: "Paga el", render: (x) => fecha(x.promised_date) },
    { key: "customer_name", header: "Cliente", cardTitle: true, render: (x) => <div>{x.customer_name}<Sub>{x.full_number ?? "Saldo general"}{x.notes ? ` · ${x.notes}` : ""}</Sub></div> },
    { key: "amount", header: "Monto", align: "right", render: (x) => <div>{soles(x.amount)}{x.balance && <Sub>saldo {soles(x.balance)}</Sub>}</div> },
    { key: "recorded_name", header: "Registró", hideOnMobile: true, render: (x) => x.recorded_name },
    { key: "status", header: "Estado", render: (x) => <StatusBadge status={x.status} labels={ESTADO_PROMESA} /> },
    { key: "acc", header: "", render: (x) => gestiona && x.status === "OPEN" ? <Button size="sm" variant="ghost" icon={X} onClick={() => accion({ title: "¿Cancelar la promesa?", confirmLabel: "Cancelar promesa", danger: true },
      () => api(`/v1/b2b/promesas/${x.id}/cancelar`, { method: "POST" }), "Promesa cancelada", r.recargar)}>Cancelar</Button> : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`El cliente recibe un WhatsApp ${op?.params.reminder_days_before ?? 3} días antes del vencimiento, el día que vence y a los 3 y 7 días de atraso. Si ya pagó, el aviso se cancela solo.`}
        actions={gestiona && <>
          <Button icon={BellRing} onClick={enviar}>Enviar avisos de hoy{pendientes ? ` (${pendientes})` : ""}</Button>
          <Button icon={CalendarCheck} onClick={evaluar}>Revisar promesas</Button>
          <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Promesa de pago</Button>
        </>} />
      <Cifras>
        <CifraLink destacada titulo="Avisos enviados" valor={d ? String(d.reminders.filter((x) => x.status === "SENT").length) : undefined} detalle="En la lista" icono={BellRing} />
        <CifraLink titulo="Por enviar hoy" valor={d ? String(pendientes) : undefined} detalle="Programados hasta hoy" tono={pendientes ? "warn" : "ok"} />
        <CifraLink titulo="Promesas abiertas" valor={d ? soles(d.promises.filter((x) => x.status === "OPEN").reduce((a, x) => a + Number(x.amount), 0)) : undefined} detalle={d ? `${d.promises.filter((x) => x.status === "OPEN").length} por cumplir` : undefined} icono={HandCoins} />
        <CifraLink titulo="Promesas incumplidas" valor={d ? String(d.promises.filter((x) => x.status === "BROKEN").length) : undefined} detalle="Pasó la fecha sin el pago" tono={d?.promises.some((x) => x.status === "BROKEN") ? "bad" : "ok"} />
      </Cifras>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "rec", label: "Recordatorios", count: d?.reminders.length }, { key: "prom", label: "Promesas de pago", count: d?.promises.length }]} />
      {tab === "rec" ? <DataTable columns={recCols} rows={d?.reminders ?? []} loading={r.cargando} error={r.error} empty="Sin recordatorios."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_RECORDATORIO)} />
          <FiltroSelect label="Cliente" value={cliente} onChange={setCliente} ancho="sm:w-[240px]" options={(op?.customers ?? []).filter((c) => c.has_credit).map((c) => ({ value: c.id, label: c.full_name }))} />
        </>} />
        : <DataTable columns={promCols} rows={d?.promises ?? []} loading={r.cargando} error={r.error} empty="Sin promesas de pago." />}
      {nueva && d && <Promesa docs={d.open_documents} hoy={op?.today ?? ""} onClose={() => setNueva(false)} onHecho={() => { setNueva(false); r.recargar(); }} />}
    </div>
  );
}

function Promesa({ docs, hoy, onClose, onHecho }: { docs: Doc[]; hoy: string; onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ document_id: "", promised_date: hoy, amount: "", notes: "" });
  const doc = docs.find((x) => x.document_id === f.document_id);
  return (
    <Dialogo titulo="Promesa de pago" boton="Registrar" onClose={onClose} aviso="Si llega la fecha sin el pago, la promesa queda incumplida y se avisa a la vendedora."
      enviar={async () => {
        await api("/v1/b2b/promesas", { method: "POST", body: { document_id: f.document_id || null, customer_id: doc?.customer_id, promised_date: f.promised_date, amount: num(f.amount), notes: f.notes || null } });
        toast.ok("Promesa registrada"); onHecho();
      }}>
      {(e) => <>
        <Field label="Comprobante" required error={e.document_id} className="sm:col-span-2">
          <Select value={f.document_id} onChange={(x) => { const d = docs.find((y) => y.document_id === x.target.value); setF({ ...f, document_id: x.target.value, amount: d ? String(Number(d.balance)) : f.amount }); }}
            placeholder="Elige el comprobante" options={docs.map((x) => ({ value: x.document_id, label: `${x.customer_name} · ${x.full_number} · ${soles(x.balance)} · vence ${fecha(x.due_date)}` }))} />
        </Field>
        <Field label="Paga el" required error={e.promised_date}><Input type="date" value={f.promised_date} onChange={(x) => setF({ ...f, promised_date: x.target.value })} /></Field>
        <Field label="Monto" required error={e.amount}><Input inputMode="decimal" prefix="S/" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} /></Field>
        <Field label="Nota" error={e.notes} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} placeholder="Pagan los martes por transferencia" /></Field>
      </>}
    </Dialogo>
  );
}
