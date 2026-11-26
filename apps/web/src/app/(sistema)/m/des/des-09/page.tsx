"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleDollarSign, Gauge, Scissors, TrendingDown } from "lucide-react";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { fecha, kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Periodo } from "@/modulos/des/comunes";
import { Barras, CifraLink, Seccion, Tabla, pp, qs, useAlAbrir, useDatos } from "@/modulos/pro/comunes";
import { ESPECIE, type Num } from "@/modulos/pro/tipos";

type Tablero = {
  period: { from: string; to: string }; orders: number; input_kg: Num; yield_vs_standard_pp: Num; waste_pct: Num; cost_per_useful_kg: Num; cuts_out_of_standard_pct: Num;
  cuts_out_of_standard: number; cuts: number; alert_pp: Num;
  by_species: { species: string; orders: number; input_kg: Num; waste_pct: Num; co_product_pct: Num; cost_per_useful_kg: Num }[];
  recent_alerts: { id: string; number: string; close_date: string; cut_alerts: { name: string; std: number; real: number; dev: number; operator: string | null }[] }[];
};

/** DES-09 Tablero de despiece: KPI-DES-01 a 04 del mes, por especie, con los cortes fuera de estándar recientes. */
export default function TableroDespiece() {
  const { local } = useSesion();
  const [mes, setMes] = useState("");
  useAlAbrir((p) => setMes(p.get("month") ?? ""));
  const { datos: t, error } = useDatos<Tablero>(`/v1/des/tablero${qs({ month: mes, site: local })}`);
  return (
    <div className="space-y-5">
      <PageHeader description={t ? `Despieces cerrados del ${fecha(t.period.from)} al ${fecha(t.period.to)}.` : "Indicadores del mes."} actions={<Periodo mes={mes} setMes={setMes} />} />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Rendimiento vs estándar" valor={t ? pp(t.yield_vs_standard_pp) : undefined} detalle={t ? `KPI-DES-01 · ${t.orders} despieces, ${kg(t.input_kg)}` : undefined} icono={Gauge} href="/m/des/des-07" />
        <CifraLink titulo="Merma" valor={t ? porcentaje(t.waste_pct, 1) : undefined} detalle="KPI-DES-02 · sobre la canal" icono={TrendingDown} />
        <CifraLink titulo="Costo por kg útil" valor={t ? soles(t.cost_per_useful_kg) : undefined} detalle="KPI-DES-03" icono={CircleDollarSign} href="/m/des/des-08" />
        <CifraLink titulo="Cortes fuera de estándar" valor={t ? porcentaje(t.cuts_out_of_standard_pct, 1) : undefined} detalle={t ? `KPI-DES-04 · ${t.cuts_out_of_standard} de ${t.cuts} pesadas` : undefined}
          icono={Scissors} tono={t ? (t.cuts_out_of_standard ? "warn" : "ok") : undefined} href="/m/des/des-07" />
      </div>
      {t && <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Merma por especie"><Barras filas={t.by_species.map((s) => ({ label: ESPECIE[s.species] ?? s.species, value: s.waste_pct }))} formato={(v) => porcentaje(v, 1)} /></Seccion>
        <Seccion titulo="Por especie">
          <Tabla cabeza={["Especie", "Despieces", "Kg", "Cortes", "Merma", "Costo/kg útil"]} filas={t.by_species.map((s) => [ESPECIE[s.species] ?? s.species, s.orders, kg(s.input_kg),
            porcentaje(s.co_product_pct, 1), porcentaje(s.waste_pct, 1), soles(s.cost_per_useful_kg)])} />
        </Seccion>
        <Seccion titulo="Cortes fuera de estándar recientes" className="lg:col-span-2">
          <Tabla cabeza={["Despiece", "Fecha", "Corte", "Real", "Estándar", "Desvío", "Operario"]}
            filas={t.recent_alerts.flatMap((o) => o.cut_alerts.map((a) => [<Link key="o" href={`/m/pro/pro-11?id=${o.id}`} className="font-mono text-primary hover:underline">{o.number}</Link>,
              fecha(o.close_date), a.name, porcentaje(a.real, 2), porcentaje(a.std, 1), <Badge key="d" tone="bad">{pp(a.dev)}</Badge>, a.operator ?? "—"]))}
            vacio={`Ningún corte se alejó más de ${numero(t.alert_pp)} pp de su estándar.`} />
        </Seccion>
      </div>}
    </div>
  );
}
