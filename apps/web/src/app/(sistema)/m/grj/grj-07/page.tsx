"use client";

import { useState } from "react";
import { Scale, ShieldAlert, TrendingDown } from "lucide-react";
import { Alert, DataTable, Input, PageHeader } from "@/components/ui";
import { kg, numero, porcentaje, soles } from "@/lib/formato";
import { CifraLink, Seccion, mesActual, nombreMes, useDatos, type Num } from "@/modulos/grj/comunes";

type Tablero = {
  month: string; kpis: { weight_diff_pct: Num; disputed_pct: Num; farm_cost_index: Num };
  detail: { received: number; disputed: number; sent_kg: Num; diff_kg: Num; pending: number; errors: number; unmapped: number };
  cost_compare: { variant_id: string; name: string; farm_kg: number; farm_cost: number; farm_per_kg: Num; other_per_kg: Num }[];
  months: { month: string; kg: Num; value: Num; dispatches: number }[];
};

/** GRJ-07 Tablero de la granja: diferencia de peso, envíos en disputa y costo por kg frente a terceros. */
export default function TableroGranja() {
  const [mes, setMes] = useState(mesActual());
  const { datos: t, error } = useDatos<Tablero>(`/v1/grj/tablero?month=${mes}`);
  const max = Math.max(1, ...(t?.months ?? []).map((m) => Number(m.kg)));
  return (
    <div className="space-y-5">
      <PageHeader description={`La relación con la granja en ${nombreMes(mes)}: cuánto pesa de menos lo que llega, cuántos envíos terminan en disputa y si su costo por kg conviene frente a otros proveedores.`}
        actions={<div className="w-[170px]"><Input type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.target.value)} /></div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CifraLink destacada titulo="Diferencia de peso con la granja" valor={t ? (t.kpis.weight_diff_pct != null ? porcentaje(t.kpis.weight_diff_pct, 2) : "—") : undefined} detalle={t ? `${kg(t.detail.diff_kg)} de ${kg(t.detail.sent_kg)}` : undefined} icono={Scale} href="/m/grj/grj-05" />
        <CifraLink titulo="Envíos en disputa" valor={t ? (t.kpis.disputed_pct != null ? porcentaje(t.kpis.disputed_pct, 1) : "—") : undefined} detalle={t ? `${t.detail.disputed} de ${t.detail.received} recibidos` : undefined} icono={ShieldAlert} tono={Number(t?.kpis.disputed_pct) > 10 ? "bad" : "ok"} href="/m/grj/grj-03" />
        <CifraLink titulo="Costo de la granja frente a terceros" valor={t ? (t.kpis.farm_cost_index != null ? numero(t.kpis.farm_cost_index, 1) : "—") : undefined} detalle="100 = igual que otros proveedores; menos es mejor" icono={TrendingDown} tono={t?.kpis.farm_cost_index != null ? (Number(t.kpis.farm_cost_index) <= 100 ? "ok" : "warn") : undefined} />
      </div>
      {t && (t.detail.pending > 0 || t.detail.errors > 0 || t.detail.unmapped > 0) && <Alert tone="warn">{[t.detail.pending && `${t.detail.pending} envío(s) por recibir`, t.detail.errors && `${t.detail.errors} con error`, t.detail.unmapped && `${t.detail.unmapped} ítem(s) sin mapear`].filter(Boolean).join(" · ")}.</Alert>}
      {t && <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Costo por kg: granja frente a terceros">
          <DataTable rows={t.cost_compare} rowKey={(r) => r.variant_id} empty="Sin recepciones de la granja en el mes." columns={[
            { key: "name", header: "Producto", cardTitle: true, render: (r) => r.name },
            { key: "farm_kg", header: "Kg", align: "right", render: (r) => kg(r.farm_kg) },
            { key: "farm_per_kg", header: "Granja", align: "right", render: (r) => soles(r.farm_per_kg) },
            { key: "other_per_kg", header: "Otros", align: "right", render: (r) => r.other_per_kg != null ? soles(r.other_per_kg) : <span className="text-muted">Sin compras</span> },
          ]} />
        </Seccion>
        <Seccion titulo="Kg recibidos de la granja por mes">
          <ul className="space-y-2">{t.months.map((m) => (
            <li key={m.month} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
              <span className="text-muted">{nombreMes(m.month)}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-primary" style={{ width: `${(Number(m.kg) / max) * 100}%` }} /></span>
              <span className="tabular-nums text-muted">{kg(m.kg)} · {soles(m.value)}</span>
            </li>))}</ul>
        </Seccion>
      </div>}
    </div>
  );
}
