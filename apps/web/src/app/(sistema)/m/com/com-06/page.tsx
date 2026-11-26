"use client";

import { useState } from "react";
import { PackageCheck, PackageOpen, Scale, ThermometerSnowflake, Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, kg, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { CifraLink, FiltroSelect, Seccion, limpio, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import type { OrdenDetalle } from "@/modulos/com/Orden";
import { CRUCE, DECISION, INSPECCION, RECEPCION, opciones, type Num, type Opciones } from "@/modulos/com/tipos";

type Fila = {
  id: string; number: string; receipt_type: string; received_at: string; status: string; supplier_name: string; po_number: string | null; warehouse_code: string; vehicle_temp_c: Num;
  inspection_result: string; total_cost: Num; received_by_name: string; document_label: string | null; carrier_guide: string | null; line_count: number; observed_lines: number; weight_kg: Num;
};
type Detalle = Fila & {
  warehouse_name: string; notes: string | null; scale_code: string | null;
  lines: { id: string; sku: string; variant_name: string; qty: Num; weight_kg: Num; temp_c: Num; unit_cost: Num; price_basis: string; total_cost: Num; accepted: boolean; quality_hold: boolean;
    rejection_reason: string | null; over_pct: Num; lot_code: string | null; supplier_lot_code: string | null; expiry_date: string | null; qc_status: string | null }[];
  documents: { id: string; doc_type: string; series: string; number: string; total: Num; match_status: string }[];
};
type Cifras = { today: number; month: number; kg_month: Num; observed: number; open_orders: number };

/** COM-06 Recepción: contra la orden o sin ella, con kg, temperatura por línea y del vehículo, lote, vencimiento, balanza e inspección. */
export default function Recepciones() {
  const op = useOpcionesCom();
  const [tipo, setTipo] = useState("");
  const [obs, setObs] = useState(false);
  const lista = useListado<Fila>("/v1/com/recepciones", { orden: "-received_at", filtros: { receipt_type: tipo, observed: obs ? 1 : null } });
  const c = useDatos<Cifras>("/v1/com/cifras/06");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const recargar = () => { lista.recargar(); c.recargar(); };

  const columnas: Column<Fila>[] = [
    { key: "number", header: "Recepción", sortable: true, render: (f) => <span className="font-mono">{f.number}</span> },
    { key: "supplier_name", header: "Proveedor", cardTitle: true, render: (f) => <div className="min-w-[150px]"><p className="font-medium">{f.supplier_name}</p><p className="text-[12px] text-muted">{f.po_number ?? RECEPCION[f.receipt_type] ?? f.receipt_type}</p></div> },
    { key: "received_at", header: "Recibida", sortable: true, render: (f) => fechaHora(f.received_at) },
    { key: "weight_kg", header: "Kg", align: "right", render: (f) => kg(f.weight_kg) },
    { key: "vehicle_temp_c", header: "Vehículo", align: "right", hideOnMobile: true, render: (f) => f.vehicle_temp_c !== null ? `${numero(f.vehicle_temp_c, 1)} °C` : "—" },
    { key: "total_cost", header: "Costo", align: "right", render: (f) => soles(f.total_cost) },
    { key: "inspection_result", header: "Inspección", render: (f) => <span className="flex flex-wrap gap-1"><StatusBadge status={f.inspection_result} labels={INSPECCION} />{f.observed_lines > 0 && <Badge tone="bad">{f.observed_lines} línea(s) observadas</Badge>}</span> },
    { key: "document_label", header: "Comprobante", hideOnMobile: true, render: (f) => f.document_label ?? <Badge tone="warn">Sin comprobante</Badge> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que entra del proveedor: se pesa, se toma la temperatura del vehículo y de cada línea, y queda el lote del proveedor con su vencimiento. Cada línea se acepta, se rechaza o se retiene para Calidad."
        actions={op?.can.receipt_record && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Recibir</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Recepciones del mes" valor={c.datos ? numero(c.datos.month) : undefined} detalle={c.datos ? `${numero(c.datos.today)} hoy` : undefined} icono={PackageCheck} />
        <CifraLink titulo="Kg recibidos en el mes" valor={c.datos ? kg(c.datos.kg_month) : undefined} icono={Scale} />
        <CifraLink titulo="Observadas" valor={c.datos ? numero(c.datos.observed) : undefined} detalle="Temperatura, peso o calidad" icono={ThermometerSnowflake} tono={c.datos?.observed ? "warn" : "ok"} onClick={() => setObs(true)} />
        <CifraLink titulo="Órdenes por recibir" valor={c.datos ? numero(c.datos.open_orders) : undefined} icono={PackageOpen} href="/m/com/com-04" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(f) => setAbierta(f.id)} search={{ ...lista.tabla.search, placeholder: "Buscar número, proveedor u orden…" }} empty="No hay recepciones con esos filtros."
        toolbar={<>
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opciones(RECEPCION)} ancho="sm:w-[200px]" />
          <FiltroSelect label="Observadas" value={obs ? "1" : ""} onChange={(v) => setObs(v === "1")} options={[{ value: "1", label: "Solo observadas" }]} />
        </>} />
      {abierta && <FichaRecepcion id={abierta} onClose={() => setAbierta(null)} />}
      {nueva && op && <NuevaRecepcion op={op} onClose={() => setNueva(false)} onGuardado={(id) => { setNueva(false); recargar(); setAbierta(id); }} />}
    </div>
  );
}

function FichaRecepcion({ id, onClose }: { id: string; onClose: () => void }) {
  const { datos: r, error } = useDatos<Detalle>(`/v1/com/recepciones/${id}`);
  return (
    <Modal open onClose={onClose} size="lg" title={r ? `Recepción ${r.number}` : "Recepción"} description={r ? `${r.supplier_name} · ${fechaHora(r.received_at)}` : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {r && <div className="space-y-5">
        <DetailList items={[
          { label: "Tipo", value: RECEPCION[r.receipt_type] ?? r.receipt_type }, { label: "Orden", value: r.po_number ?? "Sin orden" },
          { label: "Almacén", value: `${r.warehouse_code} · ${r.warehouse_name}` }, { label: "Vehículo", value: r.vehicle_temp_c !== null ? `${numero(r.vehicle_temp_c, 1)} °C` : "—" },
          { label: "Guía", value: r.carrier_guide ?? "—" }, { label: "Balanza", value: r.scale_code ?? "—" },
          { label: "Inspección", value: <StatusBadge status={r.inspection_result} labels={INSPECCION} /> }, { label: "Recibió", value: r.received_by_name },
        ]} />
        {r.notes && <p className="text-[13px] text-muted">{limpio(r.notes)}</p>}
        <DataTable rows={r.lines} rowKey={(l) => l.id} columns={[
          { key: "variant_name", header: "Producto", cardTitle: true, render: (l) => <div><p className="font-medium">{l.variant_name}</p><p className="text-[12px] text-muted">Lote {l.lot_code ?? "—"}{l.supplier_lot_code ? ` · proveedor ${l.supplier_lot_code}` : ""}</p></div> },
          { key: "weight_kg", header: "Kg / und", align: "right", render: (l) => `${kg(l.weight_kg)} · ${numero(l.qty)}` },
          { key: "temp_c", header: "Temp.", align: "right", render: (l) => l.temp_c !== null ? `${numero(l.temp_c, 1)} °C` : "—" },
          { key: "expiry_date", header: "Vence", hideOnMobile: true, render: (l) => fecha(l.expiry_date) },
          { key: "total_cost", header: "Costo", align: "right", render: (l) => soles(l.total_cost) },
          { key: "accepted", header: "Resultado", render: (l) => !l.accepted ? <Badge tone="bad">Rechazada</Badge> : l.quality_hold ? <Badge tone="warn">Retenida por Calidad</Badge> : <Badge tone="ok">Aceptada</Badge> },
        ]} />
        <Seccion titulo="Comprobantes">{r.documents.length ? r.documents.map((d) => <p key={d.id} className="flex flex-wrap items-center gap-2 text-[13px]">{d.series}-{d.number} · {soles(d.total)} <StatusBadge status={d.match_status} labels={CRUCE} /></p>)
          : <p className="text-[13px] text-muted">Aún sin comprobante: se registra en Comprobantes del proveedor.</p>}</Seccion>
      </div>}
    </Modal>
  );
}

type LineaRc = { po_line_id: string; nombre: string; basis: string; pendiente: Num; storage: string; temp_max: number | null; qty: string; weight_kg: string; temp_c: string;
  supplier_lot_code: string; expiry_date: string; decision: string; rejection_reason: string; unit_price: Num };

function NuevaRecepcion({ op, onClose, onGuardado }: { op: Opciones; onClose: () => void; onGuardado: (id: string) => void }) {
  const ordenes = useDatos<{ data: { id: string; number: string; supplier_name: string; warehouse_code: string }[] }>("/v1/com/ordenes?status=APPROVED,PARTIALLY_RECEIVED&per_page=100");
  const [po, setPo] = useState("");
  const [cab, setCab] = useState({ vehicle_temp_c: "", carrier_guide: "", scale_equipment_id: "", inspection_result: "OK" });
  const [lineas, setLineas] = useState<LineaRc[]>([]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function elegir(id: string) {
    setPo(id); setLineas([]);
    if (!id) return;
    try {
      const o = await api<OrdenDetalle>(`/v1/com/recepciones/pendientes/${id}`);
      setLineas(o.lines.filter((l) => Number(l.pending) > 0).map((l) => ({ po_line_id: l.id, nombre: `${l.sku} · ${l.variant_name}`, basis: l.price_basis, pendiente: l.pending, storage: l.storage ?? "", temp_max: l.temp_max ?? null,
        qty: l.sale_mode === "KG" ? "" : String(l.pending), weight_kg: l.sale_mode === "KG" ? String(l.pending) : "", temp_c: "", supplier_lot_code: "", expiry_date: "", decision: "ACCEPT", rejection_reason: "", unit_price: l.unit_price })));
    } catch (e) { toast.error(mensajeDe(e)); }
  }
  const cambiar = (i: number, p: Partial<LineaRc>) => setLineas(lineas.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  async function guardar() {
    setGuardando(true); setError(""); setErrores({});
    try {
      const r = await api<{ id: string; number: string }>("/v1/com/recepciones", { method: "POST", body: {
        po_id: po, vehicle_temp_c: n(cab.vehicle_temp_c), carrier_guide: cab.carrier_guide || null, scale_equipment_id: cab.scale_equipment_id || null, inspection_result: cab.inspection_result,
        lines: lineas.map((l) => ({ po_line_id: l.po_line_id, qty: n(l.qty), weight_kg: n(l.weight_kg), temp_c: n(l.temp_c), supplier_lot_code: l.supplier_lot_code || null,
          expiry_date: l.expiry_date || null, decision: l.decision, rejection_reason: l.rejection_reason || null })) } });
      toast.ok(`Recepción ${r.number} registrada`); onGuardado(r.id);
    } catch (e) { const c = erroresDe(e); setErrores(c); if (!Object.keys(c).length) setError(mensajeDe(e)); } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" dismissable={!guardando} title="Recibir mercadería"
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} disabled={!lineas.length} onClick={guardar}>Registrar recepción</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Orden de compra" required className="sm:col-span-2">
            <Select value={po} placeholder="Elegir orden aprobada" onChange={(x) => elegir(x.target.value)} options={(ordenes.datos?.data ?? []).map((o) => ({ value: o.id, label: `${o.number} · ${o.supplier_name} · ${o.warehouse_code}` }))} />
          </Field>
          <Field label="Temperatura del vehículo" error={errores.vehicle_temp_c} hint={`Refrigerado hasta ${op.params.com_chilled_max_c ?? 4} °C`}><Input inputMode="decimal" suffix="°C" value={cab.vehicle_temp_c} onChange={(x) => setCab({ ...cab, vehicle_temp_c: x.target.value })} /></Field>
          <Field label="Guía de remisión" error={errores.carrier_guide}><Input value={cab.carrier_guide} maxLength={40} onChange={(x) => setCab({ ...cab, carrier_guide: x.target.value })} /></Field>
          <Field label="Balanza" error={errores.scale_equipment_id}><Select value={cab.scale_equipment_id} placeholder="Elegir" onChange={(x) => setCab({ ...cab, scale_equipment_id: x.target.value })} options={op.scales.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} /></Field>
          <Field label="Inspección de recepción" error={errores.inspection_result}><Select value={cab.inspection_result} onChange={(x) => setCab({ ...cab, inspection_result: x.target.value })} options={opciones(Object.fromEntries(Object.entries(INSPECCION).map(([k, v]) => [k, v[0]])))} /></Field>
        </div>
        {lineas.map((l, i) => (
          <div key={l.po_line_id} className="space-y-2 rounded-lg border border-line p-3">
            <p className="text-[13.5px] font-medium">{l.nombre} <span className="text-[12px] font-normal text-muted">· pendiente {numero(l.pendiente, 2)} · {soles(l.unit_price)} / {l.basis === "KG" ? "kg" : "und"}{l.temp_max !== null ? ` · máx. ${l.temp_max} °C` : ""}</span></p>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Unidades" error={errores[`lines.${i}.qty`]}><Input inputMode="decimal" value={l.qty} onChange={(x) => cambiar(i, { qty: x.target.value })} /></Field>
              <Field label="Kg pesados" error={errores[`lines.${i}.weight_kg`]}><Input inputMode="decimal" value={l.weight_kg} onChange={(x) => cambiar(i, { weight_kg: x.target.value })} /></Field>
              <Field label="Temperatura" error={errores[`lines.${i}.temp_c`]}><Input inputMode="decimal" suffix="°C" value={l.temp_c} onChange={(x) => cambiar(i, { temp_c: x.target.value })} /></Field>
              <Field label="Lote del proveedor"><Input value={l.supplier_lot_code} maxLength={60} onChange={(x) => cambiar(i, { supplier_lot_code: x.target.value })} /></Field>
              <Field label="Vence" error={errores[`lines.${i}.expiry_date`]}><Input type="date" value={l.expiry_date} onChange={(x) => cambiar(i, { expiry_date: x.target.value })} /></Field>
              <Field label="Decisión"><Select value={l.decision} onChange={(x) => cambiar(i, { decision: x.target.value })} options={opciones(DECISION)} /></Field>
            </div>
            {l.decision === "REJECT" && <Field label="Motivo del rechazo" required error={errores[`lines.${i}.rejection_reason`]}><Input value={l.rejection_reason} maxLength={200} onChange={(x) => cambiar(i, { rejection_reason: x.target.value })} /></Field>}
          </div>
        ))}
        {po && !lineas.length && <p className="text-[13px] text-muted">Cargando las líneas pendientes…</p>}
      </div>
    </Modal>
  );
}
