"use client";

import { useState } from "react";
import { AlertTriangle, BookOpen, RefreshCw, TrendingUp } from "lucide-react";
import { Alert, Button, DataTable, DetailList, Modal, PageHeader, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { CifraLink, accion, useDatos, useVersionDeUrl } from "@/modulos/rec/comunes";
import type { Num } from "@/modulos/rec/tipos";

type Fila = { id: string; version: number; code: string; name: string; brand_name: string; standard_cost_per_kg: Num; cost_today_per_kg: Num; variation_pct: Num;
  alert: boolean; recalc_cost_per_kg: Num; recalc_at: string | null; approved_at: string | null };
type Lista = { data: Fila[]; kpi: { average_variation_pct: Num; over_alert: number; approved: number; alert_pct: number } };
type Detalle = { rows: { id: string; sku: string; name: string; qty_kg: string; cost: string; amount: string; source: string }[]; total: string; per_kg: string | null;
  base_output_kg: string; standard_cost_per_kg: Num; variation_pct: Num; recipe_code: string; recipe_name: string; version: number };

const signo = (v: Num) => (v !== null && Number(v) > 0 ? "+" : "");

/** REC-09 Costo de la receta: costo por kg con el costo promedio de cada insumo y su variación desde la aprobación (KPI-REC-01). */
export default function CostoReceta() {
  const { can } = useSesion();
  const { datos, cargando, error, recargar } = useDatos<Lista>(can("rec.cost.view") ? "/v1/rec/costos" : null);
  const inicial = useVersionDeUrl();
  const [abierta, setAbierta] = useState<string | null>(null);
  const elegida = abierta ?? inicial;
  if (!can("rec.cost.view")) return <Alert tone="info">Ver el costo de las recetas pide el permiso de costos (jefe de producción, gerencia o contabilidad).</Alert>;
  const k = datos?.kpi;
  const columnas: Column<Fila>[] = [
    { key: "code", header: "Receta", cardTitle: true, render: (f) => <div className="min-w-[180px]"><p className="font-medium">{f.code} · {f.name} v{f.version}</p><p className="text-[12px] text-muted">{f.brand_name}</p></div> },
    { key: "standard_cost_per_kg", header: "Al aprobar", align: "right", render: (f) => soles(f.standard_cost_per_kg) },
    { key: "cost_today_per_kg", header: "Hoy", align: "right", render: (f) => soles(f.cost_today_per_kg) },
    { key: "variation_pct", header: "Variación", align: "right", render: (f) => <b className={f.alert ? "text-bad" : ""}>{signo(f.variation_pct)}{porcentaje(f.variation_pct, 2)}</b> },
    { key: "approved_at", header: "Aprobada", hideOnMobile: true, render: (f) => fecha(f.approved_at) },
    { key: "recalc_at", header: "Último recálculo", hideOnMobile: true, render: (f) => f.recalc_at ? fechaHora(f.recalc_at) : "—" },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={`Costo por kg = Σ (kg × costo promedio vigente del insumo) / kg base de salida, frente al costo fijado al aprobar. Avisa al jefe de producción si la variación supera ${k?.alert_pct ?? 5} %.`}
        actions={<Button variant="primary" icon={RefreshCw} onClick={() => accion({ title: "¿Recalcular los costos?", message: "Guarda el costo de hoy de cada receta aprobada y avisa las que variaron de más. No cambia el costo aprobado.", confirmLabel: "Recalcular" },
          () => api<{ recalculated: number; alerts: number }>("/v1/rec/costos/recalcular", { method: "POST" }), "Costos recalculados", recargar)}>Recalcular y avisar</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Variación promedio" valor={k ? `${signo(k.average_variation_pct)}${porcentaje(k.average_variation_pct, 2)}` : undefined} detalle="KPI-REC-01" icono={TrendingUp}
          tono={k && Math.abs(Number(k.average_variation_pct ?? 0)) > k.alert_pct ? "warn" : "ok"} />
        <CifraLink titulo={`Recetas sobre ${k?.alert_pct ?? 5} %`} valor={k ? numero(k.over_alert) : undefined} icono={AlertTriangle} tono={k?.over_alert ? "bad" : "ok"} />
        <CifraLink titulo="Recetas aprobadas" valor={k ? numero(k.approved) : undefined} icono={BookOpen} />
      </div>
      <DataTable columns={columnas} rows={datos?.data ?? []} rowKey={(f) => f.id} loading={cargando} error={error} onRetry={recargar} onRowClick={(f) => setAbierta(f.id)}
        empty="No hay recetas aprobadas." />
      {elegida && <DetalleCosto id={elegida} onClose={() => { setAbierta(null); try { window.history.replaceState(null, "", "?"); } catch { /* */ } }} />}
    </div>
  );
}

function DetalleCosto({ id, onClose }: { id: string; onClose: () => void }) {
  const { datos: d, error } = useDatos<Detalle>(`/v1/rec/versiones/${id}/costo`);
  const total = Number(d?.total ?? 0);
  return (
    <Modal open onClose={onClose} size="lg" title={d ? `Costo de ${d.recipe_code} · ${d.recipe_name} v${d.version}` : "Costo de la receta"}>
      {error && <Alert tone="bad">{error}</Alert>}
      {d && <div className="space-y-4">
        <DataTable rows={d.rows} rowKey={(r) => r.id} columns={[
          { key: "name", header: "Ingrediente", cardTitle: true, render: (r) => <span title={r.source === "STANDARD" ? "Sin stock: costo estándar de la variante" : "Costo promedio del stock"}>{r.name}</span> },
          { key: "qty_kg", header: "Kg por lote", align: "right", render: (r) => numero(r.qty_kg, 4) },
          { key: "cost", header: "Costo promedio", align: "right", render: (r) => soles(r.cost) },
          { key: "amount", header: "Importe", align: "right", render: (r) => soles(r.amount) },
          { key: "pct", header: "% del costo", align: "right", render: (r) => porcentaje(total ? (Number(r.amount) / total) * 100 : 0, 1) },
        ]} />
        <DetailList items={[
          { label: "Costo del lote base", value: soles(d.total) }, { label: "Kg base de salida", value: numero(d.base_output_kg, 3) },
          { label: "Costo por kg hoy", value: <b>{soles(d.per_kg)}</b> }, { label: "Costo al aprobar", value: d.standard_cost_per_kg !== null ? soles(d.standard_cost_per_kg) : "Aún no aprobada" },
          { label: "Variación", value: d.variation_pct !== null ? `${signo(d.variation_pct)}${porcentaje(d.variation_pct, 2)}` : "—" },
        ]} />
      </div>}
    </Modal>
  );
}
