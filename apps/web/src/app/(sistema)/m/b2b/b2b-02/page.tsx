"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Lock, LockOpen, Pencil, Tags, Users } from "lucide-react";
import { Alert, Button, Checkbox, DataTable, DetailList, Field, Input, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { Cifras, CifraLink, DiasMora, Panel, Sub, accion, num, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { ESTADO_CREDITO, ESTADO_EXCEPCION, TIPO_CLIENTE, TIPO_EXCEPCION, type Opciones, type Resumen } from "@/modulos/b2b/tipos";

type Perfil = { credit_limit: string; term_days: number; grace_days: number; block_on_overdue: boolean; review_on: string | null; seller_user_id: string | null; seller_name: string | null;
  status: string; auto_blocked: boolean; blocked_reason: string | null; blocked_at: string | null; history: { at: string; user: string; field: string; before: unknown; after: unknown; reason: string | null }[] };
type Doc = { document_id: string; full_number: string; doc_type: string; issue_date: string; due_date: string; total: string; balance: string; days_overdue: number };
type Exc = { id: string; order_number: string; kind: string; order_amount: string; exceeded_amount: string; reason: string; state: string; requested_at: string };
type Ficha = { customer: { id: string; full_name: string; trade_name: string | null; doc_type: string; doc_number: string; customer_type: string; phone: string | null; email: string | null };
  profile: Perfil | null; summary: Resumen; promises: { kept: number; broken: number; open: number }; eligible: boolean; open_documents: Doc[]; exceptions: Exc[]; portal_users: number };

const CAMPO: Record<string, string> = { credit_limit: "Límite", term_days: "Plazo", grace_days: "Gracia", block_on_overdue: "Bloqueo por mora", status: "Estado", seller_user_id: "Vendedora", review_on: "Revisión" };

/** B2B-02 Ficha de crédito: límite, plazo, gracia, saldo, documentos abiertos, historial de cambios y bloqueo. */
export default function FichaCredito() {
  const router = useRouter();
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [id, setId] = useState<string | null>(null);
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const r = useDatos<Ficha>(id ? `/v1/b2b/clientes/${id}` : null);
  const [editar, setEditar] = useState(false);
  const d = r.datos;
  if (id === null) return null;
  if (!id) return <Alert tone="warn">Elige un cliente en <Link className="underline" href="/m/b2b/b2b-01">Clientes empresariales</Link>.</Alert>;
  if (r.error) return <Alert tone="bad">{r.error}</Alert>;
  if (!d) return <p className="text-sm text-muted">Cargando…</p>;
  const gestiona = Boolean(op?.can["b2b.credit.manage"]);
  const s = d.summary;
  const p = d.profile;

  const docCols: Column<Doc>[] = [
    { key: "full_number", header: "Comprobante", cardTitle: true, render: (x) => <span className="font-mono">{x.full_number}</span> },
    { key: "issue_date", header: "Emitido", render: (x) => fecha(x.issue_date) },
    { key: "due_date", header: "Vence", render: (x) => fecha(x.due_date) },
    { key: "total", header: "Total", align: "right", render: (x) => soles(x.total) },
    { key: "balance", header: "Saldo", align: "right", render: (x) => soles(x.balance) },
    { key: "days_overdue", header: "Mora", render: (x) => <DiasMora d={x.days_overdue} /> },
  ];
  const excCols: Column<Exc>[] = [
    { key: "order_number", header: "Pedido", cardTitle: true, render: (x) => <span className="font-mono">{x.order_number}</span> },
    { key: "kind", header: "Motivo", render: (x) => <div>{TIPO_EXCEPCION[x.kind] ?? x.kind}<Sub>{x.reason}</Sub></div> },
    { key: "order_amount", header: "Pedido", align: "right", render: (x) => soles(x.order_amount) },
    { key: "state", header: "Estado", render: (x) => <StatusBadge status={x.state} labels={ESTADO_EXCEPCION} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader code={`${d.customer.trade_name ?? d.customer.full_name} · ${d.customer.doc_type} ${d.customer.doc_number}`}
        description={`${d.customer.full_name} · ${TIPO_CLIENTE[d.customer.customer_type] ?? d.customer.customer_type}${p?.seller_name ? ` · vendedora ${p.seller_name}` : ""}`}
        actions={<>
          <StatusBadge status={p ? s.status : "NONE"} labels={ESTADO_CREDITO} />
          {gestiona && d.eligible && <Button icon={Pencil} disabled={!op} onClick={() => setEditar(true)}>{p ? "Editar crédito" : "Dar crédito"}</Button>}
          {gestiona && p && s.status !== "BLOCKED" && <Button variant="danger" icon={Lock} onClick={() => accion({ title: "¿Bloquear el crédito?", message: "Los pedidos a crédito del cliente quedarán retenidos.", confirmLabel: "Bloquear", danger: true, reason: { min: 5 } },
            (m) => api(`/v1/b2b/clientes/${id}/bloqueo`, { method: "POST", body: { reason: m } }), "Crédito bloqueado", r.recargar)}>Bloquear</Button>}
          {gestiona && p && s.status === "BLOCKED" && <Button icon={LockOpen} onClick={() => accion({ title: "¿Desbloquear el crédito?", confirmLabel: "Desbloquear", reason: { min: 5 } },
            (m) => api(`/v1/b2b/clientes/${id}/bloqueo`, { method: "POST", body: { reason: m, unblock: true } }), "Crédito desbloqueado", r.recargar)}>Desbloquear</Button>}
        </>} />
      {!d.eligible && <Alert tone="info">Solo un cliente con RUC válido y de tipo empresa, restaurante o punto de consignación puede tener crédito.</Alert>}
      {s.blocked_reason && <Alert tone="bad" title="Crédito bloqueado">{s.blocked_reason}{p?.auto_blocked ? " · bloqueo automático por mora" : ""}</Alert>}
      <Cifras>
        <CifraLink destacada titulo="Disponible" valor={p ? soles(s.available) : "Contado"} detalle={p ? `de ${soles(s.credit_limit)} · ${s.term_days} días` : undefined} />
        <CifraLink titulo="Saldo" valor={soles(s.balance)} detalle={s.unbilled ? `+ ${soles(s.unbilled)} en pedidos por facturar` : "Comprobantes por cobrar"} href={`/m/b2b/b2b-07?id=${id}`} />
        <CifraLink titulo="Vencido" valor={soles(s.overdue)} detalle={s.overdue_days ? `${s.overdue_days} días de mora · gracia ${s.grace_days}` : "Al día"} tono={s.overdue_days > s.grace_days ? "bad" : s.overdue ? "warn" : "ok"} />
        <CifraLink titulo="Promesas de pago" valor={`${d.promises.kept} cumplidas`} detalle={`${d.promises.broken} incumplidas · ${d.promises.open} abiertas`} tono={d.promises.broken ? "warn" : undefined} href="/m/b2b/b2b-09" />
      </Cifras>
      <div className="flex flex-wrap gap-2">
        <Button icon={Tags} onClick={() => router.push(`/m/b2b/b2b-03?id=${id}`)}>Precios del cliente</Button>
        <Button icon={FileSpreadsheet} onClick={() => router.push(`/m/b2b/b2b-07?id=${id}`)}>Estado de cuenta</Button>
        <Button icon={Users} onClick={() => router.push(`/m/b2b/b2b-11?cliente=${id}`)}>Accesos al portal ({d.portal_users})</Button>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel titulo="Condiciones">
          {p ? <DetailList items={[
            { label: "Límite", value: soles(p.credit_limit) }, { label: "Plazo", value: `${p.term_days} días` },
            { label: "Días de gracia", value: p.grace_days }, { label: "Bloqueo por mora", value: p.block_on_overdue ? "Automático" : "Manual" },
            { label: "Revisar el", value: fecha(p.review_on) }, { label: "Vendedora", value: p.seller_name ?? "—" },
            { label: "Teléfono", value: d.customer.phone }, { label: "Correo", value: d.customer.email },
          ]} /> : <p className="text-[13px] text-muted">El cliente compra al contado.</p>}
        </Panel>
        <Panel titulo="Historial de cambios">
          {p?.history.length ? <ul className="max-h-[260px] space-y-2 overflow-y-auto text-[13px]">{[...p.history].reverse().map((h, i) => (
            <li key={i} className="border-l-2 border-line pl-3"><p><strong>{CAMPO[h.field] ?? h.field}</strong>: {String(h.before ?? "—")} → {String(h.after ?? "—")}</p>
              <Sub>{fechaHora(h.at)} · {h.user}{h.reason ? ` · ${h.reason}` : ""}</Sub></li>))}</ul> : <p className="text-[13px] text-muted">Sin cambios.</p>}
        </Panel>
      </div>
      <Panel titulo="Comprobantes abiertos"><DataTable columns={docCols} rows={d.open_documents} rowKey={(x) => x.document_id} empty="No tiene comprobantes por cobrar." /></Panel>
      {d.exceptions.length > 0 && <Panel titulo="Excepciones de crédito" acciones={<Link className="text-[13px] text-primary underline" href="/m/b2b/b2b-04">Ver bandeja</Link>}><DataTable columns={excCols} rows={d.exceptions} /></Panel>}
      {editar && op && <EditarCredito op={op} id={id} p={p} onClose={() => setEditar(false)} onHecho={() => { setEditar(false); r.recargar(); }} />}
    </div>
  );
}

function EditarCredito({ op, id, p, onClose, onHecho }: { op: Opciones; id: string; p: Perfil | null; onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ credit_limit: p ? String(Number(p.credit_limit)) : "", term_days: String(p?.term_days ?? 15), grace_days: String(p?.grace_days ?? op.params.grace_days),
    block_on_overdue: p?.block_on_overdue ?? true, review_on: p?.review_on ?? "", seller_user_id: p?.seller_user_id ?? "", reason: "" });
  const c = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialogo titulo={p ? "Editar crédito" : "Dar crédito"} boton="Guardar" onClose={onClose} aviso="Cada cambio queda en el historial con quién lo hizo y el motivo."
      enviar={async () => {
        await api(`/v1/b2b/clientes/${id}/credito`, { method: "PUT", body: { ...f, credit_limit: num(f.credit_limit), term_days: Number(f.term_days), grace_days: Number(f.grace_days),
          review_on: f.review_on || null, seller_user_id: f.seller_user_id || null } });
        toast.ok("Crédito guardado"); onHecho();
      }}>
      {(e) => <>
        <Field label="Límite" required error={e.credit_limit}><Input inputMode="decimal" prefix="S/" value={f.credit_limit} onChange={c("credit_limit")} /></Field>
        <Field label="Plazo (días)" required error={e.term_days}><Input inputMode="numeric" value={f.term_days} onChange={c("term_days")} /></Field>
        <Field label="Días de gracia" error={e.grace_days}><Input inputMode="numeric" value={f.grace_days} onChange={c("grace_days")} /></Field>
        <Field label="Revisar el" error={e.review_on}><Input type="date" value={f.review_on} onChange={c("review_on")} /></Field>
        <Field label="Vendedora" error={e.seller_user_id}><Select value={f.seller_user_id} onChange={c("seller_user_id")} placeholder="Sin asignar" options={op.sellers.map((x) => ({ value: x.id, label: x.name }))} /></Field>
        <div className="self-end pb-2"><Checkbox checked={f.block_on_overdue} onChange={(v) => setF({ ...f, block_on_overdue: v })} label="Bloquear solo cuando pase la gracia" /></div>
        <Field label="Motivo del cambio" required error={e.reason} className="sm:col-span-2"><Input value={f.reason} onChange={c("reason")} placeholder="Aumenta su compra a dos pedidos por semana" /></Field>
      </>}
    </Dialogo>
  );
}
