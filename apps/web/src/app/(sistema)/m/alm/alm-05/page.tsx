"use client";

import { useState } from "react";
import Link from "next/link";
import { Checkbox, DataTable, Modal, PageHeader, StatusBadge, buttonClass, type Column } from "@/components/ui";
import { fecha } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, Dias, FiltroSelect } from "@/modulos/alm/comunes";
import { LoteFicha } from "@/modulos/alm/LoteFicha";
import { ESTADOS_LOTE, LOTE, type Lote } from "@/modulos/alm/tipos";

/** ALM-05 Lotes: estado, vencimiento, stock por almacén y pedidos que lo usaron. */
export default function Lotes() {
  const { marca, puede } = useSesion();
  const [estado, setEstado] = useState("");
  const [todos, setTodos] = useState(false);
  const lista = useListado<Lote>("/v1/alm/lotes", { orden: "expiry_date", filtros: { qc_status: estado, todos: todos ? 1 : "", brand: marca } });
  const [abierto, setAbierto] = useState<Lote | null>(null);

  const columnas: Column<Lote>[] = [
    { key: "code", header: "Lote", sortable: true, cardTitle: true, render: (l) => <span className="font-mono font-semibold">{l.code}</span> },
    { key: "sku", header: "Producto", sortable: true, render: (l) => <div className="min-w-[160px]"><p>{l.variant_name}</p><p className="font-mono text-[12px] text-muted">{l.sku}</p></div> },
    { key: "qc_status", header: "Estado", sortable: true, render: (l) => <StatusBadge status={l.qc_status} labels={LOTE} /> },
    { key: "expiry_date", header: "Vence", sortable: true, render: (l) => <div><p>{fecha(l.expiry_date)}</p><Dias d={l.days_left} /></div> },
    { key: "stock_qty", header: "Stock", sortable: true, align: "right", render: (l) => <Cant v={l.stock_qty} modo={l.sale_mode} /> },
    { key: "stock_by_warehouse", header: "Por almacén", hideOnMobile: true, render: (l) => <span className="font-mono text-[12px]">{l.stock_by_warehouse ?? "—"}</span> },
    { key: "supplier_name", header: "Proveedor", hideOnMobile: true, render: (l) => l.supplier_name ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada lote con su estado de calidad y su vencimiento. Solo un lote liberado y vigente se vende o se reserva." />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={setAbierto}
        search={{ ...lista.tabla.search, placeholder: "Buscar lote, SKU, producto o proveedor…" }} empty="No hay lotes con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={ESTADOS_LOTE} />
          <div className="flex items-center"><Checkbox checked={todos} onChange={setTodos} label="Incluir lotes sin stock" /></div>
        </>} />
      {abierto && (
        <Modal open onClose={() => setAbierto(null)} size="lg" title={`Lote ${abierto.code}`}
          footer={puede("ALM", "E") && <Link href={`/m/alm/alm-06?lote=${abierto.id}`} className={buttonClass("primary")}>Liberar o bloquear</Link>}>
          <LoteFicha id={abierto.id} />
        </Modal>
      )}
    </div>
  );
}
