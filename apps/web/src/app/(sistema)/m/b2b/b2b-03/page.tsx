"use client";

import { useEffect, useState } from "react";
import { CalendarX2, Check, Plus, X } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, porcentaje, soles } from "@/lib/formato";
import { FiltroSelect, Panel, Sub, accion, num, qs, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { ESTADO_PRECIO, type Opciones } from "@/modulos/b2b/tipos";

type Precio = { id: string; variant_id: string; variant_name: string; sku: string; unit_price: string; price_basis: string; valid_from: string; valid_to: string | null; status: string;
  min_price: string | null; notes: string | null; list_price: number | null; cost: number | null; margin_pct: number | null; vs_list_pct: number | null; current: boolean;
  requested_name: string | null; approved_name: string | null; reject_reason: string | null };
type PorAprobar = { id: string; customer_id: string; customer_name: string; variant_name: string; unit_price: string; price_basis: string; min_price: string | null; valid_from: string; requested_name: string; notes: string | null };

/** B2B-03 Precios del cliente: precio pactado por producto con vigencia, margen y aprobación cuando baja del margen mínimo. */
export default function PreciosCliente() {
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [id, setId] = useState("");
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const r = useDatos<{ data: Precio[]; customer: { full_name: string } | null }>(id ? `/v1/b2b/clientes/${id}/precios` : null);
  const aprueba = Boolean(op?.can["b2b.price.approve_below_margin"]);
  const pend = useDatos<PorAprobar[]>(aprueba ? "/v1/b2b/precios/por-aprobar" : null);
  const [nuevo, setNuevo] = useState(false);
  const [cerrando, setCerrando] = useState<Precio | null>(null);
  const gestiona = Boolean(op?.can["b2b.price.manage"]);
  const recargar = () => { r.recargar(); pend.recargar(); };

  const decidir = (p: { id: string; variant_name: string }, si: boolean) => accion({ title: si ? `¿Aprobar el precio de ${p.variant_name}?` : `¿Rechazar el precio de ${p.variant_name}?`,
    message: si ? "Queda bajo el margen mínimo de la empresa." : undefined, confirmLabel: si ? "Aprobar" : "Rechazar", danger: !si, reason: { min: si ? 0 : 5, optional: si, label: "Nota" } },
  (m) => api(`/v1/b2b/precios/${p.id}/decidir`, { method: "POST", body: { approve: si, note: m } }), si ? "Precio aprobado" : "Precio rechazado", recargar);

  const columnas: Column<Precio>[] = [
    { key: "variant_name", header: "Producto", cardTitle: true, render: (p) => <div><p className="font-medium">{p.variant_name}</p><Sub>{p.sku}</Sub></div> },
    { key: "unit_price", header: "Precio pactado", align: "right", render: (p) => <div><strong>{soles(p.unit_price)}</strong><Sub>por {p.price_basis === "KG" ? "kg" : "unidad"}</Sub></div> },
    { key: "list_price", header: "Lista", align: "right", render: (p) => <div>{soles(p.list_price)}{p.vs_list_pct != null && <Sub>{p.vs_list_pct > 0 ? "+" : ""}{porcentaje(p.vs_list_pct, 1)}</Sub>}</div> },
    { key: "margin_pct", header: "Margen", align: "right", render: (p) => p.margin_pct == null ? "—" : <Badge tone={p.margin_pct < (op?.params.min_margin_pct ?? 10) ? "bad" : "ok"}>{porcentaje(p.margin_pct, 1)}</Badge> },
    { key: "valid_from", header: "Vigencia", render: (p) => <div className="whitespace-nowrap">{fecha(p.valid_from)} – {p.valid_to ? fecha(p.valid_to) : "sin fin"}{p.current && <Sub>vigente hoy</Sub>}</div> },
    { key: "status", header: "Estado", render: (p) => <div><StatusBadge status={p.status} labels={ESTADO_PRECIO} />{p.reject_reason && <Sub>{p.reject_reason}</Sub>}</div> },
    { key: "requested_name", header: "Pidió / aprobó", hideOnMobile: true, render: (p) => <div>{p.requested_name ?? "—"}{p.approved_name && <Sub>aprobó {p.approved_name}</Sub>}</div> },
    { key: "acc", header: "", render: (p) => <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
      {aprueba && p.status === "PENDING_APPROVAL" && <><Button size="sm" icon={Check} onClick={() => decidir(p, true)}>Aprobar</Button><Button size="sm" variant="ghost" icon={X} onClick={() => decidir(p, false)}>Rechazar</Button></>}
      {gestiona && p.status === "ACTIVE" && !p.valid_to && <Button size="sm" variant="ghost" icon={CalendarX2} onClick={() => setCerrando(p)}>Cerrar</Button>}
    </div> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader code={r.datos?.customer?.full_name} description={`El precio pactado reemplaza al de lista en los pedidos del cliente. Las vigencias de un mismo producto no se cruzan; bajo ${op?.params.min_margin_pct ?? 10} % de margen lo aprueba gerencia.`}
        actions={gestiona && id && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNuevo(true)}>Nuevo precio</Button>} />
      {aprueba && (pend.datos?.length ?? 0) > 0 && <Panel titulo={`Precios bajo margen por aprobar (${pend.datos!.length})`}>
        <ul className="divide-y divide-line text-[13.5px]">{pend.datos!.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div><p className="font-medium">{p.customer_name} · {p.variant_name}</p><Sub>{soles(p.unit_price)} por {p.price_basis === "KG" ? "kg" : "unidad"} · mínimo {soles(p.min_price)} · desde {fecha(p.valid_from)} · pidió {p.requested_name}{p.notes ? ` · ${p.notes}` : ""}</Sub></div>
          <div className="flex gap-1"><Button size="sm" icon={Check} onClick={() => decidir(p, true)}>Aprobar</Button><Button size="sm" variant="ghost" icon={X} onClick={() => decidir(p, false)}>Rechazar</Button></div>
        </li>)}</ul>
      </Panel>}
      {!id && <Alert tone="info">Elige un cliente para ver sus precios.</Alert>}
      <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} empty={id ? "El cliente compra a precio de lista." : "—"}
        toolbar={<FiltroSelect label="Cliente" value={id} onChange={setId} ancho="sm:w-[300px]" options={(op?.customers ?? []).filter((c) => c.customer_type !== "PERSON").map((c) => ({ value: c.id, label: `${c.full_name} · ${c.doc_number}` }))} />} />
      {cerrando && <Dialogo titulo={`Cerrar el precio de ${cerrando.variant_name}`} boton="Cerrar precio" onClose={() => setCerrando(null)}
        enviar={async () => {
          await api(`/v1/b2b/precios/${cerrando.id}/cerrar`, { method: "POST", body: { valid_to: (document.getElementById("precio-hasta") as HTMLInputElement).value } });
          toast.ok("Precio cerrado"); setCerrando(null); r.recargar();
        }}>
        {(e) => <Field label="Último día del precio" required error={e.valid_to}><Input id="precio-hasta" type="date" defaultValue={op?.today} /></Field>}
      </Dialogo>}
      {nuevo && op && <NuevoPrecio op={op} id={id} onClose={() => setNuevo(false)} onHecho={() => { setNuevo(false); recargar(); }} />}
    </div>
  );
}

