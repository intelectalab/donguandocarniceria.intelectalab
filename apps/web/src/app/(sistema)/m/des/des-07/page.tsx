"use client";

import { useState } from "react";
import { Alert, Badge, DataTable, PageHeader, Tabs, type Column } from "@/components/ui";
import { fecha, kg, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Periodo } from "@/modulos/des/comunes";
import { FiltroSelect, pp, qs, useAlAbrir, useDatos } from "@/modulos/pro/comunes";
import { ESPECIE, type Num } from "@/modulos/pro/tipos";

type Fila = { key: string; species: string; cut: string | null; records: number; kg: Num; standard_pct: Num; actual_pct: Num; deviation_pp: Num; out_of_standard: number };
type Datos = { period: { from: string; to: string }; group: string; alert_pp: Num; data: Fila[]; filters: { species: string[]; suppliers: string[]; operators: string[] } };
type Grupo = "cut" | "operator" | "supplier" | "species";
const TITULO: Record<Grupo, string> = { cut: "Corte", operator: "Operario", supplier: "Proveedor", species: "Especie" };

/** DES-07 Rendimiento por corte: real contra estándar, por corte, operario, proveedor o especie (KPI-DES-02). */
export default function RendimientoPorCorte() {
  const { local } = useSesion();
  const [mes, setMes] = useState("");
  const [grupo, setGrupo] = useState<Grupo>("cut");
  const [especie, setEspecie] = useState("");
  useAlAbrir((p) => setMes(p.get("month") ?? ""));
  const { datos: d, error } = useDatos<Datos>(`/v1/des/cortes${qs({ month: mes, group: grupo, species: especie, site: local })}`);
  const columnas: Column<Fila>[] = [
    { key: "key", header: TITULO[grupo], cardTitle: true, render: (f) => <span className="font-medium">{grupo === "species" ? ESPECIE[f.key] ?? f.key : f.key ?? "Sin dato"}</span> },
    ...(grupo !== "species" ? [{ key: "species", header: "Especie", render: (f: Fila) => ESPECIE[f.species] ?? f.species }] : []),
    { key: "records", header: "Pesadas", align: "right" },
    { key: "kg", header: "Kg", align: "right", render: (f) => kg(f.kg) },
    ...(grupo === "cut" ? [{ key: "standard_pct", header: "Estándar", align: "right" as const, render: (f: Fila) => porcentaje(f.standard_pct, 1) }] : []),
    { key: "actual_pct", header: "Real promedio", align: "right", render: (f) => porcentaje(f.actual_pct, 2) },
    { key: "deviation_pp", header: "Desvío promedio", align: "right", render: (f) => <Badge tone={Math.abs(Number(f.deviation_pp)) > Number(d?.alert_pp ?? 3) ? "bad" : "ok"}>{pp(f.deviation_pp)}</Badge> },
    { key: "out_of_standard", header: "Fuera de estándar", align: "right", render: (f) => f.out_of_standard ? <Badge tone="bad">{f.out_of_standard}</Badge> : "0" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description={d ? `Despieces cerrados del ${fecha(d.period.from)} al ${fecha(d.period.to)}. Un corte está fuera de estándar si se aleja más de ${pp(d.alert_pp).replace("+", "±")}.` : "Rendimiento real contra el estándar."}
        actions={<Periodo mes={mes} setMes={setMes} />} />
      {error && <Alert tone="bad">{error}</Alert>}
      <Tabs value={grupo} onChange={setGrupo} tabs={(Object.keys(TITULO) as Grupo[]).map((k) => ({ key: k, label: `Por ${TITULO[k].toLowerCase()}` }))} />
      <DataTable rows={d?.data ?? []} rowKey={(f) => `${f.species}-${f.key}`} columns={columnas} loading={!d && !error} empty="No hay despieces cerrados en el período."
        toolbar={<FiltroSelect label="Especie" value={especie} onChange={setEspecie} options={(d?.filters.species ?? []).map((s) => ({ value: s, label: ESPECIE[s] ?? s }))} />} />
    </div>
  );
}
