"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Alert, Button, DataTable, DetailList, Field, IconButton, Input, Modal, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje, soles } from "@/lib/formato";
import { BuscaVariante } from "@/modulos/alm/comunes";
import type { Variante } from "@/modulos/alm/tipos";
import { Seccion, accion, hoyLima, useDatos } from "./comunes";
import { CRUCE, ORDEN, type Num, type Opciones } from "./tipos";

export type OrdenDetalle = {
  id: string; number: string; order_date: string; expected_date: string; status: string; supplier_id: string; supplier_name: string; supplier_doc: string; supplier_type: string;
  warehouse_id: string; warehouse_code: string; warehouse_name: string; establishment_name: string; brand_id: string | null; subtotal: Num; igv: Num; total: Num; no_igv: boolean;
  auto_approved: boolean | null; created_by: string; created_by_name: string; approved_by_name: string | null; approved_at: string | null; notes: string | null; void_reason: string | null;
  history: { at: string; user: string; action: string }[]; threshold: Num; can_approve?: boolean;
  lines: { id: string; variant_id: string; sku: string; variant_name: string; sale_mode: string; qty: Num; price_basis: string; est_weight_kg: Num; unit_price: Num; subtotal: Num;
    ordered: Num; received: Num; pending: Num; storage?: string; temp_max?: number | null }[];
  receipts: { id: string; number: string; received_at: string; total_cost: Num; status: string }[];
  documents: { id: string; doc_type: string; series: string; number: string; total: Num; match_status: string }[];
};

