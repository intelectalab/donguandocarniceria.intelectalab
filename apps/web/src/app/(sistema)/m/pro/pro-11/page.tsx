"use client";

import { useState } from "react";
import { Alert, Badge, Button, DetailList, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, kg } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import {
  CabeceraOrden, ElegirOrden, PanelCierre, PanelConsumo, PanelControl, PanelPersonal, PanelProduccion, Seccion, Tabla, accion, useFicha, useOrdenElegida,
} from "@/modulos/pro/comunes";
import { ESTADO_LOTE, TIPO_ORDEN } from "@/modulos/pro/tipos";

type Pestana = "resumen" | "consumo" | "control" | "produccion" | "personal" | "cierre" | "calidad";

/** PRO-11 Ficha de la orden: toda su historia, desde la creación hasta el cierre, con la calidad de sus lotes. */
export default function FichaOrden() {
  const { puede } = useSesion();
  const sel = useOrdenElegida("PLANNED,RELEASED,IN_PROGRESS,CLOSED,VOIDED");
  const id = sel.id;
  const [tab, setTab] = useState<Pestana>("resumen");
  const { datos: f, error, recargar } = useFicha(id || null);
  const o = f?.order;
  return (
    <div className="space-y-4">
      <PageHeader description="Elige una orden para ver sus consumos, lecturas, producción, personal, costo y la decisión de Calidad sobre sus lotes."
        actions={o && o.status === "PLANNED" && f.can.release && puede("PRO", "E") && <Button variant="primary"
          onClick={() => accion({ title: `¿Liberar ${o.number}?`, confirmLabel: "Liberar", message: "Se reservan los insumos con FEFO." }, () => api(`/v1/pro/ordenes/${o.id}/liberar`, { method: "POST" }), `Orden ${o.number} liberada`, recargar)}>
          Liberar orden</Button>} />
      <ElegirOrden {...sel} />
      {error && <Alert tone="bad">{error}</Alert>}
      {f && o && o.id === id && <>
        <CabeceraOrden f={f} />
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: "resumen", label: "Resumen" }, { key: "consumo", label: "Consumo", count: f.consumptions.length },
          ...(o.order_type === "RECIPE" ? [{ key: "control" as const, label: "Puntos de control", count: f.readings.length }] : []),
          { key: "produccion", label: o.order_type === "CUTTING" ? "Cortes" : "Producción", count: f.outputs.length }, { key: "personal", label: "Personal y equipos" },
          { key: "cierre", label: "Cierre y costo" }, { key: "calidad", label: "Calidad", count: f.quality.length + f.nonconformities.length },
        ]} />
        {tab === "resumen" && <div className="grid gap-4 lg:grid-cols-2">
          <Seccion titulo="Datos">
            <DetailList items={[
              { label: "Tipo", value: TIPO_ORDEN[o.order_type] }, { label: o.order_type === "CUTTING" ? "Plantilla" : "Receta", value: o.order_type === "CUTTING" ? `${o.template_code} · ${o.template_name} v${o.template_version}` : o.recipe_code ? `${o.recipe_code} · ${o.recipe_name} v${o.recipe_version}` : "—" },
              { label: "Sale", value: o.output_sku ? `${o.output_sku} · ${o.output_variant_name}` : o.product_name }, { label: "Marca", value: o.brand_name },
              { label: "Línea", value: `${o.line_code} · ${o.line_name}` }, { label: "Supervisor", value: o.supervisor_name },
              { label: "Planificada", value: `${fecha(o.planned_date)} · ${kg(o.planned_output_kg)}` }, { label: "Liberada", value: fechaHora(o.released_at) },
              { label: "Empezó", value: fechaHora(o.started_at) }, { label: "Cerrada", value: o.closed_at ? `${fechaHora(o.closed_at)}${o.closed_by_name ? ` · ${o.closed_by_name}` : ""}` : "—" },
              ...(o.status === "VOIDED" ? [{ label: "Motivo de anulación", value: o.void_reason }] : []),
              ...(o.yield_deviation_reason ? [{ label: "Motivo del desvío", value: o.yield_deviation_reason }] : []),
              ...(o.waste_reason ? [{ label: "Motivo de la merma", value: o.waste_reason }] : []),
              ...(o.notes ? [{ label: "Notas", value: o.notes }] : []),
            ]} />
          </Seccion>
          <Seccion titulo="Historial">
            <ol className="space-y-2 text-[13px]">
              {(o.history ?? []).map((h, i) => <li key={i} className="border-l-2 border-line pl-3"><p><b>{h.action}</b> · {h.detail}</p><p className="text-[12px] text-muted">{fechaHora(h.at)} · {h.user}</p></li>)}
            </ol>
          </Seccion>
        </div>}
        {tab === "consumo" && <PanelConsumo f={f} onCambio={recargar} />}
        {tab === "control" && <PanelControl f={f} onCambio={recargar} />}
        {tab === "produccion" && <PanelProduccion f={f} onCambio={recargar} />}
        {tab === "personal" && <PanelPersonal f={f} onCambio={recargar} />}
        {tab === "cierre" && <PanelCierre f={f} onCambio={recargar} />}
        {tab === "calidad" && <div className="grid gap-4 lg:grid-cols-2">
          <Seccion titulo="Decisiones de Calidad sobre los lotes">
            <Tabla cabeza={["Lote", "Decisión", "Fecha", "Motivo"]} filas={f.quality.map((q) => [<span key="l" className="font-mono">{q.lot_code}</span>,
              <StatusBadge key="s" status={q.new_status} labels={ESTADO_LOTE} />, fechaHora(q.decided_at), q.reason ?? "—"])} vacio="Calidad aún no decide sobre los lotes de esta orden." />
          </Seccion>
          <Seccion titulo="No conformidades">
            <Tabla cabeza={["Número", "Gravedad", "Estado", "Descripción"]} filas={f.nonconformities.map((n) => [<span key="n" className="font-mono">{n.number}</span>,
              <Badge key="g" tone={n.severity === "CRITICAL" ? "bad" : n.severity === "MAJOR" ? "warn" : "neutral"}>{n.severity === "CRITICAL" ? "Crítica" : n.severity === "MAJOR" ? "Mayor" : "Menor"}</Badge>,
              n.status === "CLOSED" ? "Cerrada" : "Abierta", n.description])} vacio="Sin no conformidades." />
          </Seccion>
        </div>}
      </>}
    </div>
  );
}
