"use client";

import { useState } from "react";
import { Alert, Badge, DataTable, Input, PageHeader, type Column } from "@/components/ui";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { qs, useDatos } from "@/modulos/pro/comunes";
import type { Num } from "@/modulos/pro/tipos";

type Fila = { variant_id: string; sku: string; name: string; sale_mode: string; packaging: boolean; warehouse_code: string | null; required: Num; released_stock: Num; shortage: Num; estimated_cost: Num; orders: string[] };
type Req = { from: string; to: string; orders: number; data: Fila[]; totals: { items_short: number; estimated_cost: Num }; purchase_module: boolean };

/** PRO-03 Requerimiento de insumos: lo que piden las órdenes planificadas contra el stock liberado del almacén de insumos de cada línea. */
export default function Requerimiento() {
  const { local } = useSesion();
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const { datos: r, error } = useDatos<Req>(`/v1/pro/requerimiento${qs({ from: desde, to: hasta, site: local })}`);
  const u = (f: Fila) => (f.sale_mode === "KG" ? "kg" : "u");
  const columnas: Column<Fila>[] = [
    { key: "name", header: "Insumo", cardTitle: true, render: (f) => <div className="min-w-[170px]"><p className="font-medium">{f.name}</p><p className="font-mono text-[12px] text-muted">{f.sku}{f.packaging ? " · empaque" : ""}</p></div> },
    { key: "warehouse_code", header: "Almacén", render: (f) => <span className="font-mono text-[12.5px]">{f.warehouse_code ?? "—"}</span> },
    { key: "required", header: "Necesario", align: "right", render: (f) => `${numero(f.required, 3)} ${u(f)}` },
    { key: "released_stock", header: "Stock liberado", align: "right", render: (f) => `${numero(f.released_stock, 3)} ${u(f)}` },
    { key: "shortage", header: "Falta", align: "right", render: (f) => Number(f.shortage) > 0 ? <Badge tone="bad">{numero(f.shortage, 3)} {u(f)}</Badge> : <Badge tone="ok">Cubierto</Badge> },
    { key: "estimated_cost", header: "Costo estimado", align: "right", render: (f) => Number(f.estimated_cost) ? soles(f.estimated_cost) : "—" },
    { key: "orders", header: "Órdenes", hideOnMobile: true, render: (f) => <span className="font-mono text-[12px]">{f.orders.join(", ")}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={r ? `Órdenes planificadas y liberadas del ${fecha(r.from)} al ${fecha(r.to)} (${r.orders}). El stock que cuenta es el liberado y sin vencer.` : "Insumos que piden las órdenes de la semana."}
        actions={<div className="flex gap-2">
          <div className="w-[150px]"><Input type="date" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="w-[150px]"><Input type="date" aria-label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        </div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {r && <Alert tone={r.totals.items_short ? "warn" : "ok"}>
        {r.totals.items_short ? `${r.totals.items_short} insumo(s) por comprar, unos ${soles(r.totals.estimated_cost)} a costo estándar.` : "El stock cubre todas las órdenes del período."}
        {r.totals.items_short > 0 && " Pásalo a Compras para su pedido; desde aquí no se genera la orden de compra."}
      </Alert>}
      <DataTable rows={r?.data ?? []} rowKey={(f) => `${f.variant_id}-${f.warehouse_code}`} columns={columnas} loading={!r && !error} empty="No hay órdenes planificadas en el período." />
    </div>
  );
}
