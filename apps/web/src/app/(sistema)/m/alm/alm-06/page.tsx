"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fecha } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Dias, FiltroSelect } from "@/modulos/alm/comunes";
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

  const columnas: Column<Lote>[] = [
    { key: "code", header: "Lote", sortable: true, cardTitle: true, render: (l) => <span className="font-mono font-semibold">{l.code}</span> },
    { key: "sku", header: "Producto", render: (l) => <span>{l.variant_name}</span> },
    { key: "qc_status", header: "Estado", render: (l) => <StatusBadge status={l.qc_status} labels={LOTE} /> },
    { key: "expiry_date", header: "Vence", sortable: true, render: (l) => <div><p>{fecha(l.expiry_date)}</p><Dias d={l.days_left} /></div> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Liberar un lote lo deja vender; bloquearlo, rechazarlo o retirarlo lo saca de la venta y exige motivo. Todo queda en el historial." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <DataTable {...lista.tabla} columns={columnas} onRowClick={(l) => elegir(l.id)}
          search={{ ...lista.tabla.search, placeholder: "Buscar lote o producto…" }} empty="No hay lotes con stock en ese estado."
          toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={ESTADOS_LOTE} />} />
        <section className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">
          {elegido ? <LoteFicha key={elegido} id={elegido} conAcciones onCambio={lista.recargar} />
            : <p className="text-[13px] text-muted">Elige un lote de la lista para ver su ficha y cambiar su estado.</p>}
        </section>
      </div>
    </div>
  );
}
