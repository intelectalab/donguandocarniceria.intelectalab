"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Pencil, Send, ShieldCheck } from "lucide-react";
import { Alert, Button, DetailList, PageHeader, StatusBadge, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { Panel, Sub, accion, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { ESTADO_CAMPANA, type Campana, type Opciones } from "@/modulos/cmp/tipos";

type Ficha = Campana & { template_name: string; template_body: string; channel_name: string; channel_number: string; created_name: string | null; approved_name: string | null;
  threshold: number; needs_manager: boolean; rate: number; fee: number };
type Estimacion = { target: number; excluded_consent: number; excluded_frequency: number; eligible: number; control: number; effective: number; unit: number; cost: number; threshold: number;
  needs_manager: boolean; estimated_discount: number | null };

/** CMP-05 Estimación y aprobación: a cuántos llega, cuánto cuesta y quién aprueba antes de enviar. */
export default function Aprobacion() {
  const router = useRouter();
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [id, setId] = useState<string | null>(null);
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const r = useDatos<Ficha>(id ? `/v1/cmp/campanas/${id}` : null);
  const [est, setEst] = useState<Estimacion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const c = r.datos;
  const abierta = c && ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(c.status);

  useEffect(() => {
    if (!id || !abierta) return;
    let vigente = true;
    api<Estimacion>(`/v1/cmp/campanas/${id}/estimar`, { method: "POST" }).then((x) => vigente && setEst(x)).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [id, abierta]);

  if (id === null) return null;
  if (!id) return <Alert tone="warn">Elige una campaña en <Link className="underline" href="/m/cmp/cmp-03">Campañas</Link>.</Alert>;
  if (r.error) return <Alert tone="bad">{r.error}</Alert>;
  if (!c || !op) return <p className="text-sm text-muted">Cargando…</p>;
  if (c.status === "SENT") { router.replace(`/m/cmp/cmp-06?id=${c.id}`); return null; }
  const e = est ?? { target: c.target_count ?? 0, excluded_consent: c.excluded_consent_count ?? 0, excluded_frequency: c.excluded_frequency_count ?? 0,
    eligible: (c.effective_count ?? 0) + (c.control_count ?? 0), control: c.control_count ?? 0, effective: c.effective_count ?? 0, unit: Number(c.unit_cost ?? c.rate), cost: Number(c.estimated_cost ?? 0),
    threshold: c.threshold, needs_manager: c.needs_manager, estimated_discount: c.estimated_discount != null ? Number(c.estimated_discount) : null };
  const esCreador = c.created_by_user === op.me;
  const aprueba = Boolean(op.can["cmp.campaign.approve"]) && (!e.needs_manager || Boolean(op.can["cmp.campaign.approve_over_threshold"]));
  const gestiona = Boolean(op.can["cmp.campaign.manage"]);

  async function hacer(url: string, ok: string) {
    setEnviando(true);
    try { await api(url, { method: "POST" }); toast.ok(ok); r.recargar(); } catch (x) { toast.error(mensajeDe(x)); } finally { setEnviando(false); }
  }
  const embudo = [
    { label: "Clientes del segmento", v: e.target, tono: "" }, { label: "Sin consentimiento de la marca", v: -e.excluded_consent, tono: "text-muted" },
    { label: `Ya recibieron ${op.params.max_per_week} mensajes esta semana`, v: -e.excluded_frequency, tono: "text-muted" }, { label: "Pueden recibir", v: e.eligible, tono: "font-semibold" },
    { label: `Grupo de control (${numero(c.control_group_pct)} %)`, v: -e.control, tono: "text-muted" }, { label: "Reciben el mensaje", v: e.effective, tono: "text-[16px] font-bold text-primary" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader code={`${c.code} · ${c.name}`} description={`${c.brand_name} · ${c.segment_name} · ${op.objectives[c.objective] ?? c.objective}. Programada para ${fechaHora(c.scheduled_at)}.`}
        actions={<>
          <StatusBadge status={c.status} labels={ESTADO_CAMPANA} />
          {gestiona && c.status === "DRAFT" && <Button icon={Pencil} onClick={() => router.push(`/m/cmp/cmp-04?id=${c.id}`)}>Editar</Button>}
          {gestiona && c.status === "DRAFT" && <Button variant="primary" icon={ShieldCheck} loading={enviando} onClick={() => hacer(`/v1/cmp/campanas/${c.id}/solicitar`, "Enviada a aprobación")}>Pedir aprobación</Button>}
          {c.status === "PENDING_APPROVAL" && aprueba && !esCreador && <Button variant="primary" icon={CheckCircle2} loading={enviando} onClick={() => accion({ title: `¿Aprobar ${c.code}?`,
            message: `Se enviarán ${numero(e.effective)} mensajes por ${soles(e.cost)}.`, confirmLabel: "Aprobar" }, () => api(`/v1/cmp/campanas/${c.id}/aprobar`, { method: "POST" }), "Campaña aprobada", r.recargar)}>Aprobar</Button>}
          {c.status === "APPROVED" && gestiona && <Button variant="primary" icon={Send} loading={enviando} onClick={() => accion({ title: `¿Enviar ${c.code} ahora?`, message: `Se envían ${numero(e.effective)} mensajes. No se puede deshacer.`, confirmLabel: "Enviar" },
            () => api(`/v1/cmp/campanas/${c.id}/enviar`, { method: "POST" }), "Campaña enviada", () => router.push(`/m/cmp/cmp-06?id=${c.id}`))}>Enviar ahora</Button>}
          {abierta && (gestiona || aprueba) && <Button variant="ghost" icon={Ban} onClick={() => accion({ title: `¿Cancelar ${c.code}?`, confirmLabel: "Cancelar campaña", danger: true, reason: { min: 5 } },
            (m) => api(`/v1/cmp/campanas/${c.id}/cancelar`, { method: "POST", body: { reason: m } }), "Campaña cancelada", r.recargar)}>Cancelar</Button>}
        </>} />
      {c.status === "PENDING_APPROVAL" && esCreador && <Alert tone="info">Tú armaste la campaña: la aprueba otra persona.</Alert>}
      {c.status === "PENDING_APPROVAL" && !aprueba && !esCreador && <Alert tone="info">{e.needs_manager ? `Cuesta más de ${soles(e.threshold)}: la aprueba gerencia.` : "La aprueba quien tenga permiso para aprobar campañas."}</Alert>}
      {c.cancel_reason && <Alert tone="bad" title="Cancelada">{c.cancel_reason}</Alert>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel titulo="A cuántos llega">
          <ul className="space-y-1.5 text-[13.5px]">{embudo.map((x) => <li key={x.label} className={`flex justify-between ${x.tono}`}><span>{x.label}</span><span className="tabular-nums">{x.v < 0 ? `− ${numero(-x.v)}` : numero(x.v)}</span></li>)}</ul>
          {est === null && abierta && <Sub>Recalculando…</Sub>}
        </Panel>
        <Panel titulo="Cuánto cuesta">
          <DetailList items={[
            { label: "Por mensaje", value: `S/ ${numero(e.unit, 4)}` },
            { label: "Costo de mensajes", value: <strong>{soles(e.cost)}</strong> },
            { label: "Descuento estimado", value: e.estimated_discount != null ? `${soles(e.estimated_discount)} (si canjea el 8 %)` : "Sin cupón" },
            { label: "Aprobación", value: e.needs_manager ? `Gerencia: supera ${soles(e.threshold)}` : `Marketing o administración: hasta ${soles(e.threshold)}` },
          ]} />
        </Panel>
        <Panel titulo="Mensaje">
          <p className="mb-2 text-[12.5px] text-muted">{c.channel_name} · {c.channel_number} · plantilla {c.template_name}</p>
          <div className="rounded-xl bg-[#e7f7e1] p-3 text-[13.5px] text-[#14290f] dark:bg-[#1d3a1a] dark:text-[#e2f5dc]">{c.template_body}</div>
          {c.coupon_code && <p className="mt-2 text-[13px]">Cupón <span className="font-mono font-semibold">{c.coupon_code}</span> · atribución {c.attribution_window_days} días</p>}
        </Panel>
        <Panel titulo="Historial">
          <ul className="space-y-2 text-[13px]">{c.history.map((h, i) => <li key={i} className="border-l-2 border-line pl-3"><StatusBadge status={h.to} labels={ESTADO_CAMPANA} /><Sub>{fechaHora(h.at)} · {h.user}{h.reason ? ` · ${h.reason}` : ""}</Sub></li>)}</ul>
          <Sub>Armó {c.created_name ?? "—"}{c.approved_name ? ` · aprobó ${c.approved_name}` : ""}</Sub>
        </Panel>
      </div>
    </div>
  );
}
