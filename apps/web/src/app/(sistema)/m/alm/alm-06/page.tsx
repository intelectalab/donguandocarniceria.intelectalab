"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fecha, fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, Dias, FiltroSelect } from "@/modulos/alm/comunes";
import { LoteFicha } from "@/modulos/alm/LoteFicha";
import { ESTADOS_LOTE, LOTE, type Lote } from "@/modulos/alm/tipos";

/** ALM-06 Liberar o bloquear lote: cambio de estado con motivo e historial. */
export default function CambiarLote() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const elegido = useSearchParams().get("lote");
  const { marca } = useSesion();
  const [estado, setEstado] = useState("QUARANTINE");
  const lista = useListado<Lote>("/v1/alm/lotes", { orden: "expiry_date", porPagina: 10, filtros: { qc_status: estado, brand: marca } });
  const elegir = (id: string) => router.replace(`/m/alm/alm-06?lote=${id}`, { scroll: false });
  const [hEstado, setHEstado] = useState("");
  const historial = useListado<Cambio>("/v1/alm/lotes/historial", { orden: "-changed_at", porPagina: 10, filtros: { to_status: hEstado, brand: marca } });

  const columnas: Column<Lote>[] = [
    { key: "code", header: "Lote", sortable: true, cardTitle: true, render: (l) => <span className="font-mono font-semibold">{l.code}</span> },
    { key: "sku", header: "Producto", render: (l) => <div><p>{l.variant_name}</p><p className="text-[12px] text-muted">{l.stock_by_warehouse ?? ""}</p></div> },
    { key: "stock_qty", header: "Stock", align: "right", render: (l) => <Cant v={l.stock_qty} modo={l.sale_mode} /> },
    { key: "qc_status", header: "Estado", render: (l) => <StatusBadge status={l.qc_status} labels={LOTE} /> },
    { key: "expiry_date", header: "Vence", sortable: true, render: (l) => <div><p>{fecha(l.expiry_date)}</p><Dias d={l.days_left} /></div> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Liberar un lote lo deja vender; bloquearlo, rechazarlo o retirarlo lo saca de la venta y exige motivo. Todo queda en el historial." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <DataTable {...lista.tabla} columns={columnas} onRowClick={(l) => elegir(l.id)}
          search={{ ...lista.tabla.search, placeholder: "Buscar lote o producto…" }} empty="No hay lotes con stock en ese estado."
          toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={ESTADOS_LOTE.map((e) => e.value === "QUARANTINE" ? { ...e, label: "Pendientes de liberar" } : e)} />} />
        <section className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">
          {elegido ? <LoteFicha key={elegido} id={elegido} conAcciones onCambio={lista.recargar} />
            : <p className="text-[13px] text-muted">Elige un lote de la lista para ver su ficha y cambiar su estado.</p>}
        </section>
      </div>
      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold">Historial de cambios de estado</h2>
        <DataTable {...historial.tabla} columns={columnasHistorial} rowKey={(h) => h.id} onRowClick={(h) => elegir(h.lot_id)}
          search={{ ...historial.tabla.search, placeholder: "Buscar lote, producto, motivo o usuario…" }} empty="Sin cambios de estado."
          toolbar={<FiltroSelect label="A estado" value={hEstado} onChange={setHEstado} options={ESTADOS_LOTE} />} />
      </section>
    </div>
  );
}

type Cambio = { id: string; lot_id: string; lot_code: string; sku: string; variant_name: string; from_status: string | null; to_status: string; reason: string | null; changed_at: string; changed_by_name: string | null };
const columnasHistorial: Column<Cambio>[] = [
  { key: "changed_at", header: "Fecha", sortable: true, render: (h) => <span className="whitespace-nowrap">{fechaHora(h.changed_at)}</span> },
  { key: "lot_code", header: "Lote", sortable: true, cardTitle: true, render: (h) => <span className="font-mono font-semibold">{h.lot_code}</span> },
  { key: "sku", header: "Producto", render: (h) => h.variant_name },
  { key: "to_status", header: "Cambio", render: (h) => <span className="flex flex-wrap items-center gap-1">{h.from_status && LOTE[h.from_status] && <><StatusBadge status={h.from_status} labels={LOTE} />→</>}<StatusBadge status={h.to_status} labels={LOTE} /></span> },
  { key: "reason", header: "Motivo", hideOnMobile: true, render: (h) => h.reason ?? "—" },
  { key: "changed_by_name", header: "Quién", hideOnMobile: true, render: (h) => h.changed_by_name ?? "—" },
];