/** Ficha de una orden de compra con sus acciones según el estado y los permisos (COM-04 y COM-05). */
export function FichaOrden({ id, op, onClose, onCambio }: { id: string; op: Opciones | null; onClose: () => void; onCambio: () => void }) {
  const { datos: o, error, recargar } = useDatos<OrdenDetalle>(`/v1/com/ordenes/${id}`);
  const [editar, setEditar] = useState(false);
  const listo = () => { recargar(); onCambio(); };
  const post = (ruta: string, body?: object) => api(`/v1/com/ordenes/${id}/${ruta}`, { method: "POST", body });
  const abierta = o && ["APPROVED", "PARTIALLY_RECEIVED"].includes(o.status);
  return (
    <Modal open onClose={onClose} size="lg" title={o ? `Orden ${o.number}` : "Orden de compra"} description={o ? `${o.supplier_name} · ${o.warehouse_code} ${o.warehouse_name}` : undefined}
      footer={o && <>
        {o.status === "DRAFT" && op?.can.order_create && <>
          <Button onClick={() => setEditar(true)}>Editar</Button>
          <Button variant="primary" onClick={() => accion({ title: "¿Enviar la orden?", message: `Si supera ${soles(o.threshold)} pasa a aprobación; si no, queda aprobada.`, confirmLabel: "Enviar" }, () => post("enviar"), "Orden enviada", listo)}>Enviar</Button>
        </>}
        {o.status === "PENDING_APPROVAL" && o.can_approve && <>
          <Button onClick={() => accion({ title: "¿Devolver la orden?", reason: { min: 5, label: "Qué hay que corregir" }, confirmLabel: "Devolver" }, (m) => post("devolver", { reason: m }), "Orden devuelta", listo)}>Devolver</Button>
          <Button variant="primary" onClick={() => accion({ title: `¿Aprobar ${o.number} por ${soles(o.total)}?`, confirmLabel: "Aprobar" }, () => post("aprobar"), "Orden aprobada", listo)}>Aprobar</Button>
        </>}
        {abierta && op?.can.order_create && <Button onClick={() => accion({ title: "¿Cerrar la orden?", message: "Lo pendiente ya no se recibirá.", reason: { min: 5 }, confirmLabel: "Cerrar" }, (m) => post("cerrar", { reason: m }), "Orden cerrada", listo)}>Cerrar con saldo</Button>}
        {["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(o.status) && op?.can.order_create && <Button variant="danger" onClick={() => accion({ title: "¿Anular la orden?", reason: { min: 5 }, confirmLabel: "Anular", danger: true }, (m) => post("anular", { reason: m }), "Orden anulada", listo)}>Anular</Button>}
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {o && <div className="space-y-5">
        {o.status === "PENDING_APPROVAL" && !o.can_approve && <Alert tone="info">Espera la aprobación de Administración o Gerencia: supera {soles(o.threshold)}. Quien crea la orden no la aprueba.</Alert>}
        {o.void_reason && <Alert tone="warn" title="Motivo">{o.void_reason}</Alert>}
        <DetailList items={[
          { label: "Estado", value: <StatusBadge status={o.status} labels={ORDEN} /> }, { label: "Proveedor", value: `${o.supplier_name} · ${o.supplier_doc}` },
          { label: "Fecha y entrega esperada", value: `${fecha(o.order_date)} → ${fecha(o.expected_date)}` }, { label: "Local", value: o.establishment_name },
          { label: "Creada por", value: o.created_by_name }, { label: "Aprobada", value: o.auto_approved ? "Automática (bajo el umbral)" : o.approved_at ? `${fechaHora(o.approved_at)} · ${o.approved_by_name ?? ""}` : "—" },
        ]} />
        <DataTable rows={o.lines} rowKey={(l) => l.id} columns={[
          { key: "variant_name", header: "Producto", cardTitle: true, render: (l) => <div><p className="font-medium">{l.variant_name}</p><p className="font-mono text-[12px] text-muted">{l.sku}</p></div> },
          { key: "qty", header: "Pedido", align: "right", render: (l) => `${numero(l.qty)}${l.price_basis === "KG" && l.sale_mode !== "KG" ? ` · ${numero(l.est_weight_kg, 1)} kg` : ""}` },
          { key: "unit_price", header: "Precio", align: "right", render: (l) => `${soles(l.unit_price)} / ${l.price_basis === "KG" ? "kg" : "und"}` },
          { key: "subtotal", header: "Subtotal", align: "right", render: (l) => soles(l.subtotal) },
          { key: "received", header: "Recibido", align: "right", render: (l) => <span>{numero(l.received, 2)}{Number(l.pending) > 0 && <span className="block text-[12px] text-warn">faltan {numero(l.pending, 2)}</span>}</span> },
        ]} />
        <div className="ml-auto w-full max-w-xs space-y-1 text-[13.5px]">
          <p className="flex justify-between"><span className="text-muted">Subtotal</span><span>{soles(o.subtotal)}</span></p>
          <p className="flex justify-between"><span className="text-muted">IGV{o.no_igv ? " (no aplica)" : ""}</span><span>{soles(o.igv)}</span></p>
          <p className="flex justify-between font-semibold"><span>Total</span><span>{soles(o.total)}</span></p>
        </div>
        {(o.receipts.length > 0 || o.documents.length > 0) && <div className="grid gap-3 sm:grid-cols-2">
          <Seccion titulo="Recepciones">{o.receipts.length ? o.receipts.map((r) => <p key={r.id} className="text-[13px]">{r.number} · {fecha(r.received_at)} · {soles(r.total_cost)}</p>) : <p className="text-[13px] text-muted">Sin recepciones.</p>}</Seccion>
          <Seccion titulo="Comprobantes">{o.documents.length ? o.documents.map((d) => <p key={d.id} className="flex flex-wrap items-center gap-2 text-[13px]">{d.series}-{d.number} · {soles(d.total)} <StatusBadge status={d.match_status} labels={CRUCE} /></p>) : <p className="text-[13px] text-muted">Sin comprobantes.</p>}</Seccion>
        </div>}
        <Seccion titulo="Historial">
          <ul className="space-y-1 text-[13px]">{o.history.map((h, i) => <li key={i}><span className="text-muted">{fechaHora(h.at)} · {h.user}:</span> {h.action}</li>)}</ul>
        </Seccion>
      </div>}
      {editar && o && op && <FormOrden op={op} orden={o} onClose={() => setEditar(false)} onGuardado={() => { setEditar(false); listo(); }} />}
    </Modal>
  );
}

type Linea = { variant: Variante | null; variant_id: string; label: string; qty: string; price_basis: string; est_weight_kg: string; unit_price: string };

/** Formulario de orden de compra: proveedor, almacén de destino, fecha esperada y líneas. */
export function FormOrden({ op, orden, inicial, onClose, onGuardado }: { op: Opciones; orden?: OrdenDetalle; inicial?: { supplier_id?: string; warehouse_id?: string };
  onClose: () => void; onGuardado: (id: string) => void }) {
  const [f, setF] = useState({ supplier_id: orden?.supplier_id ?? inicial?.supplier_id ?? "", warehouse_id: orden?.warehouse_id ?? inicial?.warehouse_id ?? "",
    expected_date: orden?.expected_date ?? hoyLima(), notes: orden?.notes ?? "" });
  const [lineas, setLineas] = useState<Linea[]>(orden?.lines.map((l) => ({ variant: null, variant_id: l.variant_id, label: `${l.sku} · ${l.variant_name}`, qty: String(l.qty), price_basis: l.price_basis,
    est_weight_kg: String(l.est_weight_kg ?? ""), unit_price: String(l.unit_price) })) ?? [{ variant: null, variant_id: "", label: "", qty: "", price_basis: "KG", est_weight_kg: "", unit_price: "" }]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const prov = op.suppliers.find((s) => s.id === f.supplier_id);
  const n = (s: string) => Number(s.replace(",", ".") || 0);
  const subtotal = lineas.reduce((a, l) => a + n(l.unit_price) * (l.price_basis === "KG" && l.est_weight_kg ? n(l.est_weight_kg) : n(l.qty)), 0);
  const igv = prov?.no_igv ? 0 : subtotal * (op.params.igv_rate ?? 0.18);
  const cambiar = (i: number, p: Partial<Linea>) => setLineas(lineas.map((l, j) => (j === i ? { ...l, ...p } : l)));
  async function guardar(enviar: boolean) {
    setGuardando(true); setError(""); setErrores({});
    try {
      const body = { ...f, notes: f.notes || null, submit: enviar, lines: lineas.filter((l) => l.variant_id).map((l) => ({ variant_id: l.variant_id, qty: n(l.qty), price_basis: l.price_basis,
        est_weight_kg: l.est_weight_kg ? n(l.est_weight_kg) : null, unit_price: n(l.unit_price) })) };
      const r = await api<{ id: string; number: string; status: string }>(orden ? `/v1/com/ordenes/${orden.id}` : "/v1/com/ordenes", { method: orden ? "PUT" : "POST", body });
      toast.ok(enviar ? (r.status === "APPROVED" ? `Orden ${r.number} aprobada` : `Orden ${r.number} enviada a aprobación`) : `Orden ${r.number} guardada en borrador`);
      onGuardado(r.id);
    } catch (e) {
      const c = erroresDe(e); setErrores(c); if (!Object.keys(c).length) setError(mensajeDe(e));
    } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" dismissable={!guardando} title={orden ? `Editar ${orden.number}` : "Nueva orden de compra"}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button loading={guardando} onClick={() => guardar(false)}>Guardar borrador</Button>
        <Button variant="primary" loading={guardando} onClick={() => guardar(true)}>Guardar y enviar</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor" required error={errores.supplier_id}>
            <Select value={f.supplier_id} placeholder="Elegir" onChange={(x) => setF({ ...f, supplier_id: x.target.value })}
              options={op.suppliers.map((s) => ({ value: s.id, label: `${s.name}${s.can_order ? "" : " (bloqueado por SUNAT)"}`, disabled: !s.can_order }))} />
          </Field>
          <Field label="Almacén de destino" required error={errores.warehouse_id}>
            <Select value={f.warehouse_id} placeholder="Elegir" onChange={(x) => setF({ ...f, warehouse_id: x.target.value })} options={op.warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
          </Field>
          <Field label="Entrega esperada" required error={errores.expected_date}><Input type="date" value={f.expected_date} onChange={(x) => setF({ ...f, expected_date: x.target.value })} /></Field>
          <Field label="Notas" error={errores.notes}><Input value={f.notes} maxLength={500} onChange={(x) => setF({ ...f, notes: x.target.value })} /></Field>
        </div>
        {errores.lines && <Alert tone="bad">{errores.lines}</Alert>}
        <div className="space-y-3">
          {lineas.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] sm:items-end">
              <Field label="Producto" error={errores[`lines.${i}.variant_id`]}>
                {l.variant_id && !l.variant ? <div className="flex items-center gap-2 text-[13px]"><span className="truncate">{l.label}</span><Button size="sm" onClick={() => cambiar(i, { variant_id: "", label: "" })}>Cambiar</Button></div>
                  : <BuscaVariante value={l.variant} onChange={(v) => cambiar(i, { variant: v, variant_id: v?.id ?? "", label: v ? `${v.sku} · ${v.name}` : "", price_basis: v ? (v.sale_mode === "UNIT" ? "UNIT" : "KG") : l.price_basis })} />}
              </Field>
              <Field label="Cantidad" error={errores[`lines.${i}.qty`]}><Input inputMode="decimal" value={l.qty} onChange={(x) => cambiar(i, { qty: x.target.value })} /></Field>
              <Field label="Precio por"><Select value={l.price_basis} onChange={(x) => cambiar(i, { price_basis: x.target.value })} options={[{ value: "KG", label: "Kilo" }, { value: "UNIT", label: "Unidad" }]} /></Field>
              <Field label="Kg estimados" hint={l.price_basis === "KG" ? "Si se pide por unidades" : undefined}><Input inputMode="decimal" value={l.est_weight_kg} disabled={l.price_basis !== "KG"} onChange={(x) => cambiar(i, { est_weight_kg: x.target.value })} /></Field>
              <Field label="Precio sin IGV" error={errores[`lines.${i}.unit_price`]}><Input inputMode="decimal" prefix="S/" value={l.unit_price} onChange={(x) => cambiar(i, { unit_price: x.target.value })} /></Field>
              <IconButton icon={Trash2} label="Quitar línea" onClick={() => setLineas(lineas.filter((_, j) => j !== i))} disabled={lineas.length === 1} />
            </div>
          ))}
          <Button size="sm" icon={Plus} onClick={() => setLineas([...lineas, { variant: null, variant_id: "", label: "", qty: "", price_basis: "KG", est_weight_kg: "", unit_price: "" }])}>Agregar línea</Button>
        </div>
        <div className="ml-auto w-full max-w-xs space-y-1 text-[13.5px]">
          <p className="flex justify-between"><span className="text-muted">Subtotal</span><span>{soles(subtotal)}</span></p>
          <p className="flex justify-between"><span className="text-muted">IGV{prov?.no_igv ? " (no aplica a este proveedor)" : ""}</span><span>{soles(igv)}</span></p>
          <p className="flex justify-between font-semibold"><span>Total</span><span>{soles(subtotal + igv)}</span></p>
          {subtotal + igv > (op.params.com_po_approval_threshold_pen ?? 2000) && <p className="text-[12.5px] text-warn">Supera {soles(op.params.com_po_approval_threshold_pen)}: la aprueba Administración.</p>}
        </div>
      </div>
    </Modal>
  );
}

export type FilaOrden = {
  id: string; number: string; order_date: string; expected_date: string; status: string; supplier_name: string; warehouse_code: string; establishment_name: string;
  subtotal: Num; igv: Num; total: Num; created_by_name: string; line_count: number; received_pct: Num; auto_approved: boolean | null;
};

export const columnasOrden: Column<FilaOrden>[] = [
  { key: "number", header: "Orden", sortable: true, render: (f) => <span className="font-mono">{f.number}</span> },
  { key: "supplier_name", header: "Proveedor", sortable: true, cardTitle: true, render: (f) => <div className="min-w-[150px]"><p className="font-medium">{f.supplier_name}</p><p className="text-[12px] text-muted">{f.line_count} línea(s) · {f.created_by_name}</p></div> },
  { key: "order_date", header: "Fecha", sortable: true, hideOnMobile: true, render: (f) => fecha(f.order_date) },
  { key: "expected_date", header: "Entrega", sortable: true, render: (f) => <span className={["APPROVED", "PARTIALLY_RECEIVED"].includes(f.status) && f.expected_date < hoyLima() ? "font-semibold text-bad" : ""}>{fecha(f.expected_date)}</span> },
  { key: "warehouse_code", header: "Destino", hideOnMobile: true, render: (f) => f.warehouse_code },
  { key: "total", header: "Total", sortable: true, align: "right", render: (f) => soles(f.total) },
  { key: "received_pct", header: "Recibido", align: "right", hideOnMobile: true, render: (f) => porcentaje(f.received_pct) },
  { key: "status", header: "Estado", render: (f) => <StatusBadge status={f.status} labels={ORDEN} /> },
];

