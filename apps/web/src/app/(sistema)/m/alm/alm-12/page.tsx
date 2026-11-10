"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { Cifra, DataTable, PageHeader, type Column } from "@/components/ui";
import { fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { TransferenciaFicha, type FilaTransferencia } from "@/modulos/alm/Transferencia";

/** Antigüedad en tránsito: más de un día ya es para revisar. */
function Antiguedad({ h }: { h: number }) {
  const clase = h >= 48 ? "text-bad" : h >= 24 ? "text-warn" : "text-ink";
  return <span className={`font-medium tabular-nums ${clase}`}>{h >= 24 ? `${numero(h / 24, 1)} días` : `${numero(h, 1)} h`}</span>;
}

/** ALM-12 Stock en tránsito: transferencias despachadas sin recibir, con su antigüedad. */
export default function EnTransito() {
  const { local, can } = useSesion();
  const lista = useListado<FilaTransferencia>("/v1/alm/transferencias", { orden: "-hours_in_transit", porPagina: 50, filtros: { status: "DISPATCHED", site: local } });
  const [abierta, setAbierta] = useState<string | null>(null);
  const costos = can("alm.stock.view_cost");
  const valor = lista.filas.reduce((s, t) => s + Number(t.value ?? 0), 0);
  const viejas = lista.filas.filter((t) => Number(t.hours_in_transit) >= 24).length;

  const columnas: Column<FilaTransferencia>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (t) => <span className="font-mono font-semibold">{t.number}</span> },
    { key: "from_code", header: "Origen → destino", render: (t) => <div><p className="font-mono">{t.from_code} → {t.to_code}</p><p className="text-[12px] text-muted">{t.to_name}</p></div> },
    { key: "guide_number", header: "Guía", render: (t) => t.guide_number ?? "—" },
    { key: "dispatched_at", header: "Despachada", sortable: true, render: (t) => <div><p>{fechaHora(t.dispatched_at)}</p>{t.dispatched_by_name && <p className="text-[12px] text-muted">{t.dispatched_by_name}</p>}</div> },
    { key: "hours_in_transit", header: "En tránsito", sortable: true, align: "right", render: (t) => <Antiguedad h={Number(t.hours_in_transit ?? 0)} /> },
    { key: "total_qty", header: "Cantidad", align: "right", hideOnMobile: true, render: (t) => numero(t.total_qty) },
    ...(costos ? [{ key: "value", header: "Valor", align: "right", render: (t: FilaTransferencia) => soles(t.value) }] as Column<FilaTransferencia>[] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que salió de un local y todavía no llega al otro. Desde aquí se recibe." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="En tránsito" valor={numero(lista.total)} icono={Truck} />
        <Cifra titulo="Más de un día" valor={numero(viejas)} tono={viejas ? "warn" : undefined} />
        {costos && <Cifra titulo="Valor en tránsito" valor={soles(valor)} detalle="De esta página" />}
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(t) => setAbierta(t.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar número, guía o almacén…" }} empty="No hay nada en tránsito." />
      {abierta && <TransferenciaFicha id={abierta} onClose={() => setAbierta(null)} onCambio={lista.recargar} />}
    </div>
  );
}
