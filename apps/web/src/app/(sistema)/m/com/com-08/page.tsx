"use client";

import { useState } from "react";
import { CheckCircle2, FileWarning, Percent } from "lucide-react";
import { Alert, Badge, Button, DataTable, Modal, PageHeader, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { CifraLink, FiltroSelect, limpio, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { CRUCE, opciones, type Num } from "@/modulos/com/tipos";

type Fila = { id: string; doc_type: string; doc_number: string; issue_date: string; total: Num; match_status: string; match_note: string | null; supplier_name: string; po_number: string;
  po_total: Num; received_total: Num; registered_by: string };
type Cruce = { status: string; tolerance_pct: number; rows: { line_id: string; description: string; basis: string; po_number: string; po_price: number; rc_price: number; inv_price: number;
  price_diff_pct: number; po_qty: number; rec_qty: number; inv_qty: number; qty_diff: number; price_ok: boolean; qty_ok: boolean; ok: boolean }[] };
type Cifras = { observed: number; approved_diff: number };

/** COM-08 Cruce de tres vías: diferencias de cantidad y precio entre la orden, la recepción y el comprobante, con su aprobación. */
export default function CruceTresVias() {
  const op = useOpcionesCom();
  const [estado, setEstado] = useState("OBSERVED");
  const lista = useListado<Fila>("/v1/com/cruces", { orden: "-issue_date", filtros: { match_status: estado } });
  const c = useDatos<Cifras>("/v1/com/cifras/08");
  const [abierto, setAbierto] = useState<Fila | null>(null);
  const columnas: Column<Fila>[] = [
    { key: "doc_number", header: "Comprobante", sortable: true, render: (f) => <span className="font-mono">{f.doc_number}</span> },
    { key: "supplier_name", header: "Proveedor", sortable: true, cardTitle: true, render: (f) => <div className="min-w-[150px]"><p className="font-medium">{f.supplier_name}</p><p className="text-[12px] text-muted">{f.po_number}</p></div> },
    { key: "issue_date", header: "Emisión", sortable: true, hideOnMobile: true, render: (f) => fecha(f.issue_date) },
    { key: "po_total", header: "Orden", align: "right", render: (f) => soles(f.po_total) },
    { key: "received_total", header: "Recibido", align: "right", hideOnMobile: true, render: (f) => soles(f.received_total) },
    { key: "total", header: "Comprobante", sortable: true, align: "right", render: (f) => soles(f.total) },
    { key: "match_status", header: "Cruce", render: (f) => <StatusBadge status={f.match_status} labels={CRUCE} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={`Cada comprobante con orden se compara línea por línea con lo pedido y lo recibido. Si el precio difiere más de ${op?.params.com_price_tolerance_pct ?? 2} % o la cantidad no cuadra, queda observado y no se paga hasta que Administración o la contadora aprueben la diferencia.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Observados" valor={c.datos ? numero(c.datos.observed) : undefined} icono={FileWarning} onClick={() => setEstado("OBSERVED")} />
        <CifraLink titulo="Diferencias aprobadas" valor={c.datos ? numero(c.datos.approved_diff) : undefined} icono={CheckCircle2} onClick={() => setEstado("APPROVED_DIFF")} />
        <CifraLink titulo="Tolerancia de precio" valor={op ? porcentaje(op.params.com_price_tolerance_pct, 1) : undefined} icono={Percent} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={setAbierto} search={{ ...lista.tabla.search, placeholder: "Buscar comprobante, proveedor u orden…" }} empty="No hay comprobantes con ese resultado de cruce."
        toolbar={<FiltroSelect label="Resultado" value={estado} onChange={setEstado} options={[...opciones(Object.fromEntries(Object.entries(CRUCE).map(([k, v]) => [k, v[0]]))), { value: "ALL", label: "Todos" }]} />} />
      {abierto && <DetalleCruce fila={abierto} puede={Boolean(op?.can.approve_diff)} onClose={() => setAbierto(null)} onCambio={() => { lista.recargar(); c.recargar(); }} />}
    </div>
  );
}

function DetalleCruce({ fila, puede, onClose, onCambio }: { fila: Fila; puede: boolean; onClose: () => void; onCambio: () => void }) {
  const { datos: x, error } = useDatos<Cruce>(`/v1/com/cruces/${fila.id}`);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function aprobar() {
    setEnviando(true);
    try { await api(`/v1/com/cruces/${fila.id}/aprobar`, { method: "POST", body: { note: nota } }); toast.ok("Diferencia aprobada: el comprobante ya se puede pagar"); onCambio(); onClose(); }
    catch (e) { toast.error(mensajeDe(e)); } finally { setEnviando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={`Cruce de ${fila.doc_number}`} description={`${fila.supplier_name} · ${fila.po_number}`}
      footer={fila.match_status === "OBSERVED" && puede && <Button variant="primary" loading={enviando} disabled={nota.trim().length < 5} onClick={aprobar}>Aprobar la diferencia</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {fila.match_note && <div className="mb-3"><Alert tone="warn">{limpio(fila.match_note)}</Alert></div>}
      {x && <div className="space-y-4">
        <DataTable rows={x.rows} rowKey={(r) => r.line_id} columns={[
          { key: "description", header: "Producto", cardTitle: true, render: (r) => r.description },
          { key: "po_price", header: "Precio orden / recibido / factura", render: (r) => <span className="whitespace-nowrap">{numero(r.po_price, 2)} · {numero(r.rc_price, 2)} · <b className={r.price_ok ? "" : "text-bad"}>{numero(r.inv_price, 2)}</b></span> },
          { key: "price_diff_pct", header: "Dif. precio", align: "right", render: (r) => <span className={r.price_ok ? "" : "font-semibold text-bad"}>{porcentaje(r.price_diff_pct, 2)}</span> },
          { key: "po_qty", header: `Cantidad orden / recibida / factura`, render: (r) => <span className="whitespace-nowrap">{numero(r.po_qty, 2)} · {numero(r.rec_qty, 2)} · <b className={r.qty_ok ? "" : "text-bad"}>{numero(r.inv_qty, 2)}</b> {r.basis === "KG" ? "kg" : "und"}</span> },
          { key: "ok", header: "Resultado", render: (r) => r.ok ? <Badge tone="ok">Cuadra</Badge> : <Badge tone="bad">{!r.price_ok && !r.qty_ok ? "Precio y cantidad" : !r.price_ok ? "Precio" : "Cantidad"}</Badge> },
        ]} />
        {fila.match_status === "OBSERVED" && (puede
          ? <div><p className="mb-1 text-[13px] font-medium">Motivo de la aprobación</p><Textarea value={nota} maxLength={300} placeholder="Por ejemplo: el proveedor subió el precio del pollo por la temporada; se acordó por teléfono." onChange={(e) => setNota(e.target.value)} /></div>
          : <Alert tone="info">La diferencia la aprueba Administración o la contadora, no quien registró el comprobante.</Alert>)}
      </div>}
    </Modal>
  );
}
