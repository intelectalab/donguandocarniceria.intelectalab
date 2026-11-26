"use client";

import { useState } from "react";
import { CalendarClock, ClipboardList, Layers, Plus, ShoppingCart } from "lucide-react";
import { Badge, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { BuscaVariante } from "@/modulos/alm/comunes";
import type { Variante } from "@/modulos/alm/tipos";
import { CifraLink, FiltroSelect, accion, hoyLima, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { FichaOrden } from "@/modulos/com/Orden";
import { ORIGEN_REQ, REQUERIMIENTO, opciones, type Num } from "@/modulos/com/tipos";

type Fila = {
  id: string; number: string; source: string; source_ref: string | null; warehouse_code: string; warehouse_name: string; variant_id: string; sku: string; variant_name: string; sale_mode: string;
  qty: Num; needed_date: string; status: string; requested_by_name: string; requested_at: string; po_id: string | null; po_number: string | null; notes: string | null;
  suggested_supplier_id: string | null; suggested_supplier_name: string | null; best_price: Num;
};
type Cifras = { pending: number; due_soon: number; ordered_month: number };

/** COM-03 Requerimientos: lo que piden producción y los almacenes; se agrupan en órdenes por proveedor. */
export default function Requerimientos() {
  const op = useOpcionesCom();
  const [estado, setEstado] = useState("PENDING");
  const [origen, setOrigen] = useState("");
  const lista = useListado<Fila>("/v1/com/requerimientos", { orden: "needed_date", filtros: { status: estado, source: origen } });
  const c = useDatos<Cifras>("/v1/com/cifras/03");
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [orden, setOrden] = useState<string | null>(null);
  const recargar = () => { lista.recargar(); c.recargar(); setElegidos([]); };
  const filas = lista.tabla.rows;

  async function agrupar() {
    try {
      const r = await api<{ orders: { id: string; number: string; supplier_name: string }[]; skipped?: string[] }>("/v1/com/requerimientos/agrupar", { method: "POST", body: { ids: elegidos } });
      toast.ok(r.orders.length === 1 ? `Orden ${r.orders[0].number} creada en borrador` : `${r.orders.length} órdenes creadas en borrador`);
      recargar();
      if (r.orders[0]) setOrden(r.orders[0].id);
    } catch (e) { toast.error(mensajeDe(e)); }
  }

  const columnas: Column<Fila>[] = [
    { key: "number", header: "Número", sortable: true, render: (f) => <span className="font-mono">{f.number}</span> },
    { key: "variant_name", header: "Producto", cardTitle: true, render: (f) => <div className="min-w-[150px]"><p className="font-medium">{f.variant_name}</p><p className="font-mono text-[12px] text-muted">{f.sku}</p></div> },
    { key: "qty", header: "Cantidad", align: "right", render: (f) => `${numero(f.qty, 2)} ${f.sale_mode === "UNIT" ? "und" : "kg"}` },
    { key: "needed_date", header: "Para el", sortable: true, render: (f) => <span className={f.status === "PENDING" && f.needed_date <= hoyLima() ? "font-semibold text-bad" : ""}>{fecha(f.needed_date)}</span> },
    { key: "warehouse_code", header: "Almacén", hideOnMobile: true, render: (f) => f.warehouse_code },
    { key: "source", header: "Origen", hideOnMobile: true, render: (f) => <span>{ORIGEN_REQ[f.source] ?? f.source}{f.source_ref && <span className="block text-[12px] text-muted">{f.source_ref}</span>}</span> },
    { key: "suggested_supplier_name", header: "Proveedor sugerido", render: (f) => f.suggested_supplier_name ? <span>{f.suggested_supplier_name}<span className="block text-[12px] text-muted">{soles(f.best_price)}</span></span> : <Badge tone="warn">Sin catálogo</Badge> },
    { key: "status", header: "Estado", render: (f) => f.po_number ? <button type="button" className="text-primary underline" onClick={(e) => { e.stopPropagation(); setOrden(f.po_id); }}>{f.po_number}</button> : <StatusBadge status={f.status} labels={REQUERIMIENTO} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que hay que comprar: lo pide el plan de producción, un almacén bajo su stock mínimo o una persona. Marca varios y se agrupan en una orden por proveedor sugerido."
        actions={op?.can.order_create && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo requerimiento</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Pendientes" valor={c.datos ? numero(c.datos.pending) : undefined} icono={ClipboardList} onClick={() => setEstado("PENDING")} />
        <CifraLink titulo="Para los próximos 3 días" valor={c.datos ? numero(c.datos.due_soon) : undefined} icono={CalendarClock} tono={c.datos?.due_soon ? "warn" : undefined} />
        <CifraLink titulo="Con orden en el mes" valor={c.datos ? numero(c.datos.ordered_month) : undefined} icono={ShoppingCart} onClick={() => setEstado("ORDERED")} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} search={{ ...lista.tabla.search, placeholder: "Buscar número o producto…" }} empty="No hay requerimientos con esos filtros."
        selection={op?.can.order_create ? { selected: elegidos, onChange: setElegidos, canSelect: (f) => f.status === "PENDING",
          actions: <Button size="sm" variant="primary" icon={Layers} onClick={agrupar}>Crear órdenes por proveedor</Button> } : undefined}
        onRowClick={(f) => f.status === "PENDING" && op?.can.order_create && accion({ title: `¿Cancelar ${f.number}?`, reason: { min: 5 }, confirmLabel: "Cancelar requerimiento", danger: true },
          (m) => api(`/v1/com/requerimientos/${f.id}/cancelar`, { method: "POST", body: { reason: m } }), "Requerimiento cancelado", recargar)}
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opciones(Object.fromEntries(Object.entries(REQUERIMIENTO).map(([k, v]) => [k, v[0]])))} />
          <FiltroSelect label="Origen" value={origen} onChange={setOrigen} options={opciones(ORIGEN_REQ)} ancho="sm:w-[200px]" />
        </>} />
      {nuevo && op && <NuevoRequerimiento almacenes={op.warehouses} onClose={() => setNuevo(false)} onGuardado={() => { setNuevo(false); recargar(); }} />}
      {orden && <FichaOrden id={orden} op={op} onClose={() => setOrden(null)} onCambio={recargar} />}
      {filas.length > 0 && <p className="text-[12.5px] text-muted">Toca un requerimiento pendiente para cancelarlo.</p>}
    </div>
  );
}

function NuevoRequerimiento({ almacenes, onClose, onGuardado }: { almacenes: { id: string; code: string; name: string }[]; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState<Variante | null>(null);
  const [f, setF] = useState({ warehouse_id: "", qty: "", needed_date: hoyLima(), notes: "" });
  return (
    <Dialogo titulo="Nuevo requerimiento" boton="Registrar" onClose={onClose} enviar={async () => {
      await api("/v1/com/requerimientos", { method: "POST", body: { ...f, variant_id: v?.id, qty: Number(f.qty.replace(",", ".")), notes: f.notes || null } });
      toast.ok("Requerimiento registrado"); onGuardado();
    }}>
      {(e) => <>
        <Field label="Producto" required error={e.variant_id} className="sm:col-span-2"><BuscaVariante value={v} onChange={setV} invalid={Boolean(e.variant_id)} /></Field>
        <Field label="Almacén" required error={e.warehouse_id}><Select value={f.warehouse_id} placeholder="Elegir" onChange={(x) => setF({ ...f, warehouse_id: x.target.value })} options={almacenes.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} /></Field>
        <Field label={`Cantidad${v ? (v.sale_mode === "UNIT" ? " (unidades)" : " (kg)") : ""}`} required error={e.qty}><Input inputMode="decimal" value={f.qty} onChange={(x) => setF({ ...f, qty: x.target.value })} /></Field>
        <Field label="Para el" required error={e.needed_date}><Input type="date" value={f.needed_date} onChange={(x) => setF({ ...f, needed_date: x.target.value })} /></Field>
        <Field label="Nota" error={e.notes}><Input value={f.notes} maxLength={300} onChange={(x) => setF({ ...f, notes: x.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}
