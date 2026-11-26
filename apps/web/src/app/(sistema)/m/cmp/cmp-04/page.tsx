"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Alert, Button, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { Panel, Sub, num, opciones, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import type { Campana, Opciones } from "@/modulos/cmp/tipos";

/** CMP-04 Nueva campaña: marca, segmento, número de WhatsApp, plantilla aprobada, objetivo, cupón, fecha, ventana de atribución y grupo de control. */
export default function NuevaCampana() {
  const router = useRouter();
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [id, setId] = useState<string | null>(null);
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const actual = useDatos<Campana>(id ? `/v1/cmp/campanas/${id}` : null);
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  if (op && f === null && id === "") setF({ name: "", brand_id: op.brands[0]?.id ?? "", segment_id: "", channel_id: "", template_id: "", objective: "REPURCHASE", coupon_id: "",
    scheduled_at: `${op.today}T10:00`, attribution_window_days: String(op.params.window_days), control_group_pct: String(op.params.control_pct) });
  if (op && f === null && actual.datos) { const c = actual.datos; setF({ name: c.name, brand_id: c.brand_id, segment_id: c.segment_id, channel_id: c.channel_id, template_id: c.template_id,
    objective: c.objective, coupon_id: c.coupon_id ?? "", scheduled_at: c.scheduled_at ? c.scheduled_at.slice(0, 16).replace(" ", "T") : "", attribution_window_days: String(c.attribution_window_days),
    control_group_pct: String(Number(c.control_group_pct)) }); }
  if (!op || !f) return <p className="text-sm text-muted">{actual.error ?? "Cargando…"}</p>;
  const c = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const deMarca = <T extends { brand_id: string | null }>(xs: T[]) => xs.filter((x) => !x.brand_id || x.brand_id === f.brand_id);
  const plantilla = op.templates.find((t) => t.id === f.template_id);
  const segmento = op.segments.find((s) => s.id === f.segment_id);
  const editable = !actual.datos || actual.datos.status === "DRAFT";

  async function guardar() {
    setGuardando(true); setErrores({});
    try {
      const body = { ...f, coupon_id: f!.coupon_id || null, scheduled_at: f!.scheduled_at ? `${f!.scheduled_at}:00-05:00` : null, attribution_window_days: Number(f!.attribution_window_days), control_group_pct: num(f!.control_group_pct) };
      const x = await api<{ id: string }>(id ? `/v1/cmp/campanas/${id}` : "/v1/cmp/campanas", { method: id ? "PUT" : "POST", body });
      toast.ok("Campaña guardada en borrador"); router.push(`/m/cmp/cmp-05?id=${x.id ?? id}`);
    } catch (e) { const x = erroresDe(e); setErrores(x); if (!Object.keys(x).length) toast.error(mensajeDe(e)); } finally { setGuardando(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader code={actual.datos?.code} description="La campaña se guarda en borrador. En el siguiente paso se calcula a cuántos llega, cuánto cuesta y se pide la aprobación."
        actions={editable && <Button variant="primary" icon={ArrowRight} loading={guardando} onClick={guardar}>Guardar y estimar</Button>} />
      {!editable && <Alert tone="info">La campaña ya salió del borrador: no se puede cambiar.</Alert>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel titulo="Campaña">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre" required error={errores.name} className="sm:col-span-2"><Input value={f.name} onChange={c("name")} placeholder="Vuelve por tu cuy de setiembre" /></Field>
            <Field label="Marca" required error={errores.brand_id}><Select value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: e.target.value, segment_id: "", channel_id: "", template_id: "", coupon_id: "" })} options={op.brands.map((b) => ({ value: b.id, label: b.name }))} /></Field>
            <Field label="Objetivo" error={errores.objective}><Select value={f.objective} onChange={c("objective")} options={opciones(op.objectives)} /></Field>
            <Field label="Segmento" required error={errores.segment_id} className="sm:col-span-2"><Select value={f.segment_id} onChange={c("segment_id")} placeholder="Elige el segmento"
              options={deMarca(op.segments).map((s) => ({ value: s.id, label: `${s.name} · ${numero(s.consent_count)} aceptan de ${numero(s.member_count)}` }))} /></Field>
            <Field label="Número de WhatsApp" required error={errores.channel_id}><Select value={f.channel_id} onChange={c("channel_id")} placeholder="Elige el número"
              options={op.channels.filter((x) => x.brand_id === f.brand_id).map((x) => ({ value: x.id, label: `${x.display_name} · ${x.number}`, disabled: x.status !== "ACTIVE" }))} /></Field>
            <Field label="Plantilla" required error={errores.template_id} hint="Solo plantillas de marketing aprobadas por Meta."><Select value={f.template_id} onChange={c("template_id")} placeholder="Elige la plantilla"
              options={op.templates.filter((t) => t.brand_id === f.brand_id && t.category === "MARKETING").map((t) => ({ value: t.id, label: `${t.name}${t.provider_status === "APPROVED" ? "" : " (en revisión)"}`, disabled: t.provider_status !== "APPROVED" }))} /></Field>
            <Field label="Cupón" error={errores.coupon_id}><Select value={f.coupon_id} onChange={c("coupon_id")} placeholder="Sin cupón"
              options={deMarca(op.coupons).map((k) => ({ value: k.id, label: `${k.code} · ${op.discount_types[k.discount_type]}${k.discount_type !== "FREE_DELIVERY" ? ` ${Number(k.value)}${k.discount_type === "PCT" ? " %" : ""}` : ""}` }))} /></Field>
            <Field label="Envío" error={errores.scheduled_at}><Input type="datetime-local" value={f.scheduled_at} onChange={c("scheduled_at")} /></Field>
            <Field label="Ventana de atribución (días)" error={errores.attribution_window_days} hint="Un pedido en estos días cuenta para la campaña (1 a 60)."><Input inputMode="numeric" value={f.attribution_window_days} onChange={c("attribution_window_days")} /></Field>
            <Field label="Grupo de control" error={errores.control_group_pct} hint="No recibe el mensaje: sirve para medir el efecto real (0 a 50 %)."><Input inputMode="decimal" suffix="%" value={f.control_group_pct} onChange={c("control_group_pct")} /></Field>
          </div>
        </Panel>
        <Panel titulo="Mensaje">
          {plantilla ? <div className="rounded-xl bg-[#e7f7e1] p-3 text-[13.5px] text-[#14290f] shadow-card dark:bg-[#1d3a1a] dark:text-[#e2f5dc]">{plantilla.body}</div>
            : <p className="text-[13px] text-muted">Elige una plantilla para ver el mensaje.</p>}
          {segmento && <p className="mt-3 text-[13px]">Llega a hasta <strong>{numero(segmento.consent_count)}</strong> clientes con consentimiento, antes del tope semanal y del grupo de control.</p>}
          <Sub>Costo aproximado: S/ {numero(op.params.rate, 4)} por mensaje de marketing{op.params.fee ? ` + S/ ${numero(op.params.fee, 4)} del proveedor` : ""}.</Sub>
        </Panel>
      </div>
    </div>
  );
}
