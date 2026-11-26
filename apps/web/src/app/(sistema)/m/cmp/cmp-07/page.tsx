"use client";

import { useState } from "react";
import { FlaskConical, Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { FiltroSelect, Sub, num, opciones, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { Chips } from "@/modulos/cmp/Chips";
import { CANAL_PEDIDO, ESTADO_CUPON, type Opciones } from "@/modulos/cmp/tipos";

type Cupon = { id: string; code: string; brand_id: string | null; brand_name: string | null; campaign_id: string | null; campaign_code: string | null; discount_type: string; value: string;
  max_discount: string | null; min_order_amount: string; valid_from: string; valid_to: string; max_uses_total: number | null; max_uses_per_customer: number; customer_id: string | null;
  customer_name: string | null; channels: string[]; status: string; description: string | null; usage: { uses: number; discount: number; customers: number }; in_force: boolean };

const valor = (k: Pick<Cupon, "discount_type" | "value" | "max_discount">) => k.discount_type === "PCT" ? `${numero(k.value)} %${k.max_discount ? ` (hasta ${soles(k.max_discount)})` : ""}` : k.discount_type === "AMOUNT" ? soles(k.value) : "Delivery gratis";

/** CMP-07 Cupones: código, descuento, vigencia, mínimo, límites de uso, cliente y canales; con prueba sobre un pedido. */
export default function Cupones() {
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [estado, setEstado] = useState("");
  const [personales, setPersonales] = useState("0");
  const r = useDatos<{ data: Cupon[] }>(`/v1/cmp/cupones${qs({ status: estado, personal: personales })}`);
  const [form, setForm] = useState<Cupon | "nuevo" | null>(null);
  const [probar, setProbar] = useState(false);
  const gestiona = Boolean(op?.can["cmp.coupon.manage"]);

  const columnas: Column<Cupon>[] = [
    { key: "code", header: "Código", cardTitle: true, render: (k) => <div><p className="font-mono font-semibold">{k.code}</p><Sub>{k.brand_name ?? "Todas las marcas"}{k.campaign_code ? ` · ${k.campaign_code}` : ""}</Sub></div> },
    { key: "value", header: "Descuento", render: (k) => <div>{valor(k)}{Number(k.min_order_amount) > 0 && <Sub>pedido desde {soles(k.min_order_amount)}</Sub>}</div> },
    { key: "valid_from", header: "Vigencia", render: (k) => <div className="whitespace-nowrap">{fecha(k.valid_from)} – {fecha(k.valid_to)}{k.in_force && <Sub>vigente hoy</Sub>}</div> },
    { key: "limits", header: "Límites", render: (k) => <div className="text-[12.5px]">{k.max_uses_total ? `${numero(k.max_uses_total)} usos` : "Sin tope"} · {k.max_uses_per_customer} por cliente
      {k.customer_name && <Sub>Personal: {k.customer_name}</Sub>}{k.channels.length > 0 && <Sub>{k.channels.map((c) => CANAL_PEDIDO[c] ?? c).join(", ")}</Sub>}</div> },
    { key: "usage", header: "Usos", align: "right", render: (k) => <div>{numero(k.usage.uses)}<Sub>{soles(k.usage.discount)} · {numero(k.usage.customers)} clientes</Sub></div> },
    { key: "status", header: "Estado", render: (k) => <StatusBadge status={k.status} labels={ESTADO_CUPON} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Un pedido acepta un solo cupón. El código vale dentro de su vigencia, desde el mínimo de compra y hasta sus límites de uso; uno personal solo lo usa su cliente."
        actions={<>
          <Button icon={FlaskConical} onClick={() => setProbar(true)}>Probar en un pedido</Button>
          {gestiona && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setForm("nuevo")}>Nuevo cupón</Button>}
        </>} />
      <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay cupones." onRowClick={gestiona ? (k) => setForm(k) : undefined}
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_CUPON)} />
          <FiltroSelect label="Personales" value={personales} onChange={setPersonales} options={[{ value: "0", label: "Sin personales" }, { value: "1", label: "Con personales" }]} />
        </>} />
      {form && op && <FormCupon op={op} k={form === "nuevo" ? null : form} onClose={() => setForm(null)} onHecho={() => { setForm(null); r.recargar(); }} />}
      {probar && <Probar puede={gestiona} onClose={() => { setProbar(false); r.recargar(); }} />}
    </div>
  );
}

