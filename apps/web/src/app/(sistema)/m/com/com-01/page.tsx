"use client";

import { useState } from "react";
import { Building2, Landmark, ShieldAlert, Tractor, Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { CifraLink, FiltroSelect, Seccion, accion, olvidarOpcionesCom, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { ORDEN, SUNAT, TIPO_PROVEEDOR, opciones, type Num, type Opciones } from "@/modulos/com/tipos";

type Fila = {
  id: string; doc_type: string; doc_number: string; legal_name: string; name: string; supplier_type: string; phone: string | null; status: string; payment_terms_days: number;
  sunat_status: string; rating: number | null; bank_change_pending: boolean; catalog_items: number; balance_pen: Num; last_order_date: string | null;
};
type Proveedor = Fila & {
  trade_name: string | null; email: string | null; bank_name: string | null; bank_account: string | null; pending_bank_change: string | null; sunat_checked_at: string | null;
  sunat_msg: string | null; notes: string | null; related_company_id: string | null; default_cost_center_id: string | null; cost_center_name: string | null; bank_changed_at: string | null;
  bank_changed_by_name: string | null;
  orders: { id: string; number: string; order_date: string; total: Num; status: string }[];
  documents: { id: string; doc_type: string; series: string; number: string; issue_date: string; total: Num; balance: Num }[];
  catalog: { id: string; sku: string; variant_name: string; last_price: Num; price_basis: string }[];
};
type Cifras = { active: number; blocked: number; bank_pending: number; farms: number };

/** COM-01 Proveedores: datos, condiciones de pago, cuenta bancaria con doble control y estado SUNAT. */
export default function Proveedores() {
  const op = useOpcionesCom();
  const [tipo, setTipo] = useState("");
  const [sunat, setSunat] = useState("");
  const lista = useListado<Fila>("/v1/com/proveedores", { orden: "legal_name", filtros: { supplier_type: tipo, sunat_status: sunat } });
  const c = useDatos<Cifras>("/v1/com/cifras/01");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const recargar = () => { lista.recargar(); c.recargar(); olvidarOpcionesCom(); };

  const columnas: Column<Fila>[] = [
    { key: "legal_name", header: "Proveedor", sortable: true, cardTitle: true, render: (f) => <div className="min-w-[180px]"><p className="font-medium">{f.name}</p><p className="text-[12px] text-muted">{f.doc_type} {f.doc_number}</p></div> },
    { key: "supplier_type", header: "Tipo", sortable: true, render: (f) => TIPO_PROVEEDOR[f.supplier_type] ?? f.supplier_type },
    { key: "sunat_status", header: "SUNAT", render: (f) => <StatusBadge status={f.sunat_status} labels={SUNAT} /> },
    { key: "payment_terms_days", header: "Pago", align: "right", hideOnMobile: true, render: (f) => f.payment_terms_days ? `${f.payment_terms_days} días` : "Contado" },
    { key: "catalog_items", header: "Catálogo", align: "right", hideOnMobile: true, render: (f) => numero(f.catalog_items) },
    { key: "balance_pen", header: "Por pagar", sortable: true, align: "right", render: (f) => Number(f.balance_pen) ? soles(f.balance_pen) : <span className="text-muted">—</span> },
    { key: "status", header: "Estado", render: (f) => <span className="flex flex-wrap gap-1"><StatusBadge status={f.status} />{f.bank_change_pending && <Badge tone="warn">Cuenta por aprobar</Badge>}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Quién nos vende: productores, camales, la granja relacionada, insumos y servicios. Un proveedor no habido, suspendido o de baja en SUNAT no recibe órdenes ni pagos."
        actions={op?.can.order_create && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo proveedor</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Proveedores activos" valor={c.datos ? numero(c.datos.active) : undefined} icono={Building2} onClick={() => setSunat("")} />
        <CifraLink titulo="Bloqueados por SUNAT" valor={c.datos ? numero(c.datos.blocked) : undefined} detalle="No habido, suspendido o de baja" icono={ShieldAlert}
          tono={c.datos?.blocked ? "bad" : "ok"} onClick={() => setSunat("NOT_LOCATED")} />
        <CifraLink titulo="Cambios de cuenta por aprobar" valor={c.datos ? numero(c.datos.bank_pending) : undefined} detalle="Doble control antes de pagar" icono={Landmark}
          tono={c.datos?.bank_pending ? "warn" : undefined} />
        <CifraLink titulo="Granjas relacionadas" valor={c.datos ? numero(c.datos.farms) : undefined} icono={Tractor} href="/m/grj/grj-01" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(f) => setAbierto(f.id)} search={{ ...lista.tabla.search, placeholder: "Buscar RUC, razón social o nombre…" }}
        empty="No hay proveedores con esos filtros."
        toolbar={<>
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opciones(TIPO_PROVEEDOR)} ancho="sm:w-[190px]" />
          <FiltroSelect label="SUNAT" value={sunat} onChange={setSunat} options={opciones(Object.fromEntries(Object.entries(SUNAT).map(([k, v]) => [k, v[0]])))} />
        </>} />
      {abierto && <FichaProveedor id={abierto} op={op} onClose={() => setAbierto(null)} onCambio={recargar} />}
      {nuevo && op && <FormProveedor op={op} onClose={() => setNuevo(false)} onGuardado={() => { setNuevo(false); recargar(); }} />}
    </div>
  );
}

function FichaProveedor({ id, op, onClose, onCambio }: { id: string; op: Opciones | null; onClose: () => void; onCambio: () => void }) {
  const { datos: p, error, recargar } = useDatos<Proveedor>(`/v1/com/proveedores/${id}`);
  const [editar, setEditar] = useState(false);
  const [cuenta, setCuenta] = useState(false);
  const listo = () => { recargar(); onCambio(); };
  return (
    <Modal open onClose={onClose} size="lg" title={p ? p.name : "Proveedor"} description={p ? `${p.doc_type} ${p.doc_number} · ${p.legal_name}` : undefined}
      footer={p && <>
        <Button onClick={() => accion({ title: "Consultar SUNAT", message: "Se consulta el estado del contribuyente y su condición de domicilio.", confirmLabel: "Consultar" },
          () => api(`/v1/com/proveedores/${p.id}/sunat`, { method: "POST" }), "Estado SUNAT actualizado", listo)}>Consultar SUNAT</Button>
        {op?.can.bank_change && <Button onClick={() => setCuenta(true)}>Cambiar cuenta bancaria</Button>}
        {op?.can.order_create && <Button variant="primary" onClick={() => setEditar(true)}>Editar</Button>}
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {p && <div className="space-y-5">
        {p.pending_bank_change && <Alert tone="warn" title="Cambio de cuenta bancaria por aprobar">
          <p>Nueva cuenta: {p.pending_bank_change}. Hasta que otra persona lo apruebe, los pagos van a la cuenta anterior.</p>
          {op?.can.bank_change && <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => accion({ title: "¿Aprobar la nueva cuenta?", confirmLabel: "Aprobar" }, () => api(`/v1/com/proveedores/${p.id}/cuenta/aprobar`, { method: "POST" }), "Cuenta aprobada", listo)}>Aprobar</Button>
            <Button size="sm" onClick={() => accion({ title: "¿Rechazar el cambio?", reason: { min: 5 }, confirmLabel: "Rechazar", danger: true }, (m) => api(`/v1/com/proveedores/${p.id}/cuenta/rechazar`, { method: "POST", body: { reason: m } }), "Cambio rechazado", listo)}>Rechazar</Button>
          </div>}
        </Alert>}
        <DetailList items={[
          { label: "Tipo", value: TIPO_PROVEEDOR[p.supplier_type] ?? p.supplier_type }, { label: "SUNAT", value: <span className="flex flex-wrap items-center gap-2"><StatusBadge status={p.sunat_status} labels={SUNAT} />{p.sunat_checked_at && <span className="text-[12px] text-muted">consultado {fecha(p.sunat_checked_at)}</span>}</span> },
          { label: "Condición de pago", value: p.payment_terms_days ? `${p.payment_terms_days} días` : "Contado" }, { label: "Centro de costo por defecto", value: p.cost_center_name ?? "—" },
          { label: "Cuenta bancaria", value: p.bank_account ? `${p.bank_name ?? ""} ${p.bank_account}` : "—" }, { label: "Teléfono y correo", value: [p.phone, p.email].filter(Boolean).join(" · ") || "—" },
          { label: "Calificación", value: p.rating ? "★".repeat(p.rating) : "Sin evaluar" }, { label: "Por pagar", value: soles(p.balance_pen ?? 0) },
        ]} />
        {p.notes && <p className="text-[13px] text-muted">{p.notes}</p>}
        <Seccion titulo="Últimas órdenes">
          <DataTable rows={p.orders} rowKey={(o) => o.id} empty="Sin órdenes." columns={[
            { key: "number", header: "Orden", cardTitle: true, render: (o) => <span className="font-mono">{o.number}</span> },
            { key: "order_date", header: "Fecha", render: (o) => fecha(o.order_date) },
            { key: "total", header: "Total", align: "right", render: (o) => soles(o.total) },
            { key: "status", header: "Estado", render: (o) => <StatusBadge status={o.status} labels={ORDEN} /> },
          ]} />
        </Seccion>
        <Seccion titulo="Catálogo">
          <DataTable rows={p.catalog} rowKey={(o) => o.id} empty="Sin productos en su catálogo." columns={[
            { key: "sku", header: "SKU", render: (o) => <span className="font-mono">{o.sku}</span> },
            { key: "variant_name", header: "Producto", cardTitle: true, render: (o) => o.variant_name },
            { key: "last_price", header: "Último precio", align: "right", render: (o) => `${soles(o.last_price)} / ${o.price_basis === "KG" ? "kg" : "und"}` },
          ]} />
        </Seccion>
      </div>}
      {editar && p && op && <FormProveedor op={op} p={p} onClose={() => setEditar(false)} onGuardado={() => { setEditar(false); listo(); }} />}
      {cuenta && p && <Dialogo titulo="Cambiar cuenta bancaria" boton="Solicitar cambio" onClose={() => setCuenta(false)}
        aviso="El cambio de cuenta lo aprueba otra persona antes del siguiente pago, para evitar fraudes."
        enviar={async () => { const f = new FormData(document.getElementById("f-dialogo") as HTMLFormElement);
          await api(`/v1/com/proveedores/${p.id}/cuenta`, { method: "POST", body: { bank_name: f.get("bank_name"), bank_account: f.get("bank_account"), reason: f.get("reason") } });
          toast.ok("Cambio enviado a aprobación"); setCuenta(false); listo(); }}>
        {(e) => <>
          <Field label="Banco" error={e.bank_name}><Input name="bank_name" defaultValue={p.bank_name ?? ""} maxLength={80} /></Field>
          <Field label="Número de cuenta o CCI" required error={e.bank_account}><Input name="bank_account" maxLength={40} /></Field>
          <Field label="Motivo" error={e.reason} className="sm:col-span-2"><Textarea name="reason" maxLength={200} /></Field>
        </>}
      </Dialogo>}
    </Modal>
  );
}

function FormProveedor({ op, p, onClose, onGuardado }: { op: Opciones; p?: Proveedor; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({
    doc_type: p?.doc_type ?? "RUC", doc_number: p?.doc_number ?? "", legal_name: p?.legal_name ?? "", trade_name: p?.trade_name ?? "", supplier_type: p?.supplier_type ?? "PRODUCER",
    phone: p?.phone ?? "", email: p?.email ?? "", payment_terms_days: String(p?.payment_terms_days ?? 0), default_cost_center_id: p?.default_cost_center_id ?? "",
    related_company_id: p?.related_company_id ?? "", notes: p?.notes ?? "", status: p?.status ?? "ACTIVE",
  });
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  return (
    <Dialogo titulo={p ? `Editar ${p.name}` : "Nuevo proveedor"} boton="Guardar" onClose={onClose}
      aviso={p ? undefined : "Con RUC, el sistema valida el dígito verificador y consulta SUNAT al guardar."}
      enviar={async () => {
        const body = { ...f, payment_terms_days: Number(f.payment_terms_days || 0), default_cost_center_id: f.default_cost_center_id || null, related_company_id: f.related_company_id || null };
        await api(p ? `/v1/com/proveedores/${p.id}` : "/v1/com/proveedores", { method: p ? "PUT" : "POST", body });
        toast.ok("Proveedor guardado"); onGuardado();
      }}>
      {(e) => <>
        <Field label="Documento" required error={e.doc_type}><Select value={f.doc_type} onChange={set("doc_type")} options={[{ value: "RUC", label: "RUC" }, { value: "DNI", label: "DNI" }, { value: "FOREIGN", label: "Extranjero" }]} /></Field>
        <Field label="Número" required error={e.doc_number}><Input value={f.doc_number} inputMode="numeric" maxLength={20} onChange={set("doc_number")} /></Field>
        <Field label="Razón social" required error={e.legal_name} className="sm:col-span-2"><Input value={f.legal_name} maxLength={200} onChange={set("legal_name")} /></Field>
        <Field label="Nombre comercial" error={e.trade_name}><Input value={f.trade_name} maxLength={200} onChange={set("trade_name")} /></Field>
        <Field label="Tipo" required error={e.supplier_type}><Select value={f.supplier_type} onChange={set("supplier_type")} options={op.supplier_types.map((t) => ({ value: t, label: TIPO_PROVEEDOR[t] ?? t }))} /></Field>
        <Field label="Teléfono" error={e.phone}><Input value={f.phone} maxLength={40} onChange={set("phone")} /></Field>
        <Field label="Correo" error={e.email}><Input type="email" value={f.email} maxLength={120} onChange={set("email")} /></Field>
        <Field label="Días de crédito" error={e.payment_terms_days} hint="0 es al contado"><Input inputMode="numeric" value={f.payment_terms_days} onChange={set("payment_terms_days")} /></Field>
        <Field label="Centro de costo por defecto" error={e.default_cost_center_id}><Select value={f.default_cost_center_id} placeholder="Sin centro" onChange={set("default_cost_center_id")} options={op.cost_centers.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>
        {f.supplier_type === "RELATED_FARM" && <Field label="Empresa relacionada" error={e.related_company_id}><Select value={f.related_company_id} placeholder="Elegir" onChange={set("related_company_id")} options={op.companies.map((c) => ({ value: c.id, label: c.legal_name }))} /></Field>}
        {p && <Field label="Estado" error={e.status}><Select value={f.status} onChange={set("status")} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>}
        <Field label="Notas" error={e.notes} className="sm:col-span-2"><Textarea value={f.notes} maxLength={500} onChange={set("notes")} /></Field>
      </>}
    </Dialogo>
  );
}
