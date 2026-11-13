"use client";

import { useState } from "react";
import { Divide, Percent, Scale, Wallet } from "lucide-react";
import { Alert, Cifra, DataTable, Field, Input, PageHeader, type Column } from "@/components/ui";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { NavVersion, SelectorVersion, num, useDatos, useVersion, useVersionElegida } from "@/modulos/rec/comunes";

type Linea = { seq: number; variant_id: string; sku: string; name: string; base_kg: string; kg: string; tolerance_pct: string; tolerance_kg: string; is_additive: boolean; available_kg: string };
type Escalado = { version_id: string; version: number; base_output_kg: string; target_kg: string; factor: string; lines: Linea[]; total_kg: string;
  expected_yield_pct: string | null; batch_cost: string | null; status: string };

/** REC-08 Escalado: kg deseados → factor y kg de cada ingrediente (redondeado a 3 decimales). Es lo que usa la orden de producción. */
export default function EscaladoPantalla() {
  const { can } = useSesion();
  const sel = useVersionElegida("APPROVED");
  const v = useVersion(sel.id);
  const [kg, setKg] = useState("25");
  const deseado = num(kg);
  const e = useDatos<Escalado>(sel.id && deseado && deseado > 0 ? `/v1/rec/versiones/${sel.id}/escalado?kg=${deseado}` : null);
  const columnas: Column<Linea>[] = [
    { key: "seq", header: "#", align: "right", hideOnMobile: true, render: (l) => l.seq },
    { key: "name", header: "Ingrediente", cardTitle: true, render: (l) => <div><p>{l.name}</p><p className="font-mono text-[12px] text-muted">{l.sku}</p></div> },
    { key: "base_kg", header: "Kg base", align: "right", render: (l) => numero(l.base_kg, 4) },
    { key: "kg", header: "Kg escalados", align: "right", render: (l) => <b className="tabular-nums">{numero(l.kg, 3)}</b> },
    { key: "tolerance_kg", header: "Tolerancia", align: "right", render: (l) => `± ${numero(l.tolerance_kg, 3)} kg` },
    { key: "available_kg", header: "Stock liberado", align: "right", render: (l) => <span className={Number(l.available_kg) < Number(l.kg) ? "font-bold text-bad" : ""}>{numero(l.available_kg, 3)}</span> },
  ];
  const faltan = e.datos?.lines.filter((l) => Number(l.available_kg) < Number(l.kg)).length ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader description="Escribe los kg que quieres producir: factor = kg deseados / kg base, y cada ingrediente = kg base × factor, redondeado a 3 decimales. La orden de producción usa este mismo cálculo." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <SelectorVersion id={sel.id} lista={sel.lista} onChange={sel.elegir} version={v.datos} />
        <div className="w-full sm:w-[180px]"><Field label="Kg deseados"><Input inputMode="decimal" suffix="kg" value={kg} onChange={(x) => setKg(x.target.value)} /></Field></div>
      </div>
      {!sel.cargando && !sel.id && <Alert tone="info">No hay versiones aprobadas para escalar.</Alert>}
      {v.datos && <NavVersion v={v.datos} actual="rec-08" costos={can("rec.cost.view")} />}
      {v.datos && v.datos.status !== "APPROVED" && <Alert tone="warn">Esta versión no está aprobada: la orden de producción solo usa la versión vigente.</Alert>}
      {e.error && <Alert tone="bad">{e.error}</Alert>}
      {e.datos && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra destacada titulo="Factor de escala" valor={numero(e.datos.factor, 4)} detalle={`${numero(e.datos.target_kg, 3)} / ${numero(e.datos.base_output_kg, 3)} kg base`} icono={Divide} />
          <Cifra titulo="Kg de ingredientes" valor={numero(e.datos.total_kg, 3)} icono={Scale} tono={faltan ? "warn" : undefined} detalle={faltan ? `${faltan} sin stock suficiente` : "Con stock liberado"} />
          <Cifra titulo="Rendimiento esperado" valor={porcentaje(e.datos.expected_yield_pct, 2)} icono={Percent} />
          {can("rec.cost.view") && <Cifra titulo="Costo estándar del lote" valor={soles(e.datos.batch_cost)} icono={Wallet} />}
        </div>
        <DataTable columns={columnas} rows={e.datos.lines} rowKey={(l) => l.variant_id} loading={e.cargando} empty="La versión no tiene ingredientes." />
      </>}
    </div>
  );
}