function FormCupon({ op, k, onClose, onHecho }: { op: Opciones; k: Cupon | null; onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ code: k?.code ?? "", brand_id: k?.brand_id ?? "", discount_type: k?.discount_type ?? "PCT", value: k ? String(Number(k.value)) : "10", max_discount: k?.max_discount ? String(Number(k.max_discount)) : "",
    min_order_amount: k ? String(Number(k.min_order_amount)) : "0", valid_from: k?.valid_from ?? op.today, valid_to: k?.valid_to ?? "", max_uses_total: k?.max_uses_total ? String(k.max_uses_total) : "",
    max_uses_per_customer: String(k?.max_uses_per_customer ?? 1), status: k?.status ?? "ACTIVE", description: k?.description ?? "", channels: k?.channels ?? [] });
  const c = (x: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [x]: e.target.value });
  return (
    <Dialogo titulo={k ? `Cupón ${k.code}` : "Nuevo cupón"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(k ? `/v1/cmp/cupones/${k.id}` : "/v1/cmp/cupones", { method: k ? "PUT" : "POST", body: { ...f, brand_id: f.brand_id || null, value: num(f.value), max_discount: num(f.max_discount),
          min_order_amount: num(f.min_order_amount) ?? 0, max_uses_total: num(f.max_uses_total), max_uses_per_customer: Number(f.max_uses_per_customer), description: f.description || null, customer_id: k?.customer_id ?? null, campaign_id: k?.campaign_id ?? null } });
        toast.ok("Cupón guardado"); onHecho();
      }}>
      {(e) => <>
        <Field label="Código" required error={e.code} hint="Mayúsculas, números o guiones (3 a 20)."><Input value={f.code} onChange={(x) => setF({ ...f, code: x.target.value.toUpperCase() })} placeholder="VUELVE10" /></Field>
        <Field label="Marca" error={e.brand_id}><Select value={f.brand_id} onChange={c("brand_id")} placeholder="Todas las marcas" options={op.brands.map((b) => ({ value: b.id, label: b.name }))} /></Field>
        <Field label="Tipo" required error={e.discount_type}><Select value={f.discount_type} onChange={c("discount_type")} options={opciones(op.discount_types)} /></Field>
        {f.discount_type !== "FREE_DELIVERY" ? <Field label="Valor" required error={e.value}><Input inputMode="decimal" prefix={f.discount_type === "AMOUNT" ? "S/" : undefined} suffix={f.discount_type === "PCT" ? "%" : undefined} value={f.value} onChange={c("value")} /></Field> : <div />}
        {f.discount_type === "PCT" && <Field label="Descuento máximo" error={e.max_discount}><Input inputMode="decimal" prefix="S/" value={f.max_discount} onChange={c("max_discount")} /></Field>}
        <Field label="Pedido mínimo" error={e.min_order_amount} hint="Suma de productos, sin delivery."><Input inputMode="decimal" prefix="S/" value={f.min_order_amount} onChange={c("min_order_amount")} /></Field>
        <Field label="Desde" required error={e.valid_from}><Input type="date" value={f.valid_from} onChange={c("valid_from")} /></Field>
        <Field label="Hasta" required error={e.valid_to}><Input type="date" value={f.valid_to} onChange={c("valid_to")} /></Field>
        <Field label="Usos en total" error={e.max_uses_total} hint="Vacío: sin tope."><Input inputMode="numeric" value={f.max_uses_total} onChange={c("max_uses_total")} /></Field>
        <Field label="Usos por cliente" required error={e.max_uses_per_customer}><Input inputMode="numeric" value={f.max_uses_per_customer} onChange={c("max_uses_per_customer")} /></Field>
        <Field label="Solo en los canales" error={e.channels} className="sm:col-span-2" hint="Sin marcar: vale en todos."><Chips etiqueta="Canales" opciones={op.order_channels.map((x) => ({ value: x, label: CANAL_PEDIDO[x] ?? x }))} valor={f.channels} onChange={(v) => setF({ ...f, channels: v })} /></Field>
        <Field label="Estado" error={e.status}><Select value={f.status} onChange={c("status")} options={opcionesDe(ESTADO_CUPON)} /></Field>
        <Field label="Descripción" error={e.description}><Textarea rows={1} value={f.description} onChange={c("description")} /></Field>
        {k?.customer_name && <div className="sm:col-span-2"><Alert tone="info">Cupón personal de {k.customer_name}.</Alert></div>}
      </>}
    </Dialogo>
  );
}

function Probar({ puede, onClose }: { puede: boolean; onClose: () => void }) {
  const [pedido, setPedido] = useState("");
  const [codigo, setCodigo] = useState("");
  const [res, setRes] = useState<{ code: string; base: number; discount: number; order_id: string; order_number: string; order_status: string } | null>(null);
  const [error, setError] = useState("");
  return (
    <Dialogo titulo="Probar un cupón" boton={res && puede && ["DRAFT", "CONFIRMED"].includes(res.order_status) ? "Aplicar al pedido" : "Probar"} onClose={onClose}
      aviso="Revisa si el cupón vale para el pedido y cuánto descuenta, sin aplicarlo. Si vale, puedes aplicarlo."
      enviar={async () => {
        setError("");
        if (res && puede && ["DRAFT", "CONFIRMED"].includes(res.order_status)) {
          const y = await api<{ discount: number; total: number }>("/v1/cmp/cupones/probar", { method: "POST", body: { order_id: res.order_id, code: codigo, apply: true } });
          toast.ok(`Cupón aplicado: −${soles(y.discount)}, total ${soles(y.total)}`); onClose(); return;
        }
        try { setRes(await api("/v1/cmp/cupones/probar", { method: "POST", body: { order_number: pedido, code: codigo } })); } catch (e) { setRes(null); setError(mensajeDe(e)); }
      }}>
      {(e) => <>
        <Field label="Pedido" required error={e.order_id ?? e.order_number}><Input value={pedido} onChange={(x) => { setPedido(x.target.value.toUpperCase()); setRes(null); }} placeholder="P-001383" /></Field>
        <Field label="Código" required error={e.code}><Input value={codigo} onChange={(x) => { setCodigo(x.target.value.toUpperCase()); setRes(null); }} placeholder="VUELVE10" /></Field>
        {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
        {res && <div className="sm:col-span-2"><Alert tone="ok" title={`${res.code} vale para ${res.order_number}`}>Productos {soles(res.base)} · descuento <Badge tone="ok">{soles(res.discount)}</Badge></Alert></div>}
      </>}
    </Dialogo>
  );
}
