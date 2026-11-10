"use client";

import { useState } from "react";
import { Unlock } from "lucide-react";
import { DataTable, IconButton, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, kg } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, FiltroSelect, accion } from "@/modulos/alm/comunes";
import { RESERVA, type Num } from "@/modulos/alm/tipos";

type Reserva = { id: string; order_id: string; order_number: string; order_line_id: string; status: string; qty: Num; weight_kg: Num; delivery_date: string | null;
  reserved_at: string; closed_at: string | null; released_reason: string | null; released_by_name: string | null; sku: string; variant_name: string; sale_mode: string;
  warehouse_code: string; lot_code: string | null; expiry_date: string | null };

/** ALM-10 Reservas: activas por pedido, lote y almacén; liberación a mano con motivo y permiso. */
export default function Reservas() {
  const { marca, local, can } = useSesion();
  const [estado, setEstado] = useState("ACTIVE");
  const lista = useListado<Reserva>("/v1/alm/reservas", { orden: "delivery_date", filtros: { status: estado, site: local, brand: marca } });
  const libera = can("alm.reservation.release");

  async function liberar(r: Reserva) {
    await accion({ title: `¿Liberar la reserva de ${r.order_number}?`, message: `${r.sku} · ${r.lot_code ?? "sin lote"} en ${r.warehouse_code}. La línea del pedido queda sin stock reservado.`,
      confirmLabel: "Liberar", danger: true, reason: { min: 5 } },
    (m) => api(`/v1/alm/reservas/${r.id}/liberar`, { method: "POST", body: { reason: m } }), "Reserva liberada", lista.recargar);
  }

  const columnas: Column<Reserva>[] = [
    { key: "order_number", header: "Pedido", sortable: true, cardTitle: true, render: (r) => <span className="font-mono font-semibold">{r.order_number}</span> },
    { key: "delivery_date", header: "Entrega", sortable: true, render: (r) => fecha(r.delivery_date) },
    { key: "sku", header: "Producto", render: (r) => <div className="min-w-[160px]"><p>{r.variant_name}</p><p className="font-mono text-[12px] text-muted">{r.sku}</p></div> },
    { key: "lot_code", header: "Lote", render: (r) => r.lot_code ? <div><p className="font-mono">{r.lot_code}</p><p className="text-[12px] text-muted">Vence {fecha(r.expiry_date)}</p></div> : "—" },
    { key: "warehouse_code", header: "Almacén", hideOnMobile: true, render: (r) => <span className="font-mono">{r.warehouse_code}</span> },
    { key: "qty", header: "Cantidad", sortable: true, align: "right", render: (r) => <div><Cant v={r.qty} modo={r.sale_mode} />{r.weight_kg !== null && r.sale_mode !== "KG" && <p className="text-[12px] text-muted">{kg(r.weight_kg)}</p>}</div> },
    { key: "reserved_at", header: "Reservada", sortable: true, hideOnMobile: true, render: (r) => fechaHora(r.reserved_at) },
    ...(estado === "RELEASED" ? [{ key: "released_reason", header: "Motivo", render: (r: Reserva) => <div><p>{r.released_reason ?? "—"}</p>{r.released_by_name && <p className="text-[12px] text-muted">{r.released_by_name}</p>}</div> }] as Column<Reserva>[] : []),
    { key: "status", header: "Estado", render: (r) => <StatusBadge status={r.status} labels={RESERVA} /> },
    ...(libera && estado === "ACTIVE" ? [{ key: "acciones", header: "", align: "right", render: (r: Reserva) => <IconButton icon={Unlock} label="Liberar reserva" onClick={() => liberar(r)} /> }] as Column<Reserva>[] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Stock apartado para pedidos confirmados, por lote y almacén (FEFO). Se libera solo al cancelar el pedido o a mano, con motivo." />
      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar pedido, SKU o lote…" }} empty="No hay reservas con ese estado."
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={(v) => setEstado(v || "ACTIVE")}
          options={[{ value: "ACTIVE", label: "Activas" }, { value: "RELEASED", label: "Liberadas" }, { value: "CONSUMED", label: "Despachadas" }]} />} />
    </div>
  );
}
