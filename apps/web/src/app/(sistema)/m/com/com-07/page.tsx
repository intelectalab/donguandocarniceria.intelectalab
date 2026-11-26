"use client";

import { useState } from "react";
import { FileWarning, FileText, ReceiptText, Truck, Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { CifraLink, FiltroSelect, Seccion, accion, hoyLima, limpio, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { COMPROBANTE, CRUCE, opciones, type Num, type Opciones } from "@/modulos/com/tipos";

type Fila = {
  id: string; doc_type: string; doc_number: string; issue_date: string; due_date: string | null; currency: string; exchange_rate: Num; base_taxed: Num; igv: Num; non_taxed: Num; total: Num;
  balance: Num; status: string; match_status: string; supplier_name: string; supplier_doc: string; po_number: string | null; brand_name: string | null; registered_by_name: string;
  has_pdf: boolean; has_xml: boolean; entry_number: string | null; entry_status: string | null;
};
type Detalle = {
  id: string; label: string; doc_type: string; series: string; number: string; issue_date: string; due_date: string | null; accounting_date: string; currency: string; exchange_rate: Num;
  base_taxed: Num; igv: Num; non_taxed: Num; other_charges: Num; total: Num; balance: Num; paid_amount: Num; igv_is_credit: boolean; status: string; match_status: string; match_note: string | null;
  supplier_name: string; supplier_doc: string; po_number: string | null; receipt_number: string | null; cost_center_name: string | null; brand_name: string | null; establishment_name: string | null;
  registered_by_name: string; notes: string | null; description: string | null; file_pdf_url: string | null; file_xml_url: string | null; void_reason: string | null;
  lines: { id: string; description: string; sku: string | null; qty: Num; unit_price: Num; subtotal: Num; igv: Num; total: Num }[];
  payments: { id: string; number: string; paid_at: string; amount: Num }[];
  entries: { id: string; number: string | null; status: string; total_debit: Num; entry_date: string }[];
};
type Cifras = { month: number; month_total: Num; observed: number; approved_diff: number; receipts_without_doc: number };
const ESTADO_ASIENTO: Record<string, [string, "ok" | "warn" | "neutral" | "bad"]> = { APPROVED: ["Contabilizado", "ok"], PENDING_APPROVAL: ["Asiento por aprobar", "warn"], DRAFT: ["Asiento en borrador", "warn"], VOIDED: ["Asiento anulado", "neutral"] };

/** COM-07 Comprobantes del proveedor: tipo SUNAT, serie y número, fechas, moneda, importes, archivos y vínculos con la orden y la recepción. */
export default function Comprobantes() {
  const op = useOpcionesCom();
  const [tipo, setTipo] = useState("");
  const [cruce, setCruce] = useState("");
  const lista = useListado<Fila>("/v1/com/comprobantes", { orden: "-issue_date", filtros: { doc_type: tipo, match_status: cruce } });
  const c = useDatos<Cifras>("/v1/com/cifras/07");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const recargar = () => { lista.recargar(); c.recargar(); };
  const nombreTipo = (t: string) => op?.doc_types.find((d) => d.code === t)?.name ?? t;

  const columnas: Column<Fila>[] = [
    { key: "doc_number", header: "Comprobante", sortable: true, render: (f) => <div><p className="font-mono">{f.doc_number}</p><p className="text-[12px] text-muted">{nombreTipo(f.doc_type)}</p></div> },
    { key: "supplier_name", header: "Proveedor", sortable: true, cardTitle: true, render: (f) => <div className="min-w-[150px]"><p className="font-medium">{f.supplier_name}</p><p className="text-[12px] text-muted">{f.supplier_doc}{f.po_number ? ` · ${f.po_number}` : ""}</p></div> },
    { key: "issue_date", header: "Emisión", sortable: true, render: (f) => fecha(f.issue_date) },
    { key: "total", header: "Total", sortable: true, align: "right", render: (f) => <span>{f.currency !== "PEN" ? `${f.currency} ${numero(f.total, 2)}` : soles(f.total)}{f.currency !== "PEN" && <span className="block text-[12px] text-muted">TC {numero(f.exchange_rate, 3)}</span>}</span> },
    { key: "balance", header: "Saldo", sortable: true, align: "right", hideOnMobile: true, render: (f) => Number(f.balance) ? soles(f.balance) : <span className="text-muted">—</span> },
    { key: "match_status", header: "Cruce", sortable: true, render: (f) => <StatusBadge status={f.match_status} labels={CRUCE} /> },
    { key: "entry_status", header: "Contabilidad", hideOnMobile: true, render: (f) => f.entry_status ? <StatusBadge status={f.entry_status} labels={ESTADO_ASIENTO} /> : <span className="text-muted">—</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Facturas, boletas, recibos por honorarios y notas de los proveedores. No se registra dos veces el mismo comprobante; con la orden y la recepción vinculadas, el sistema hace el cruce de tres vías."
        actions={op?.can.document_record && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Registrar comprobante</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Registrados en el mes" valor={c.datos ? numero(c.datos.month) : undefined} detalle={c.datos ? soles(c.datos.month_total) : undefined} icono={ReceiptText} />
        <CifraLink titulo="Observados en el cruce" valor={c.datos ? numero(c.datos.observed) : undefined} icono={FileWarning} tono={c.datos?.observed ? "bad" : "ok"} href="/m/com/com-08" />
        <CifraLink titulo="Diferencias aprobadas" valor={c.datos ? numero(c.datos.approved_diff) : undefined} icono={FileText} onClick={() => setCruce("APPROVED_DIFF")} />
        <CifraLink titulo="Recepciones sin comprobante" valor={c.datos ? numero(c.datos.receipts_without_doc) : undefined} icono={Truck} tono={c.datos?.receipts_without_doc ? "warn" : undefined} href="/m/com/com-06" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(f) => setAbierto(f.id)} search={{ ...lista.tabla.search, placeholder: "Buscar serie y número, proveedor u orden…" }} empty="No hay comprobantes con esos filtros."
        toolbar={<>
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={(op?.doc_types ?? []).map((d) => ({ value: d.code, label: d.name }))} ancho="sm:w-[210px]" />
          <FiltroSelect label="Cruce" value={cruce} onChange={setCruce} options={opciones(Object.fromEntries(Object.entries(CRUCE).map(([k, v]) => [k, v[0]])))} />
        </>} />
      {abierto && <FichaComprobante id={abierto} op={op} onClose={() => setAbierto(null)} onCambio={recargar} />}
      {nuevo && op && <NuevoComprobante op={op} onClose={() => setNuevo(false)} onGuardado={(id) => { setNuevo(false); recargar(); setAbierto(id); }} />}
    </div>
  );
}

function FichaComprobante({ id, op, onClose, onCambio }: { id: string; op: Opciones | null; onClose: () => void; onCambio: () => void }) {
  const { datos: d, error, recargar } = useDatos<Detalle>(`/v1/com/comprobantes/${id}`);
  return (
    <Modal open onClose={onClose} size="lg" title={d ? d.label : "Comprobante"} description={d ? `${d.supplier_name} · ${d.supplier_doc}` : undefined}
      footer={d && d.status !== "VOIDED" && op?.can.document_record && Number(d.paid_amount) === 0 && <Button variant="danger" onClick={() => accion({ title: `¿Anular ${d.label}?`, reason: { min: 5 }, confirmLabel: "Anular", danger: true },
        (m) => api(`/v1/com/comprobantes/${d.id}/anular`, { method: "POST", body: { reason: m } }), "Comprobante anulado", () => { recargar(); onCambio(); })}>Anular</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {d && <div className="space-y-5">
        {d.match_note && <Alert tone="warn" title="Cruce de tres vías">{limpio(d.match_note)}</Alert>}
        {d.void_reason && <Alert tone="bad" title="Anulado">{d.void_reason}</Alert>}
        <DetailList items={[
          { label: "Estado", value: <span className="flex flex-wrap gap-1"><StatusBadge status={d.status} labels={COMPROBANTE} /><StatusBadge status={d.match_status} labels={CRUCE} /></span> },
          { label: "Emisión y vencimiento", value: `${fecha(d.issue_date)} → ${fecha(d.due_date)}` }, { label: "Fecha contable", value: fecha(d.accounting_date) },
          { label: "Moneda", value: d.currency === "PEN" ? "Soles" : `${d.currency} · tipo de cambio ${numero(d.exchange_rate, 3)}` },
          { label: "Orden y recepción", value: [d.po_number, d.receipt_number].filter(Boolean).join(" · ") || "—" }, { label: "Centro de costo y marca", value: [d.cost_center_name, d.brand_name].filter(Boolean).join(" · ") || "—" },
          { label: "Crédito fiscal", value: d.igv_is_credit ? "Sí" : "No" }, { label: "Archivos", value: [d.file_pdf_url && "PDF", d.file_xml_url && "XML"].filter(Boolean).join(" y ") || <Badge tone="warn">Sin archivos</Badge> },
        ]} />
        <div className="ml-auto w-full max-w-xs space-y-1 text-[13.5px]">
          <p className="flex justify-between"><span className="text-muted">Base gravada</span><span>{numero(d.base_taxed, 2)}</span></p>
          <p className="flex justify-between"><span className="text-muted">IGV</span><span>{numero(d.igv, 2)}</span></p>
          <p className="flex justify-between"><span className="text-muted">No gravado</span><span>{numero(d.non_taxed, 2)}</span></p>
          <p className="flex justify-between font-semibold"><span>Total</span><span>{numero(d.total, 2)}</span></p>
          <p className="flex justify-between"><span className="text-muted">Saldo por pagar</span><span>{soles(d.balance)}</span></p>
        </div>
        {d.lines.length > 0 && <DataTable rows={d.lines} rowKey={(l) => l.id} columns={[
          { key: "description", header: "Detalle", cardTitle: true, render: (l) => limpio(l.description) },
          { key: "qty", header: "Cantidad", align: "right", render: (l) => numero(l.qty, 3) },
          { key: "unit_price", header: "Precio", align: "right", render: (l) => numero(l.unit_price, 4) },
          { key: "total", header: "Total", align: "right", render: (l) => numero(l.total, 2) },
        ]} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Seccion titulo="Pagos">{d.payments.length ? d.payments.map((p) => <p key={p.id} className="text-[13px]">{p.number} · {fecha(p.paid_at)} · {soles(p.amount)}</p>) : <p className="text-[13px] text-muted">Sin pagos.</p>}</Seccion>
          <Seccion titulo="Asiento contable">{d.entries.length ? d.entries.map((e) => <p key={e.id} className="flex flex-wrap items-center gap-2 text-[13px]">{e.number ?? "Sin número"} · {soles(e.total_debit)} <StatusBadge status={e.status} labels={ESTADO_ASIENTO} /></p>) : <p className="text-[13px] text-muted">Sin asiento todavía.</p>}</Seccion>
        </div>
      </div>}
    </Modal>
  );
}

type RecepcionSinDoc = { id: string; number: string; received_at: string; total_cost: Num; po_id: string | null; po_number: string | null };
type LineaRecepcion = { id: string; variant_id: string; variant_name: string; qty: Num; weight_kg: Num; unit_cost: Num; price_basis: string; accepted: boolean };

function NuevoComprobante({ op, onClose, onGuardado }: { op: Opciones; onClose: () => void; onGuardado: (id: string) => void }) {
  const [f, setF] = useState({ supplier_id: "", doc_type: "INVOICE", series: "", number: "", issue_date: hoyLima(), due_date: "", currency: "PEN", exchange_rate: "1", base_taxed: "", igv: "",
    non_taxed: "", total: "", receipt_id: "", cost_center_id: "", brand_id: "", establishment_id: "", file_pdf_url: "", file_xml_url: "", description: "" });
  const [rcLineas, setRcLineas] = useState<LineaRecepcion[]>([]);
  const [poId, setPoId] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);
  const recepciones = useDatos<{ data: RecepcionSinDoc[] }>(f.supplier_id ? `/v1/com/recepciones?without_document=1&supplier_id=${f.supplier_id}&per_page=50` : null);
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  const igvRate = op.params.igv_rate ?? 0.18;
  async function elegirRecepcion(id: string) {
    setF({ ...f, receipt_id: id }); setRcLineas([]); setPoId(null);
    if (!id) return;
    const r = await api<{ po_id: string | null; total_cost: Num; lines: LineaRecepcion[] }>(`/v1/com/recepciones/${id}`);
    setRcLineas(r.lines.filter((l) => l.accepted)); setPoId(r.po_id);
    const base = Number(r.total_cost);
    if (!f.base_taxed) setF((x) => ({ ...x, receipt_id: id, base_taxed: base.toFixed(2), igv: (base * igvRate).toFixed(2), total: (base * (1 + igvRate)).toFixed(2) }));
  }
  async function revisarDuplicado() {
    if (!f.supplier_id || !f.series || !f.number) return;
    try {
      const r = await api<{ duplicate: boolean; document: { label: string; issue_date: string } | null }>(`/v1/com/comprobantes/duplicado?supplier_id=${f.supplier_id}&doc_type=${f.doc_type}&series=${encodeURIComponent(f.series)}&number=${encodeURIComponent(f.number)}`);
      setAviso(r.duplicate && r.document ? `${r.document.label} ya está registrado (emitido el ${fecha(r.document.issue_date)}).` : "");
    } catch { setAviso(""); }
  }
  async function tipoCambio(moneda: string, fechaEmision: string) {
    if (moneda === "PEN") { setF((x) => ({ ...x, currency: moneda, exchange_rate: "1" })); return; }
    try { const r = await api<{ rate: Num }>(`/v1/com/comprobantes/tipo-cambio?currency=${moneda}&date=${fechaEmision}`); setF((x) => ({ ...x, currency: moneda, exchange_rate: String(r.rate ?? "") })); }
    catch { setF((x) => ({ ...x, currency: moneda })); }
  }
  async function guardar() {
    setGuardando(true); setError(""); setErrores({});
    try {
      const r = await api<{ id: string }>("/v1/com/comprobantes", { method: "POST", body: {
        ...f, series: f.series.toUpperCase(), due_date: f.due_date || null, exchange_rate: n(f.exchange_rate), base_taxed: n(f.base_taxed) ?? 0, igv: n(f.igv) ?? 0, non_taxed: n(f.non_taxed), total: n(f.total),
        receipt_id: f.receipt_id || null, po_id: poId, cost_center_id: f.cost_center_id || null, brand_id: f.brand_id || null, establishment_id: f.establishment_id || null,
        file_pdf_url: f.file_pdf_url || null, file_xml_url: f.file_xml_url || null, description: f.description || null,
        lines: rcLineas.length ? rcLineas.map((l) => ({ receipt_line_id: l.id, variant_id: l.variant_id, description: l.variant_name, qty: Number(l.price_basis === "KG" ? l.weight_kg : l.qty), unit_price: Number(l.unit_cost) })) : null } });
      toast.ok("Comprobante registrado"); onGuardado(r.id);
    } catch (e) { const c = erroresDe(e); setErrores(c); if (!Object.keys(c).length) setError(mensajeDe(e)); } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" dismissable={!guardando} title="Registrar comprobante del proveedor"
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={guardar}>Registrar</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        {aviso && <Alert tone="warn">{aviso}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Proveedor" required error={errores.supplier_id} className="sm:col-span-2"><Select value={f.supplier_id} placeholder="Elegir" onChange={(x) => setF({ ...f, supplier_id: x.target.value, receipt_id: "" })} options={op.suppliers.map((s) => ({ value: s.id, label: `${s.name} · ${s.doc_number}` }))} /></Field>
          <Field label="Tipo" required error={errores.doc_type}><Select value={f.doc_type} onChange={set("doc_type")} options={op.doc_types.filter((d) => d.code !== "INTERNAL_TRANSFER").map((d) => ({ value: d.code, label: d.name }))} /></Field>
          <Field label="Serie" required error={errores.series}><Input value={f.series} maxLength={8} onChange={set("series")} onBlur={revisarDuplicado} /></Field>
          <Field label="Número" required error={errores.number}><Input value={f.number} inputMode="numeric" maxLength={20} onChange={set("number")} onBlur={revisarDuplicado} /></Field>
          <Field label="Emisión" required error={errores.issue_date}><Input type="date" value={f.issue_date} onChange={(x) => { setF({ ...f, issue_date: x.target.value }); if (f.currency !== "PEN") tipoCambio(f.currency, x.target.value); }} /></Field>
          <Field label="Vencimiento" error={errores.due_date} hint="Sin fecha, según los días de crédito"><Input type="date" value={f.due_date} onChange={set("due_date")} /></Field>
          <Field label="Moneda" error={errores.currency}><Select value={f.currency} onChange={(x) => tipoCambio(x.target.value, f.issue_date)} options={[{ value: "PEN", label: "Soles" }, { value: "USD", label: "Dólares" }, { value: "EUR", label: "Euros" }]} /></Field>
          <Field label="Tipo de cambio" error={errores.exchange_rate}><Input inputMode="decimal" value={f.exchange_rate} disabled={f.currency === "PEN"} onChange={set("exchange_rate")} /></Field>
          <Field label="Recepción" error={errores.receipt_id} hint="Para el cruce con la orden"><Select value={f.receipt_id} placeholder={f.supplier_id ? "Sin recepción" : "Elige el proveedor"} disabled={!f.supplier_id} onChange={(x) => elegirRecepcion(x.target.value)}
            options={(recepciones.datos?.data ?? []).map((r) => ({ value: r.id, label: `${r.number}${r.po_number ? ` · ${r.po_number}` : ""} · ${soles(r.total_cost)}` }))} /></Field>
          <Field label="Base gravada" required error={errores.base_taxed}><Input inputMode="decimal" value={f.base_taxed} onChange={(x) => { const b = Number(x.target.value.replace(",", ".") || 0); setF({ ...f, base_taxed: x.target.value, igv: (b * igvRate).toFixed(2), total: (b * (1 + igvRate) + Number(f.non_taxed || 0)).toFixed(2) }); }} /></Field>
          <Field label="IGV" required error={errores.igv}><Input inputMode="decimal" value={f.igv} onChange={set("igv")} /></Field>
          <Field label="No gravado" error={errores.non_taxed}><Input inputMode="decimal" value={f.non_taxed} onChange={set("non_taxed")} /></Field>
          <Field label="Total" required error={errores.total}><Input inputMode="decimal" value={f.total} onChange={set("total")} /></Field>
          <Field label="Centro de costo" error={errores.cost_center_id}><Select value={f.cost_center_id} placeholder="El del proveedor" onChange={set("cost_center_id")} options={op.cost_centers.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>
          <Field label="Marca" error={errores.brand_id}><Select value={f.brand_id} placeholder="Común" onChange={set("brand_id")} options={op.brands.map((b) => ({ value: b.id, label: b.name }))} /></Field>
          <Field label="Local" error={errores.establishment_id}><Select value={f.establishment_id} placeholder="El de la orden" onChange={set("establishment_id")} options={op.establishments.map((e) => ({ value: e.id, label: e.name }))} /></Field>
          <Field label="Archivo PDF" error={errores.file_pdf_url}><Input value={f.file_pdf_url} placeholder="Ruta o enlace" onChange={set("file_pdf_url")} /></Field>
          <Field label="Archivo XML" error={errores.file_xml_url}><Input value={f.file_xml_url} placeholder="Ruta o enlace" onChange={set("file_xml_url")} /></Field>
          <Field label="Detalle" error={errores.description} className="sm:col-span-2 lg:col-span-3"><Input value={f.description} maxLength={300} onChange={set("description")} /></Field>
        </div>
        {rcLineas.length > 0 && <p className="text-[12.5px] text-muted">Se cruzan {rcLineas.length} línea(s) de la recepción con su precio; si difiere de la orden más de {op.params.com_price_tolerance_pct ?? 2} %, queda observado.</p>}
      </div>
    </Modal>
  );
}
