"use client";

import { useState } from "react";
import { History, Package, Plus, TriangleAlert, Users } from "lucide-react";
import { Button, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { BuscaVariante } from "@/modulos/alm/comunes";
import { CifraLink, FiltroSelect, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { TIPO_PROVEEDOR, type Num, type Opciones } from "@/modulos/com/tipos";
import type { Variante } from "@/modulos/alm/tipos";

type Fila = {
  id: string; supplier_id: string; supplier_name: string; supplier_type: string; variant_id: string; sku: string; variant_name: string; line: string | null; supplier_sku: string | null;
  uom_code: string | null; price_basis: string; last_price: Num; min_order_qty: Num; lead_time_days: number | null; status: string; best_price: Num; updated_at: string | null;
  price_history: { date: string; price: Num; source?: string }[];
};
type Cifras = { items: number; variants: number; single_source: number; stale: number };

/** COM-02 Catálogo por proveedor: qué nos vende cada uno, a qué precio y con qué plazo, con el historial de precios. */
export default function Catalogo() {
  const op = useOpcionesCom();
  const [prov, setProv] = useState("");
  const [linea, setLinea] = useState("");
  const lista = useListado<Fila>("/v1/com/catalogo", { orden: "variant_name", filtros: { supplier_id: prov, line: linea } });
  const c = useDatos<Cifras>("/v1/com/cifras/02");
  const [editar, setEditar] = useState<Fila | "nuevo" | null>(null);
  const [historial, setHistorial] = useState<Fila | null>(null);

  const columnas: Column<Fila>[] = [
    { key: "variant_name", header: "Producto", sortable: true, cardTitle: true, render: (f) => <div className="min-w-[160px]"><p className="font-medium">{f.variant_name}</p><p className="font-mono text-[12px] text-muted">{f.sku}{f.supplier_sku ? ` · código del proveedor ${f.supplier_sku}` : ""}</p></div> },
    { key: "supplier_name", header: "Proveedor", sortable: true, render: (f) => <div><p>{f.supplier_name}</p><p className="text-[12px] text-muted">{TIPO_PROVEEDOR[f.supplier_type] ?? f.supplier_type}</p></div> },
    { key: "last_price", header: "Último precio", sortable: true, align: "right", render: (f) => (
      <span className="whitespace-nowrap">{soles(f.last_price)} / {f.price_basis === "KG" ? "kg" : "und"}{f.best_price !== null && Number(f.best_price) < Number(f.last_price) && <span className="block text-[12px] text-warn">mejor: {soles(f.best_price)}</span>}</span>) },
    { key: "min_order_qty", header: "Pedido mínimo", align: "right", hideOnMobile: true, render: (f) => f.min_order_qty ? `${numero(f.min_order_qty)} ${f.uom_code ?? ""}` : "—" },
    { key: "lead_time_days", header: "Plazo", align: "right", hideOnMobile: true, render: (f) => f.lead_time_days !== null ? `${f.lead_time_days} días` : "—" },
    { key: "updated_at", header: "Actualizado", hideOnMobile: true, render: (f) => fecha(f.updated_at) },
    { key: "status", header: "Estado", render: (f) => <StatusBadge status={f.status} /> },
    { key: "id", header: "", render: (f) => <Button size="sm" icon={History} onClick={(e) => { e.stopPropagation(); setHistorial(f); }}>Precios</Button> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="El catálogo de cada proveedor: código, unidad, último precio, pedido mínimo y plazo de entrega. Al recibir, el último precio se actualiza y queda en el historial."
        actions={op?.can.order_create && <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Agregar producto</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Productos en catálogos" valor={c.datos ? numero(c.datos.items) : undefined} icono={Package} />
        <CifraLink titulo="Variantes cubiertas" valor={c.datos ? numero(c.datos.variants) : undefined} icono={Users} />
        <CifraLink titulo="Con un solo proveedor" valor={c.datos ? numero(c.datos.single_source) : undefined} detalle="Sin alternativa si falla" icono={TriangleAlert} tono={c.datos?.single_source ? "warn" : undefined} />
        <CifraLink titulo="Precio sin actualizar" valor={c.datos ? numero(c.datos.stale) : undefined} detalle="Más de 90 días" icono={History} tono={c.datos?.stale ? "warn" : undefined} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(f) => op?.can.order_create && setEditar(f)} search={{ ...lista.tabla.search, placeholder: "Buscar producto, SKU o proveedor…" }}
        empty="No hay productos en el catálogo con esos filtros."
        toolbar={<>
          <FiltroSelect label="Proveedor" value={prov} onChange={setProv} ancho="sm:w-[220px]" options={(op?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <FiltroSelect label="Línea" value={linea} onChange={setLinea} options={(op?.lines ?? []).map((l) => ({ value: l, label: l.charAt(0) + l.slice(1).toLowerCase() }))} />
        </>} />
      {editar && op && <FormCatalogo op={op} fila={editar === "nuevo" ? null : editar} onClose={() => setEditar(null)} onGuardado={() => { setEditar(null); lista.recargar(); c.recargar(); }} />}
      {historial && <Modal open onClose={() => setHistorial(null)} title={`Precios de ${historial.variant_name}`} description={historial.supplier_name}>
        <DataTable rows={[...historial.price_history].reverse()} rowKey={(h) => `${h.date}-${h.price}`} empty="Sin historial." columns={[
          { key: "date", header: "Fecha", render: (h) => fecha(h.date) },
          { key: "price", header: "Precio", align: "right", render: (h) => soles(h.price) },
          { key: "source", header: "Origen", render: (h) => h.source === "RECEIPT" ? "Recepción" : h.source === "MANUAL" ? "Manual" : (h.source ?? "—") },
        ]} />
      </Modal>}
    </div>
  );
}

function FormCatalogo({ op, fila, onClose, onGuardado }: { op: Opciones; fila: Fila | null; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState<Variante | null>(null);
  const [f, setF] = useState({ supplier_id: fila?.supplier_id ?? "", supplier_sku: fila?.supplier_sku ?? "", price_basis: fila?.price_basis ?? "KG", last_price: String(fila?.last_price ?? ""),
    min_order_qty: String(fila?.min_order_qty ?? ""), lead_time_days: String(fila?.lead_time_days ?? ""), status: fila?.status ?? "ACTIVE" });
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  return (
    <Dialogo titulo={fila ? `${fila.variant_name} · ${fila.supplier_name}` : "Agregar producto al catálogo"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        const body = { ...f, variant_id: fila ? undefined : v?.id, last_price: n(f.last_price), min_order_qty: n(f.min_order_qty), lead_time_days: n(f.lead_time_days) };
        await api(fila ? `/v1/com/catalogo/${fila.id}` : "/v1/com/catalogo", { method: fila ? "PUT" : "POST", body });
        toast.ok("Catálogo guardado"); onGuardado();
      }}>
      {(e) => <>
        {!fila && <>
          <Field label="Proveedor" required error={e.supplier_id} className="sm:col-span-2"><Select value={f.supplier_id} placeholder="Elegir" onChange={set("supplier_id")} options={op.suppliers.map((s) => ({ value: s.id, label: s.name }))} /></Field>
          <Field label="Producto" required error={e.variant_id} className="sm:col-span-2"><BuscaVariante value={v} onChange={setV} invalid={Boolean(e.variant_id)} /></Field>
        </>}
        <Field label="Código del proveedor" error={e.supplier_sku}><Input value={f.supplier_sku} maxLength={60} onChange={set("supplier_sku")} /></Field>
        <Field label="Precio por" required error={e.price_basis}><Select value={f.price_basis} onChange={set("price_basis")} options={[{ value: "KG", label: "Kilo" }, { value: "UNIT", label: "Unidad" }]} /></Field>
        <Field label="Último precio (sin IGV)" error={e.last_price}><Input inputMode="decimal" prefix="S/" value={f.last_price} onChange={set("last_price")} /></Field>
        <Field label="Pedido mínimo" error={e.min_order_qty}><Input inputMode="decimal" value={f.min_order_qty} onChange={set("min_order_qty")} /></Field>
        <Field label="Plazo de entrega" error={e.lead_time_days}><Input inputMode="numeric" suffix="días" value={f.lead_time_days} onChange={set("lead_time_days")} /></Field>
        {fila && <Field label="Estado" error={e.status}><Select value={f.status} onChange={set("status")} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>}
      </>}
    </Dialogo>
  );
}
