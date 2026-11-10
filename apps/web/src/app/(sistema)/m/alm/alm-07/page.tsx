"use client";

import { useState } from "react";
import { AlertTriangle, ClipboardList, FileText, Plus, Truck } from "lucide-react";
import { Badge, Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { CifraLink, FiltroSelect, qs, useAlAbrir, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { TransferenciaFicha, TransferenciaNueva, type FilaTransferencia } from "@/modulos/alm/Transferencia";
import { TRANSFERENCIA } from "@/modulos/alm/tipos";

type Cifras = { draft: number; dispatched: number; with_diff: number; guides_month: number; need_guide: number };

/** ALM-07 Transferencias: solicitud, despacho con guía cuando cambia de local y recepción con diferencias. */
export default function Transferencias() {
  const { local, can, puede } = useSesion();
  const op = useOpciones();
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const lista = useListado<FilaTransferencia>("/v1/alm/transferencias", { orden: "-requested_at", filtros: { status: estado, scope: tipo, site: local } });
  const c = useDatos<Cifras>(`/v1/alm/cifras/07${qs({ site: local })}`).datos;
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const puedeCrear = can("alm.transfer.create") && puede("ALM", "C");
  useAlAbrir((p) => { if (p.get("nuevo") && puedeCrear) setNueva(true); if (p.get("id")) setAbierta(p.get("id")); });

  const columnas: Column<FilaTransferencia>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (t) => <span className="font-mono font-semibold">{t.number}</span> },
    { key: "requested_at", header: "Solicitada", sortable: true, render: (t) => <div><p className="whitespace-nowrap">{fechaHora(t.requested_at)}</p>{t.requested_by_name && <p className="text-[12px] text-muted">{t.requested_by_name}</p>}</div> },
    { key: "from_code", header: "Origen → destino", render: (t) => <div><p className="font-mono">{t.from_code} → {t.to_code}</p>{t.between_sites ? <Badge tone="info">Entre locales</Badge> : <span className="text-[12px] text-muted">Mismo local</span>}</div> },
    { key: "content", header: "Contenido", hideOnMobile: true, render: (t) => <span className="font-mono text-[12px]">{t.content ?? "—"}</span> },
    { key: "guide_number", header: "Guía", render: (t) => t.requires_guide ? (t.guide_number ?? <Badge tone="warn">Falta</Badge>) : <span className="text-muted">No aplica</span> },
    { key: "diff_qty", header: "Diferencia", align: "right", hideOnMobile: true, render: (t) => Math.abs(Number(t.diff_qty ?? 0)) > 0.0005 ? <span className="text-bad">{numero(t.diff_qty, 3)}</span> : <span className="text-muted">—</span> },
    { key: "status", header: "Estado", sortable: true, render: (t) => <StatusBadge status={t.status} labels={TRANSFERENCIA} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Mercadería que pasa de un almacén a otro. Dentro del mismo local es inmediata; a otro local viaja con guía de remisión y pasa por tránsito."
        actions={puedeCrear && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNueva(true)}>Nueva transferencia</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Por despachar" valor={c ? numero(c.draft) : undefined} detalle={c?.need_guide ? `${c.need_guide} sin guía` : "Solicitadas"} icono={ClipboardList}
          tono={c?.need_guide ? "warn" : undefined} onClick={() => setEstado("DRAFT")} />
        <CifraLink titulo="En tránsito" valor={c ? numero(c.dispatched) : undefined} detalle="Despachadas sin recibir" icono={Truck} tono={c?.dispatched ? "warn" : undefined} href="/m/alm/alm-12" />
        <CifraLink titulo="Recibidas con diferencia" valor={c ? numero(c.with_diff) : undefined} detalle="Faltante o sobrante" icono={AlertTriangle}
          tono={c?.with_diff ? "bad" : undefined} onClick={() => setEstado("RECEIVED_WITH_DIFF")} />
        <CifraLink titulo="Guías del mes" valor={c ? numero(c.guides_month) : undefined} detalle="Guías de remisión registradas" icono={FileText} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(t) => setAbierta(t.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar número, guía o almacén…" }} empty="No hay transferencias."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={Object.entries(TRANSFERENCIA).map(([value, [label]]) => ({ value, label }))} ancho="sm:w-[200px]" />
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={[{ value: "SITES", label: "Entre locales" }, { value: "SAME", label: "Mismo local" }]} />
        </>} />
      {abierta && <TransferenciaFicha id={abierta} onClose={() => setAbierta(null)} onCambio={lista.recargar} />}
      {nueva && op && <TransferenciaNueva op={op} onClose={() => setNueva(false)} onCreada={(id) => { setNueva(false); lista.recargar(); setAbierta(id); }} />}
    </div>
  );
}
