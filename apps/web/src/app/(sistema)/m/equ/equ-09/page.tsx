"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, CalendarCheck, CircleDollarSign, Scale } from "lucide-react";
import { Alert, Badge, DataTable, Input, PageHeader } from "@/components/ui";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Barras, CifraLink, qs, useDatos } from "@/modulos/equ/comunes";
import type { Num } from "@/modulos/equ/tipos";

type Tablero = {
  period: { from: string; to: string };
  availability: { value: Num; down_hours: Num; total_hours: Num; equipment: number };
  scales: { value: Num; ok: number; total: number };
  maintenance_cost: Num;
  preventive: { value: Num; on_time: number; total: number };
  availability_by_equipment: { code: string; name: string; pct: Num; down: Num }[];
  cost_by_site: { label: string; value: Num }[];
  cost_by_equipment: { label: string; value: Num }[];
  cost_by_month: { month: string; preventive: Num; corrective: Num }[];
  scales_list: { id: string; code: string; name: string; establishment_name: string; valid_until: string | null; usable: boolean; rule: string | null }[];
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

/** EQU-09 Tablero de equipos: KPI-EQU-01 a KPI-EQU-04 del mes, por equipo y local. */
export default function TableroEquipos() {
  const { local } = useSesion();
  const router = useRouter();
  const [mes, setMes] = useState("");
  const { datos: t, error } = useDatos<Tablero>(`/v1/equ/tablero${qs({ site: local, mes })}`);
  const maxMes = Math.max(1, ...(t?.cost_by_month ?? []).map((m) => Number(m.preventive) + Number(m.corrective)));

  return (
    <div className="space-y-5">
      <PageHeader description={t ? `Indicadores del ${fecha(t.period.from)} al ${fecha(t.period.to)}, por equipo y local.` : "Indicadores del mes, por equipo y local."}
        actions={<div className="w-[170px]"><Input type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.target.value)} /></div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Disponibilidad" valor={t?.availability.value != null ? porcentaje(t.availability.value, 2) : undefined}
          detalle={t ? `KPI-EQU-01 · ${numero(t.availability.down_hours, 1)} h fuera de servicio` : undefined} icono={Activity} href="/m/equ/equ-06" />
        <CifraLink titulo="Balanzas con calibración vigente" valor={t ? (t.scales.value != null ? porcentaje(t.scales.value, 1) : "—") : undefined}
          detalle={t ? `KPI-EQU-02 · ${t.scales.ok} de ${t.scales.total} · meta 100 %` : undefined} icono={Scale} tono={t ? (t.scales.ok === t.scales.total ? "ok" : "bad") : undefined} href="/m/equ/equ-04" />
        <CifraLink titulo="Costo de mantenimiento" valor={t ? soles(t.maintenance_cost) : undefined} detalle="KPI-EQU-03 · órdenes cerradas" icono={CircleDollarSign} href="/m/equ/equ-06" />
        <CifraLink titulo="Cumplimiento del preventivo" valor={t ? (t.preventive.value != null ? porcentaje(t.preventive.value, 1) : "—") : undefined}
          detalle={t ? `KPI-EQU-04 · ${t.preventive.on_time} de ${t.preventive.total} a tiempo` : undefined} icono={CalendarCheck} href="/m/equ/equ-05" />
      </div>
      {t && <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[14px] font-semibold">Disponibilidad por equipo (con paradas en el mes)</h2>
          {t.availability_by_equipment.length
            ? <Barras filas={t.availability_by_equipment.map((x) => ({ label: x.code, value: x.pct }))} formato={(v) => porcentaje(v, 1)} />
            : <p className="text-[13px] text-muted">Sin paradas en el mes.</p>}
          {t.availability_by_equipment.length > 0 && <p className="mt-2 text-[12px] text-muted">{t.availability_by_equipment.map((x) => `${x.code}: ${numero(x.down, 1)} h`).join(" · ")}</p>}
        </section>
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[14px] font-semibold">Costo de mantenimiento del mes</h2>
          <p className="mb-1 text-[12.5px] text-muted">Por local</p>
          <Barras filas={t.cost_by_site} formato={soles} />
          <p className="mt-4 mb-1 text-[12.5px] text-muted">Por equipo</p>
          <Barras filas={t.cost_by_equipment} formato={soles} />
        </section>
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-[14px] font-semibold">Costo de mantenimiento por mes</h2>
          <p className="mb-3 flex gap-3 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-primary" aria-hidden="true" />Preventivo</span>
            <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-warn" aria-hidden="true" />Correctivo</span>
          </p>
          <div className="flex h-44 items-end gap-2" role="img" aria-label="Costo de mantenimiento de los últimos 6 meses">
            {t.cost_by_month.map((m) => {
              const p = Number(m.preventive), c = Number(m.corrective);
              return (
                <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[11px] tabular-nums text-muted">{p + c ? soles(p + c).replace(".00", "") : ""}</span>
                  <div className="flex w-full max-w-[44px] flex-col justify-end overflow-hidden rounded-t-md" style={{ height: `${((p + c) / maxMes) * 75}%` }} title={`Preventivo ${soles(p)} · correctivo ${soles(c)}`}>
                    <div className="bg-warn" style={{ height: `${p + c ? (c / (p + c)) * 100 : 0}%` }} />
                    <div className="bg-primary" style={{ height: `${p + c ? (p / (p + c)) * 100 : 0}%` }} />
                  </div>
                  <span className="text-[11.5px] text-muted">{MESES[Number(m.month.slice(5)) - 1]}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="min-w-0 space-y-2">
          <h2 className="text-[14px] font-semibold">Balanzas</h2>
          <DataTable rows={t.scales_list} rowKey={(b) => b.id} onRowClick={(b) => router.push(`/m/equ/equ-02?id=${b.id}`)} columns={[
            { key: "code", header: "Balanza", cardTitle: true, render: (b) => <span><span className="font-mono font-semibold">{b.code}</span><span className="block text-[12px] text-muted">{b.name}</span></span> },
            { key: "establishment_name", header: "Local", render: (b) => b.establishment_name },
            { key: "valid_until", header: "Vigente hasta", render: (b) => fecha(b.valid_until) },
            { key: "usable", header: "Pesa ventas", render: (b) => b.usable ? <Badge tone="ok">Sí</Badge> : <Badge tone="bad">No ({b.rule})</Badge> },
          ]} />
        </section>
      </div>}
    </div>
  );
}
