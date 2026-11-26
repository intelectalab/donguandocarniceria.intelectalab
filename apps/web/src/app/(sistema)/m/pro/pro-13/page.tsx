"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, PageHeader, StatusBadge, Tabs, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, kg } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { accion, useOpcionesPro } from "@/modulos/pro/comunes";
import { ESTADO_ORDEN, TIPO_ORDEN, type Num } from "@/modulos/pro/tipos";

type Fila = { id: string; number: string; order_type: string; status: string; planned_date: string; planned_output_kg: Num; product_name: string | null; line_code: string; establishment_name: string; supervisor_name: string | null };

/** PRO-13 Anulación: solo una orden planificada o liberada sin consumos; deja el motivo y libera lo reservado (RN-PRO-10). */
export default function Anulacion() {
  const { local, puede } = useSesion();
  const router = useRouter();
  const op = useOpcionesPro();
  const [vista, setVista] = useState<"anulables" | "anuladas">("anulables");
  const lista = useListado<Fila>("/v1/pro/ordenes", { orden: "-planned_date", filtros: { status: vista === "anulables" ? "PLANNED,RELEASED" : "VOIDED", site: local } });
  const anula = Boolean(op?.can.void) && puede("PRO", "A");
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Orden", render: (o) => <span className="font-mono font-semibold">{o.number}</span> },
    { key: "product_name", header: "Producto", cardTitle: true, render: (o) => <div><p className="font-medium">{o.product_name ?? "—"}</p><p className="text-[12px] text-muted">{TIPO_ORDEN[o.order_type]}</p></div> },
    { key: "line_code", header: "Línea", render: (o) => `${o.line_code} · ${o.establishment_name}` },
    { key: "planned_date", header: "Fecha", render: (o) => fecha(o.planned_date) },
    { key: "planned_output_kg", header: "Kg", align: "right", render: (o) => kg(o.planned_output_kg) },
    { key: "status", header: "Estado", render: (o) => <StatusBadge status={o.status} labels={ESTADO_ORDEN} /> },
    ...(vista === "anulables" && anula ? [{ key: "acc", header: "", render: (o: Fila) => <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation();
      void accion({ title: `¿Anular ${o.number}?`, message: "Solo se anula si aún no tiene consumos ni producción. Lo reservado vuelve al stock.", confirmLabel: "Anular", danger: true, reason: { min: 5 } },
        (m) => api(`/v1/pro/ordenes/${o.id}/anular`, { method: "POST", body: { reason: m } }), `Orden ${o.number} anulada`, lista.recargar); }}>Anular</Button> }] : []),
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Una orden con consumos o producción ya no se anula: se cierra con su merma. La anulación deja el motivo y quién la hizo." />
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "anulables", label: "Se pueden anular" }, { key: "anuladas", label: "Anuladas" }]} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(o) => router.push(`/m/pro/pro-11?id=${o.id}`)} empty={vista === "anulables" ? "No hay órdenes planificadas o liberadas." : "No hay órdenes anuladas."} />
    </div>
  );
}
