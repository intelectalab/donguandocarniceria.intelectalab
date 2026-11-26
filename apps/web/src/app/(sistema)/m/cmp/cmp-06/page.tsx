"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Alert, Badge, Button, DataTable, PageHeader, StatusBadge, Tabs, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje, soles } from "@/lib/formato";
import { Barras, Cifras, CifraLink, Panel, Sub, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { ESTADO_CAMPANA, ESTADO_DESTINATARIO, roiTexto, type Campana, type Opciones } from "@/modulos/cmp/tipos";

type Dest = { id: string; full_name: string; phone: string; is_control: boolean; status: string; message_cost: string; opted_out: boolean; sent_at: string | null; read_at: string | null };
type Atr = { id: string; order_number: string; full_name: string; rule: string; collected_amount: string; discount_amount: string; attributed_at: string };
type Ficha = Campana & { recipients: Dest[]; attributions: Atr[] };

/** CMP-06 Resultados de campaña: entregados, leídos, pedidos, cobrado, retorno y efecto contra el grupo de control. */
export default function Resultados() {
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [id, setId] = useState<string | null>(null);
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const r = useDatos<Ficha>(id ? `/v1/cmp/campanas/${id}` : null);
  const [tab, setTab] = useState<"pedidos" | "destinatarios">("pedidos");
  const c = r.datos;
  if (id === null) return null;
  if (!id) return <Alert tone="warn">Elige una campaña enviada en <Link className="underline" href="/m/cmp/cmp-03">Campañas</Link>.</Alert>;
  if (r.error) return <Alert tone="bad">{r.error}</Alert>;
  if (!c) return <p className="text-sm text-muted">Cargando…</p>;
  const x = c.results;
  if (!x) return <Alert tone="info">La campaña {c.code} todavía no se envía. <Link className="underline" href={`/m/cmp/cmp-05?id=${c.id}`}>Ver la estimación</Link></Alert>;

  async function atribuir() {
    try { const y = await api<{ attributed: number }>("/v1/cmp/atribuir", { method: "POST" }); toast.ok(`${y.attributed} pedidos nuevos atribuidos`); r.recargar(); } catch (e) { toast.error(mensajeDe(e)); }
  }
  const destCols: Column<Dest>[] = [
    { key: "full_name", header: "Cliente", cardTitle: true, render: (d) => <div>{d.full_name}<Sub>{d.phone}</Sub></div> },
    { key: "status", header: "Estado", render: (d) => <div className="flex flex-wrap gap-1"><StatusBadge status={d.status} labels={ESTADO_DESTINATARIO} />{d.opted_out && <Badge tone="bad">Pidió la baja</Badge>}</div> },
    { key: "sent_at", header: "Enviado", render: (d) => fechaHora(d.sent_at) },
    { key: "read_at", header: "Leído", render: (d) => fechaHora(d.read_at) },
    { key: "message_cost", header: "Costo", align: "right", render: (d) => d.is_control ? "—" : `S/ ${numero(d.message_cost, 4)}` },
  ];
  const atrCols: Column<Atr>[] = [
    { key: "order_number", header: "Pedido", cardTitle: true, render: (a) => <div><span className="font-mono">{a.order_number}</span><Sub>{a.full_name}</Sub></div> },
    { key: "rule", header: "Cómo se atribuyó", render: (a) => <Badge tone={a.rule === "COUPON" ? "ok" : "info"}>{a.rule === "COUPON" ? "Usó el cupón" : "Compró en la ventana"}</Badge> },
    { key: "collected_amount", header: "Cobrado sin IGV", align: "right", render: (a) => soles(a.collected_amount) },
    { key: "discount_amount", header: "Descuento", align: "right", render: (a) => soles(a.discount_amount) },
    { key: "attributed_at", header: "Atribuido", render: (a) => fechaHora(a.attributed_at) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader code={`${c.code} · ${c.name}`} description={`${c.brand_name} · ${c.segment_name} · ${op?.objectives[c.objective] ?? c.objective}. Enviada ${fechaHora(c.sent_at)}; cuenta pedidos hasta el ${fecha(x.window_end)}.`}
        actions={<><StatusBadge status={c.status} labels={ESTADO_CAMPANA} /><Button icon={RefreshCw} onClick={atribuir}>Atribuir pedidos nuevos</Button></>} />
      <Cifras>
        <CifraLink destacada titulo="Cobrado" valor={soles(x.collected)} detalle={`${numero(x.orders)} pedidos · ${numero(x.paid_orders)} pagados`} />
        <CifraLink titulo="Retorno" valor={roiTexto(x.roi)} detalle={`Costo ${soles(x.total_cost)}${x.cost_per_order ? ` · ${soles(x.cost_per_order)} por pedido` : ""}`} tono={(x.roi ?? 0) >= 0 ? "ok" : "bad"} />
        <CifraLink titulo="Compraron" valor={porcentaje(x.buy_rate, 1)} detalle={`Grupo de control: ${porcentaje(x.control_rate, 1)} de ${numero(x.control)}`} />
        <CifraLink titulo="Efecto real" valor={x.lift != null ? `${x.lift > 0 ? "+" : ""}${numero(x.lift, 1)} puntos` : "—"} detalle="Compra de los que recibieron menos la del control" tono={(x.lift ?? 0) > 0 ? "ok" : "warn"} />
      </Cifras>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel titulo="Mensajes">
          <Barras formato={(v) => numero(v)} filas={[{ label: "Enviados", value: x.sent }, { label: "Entregados", value: x.delivered }, { label: "Leídos", value: x.read }, { label: "Respondieron", value: x.replied }, { label: "Pidieron la baja", value: x.optouts }]} />
          <Sub>Bajas: {porcentaje(x.optout_rate, 1)} de los enviados.</Sub>
        </Panel>
        <Panel titulo="Pedidos atribuidos">
          <Barras formato={(v) => numero(v)} filas={[{ label: "Con el cupón", value: x.by_coupon }, { label: "En la ventana", value: x.orders - x.by_coupon }, { label: "Canjes del cupón", value: x.redemptions }]} />
          <Sub>Descuentos dados: {soles(x.discounts)}. Lo cobrado se cuenta sin IGV.</Sub>
        </Panel>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "pedidos", label: "Pedidos", count: c.attributions.length }, { key: "destinatarios", label: "Destinatarios", count: c.recipients.length }]} />
      {tab === "pedidos" ? <DataTable columns={atrCols} rows={c.attributions} empty="Sin pedidos atribuidos." /> : <DataTable columns={destCols} rows={c.recipients} empty="Sin destinatarios." />}
    </div>
  );
}
