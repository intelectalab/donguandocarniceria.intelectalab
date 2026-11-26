"use client";

import { useState } from "react";
import { Alert, Badge, DataTable, PageHeader, type Column } from "@/components/ui";
import { fecha, kg, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Periodo } from "@/modulos/des/comunes";
import { pp, qs, tonoDesvio, useAlAbrir, useDatos } from "@/modulos/pro/comunes";
import { ESPECIE, type Num } from "@/modulos/pro/tipos";

type Fila = { supplier: string | null; species: string; orders: number; input_kg: Num; useful_kg: Num; yield_pct: Num; yield_vs_standard_pp: Num; waste_pct: Num; cost_per_useful_kg: Num };

/** DES-08 Comparación de proveedores: rendimiento útil, merma y costo por kg útil de cada camal o productor (KPI-DES-03). */
export default function Proveedores() {
  const { local } = useSesion();
  const [mes, setMes] = useState("");
  useAlAbrir((p) => setMes(p.get("month") ?? ""));
  const { datos: d, error } = useDatos<{ period: { from: string; to: string }; data: Fila[] }>(`/v1/des/proveedores${qs({ month: mes, site: local })}`);
  const columnas: Column<Fila>[] = [
    { key: "supplier", header: "Proveedor", cardTitle: true, render: (f) => <span className="font-medium">{f.supplier ?? "Sin proveedor"}</span> },
    { key: "species", header: "Especie", render: (f) => ESPECIE[f.species] ?? f.species },
    { key: "orders", header: "Despieces", align: "right" },
    { key: "input_kg", header: "Kg de entrada", align: "right", render: (f) => kg(f.input_kg) },
    { key: "useful_kg", header: "Kg útiles", align: "right", render: (f) => kg(f.useful_kg) },
    { key: "yield_pct", header: "Rendimiento útil", align: "right", render: (f) => porcentaje(f.yield_pct, 2) },
    { key: "yield_vs_standard_pp", header: "Contra el estándar", align: "right", render: (f) => <Badge tone={tonoDesvio(f.yield_vs_standard_pp)}>{pp(f.yield_vs_standard_pp)}</Badge> },
    { key: "waste_pct", header: "Merma", align: "right", render: (f) => porcentaje(f.waste_pct, 1) },
    { key: "cost_per_useful_kg", header: "Costo por kg útil", align: "right", render: (f) => soles(f.cost_per_useful_kg) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description={d ? `Despieces cerrados del ${fecha(d.period.from)} al ${fecha(d.period.to)}, por proveedor de la canal.` : "Comparación de proveedores."} actions={<Periodo mes={mes} setMes={setMes} />} />
      {error && <Alert tone="bad">{error}</Alert>}
      <DataTable rows={d?.data ?? []} rowKey={(f) => `${f.species}-${f.supplier}`} columns={columnas} loading={!d && !error} empty="No hay despieces cerrados en el período." />
    </div>
  );
}
