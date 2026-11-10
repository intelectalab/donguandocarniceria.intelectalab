"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { FiltroSelect, useOpciones } from "@/modulos/alm/comunes";
import { TransferenciaFicha, TransferenciaNueva, type FilaTransferencia } from "@/modulos/alm/Transferencia";
import { TRANSFERENCIA } from "@/modulos/alm/tipos";

/** ALM-07 Transferencias: solicitud, despacho con guía cuando cambia de local y recepción con diferencias. */
export default function Transferencias() {
  const { local, can, puede } = useSesion();
  const op = useOpciones();
  const [estado, setEstado] = useState("");
  const lista = useListado<FilaTransferencia>("/v1/alm/transferencias", { orden: "-requested_at", filtros: { status: estado, site: local } });
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);

  const columnas: Column<FilaTransferencia>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (t) => <span className="font-mono font-semibold">{t.number}</span> },
    { key: "requested_at", header: "Solicitada", sortable: true, render: (t) => fechaHora(t.requested_at) },
    { key: "from_code", header: "Origen → destino", render: (t) => <span className="font-mono">{t.from_code} → {t.to_code}</span> },
    { key: "guide_number", header: "Guía", render: (t) => t.requires_guide ? (t.guide_number ?? <Badge tone="warn">Falta</Badge>) : <span className="text-muted">No aplica</span> },
    { key: "lines", header: "Líneas", align: "right", hideOnMobile: true },
    { key: "status", header: "Estado", sortable: true, render: (t) => <StatusBadge status={t.status} labels={TRANSFERENCIA} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Mercadería que pasa de un almacén a otro. Dentro del mismo local es inmediata; a otro local viaja con guía de remisión y pasa por tránsito."
        actions={can("alm.transfer.create") && puede("ALM", "C") && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNueva(true)}>Nueva transferencia</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(t) => setAbierta(t.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar número, guía o almacén…" }} empty="No hay transferencias."
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={Object.entries(TRANSFERENCIA).map(([value, [label]]) => ({ value, label }))} ancho="sm:w-[200px]" />} />
      {abierta && <TransferenciaFicha id={abierta} onClose={() => setAbierta(null)} onCambio={lista.recargar} />}
      {nueva && op && <TransferenciaNueva op={op} onClose={() => setNueva(false)} onCreada={(id) => { setNueva(false); lista.recargar(); setAbierta(id); }} />}
    </div>
  );
}
