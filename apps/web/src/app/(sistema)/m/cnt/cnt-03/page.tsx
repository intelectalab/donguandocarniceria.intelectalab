"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardCheck, FilePen, FileWarning, Wand2 } from "lucide-react";
import { Badge, Button, DataTable, Input, Modal, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { FichaAsiento, type FilaAsiento } from "@/modulos/cnt/Asiento";
import { ASIENTO, CifraLink, FiltroSelect, SelectorMes, mesActual, nombreMes, opciones, qs, texto, useAlAbrir, useDatos, useOpcionesCnt, type Num } from "@/modulos/cnt/comunes";

type Cifras = { approved: number; pending: number; drafts: number; amount: Num };
type SinAsiento = { period: string; count: number; data: { id: string; date: string; total: Num; label: string; kind: string }[] };
const TIPO_DOC: Record<string, string> = { SALE: "Venta", PURCHASE: "Compra", EXPENSE: "Gasto", COLLECTION: "Cobro", SUPPLIER_PAYMENT: "Pago a proveedor", NTI: "NTI de la granja" };

/** CNT-03 Asientos: lista y detalle con origen, estado, número, período, quién preparó y quién aprobó. */
export default function Asientos() {
  const op = useOpcionesCnt();
  const [mes, setMes] = useState(mesActual());
  const [estado, setEstado] = useState("");
  const [origen, setOrigen] = useState("");
  const [marca, setMarca] = useState("");
  const [local, setLocal] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [sinAsiento, setSinAsiento] = useState(false);
  useAlAbrir((p) => { if (p.get("month")) setMes(p.get("month")!); if (p.get("status")) setEstado(p.get("status")!); if (p.get("id")) setAbierto(p.get("id")); });
  const lista = useListado<FilaAsiento>("/v1/cnt/asientos", { orden: "-entry_date", filtros: { period: mes, status: estado, source: origen, brand: marca, site: local, account: cuenta } });
  const c = useDatos<Cifras>(`/v1/cnt/cifras/03${qs({ period: mes })}`);
  const sa = useDatos<SinAsiento>(`/v1/cnt/asientos/sin-asiento${qs({ period: mes })}`);
  const recargar = () => { lista.recargar(); c.recargar(); sa.recargar(); };
  const columnas: Column<FilaAsiento>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (a) => <div className="min-w-[200px]"><p className="font-medium tabular-nums">{a.number ?? "Sin número"}</p><p className="text-[12px] text-muted">{texto(a.description)}</p></div> },
    { key: "entry_date", header: "Fecha", sortable: true, render: (a) => fecha(a.entry_date) },
    { key: "source_type", header: "Origen", sortable: true, render: (a) => <span>{a.source_name}{a.reversal_of && <Badge tone="info">Reversa</Badge>}</span> },
    { key: "brand_name", header: "Marca", hideOnMobile: true, render: (a) => a.brand_name ?? <span className="text-muted">—</span> },
    { key: "total_debit", header: "Importe", sortable: true, align: "right", render: (a) => soles(a.total_debit) },
    { key: "prepared_by_name", header: "Preparó y aprobó", hideOnMobile: true, render: (a) => <span className="text-[12.5px]">{a.prepared_by_name ?? "Sistema"}<span className="block text-muted">{a.approved_by_name ?? (a.auto_approved ? "Aprobación automática" : "—")}</span></span> },
    { key: "status", header: "Estado", sortable: true, render: (a) => <span className="flex flex-wrap gap-1"><StatusBadge status={a.status} labels={ASIENTO} />{a.blocked && <Badge tone="bad">Bloqueado</Badge>}{a.reversed_by_id && <Badge tone="neutral">Reversado</Badge>}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={`Los asientos de ${nombreMes(mes)}: los automáticos que generan ventas, compras, gastos, cobros, pagos y planilla, y los manuales.`}
        actions={<SelectorMes value={mes} onChange={setMes} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Aprobados" valor={c.datos ? numero(c.datos.approved) : undefined} detalle={c.datos ? soles(c.datos.amount) : undefined} icono={CheckCircle2} onClick={() => setEstado("APPROVED")} />
        <CifraLink titulo="Por aprobar" valor={c.datos ? numero(c.datos.pending) : undefined} icono={ClipboardCheck} tono={c.datos?.pending ? "warn" : "ok"} onClick={() => setEstado("PENDING_APPROVAL")} />
        <CifraLink titulo="Borradores" valor={c.datos ? numero(c.datos.drafts) : undefined} icono={FilePen} onClick={() => setEstado("DRAFT")} />
        <CifraLink titulo="Documentos sin asiento" valor={sa.datos ? numero(sa.datos.count) : undefined} icono={FileWarning} tono={sa.datos?.count ? "bad" : "ok"} onClick={() => setSinAsiento(true)} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(a) => setAbierto(a.id)} search={{ ...lista.tabla.search, placeholder: "Buscar número, glosa o documento…" }} empty="No hay asientos con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opciones(Object.fromEntries(Object.entries(ASIENTO).map(([k, v]) => [k, v[0]])))} />
          <FiltroSelect label="Origen" value={origen} onChange={setOrigen} options={opciones(op?.sources ?? {})} ancho="sm:w-[190px]" />
          <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          <FiltroSelect label="Local" value={local} onChange={setLocal} options={(op?.establishments ?? []).map((s) => ({ value: s.id, label: s.name }))} ancho="sm:w-[200px]" />
          <div className="w-full sm:w-[130px]"><Input aria-label="Cuenta" placeholder="Cuenta" inputMode="numeric" value={cuenta} onChange={(e) => setCuenta(e.target.value.replace(/\D/g, ""))} /></div>
        </>} />
      {abierto && <FichaAsiento id={abierto} op={op} onClose={() => setAbierto(null)} onCambio={recargar} />}
      {sinAsiento && sa.datos && <Modal open onClose={() => setSinAsiento(false)} size="lg" title="Documentos sin asiento" description={`${numero(sa.datos.count)} documentos de ${nombreMes(mes)}`}
        footer={op?.can.prepare && sa.datos.count > 0 ? <Button variant="primary" icon={Wand2} onClick={async () => {
          try {
            const r = await api<{ created?: number; inbox?: number }>("/v1/cnt/asientos/generar", { method: "POST", body: { period: `${mes}-01` } });
            toast.ok(`Asientos generados${r.created != null ? `: ${r.created}` : ""}${r.inbox ? ` · ${r.inbox} a la bandeja` : ""}`); setSinAsiento(false); recargar();
          } catch (e) { toast.error(mensajeDe(e)); }
        }}>Generar los asientos</Button> : undefined}>
        <DataTable rows={sa.datos.data} rowKey={(d) => `${d.kind}-${d.id}`} empty="Todos los documentos tienen asiento." columns={[
          { key: "label", header: "Documento", cardTitle: true, render: (d) => texto(d.label) },
          { key: "kind", header: "Tipo", render: (d) => TIPO_DOC[d.kind] ?? d.kind },
          { key: "date", header: "Fecha", render: (d) => fecha(d.date) },
          { key: "total", header: "Total", align: "right", render: (d) => soles(d.total) },
        ]} />
      </Modal>}
    </div>
  );
}
