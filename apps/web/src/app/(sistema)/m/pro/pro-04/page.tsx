"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Factory, Gauge, Plus } from "lucide-react";
import { Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fecha, kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { CifraLink, FiltroSelect, Semaforo, pp, qs, useDatos, useOpcionesPro } from "@/modulos/pro/comunes";
import { ESTADO_ORDEN, TIPO_ORDEN, opciones, opcionesDe, type Num } from "@/modulos/pro/tipos";

type Fila = {
  id: string; number: string; order_type: string; status: string; planned_date: string; close_date: string | null; planned_output_kg: Num; main_kg: Num; waste_pct: Num;
  actual_yield_pct: Num; yield_deviation_pp: Num; line_code: string; establishment_name: string; product_name: string | null; brand_name: string | null; supervisor_name: string | null;
  cost_per_kg: Num; cost_deviation_pct: Num; yield_light: string | null; cost_light: string | null; critical_deviation: boolean;
};
type Tablero = { kpis: { orders: number; produced_kg: Num; waste_pct: Num; plan_compliance_pct: Num } };

/** PRO-04 Órdenes de producción, con semáforo de rendimiento y costo. */
export default function Ordenes() {
  const { local, puede } = useSesion();
  const router = useRouter();
  const op = useOpcionesPro();
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [linea, setLinea] = useState("");
  const lista = useListado<Fila>("/v1/pro/ordenes", { orden: "-planned_date", filtros: { status: estado, order_type: tipo, line_id: linea, site: local } });
  const t = useDatos<Tablero>(`/v1/pro/tablero${qs({ site: local })}`).datos;
  const abiertas = useDatos<{ total: number }>(`/v1/pro/ordenes${qs({ abiertas: "SI", site: local, per_page: 1 })}`).datos;
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Orden", sortable: true, render: (o) => <span className="font-mono font-semibold whitespace-nowrap">{o.number}</span> },
    { key: "product_name", header: "Producto", cardTitle: true, render: (o) => <div className="min-w-[160px]"><p className="font-medium">{o.product_name ?? "—"}</p><p className="text-[12px] text-muted">{TIPO_ORDEN[o.order_type]} · {o.brand_name ?? ""}</p></div> },
    { key: "line_code", header: "Línea", render: (o) => <span className="whitespace-nowrap">{o.line_code}<span className="text-muted"> · {o.establishment_name}</span></span> },
    { key: "planned_date", header: "Fecha", sortable: true, render: (o) => fecha(o.close_date ?? o.planned_date) },
    { key: "planned_output_kg", header: "Plan / real", align: "right", sortable: true, render: (o) => <span className="whitespace-nowrap">{kg(o.planned_output_kg)}<span className="block text-[11.5px] text-muted">{o.main_kg !== null ? kg(o.main_kg) : ""}</span></span> },
    { key: "actual_yield_pct", header: "Rendimiento", align: "right", sortable: true, render: (o) => o.actual_yield_pct === null ? "—" : <Semaforo luz={o.yield_light}>{porcentaje(o.actual_yield_pct, 1)} <span className="text-[11.5px] text-muted">{pp(o.yield_deviation_pp)}</span></Semaforo> },
    { key: "waste_pct", header: "Merma", align: "right", hideOnMobile: true, render: (o) => porcentaje(o.waste_pct, 1) },
    ...(op?.can.cost ? [{ key: "cost_per_kg", header: "Costo por kg", align: "right" as const, sortable: true, render: (o: Fila) => o.cost_per_kg === null ? "—" : <Semaforo luz={o.cost_light}>{soles(o.cost_per_kg)}</Semaforo> }] : []),
    { key: "status", header: "Estado", sortable: true, render: (o) => <span className="flex flex-wrap gap-1"><StatusBadge status={o.status} labels={ESTADO_ORDEN} />{o.critical_deviation && <StatusBadge status="CCP" labels={{ CCP: ["Desvío crítico", "bad"] }} />}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Recetas, despieces y envasados del local. El semáforo compara el rendimiento con lo esperado y el costo por kg con el estándar de la receta."
        actions={op?.can.create && puede("PRO", "C") && <Button variant="primary" icon={Plus} onClick={() => router.push("/m/pro/pro-05")}>Nueva orden</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Abiertas" valor={abiertas ? numero(abiertas.total) : undefined} detalle="Planificadas, liberadas y en proceso" icono={ClipboardList} onClick={() => setEstado("PLANNED,RELEASED,IN_PROGRESS")} />
        <CifraLink titulo="Producido este mes" valor={t ? kg(t.kpis.produced_kg) : undefined} detalle={t ? `${t.kpis.orders} órdenes cerradas` : undefined} icono={Factory} href="/m/pro/pro-12" />
        <CifraLink titulo="Merma del mes" valor={t ? porcentaje(t.kpis.waste_pct, 1) : undefined} detalle="Sobre lo que entró" icono={Gauge} href="/m/pro/pro-12" />
        <CifraLink titulo="Cumplimiento del plan" valor={t ? porcentaje(t.kpis.plan_compliance_pct, 1) : undefined} detalle="Órdenes cerradas a tiempo" icono={ClipboardList} href="/m/pro/pro-12" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(o) => router.push(`/m/pro/pro-11?id=${o.id}`)}
        search={{ ...lista.tabla.search, placeholder: "Buscar orden, producto, línea o supervisor…" }} empty="No hay órdenes con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_ORDEN)} />
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opciones(TIPO_ORDEN)} />
          <FiltroSelect label="Línea" value={linea} onChange={setLinea} options={(op?.lines ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} ancho="sm:w-[220px]" />
        </>} />
    </div>
  );
}