function NuevoPrecio({ op, id, onClose, onHecho }: { op: Opciones; id: string; onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ variant_id: "", unit_price: "", price_basis: "UNIT", valid_from: op.today, valid_to: "", notes: "" });
  const [ref, setRef] = useState<{ list_price: number | null; basis: string | null; cost: number | null; min_price: number | null } | null>(null);
  const c = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  useEffect(() => {
    if (!f.variant_id) return;
    let vigente = true;
    api<NonNullable<typeof ref>>(`/v1/b2b/clientes/${id}/precios/referencia${qs({ variant_id: f.variant_id })}`).then((x) => vigente && setRef(x)).catch(() => {});
    return () => { vigente = false; };
  }, [f.variant_id, id]);
  const precio = num(f.unit_price);
  const margen = ref?.cost && precio ? ((precio - ref.cost) / precio) * 100 : null;
  return (
    <Dialogo titulo="Nuevo precio pactado" boton="Guardar" onClose={onClose}
      enviar={async () => {
        const x = await api<{ status: string }>(`/v1/b2b/clientes/${id}/precios`, { method: "POST", body: { ...f, unit_price: precio, valid_to: f.valid_to || null, notes: f.notes || null } });
        toast.ok(x.status === "PENDING_APPROVAL" ? "Precio guardado: queda por aprobar por estar bajo el margen mínimo" : "Precio guardado");
        onHecho();
      }}>
      {(e) => <>
        <Field label="Producto" required error={e.variant_id} className="sm:col-span-2">
          <Select value={f.variant_id} onChange={(x) => { const v = op.variants.find((y) => y.id === x.target.value); setF({ ...f, variant_id: x.target.value, price_basis: v?.sale_mode === "KG" ? "KG" : "UNIT" }); }}
            placeholder="Elige el producto" options={op.variants.map((v) => ({ value: v.id, label: `${v.name} · ${v.sku}` }))} />
        </Field>
        <Field label="Precio" required error={e.unit_price}><Input inputMode="decimal" prefix="S/" suffix={f.price_basis === "KG" ? "/kg" : "c/u"} value={f.unit_price} onChange={c("unit_price")} /></Field>
        <Field label="Por" error={e.price_basis}><Select value={f.price_basis} onChange={c("price_basis")} options={[{ value: "UNIT", label: "Unidad" }, { value: "KG", label: "Kilo" }]} /></Field>
        {ref && <div className="text-[13px] sm:col-span-2">
          <p>Lista {soles(ref.list_price)} · costo {soles(ref.cost)} · mínimo sin aprobación {soles(ref.min_price)}</p>
          {margen !== null && <p className={margen < op.params.min_margin_pct ? "text-bad" : "text-ok"}>Margen {porcentaje(margen, 1)}{margen < op.params.min_margin_pct ? ": necesita aprobación" : ""}</p>}
        </div>}
        <Field label="Desde" required error={e.valid_from}><Input type="date" value={f.valid_from} onChange={c("valid_from")} /></Field>
        <Field label="Hasta" error={e.valid_to}><Input type="date" value={f.valid_to} onChange={c("valid_to")} /></Field>
        <Field label="Nota" error={e.notes} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={c("notes")} /></Field>
      </>}
    </Dialogo>
  );
}
