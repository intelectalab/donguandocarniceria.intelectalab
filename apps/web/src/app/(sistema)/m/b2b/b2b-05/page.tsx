"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Plus, Square, Trash2 } from "lucide-react";
import { Badge, Button, Checkbox, DataTable, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { DiasSemana, FiltroSelect, Sub, accion, diasTexto, num, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { ESTADO_CORRIDA, ESTADO_RECURRENTE, type Opciones } from "@/modulos/b2b/tipos";

type Linea = { variant_id: string; variant_name?: string; sale_mode?: string; qty: string; est_weight_kg: string | null; cut_notes: string | null; sellable?: boolean };
type Rec = { id: string; customer_id: string; customer_name: string; brand_name: string; address_id: string; address_text: string; name: string; frequency: string; weekdays: number[];
  interval_days: number | null; slot_from: string | null; slot_to: string | null; lead_days: number; starts_on: string; ends_on: string | null; auto_confirm: boolean; status: string;
  notes: string | null; lines: Linea[]; next_dates: string[]; last_run: { delivery_date: string; status: string; message: string | null } | null };

/** B2B-05 Pedidos recurrentes: plantilla del cliente con días, horario, dirección y productos; genera el pedido el día anterior. */
export default function Recurrentes() {
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [cliente, setCliente] = useState("");
  const [estado, setEstado] = useState("");
  const r = useDatos<{ data: Rec[] }>(`/v1/b2b/recurrentes${qs({ customer_id: cliente, status: estado })}`);
  const [form, setForm] = useState<Rec | "nuevo" | null>(null);
  const gestiona = Boolean(op?.can["b2b.recurring.manage"]);

  const cambiar = (x: Rec, status: string, titulo: string) => accion({ title: titulo, confirmLabel: "Confirmar", danger: status === "ENDED" },
    () => api(`/v1/b2b/recurrentes/${x.id}/estado`, { method: "POST", body: { status } }), "Pedido recurrente actualizado", r.recargar);

  const columnas: Column<Rec>[] = [
    { key: "name", header: "Plantilla", cardTitle: true, render: (x) => <div className="min-w-[200px]"><p className="font-semibold">{x.name}</p><Sub>{x.customer_name} · {x.brand_name}</Sub></div> },
    { key: "frequency", header: "Cuándo", render: (x) => <div>{x.frequency === "WEEKLY" ? diasTexto(x.weekdays) : `Cada ${x.interval_days} días`}<Sub>{x.slot_from ? `${x.slot_from.slice(0, 5)}–${x.slot_to?.slice(0, 5)}` : "Sin horario"}</Sub></div> },
    { key: "lines", header: "Productos", render: (x) => <div className="max-w-[260px] text-[12.5px]">{x.lines.map((l) => `${numero(l.qty)} ${l.variant_name}`).join(" · ")}
      {x.lines.some((l) => l.sellable === false) && <Badge tone="bad">Producto inactivo</Badge>}</div> },
    { key: "address_text", header: "Dirección", hideOnMobile: true, render: (x) => <span className="line-clamp-2 max-w-[200px]">{x.address_text}</span> },
    { key: "next_dates", header: "Próximas entregas", render: (x) => x.status === "ACTIVE" ? <div className="text-[12.5px]">{x.next_dates.slice(0, 3).map(fecha).join(" · ") || "—"}<Sub>{x.auto_confirm ? "Se confirma sola" : "Queda por confirmar"}</Sub></div> : "—" },
    { key: "last_run", header: "Última corrida", hideOnMobile: true, render: (x) => x.last_run ? <div><StatusBadge status={x.last_run.status} labels={ESTADO_CORRIDA} /><Sub>{fecha(x.last_run.delivery_date)}{x.last_run.message ? ` · ${x.last_run.message}` : ""}</Sub></div> : "—" },
    { key: "status", header: "Estado", render: (x) => <StatusBadge status={x.status} labels={ESTADO_RECURRENTE} /> },
    { key: "acc", header: "", render: (x) => gestiona && x.status !== "ENDED" ? <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
      {x.status === "ACTIVE" ? <Button size="sm" variant="ghost" icon={Pause} onClick={() => cambiar(x, "PAUSED", `¿Pausar ${x.name}?`)}>Pausar</Button>
        : <Button size="sm" icon={Play} onClick={() => cambiar(x, "ACTIVE", `¿Reactivar ${x.name}?`)}>Reactivar</Button>}
      <Button size="sm" variant="ghost" icon={Square} onClick={() => cambiar(x, "ENDED", `¿Terminar ${x.name}?`)}>Terminar</Button></div> : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Cada día a las ${op?.params.run_time ?? "18:00"} se generan los pedidos de las plantillas que entregan al día siguiente. Si cae feriado se salta; si el crédito no alcanza, el pedido queda retenido.`}
        actions={gestiona && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setForm("nuevo")}>Nuevo pedido recurrente</Button>} />
      <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay pedidos recurrentes." onRowClick={gestiona ? (x) => setForm(x) : undefined}
        toolbar={<>
          <FiltroSelect label="Cliente" value={cliente} onChange={setCliente} ancho="sm:w-[260px]" options={(op?.customers ?? []).filter((c) => c.has_credit).map((c) => ({ value: c.id, label: c.full_name }))} />
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_RECURRENTE)} />
        </>} />
      {form && op && <FormRecurrente op={op} x={form === "nuevo" ? null : form} onClose={() => setForm(null)} onHecho={() => { setForm(null); r.recargar(); }} />}
    </div>
  );
}

function FormRecurrente({ op, x, onClose, onHecho }: { op: Opciones; x: Rec | null; onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ customer_id: x?.customer_id ?? "", address_id: x?.address_id ?? "", name: x?.name ?? "", frequency: x?.frequency ?? "WEEKLY", weekdays: (x?.weekdays ?? []).map(Number),
    interval_days: String(x?.interval_days ?? 7), slot_from: x?.slot_from?.slice(0, 5) ?? "09:00", slot_to: x?.slot_to?.slice(0, 5) ?? "13:00", lead_days: String(x?.lead_days ?? op.params.lead_days),
    starts_on: x?.starts_on ?? op.today, ends_on: x?.ends_on ?? "", auto_confirm: x?.auto_confirm ?? true, notes: x?.notes ?? "" });
  const [lineas, setLineas] = useState<Linea[]>(x?.lines.map((l) => ({ ...l, qty: String(Number(l.qty)) })) ?? [{ variant_id: "", qty: "", est_weight_kg: null, cut_notes: null }]);
  const [dirs, setDirs] = useState<{ id: string; label: string | null; address_line: string; district: string | null; is_default: boolean }[]>([]);
  const c = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  useEffect(() => {
    if (!f.customer_id) return;
    let vigente = true;
    api<typeof dirs>(`/v1/b2b/clientes/${f.customer_id}/direcciones`).then((d) => vigente && setDirs(d)).catch(() => {});
    return () => { vigente = false; };
  }, [f.customer_id]);
  const setL = (i: number, k: keyof Linea, v: string) => setLineas(lineas.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Dialogo titulo={x ? `Editar ${x.name}` : "Nuevo pedido recurrente"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        const body = { ...f, interval_days: f.frequency === "EVERY_N_DAYS" ? Number(f.interval_days) : null, weekdays: f.frequency === "WEEKLY" ? f.weekdays : [], lead_days: Number(f.lead_days),
          ends_on: f.ends_on || null, notes: f.notes || null,
          lines: lineas.filter((l) => l.variant_id).map((l) => ({ variant_id: l.variant_id, qty: num(l.qty), est_weight_kg: l.est_weight_kg ? num(String(l.est_weight_kg)) : null, cut_notes: l.cut_notes || null })) };
        await api(x ? `/v1/b2b/recurrentes/${x.id}` : "/v1/b2b/recurrentes", { method: x ? "PUT" : "POST", body });
        toast.ok("Pedido recurrente guardado"); onHecho();
      }}>
      {(e) => <>
        <Field label="Cliente" required error={e.customer_id}><Select value={f.customer_id} disabled={Boolean(x)} onChange={(y) => setF({ ...f, customer_id: y.target.value, address_id: "" })} placeholder="Elige el cliente"
          options={op.customers.filter((y) => y.customer_type !== "PERSON").map((y) => ({ value: y.id, label: y.full_name }))} /></Field>
        <Field label="Dirección de entrega" required error={e.address_id}><Select value={f.address_id} onChange={c("address_id")} placeholder="Elige la dirección"
          options={dirs.map((d) => ({ value: d.id, label: `${d.label ? `${d.label}: ` : ""}${d.address_line}${d.district ? `, ${d.district}` : ""}` }))} /></Field>
        <Field label="Nombre" error={e.name} className="sm:col-span-2"><Input value={f.name} onChange={c("name")} placeholder="Cuy de la semana (lunes y jueves)" /></Field>
        <Field label="Frecuencia" required error={e.frequency}><Select value={f.frequency} onChange={c("frequency")} options={[{ value: "WEEKLY", label: "Días de la semana" }, { value: "EVERY_N_DAYS", label: "Cada cierto número de días" }]} /></Field>
        {f.frequency === "WEEKLY" ? <Field label="Días de entrega" error={e.weekdays}><DiasSemana value={f.weekdays} onChange={(v) => setF({ ...f, weekdays: v })} /></Field>
          : <Field label="Cada (días)" error={e.interval_days}><Input inputMode="numeric" value={f.interval_days} onChange={c("interval_days")} /></Field>}
        <div className="grid grid-cols-2 gap-2"><Field label="Desde las" error={e.slot_from}><Input type="time" value={f.slot_from} onChange={c("slot_from")} /></Field>
          <Field label="Hasta las" error={e.slot_to}><Input type="time" value={f.slot_to} onChange={c("slot_to")} /></Field></div>
        <Field label="Generar con anticipación (días)" error={e.lead_days}><Input inputMode="numeric" value={f.lead_days} onChange={c("lead_days")} /></Field>
        <Field label="Empieza" error={e.starts_on}><Input type="date" value={f.starts_on} onChange={c("starts_on")} /></Field>
        <Field label="Termina" error={e.ends_on}><Input type="date" value={f.ends_on} onChange={c("ends_on")} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={f.auto_confirm} onChange={(v) => setF({ ...f, auto_confirm: v })} label="Confirmar solo si el crédito y el stock alcanzan" hint="Si no, el pedido queda por confirmar." /></div>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-[13px] font-medium">Productos</p>
          {lineas.map((l, i) => {
            const v = op.variants.find((y) => y.id === l.variant_id);
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_minmax(0,1fr)_auto]">
                <Select aria-label="Producto" value={l.variant_id} onChange={(y) => setL(i, "variant_id", y.target.value)} placeholder="Producto" options={op.variants.map((y) => ({ value: y.id, label: `${y.name} · ${y.sku}` }))} />
                <Input aria-label="Cantidad" inputMode="decimal" value={l.qty} onChange={(y) => setL(i, "qty", y.target.value)} placeholder={v?.sale_mode === "KG" ? "Unid." : "Cant."} />
                <Input aria-label="Indicaciones de corte" value={l.cut_notes ?? ""} onChange={(y) => setL(i, "cut_notes", y.target.value)} placeholder="Corte o nota" />
                <Button variant="ghost" icon={Trash2} aria-label="Quitar" onClick={() => setLineas(lineas.filter((_, j) => j !== i))} />
              </div>
            );
          })}
          <Button size="sm" icon={Plus} onClick={() => setLineas([...lineas, { variant_id: "", qty: "", est_weight_kg: null, cut_notes: null }])}>Agregar producto</Button>
          {e.lines && <p className="text-[13px] text-bad">{e.lines}</p>}
        </div>
        <Field label="Notas" error={e.notes} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={c("notes")} /></Field>
      </>}
    </Dialogo>
  );
}
