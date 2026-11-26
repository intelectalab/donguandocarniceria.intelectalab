"use client";

import { useState } from "react";
import { ClipboardCheck, MessageSquareWarning, ShieldCheck, Sparkles, Thermometer, TriangleAlert } from "lucide-react";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { fecha, fechaHora, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Periodo } from "@/modulos/des/comunes";
import { Barras, CifraLink, Seccion, Tabla, qs, useAlAbrir, useDatos } from "@/modulos/cal/comunes";
import type { Num } from "@/modulos/pro/tipos";

type Tablero = {
  period: { from: string; to: string }; first_pass_release_pct: Num; lots_decided: number; rejected_or_held_pct: Num; lots_rejected_or_held: number; out_of_range_pct: Num; readings: number;
  readings_out: number; open_nc: number; open_nc_avg_age_days: Num; checklist_compliance_pct: Num; checklist_tasks: number; cleaning_compliance_pct: Num; cleaning_tasks: number;
  claims: number; delivered_orders: number; claims_per_1000: Num; digesa_without_registry: number;
  digesa_products: { id: string; code: string; name: string; expires: string | null }[];
  by_point: { id: string; code: string; name: string; readings: number; out_of_range: number; out_of_range_pct: Num }[];
  overdue_points: { id: string; code: string; name: string; reading_frequency_min: Num; last: string | null }[];
};

/** CAL-13 Tablero de calidad: KPI-CAL-01 a 08 del mes y lo que necesita atención hoy. */
export default function TableroCalidad() {
  const { local } = useSesion();
  const [mes, setMes] = useState("");
  useAlAbrir((p) => setMes(p.get("month") ?? ""));
  const { datos: t, error } = useDatos<Tablero>(`/v1/cal/tablero${qs({ month: mes, site: local })}`);
  const m = mes ? `?month=${mes}` : "";
  return (
    <div className="space-y-5">
      <PageHeader description={t ? `Indicadores del ${fecha(t.period.from)} al ${fecha(t.period.to)}.` : "Indicadores del mes."} actions={<Periodo mes={mes} setMes={setMes} />} />
      {error && <Alert tone="bad">{error}</Alert>}
      {t && t.digesa_without_registry > 0 && <Alert tone="bad" title={`${t.digesa_without_registry} producto(s) DIGESA sin registro vigente`}>Sus lotes no se liberan ni se etiquetan hasta renovar el registro.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Liberación a la primera" valor={t ? porcentaje(t.first_pass_release_pct, 1) : undefined} detalle={t ? `KPI-CAL-01 · ${t.lots_decided} lotes decididos` : undefined} icono={ShieldCheck} href="/m/cal/cal-07" />
        <CifraLink titulo="Retenidos o rechazados" valor={t ? porcentaje(t.rejected_or_held_pct, 1) : undefined} detalle={t ? `KPI-CAL-02 · ${t.lots_rejected_or_held} lotes` : undefined}
          icono={TriangleAlert} tono={t ? (t.lots_rejected_or_held ? "warn" : "ok") : undefined} href="/m/cal/cal-07" />
        <CifraLink titulo="Lecturas fuera de rango" valor={t ? porcentaje(t.out_of_range_pct, 2) : undefined} detalle={t ? `KPI-CAL-03 · ${t.readings_out} de ${numero(t.readings)}` : undefined} icono={Thermometer} href="/m/cal/cal-06" />
        <CifraLink titulo="No conformidades abiertas" valor={t ? String(t.open_nc) : undefined} detalle={t ? `KPI-CAL-04 · ${numero(t.open_nc_avg_age_days)} días en promedio` : undefined}
          icono={TriangleAlert} tono={t ? (t.open_nc ? "warn" : "ok") : undefined} href="/m/cal/cal-08" />
        <CifraLink titulo="Checklists cumplidos" valor={t ? porcentaje(t.checklist_compliance_pct, 1) : undefined} detalle={t ? `KPI-CAL-05 · ${t.checklist_tasks} tareas` : undefined} icono={ClipboardCheck} href="/m/cal/cal-02" />
        <CifraLink titulo="Limpieza cumplida" valor={t ? porcentaje(t.cleaning_compliance_pct, 1) : undefined} detalle={t ? `KPI-CAL-06 · ${t.cleaning_tasks} tareas` : undefined} icono={Sparkles} href={`/m/cal/cal-12${m}`} />
        <CifraLink titulo="Reclamos por mil pedidos" valor={t ? numero(t.claims_per_1000) : undefined} detalle={t ? `KPI-CAL-07 · ${t.claims} de ${numero(t.delivered_orders)} entregados` : undefined} icono={MessageSquareWarning} href="/m/cal/cal-11" />
        <CifraLink titulo="DIGESA sin registro" valor={t ? String(t.digesa_without_registry) : undefined} detalle="KPI-CAL-08 · productos" icono={ShieldCheck}
          tono={t ? (t.digesa_without_registry ? "bad" : "ok") : undefined} href="/m/cal/cal-10" />
      </div>
      {t && <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Lecturas fuera de rango por punto"><Barras filas={t.by_point.map((p) => ({ label: p.name, value: p.out_of_range_pct }))} formato={(v) => porcentaje(v, 1)} /></Seccion>
        <Seccion titulo="Puntos sin lectura a tiempo">
          <Tabla cabeza={["Punto", "Cada", "Última lectura"]} filas={t.overdue_points.map((p) => [<div key="p"><p>{p.name}</p><p className="text-[12px] text-muted">{p.code}</p></div>,
            `${numero(Number(p.reading_frequency_min ?? 0) / 60)} h`, p.last ? <Badge key="l" tone="warn">{fechaHora(p.last)}</Badge> : <Badge key="l" tone="bad">Nunca</Badge>])} vacio="Todos los puntos tienen su lectura al día." />
        </Seccion>
        {t.digesa_products.length > 0 && <Seccion titulo="Productos DIGESA sin registro vigente" className="lg:col-span-2">
          <Tabla cabeza={["Producto", "Código", "Venció"]} filas={t.digesa_products.map((p) => [p.name, p.code, fecha(p.expires)])} />
        </Seccion>}
      </div>}
    </div>
  );
}
