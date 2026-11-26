"use client";

import { useState } from "react";
import { CalendarCheck, CircleDollarSign, Factory, Gauge, Timer, TrendingDown } from "lucide-react";
import { Alert, DataTable, Input, PageHeader, type Column } from "@/components/ui";
import { fecha, kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Barras, CifraLink, Seccion, pp, qs, useAlAbrir, useDatos, useOpcionesPro } from "@/modulos/pro/comunes";
import type { Num } from "@/modulos/pro/tipos";

type Grupo = { orders: number; produced_kg: Num; input_kg: Num; yield_vs_expected_pp: Num; waste_pct: Num; cost_per_kg: Num; total_cost: Num; recipe_vs_actual_pct: Num };
type Tablero = {
  period: { from: string; to: string };
  kpis: Grupo & { labor_hours: Num; productivity_kg_h: Num; planned_orders: number; on_time_orders: number; plan_compliance_pct: Num };
  by_line: (Grupo & { line_id: string; line_code: string; line_name: string })[];
  by_product: (Grupo & { product_id: string; product_name: string })[];
  trend: { month: string; produced_kg: Num; waste_pct: Num; cost_per_kg: Num }[];
};
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

/** PRO-12 Tablero de producción: KPI-PRO-01 a 06 del mes, por línea y producto. */
export default function TableroProduccion() {
  const { local } = useSesion();
  const op = useOpcionesPro();
  const [mes, setMes] = useState("");
  useAlAbrir((p) => setMes(p.get("month") ?? ""));
  const { datos: t, error } = useDatos<Tablero>(`/v1/pro/tablero${qs({ month: mes, site: local })}`);
  const k = t?.kpis;
  const ver = Boolean(op?.can.cost);
  const col = <T extends Grupo>(): Column<T>[] => [
    { key: "orders", header: "Órdenes", align: "right" }, { key: "produced_kg", header: "Producido", align: "right", render: (x) => kg(x.produced_kg) },
    { key: "yield_vs_expected_pp", header: "Rend. vs esperado", align: "right", render: (x) => pp(x.yield_vs_expected_pp) },
    { key: "waste_pct", header: "Merma", align: "right", render: (x) => porcentaje(x.waste_pct, 1) },
    ...(ver ? [{ key: "cost_per_kg", header: "Costo por kg", align: "right" as const, render: (x: T) => soles(x.cost_per_kg) },
      { key: "recipe_vs_actual_pct", header: "Real vs receta", align: "right" as const, render: (x: T) => x.recipe_vs_actual_pct === null ? "—" : `${Number(x.recipe_vs_actual_pct) > 0 ? "+" : ""}${numero(x.recipe_vs_actual_pct, 1)} %` }] : []),
  ];
  const maxT = Math.max(1, ...(t?.trend ?? []).map((m) => Number(m.produced_kg)));
  return (
    <div className="space-y-5">
      <PageHeader description={t ? `Órdenes cerradas del ${fecha(t.period.from)} al ${fecha(t.period.to)}.` : "Indicadores del mes."}
        actions={<div className="w-[170px]"><Input type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.target.value)} /></div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <CifraLink destacada titulo="Producido" valor={k ? kg(k.produced_kg) : undefined} detalle={k ? `${k.orders} órdenes cerradas` : undefined} icono={Factory} href="/m/pro/pro-04" />
        <CifraLink titulo="Rendimiento vs esperado" valor={k ? pp(k.yield_vs_expected_pp) : undefined} detalle="KPI-PRO-01" icono={Gauge} tono={k?.yield_vs_expected_pp != null ? (Math.abs(Number(k.yield_vs_expected_pp)) <= 3 ? "ok" : "warn") : undefined} />
        <CifraLink titulo="Merma" valor={k ? porcentaje(k.waste_pct, 1) : undefined} detalle="KPI-PRO-02 · sobre lo que entró" icono={TrendingDown} />
        <CifraLink titulo="Costo por kg" valor={k ? (ver ? soles(k.cost_per_kg) : "—") : undefined} detalle={ver && k ? `KPI-PRO-03 · total ${soles(k.total_cost)}` : "Sin permiso de costos"} icono={CircleDollarSign} />
        <CifraLink titulo="Productividad" valor={k ? (k.productivity_kg_h !== null ? `${numero(k.productivity_kg_h, 2)} kg/h` : "—") : undefined} detalle={k ? `KPI-PRO-05 · ${numero(k.labor_hours, 1)} h de personal` : undefined} icono={Timer} />
        <CifraLink titulo="Cumplimiento del plan" valor={k ? porcentaje(k.plan_compliance_pct, 1) : undefined} detalle={k ? `KPI-PRO-06 · ${k.on_time_orders} de ${k.planned_orders} a tiempo` : undefined} icono={CalendarCheck} />
      </div>
      {t && <>
        <div className="grid gap-4 lg:grid-cols-2">
          <Seccion titulo="Merma por línea"><Barras filas={t.by_line.map((l) => ({ label: l.line_code, value: l.waste_pct }))} formato={(v) => porcentaje(v, 1)} /></Seccion>
          <Seccion titulo="Producido en los últimos meses">
            <div className="flex h-40 items-end gap-2">
              {t.trend.map((m) => <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[11px] tabular-nums text-muted">{Number(m.produced_kg) ? numero(m.produced_kg, 0) : ""}</span>
                <span className="w-full rounded-t-md bg-primary" style={{ height: `${(Number(m.produced_kg) / maxT) * 100}%`, minHeight: 2 }} />
                <span className="text-[11.5px] text-muted">{MESES[Number(m.month.slice(5)) - 1]}</span>
              </div>)}
            </div>
          </Seccion>
        </div>
        <Seccion titulo="Por línea"><DataTable rows={t.by_line} rowKey={(x) => x.line_id} columns={[{ key: "line_code", header: "Línea", cardTitle: true, render: (x) => `${x.line_code} · ${x.line_name}` }, ...col<Tablero["by_line"][number]>()]} /></Seccion>
        <Seccion titulo="Por producto"><DataTable rows={t.by_product} rowKey={(x) => x.product_id} columns={[{ key: "product_name", header: "Producto", cardTitle: true }, ...col<Tablero["by_product"][number]>()]} /></Seccion>
      </>}
    </div>
  );
}
