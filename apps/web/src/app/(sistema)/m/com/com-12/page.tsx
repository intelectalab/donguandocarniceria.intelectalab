"use client";

import { useState } from "react";
import { AlarmClock, CalendarCheck, ClipboardX, Scale, Tractor, Wallet } from "lucide-react";
import { Alert, DataTable, Input, PageHeader } from "@/components/ui";
import { kg, numero, porcentaje, soles } from "@/lib/formato";
import { Barras, CifraLink, Seccion, mesActual, nombreMes, useDatos } from "@/modulos/com/comunes";
import { TIPO_PROVEEDOR, type Num } from "@/modulos/com/tipos";

type Tablero = {
  month: string; kpis: { cost_per_kg: Num; observed_pct: Num; compliance_pct: Num; payment_days: Num; farm_share_pct: Num; overdue_payables: Num };
  detail: { kg_received: Num; lines: number; observed_lines: number; pos_received: number; pos_on_time: number; paid: Num; overdue_docs: number; meat_purchases: Num; farm_purchases: Num; pending_approval: number; observed_docs: number };
  cost_per_kg: { supplier: string; variant: string; kg: Num; cost: Num; per_kg: Num }[];
  by_supplier_type: { type: string; value: Num }[];
  weeks: { week: string; farm: Num; others: Num }[];
  aging: { bucket: string; label: string; amount: Num }[];
};

/** COM-12 Tablero de compras: los seis indicadores del mes. */
export default function TableroCompras() {
  const [mes, setMes] = useState(mesActual());
  const { datos: t, error } = useDatos<Tablero>(`/v1/com/tablero?month=${mes}`);
  const k = t?.kpis;
  const maxSemana = Math.max(1, ...(t?.weeks ?? []).map((w) => Number(w.farm) + Number(w.others)));
  return (
    <div className="space-y-5">
      <PageHeader description={`Indicadores de compras de ${nombreMes(mes)}.`} actions={<div className="w-[170px]"><Input type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.target.value)} /></div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Costo por kg comprado" valor={t ? (k?.cost_per_kg != null ? soles(k.cost_per_kg) : "—") : undefined} detalle={t ? `${kg(t.detail.kg_received)} de cárnicos` : undefined} icono={Scale} />
        <CifraLink titulo="Recepciones observadas" valor={t ? (k?.observed_pct != null ? porcentaje(k.observed_pct, 1) : "—") : undefined} detalle={t ? `${t.detail.observed_lines} de ${t.detail.lines} líneas` : undefined} icono={ClipboardX}
          tono={Number(k?.observed_pct) > 5 ? "bad" : "ok"} href="/m/com/com-06" />
        <CifraLink titulo="Cumplimiento de proveedores" valor={t ? (k?.compliance_pct != null ? porcentaje(k.compliance_pct, 1) : "—") : undefined} detalle={t ? `${t.detail.pos_on_time} de ${t.detail.pos_received} órdenes a tiempo` : undefined} icono={CalendarCheck} href="/m/com/com-11" />
        <CifraLink titulo="Días de pago" valor={t ? (k?.payment_days != null ? `${numero(k.payment_days, 1)} días` : "—") : undefined} detalle="Promedio desde la emisión" icono={Wallet} href="/m/com/com-10" />
        <CifraLink titulo="Participación de la granja" valor={t ? (k?.farm_share_pct != null ? porcentaje(k.farm_share_pct, 1) : "—") : undefined} detalle={t ? `${soles(t.detail.farm_purchases)} de ${soles(t.detail.meat_purchases)}` : undefined} icono={Tractor} href="/m/grj/grj-07" />
        <CifraLink titulo="Cuentas por pagar vencidas" valor={t ? soles(k?.overdue_payables) : undefined} detalle={t ? `${t.detail.overdue_docs} comprobantes` : undefined} icono={AlarmClock} tono={Number(k?.overdue_payables) ? "bad" : "ok"} href="/m/com/com-09" />
      </div>
      {t && <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Costo por kg por proveedor y producto">
          <DataTable rows={t.cost_per_kg} rowKey={(r) => `${r.supplier}-${r.variant}`} empty="Sin recepciones de cárnicos en el mes." columns={[
            { key: "variant", header: "Producto", cardTitle: true, render: (r) => <div><p>{r.variant}</p><p className="text-[12px] text-muted">{r.supplier}</p></div> },
            { key: "kg", header: "Kg", align: "right", render: (r) => kg(r.kg) },
            { key: "cost", header: "Costo", align: "right", render: (r) => soles(r.cost) },
            { key: "per_kg", header: "Por kg", align: "right", render: (r) => soles(r.per_kg) },
          ]} />
        </Seccion>
        <Seccion titulo="Compras por tipo de proveedor"><Barras filas={t.by_supplier_type.map((x) => ({ label: TIPO_PROVEEDOR[x.type] ?? x.type, value: x.value }))} formato={soles} /></Seccion>
        <Seccion titulo="Granja frente a otros proveedores, por semana">
          {t.weeks.length ? <ul className="space-y-2">{t.weeks.map((w) => (
            <li key={w.week} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
              <span className="text-muted">{w.week}</span>
              <span className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full bg-primary" style={{ width: `${(Number(w.farm) / maxSemana) * 100}%` }} title="Granja" />
                <span className="block h-full bg-accent" style={{ width: `${(Number(w.others) / maxSemana) * 100}%` }} title="Otros" />
              </span>
              <span className="tabular-nums text-muted">{soles(Number(w.farm) + Number(w.others))}</span>
            </li>))}</ul> : <p className="text-[13px] text-muted">Sin compras en el mes.</p>}
          <p className="mt-2 flex gap-4 text-[12px] text-muted"><span><span className="mr-1 inline-block size-2 rounded-full bg-primary" />Granja</span><span><span className="mr-1 inline-block size-2 rounded-full bg-accent" />Otros</span></p>
        </Seccion>
        <Seccion titulo="Antigüedad de lo que se debe"><Barras filas={t.aging.map((a) => ({ label: a.label, value: a.amount }))} formato={soles} /></Seccion>
      </div>}
    </div>
  );
}
