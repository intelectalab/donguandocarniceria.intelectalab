"use client";

import type { ReactNode } from "react";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { BadgeItemSep, type ItemSep, soles } from "./comun";

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] font-semibold uppercase text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px]">{children}</dd>
    </div>
  );
}

export function DetalleItemSep({ item }: { item: ItemSep }) {
  const almacen = item.warehouse_name || item.warehouse_code || item.warehouse_id;

  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      <Campo label="Tipo">{item.item_type_name}</Campo>
      <Campo label="Acción">{item.action_name}</Campo>
      <Campo label="Estado"><BadgeItemSep status={item.status} /></Campo>
      {item.qty != null && <Campo label="Cantidad">{`${numero(item.qty, 3)} ${item.uom}`}</Campo>}
      {item.qty_at_cutoff != null && <Campo label="Saldo al corte">{`${numero(item.qty_at_cutoff, 3)} ${item.uom}`}</Campo>}
      {item.received_qty != null && <Campo label="Recibido en destino">{`${numero(item.received_qty, 3)} ${item.uom}`}</Campo>}
      {item.amount != null && <Campo label="Importe">{soles(item.amount)}</Campo>}
      {almacen && <Campo label="Almacén">{almacen}</Campo>}
      {item.expiry_date && <Campo label="Vence">{fecha(item.expiry_date)}</Campo>}
      {item.unit_cost != null && <Campo label="Costo promedio">{soles(item.unit_cost)}</Campo>}
      <Campo label="Intentos">{String(item.attempts)}</Campo>
      <Campo label="Ejecutado">{fechaHora(item.executed_at)}</Campo>
      <Campo label="Resultado">{item.result || "—"}</Campo>
      {item.error && <Campo label="Error"><span className="text-bad">{item.error}</span></Campo>}
      {item.exclude_reason && <Campo label="Motivo de exclusión">{item.exclude_reason}</Campo>}
      {item.note && <Campo label="Nota">{item.note}</Campo>}
    </dl>
  );
}
