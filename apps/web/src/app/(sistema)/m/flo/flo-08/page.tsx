"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { Foto } from "@/modulos/del/Captura";
import { AlVehiculo, ErrorCarga, Estado, FiltroVehiculo, Vacio, VerArchivo, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { CamposGasto, GASTO_VACIO, cuerpoGasto, type GastoForm } from "@/modulos/flo/Gasto";
import { ORDEN, hoyLima, type Opciones } from "@/modulos/flo/tipos";

type Parte = { description: string; qty: number; unit_cost: number };
type Orden = {
  id: string; number: string; vehicle_id: string; vehiculo: string; plan_id: string | null; plan: string | null; plan_code: string | null; kind: "PREVENTIVE" | "CORRECTIVE";
  description: string; workshop_name: string | null; opened_on: string; in_workshop: boolean; due_km: number | null; due_on: string | null; odometer_km: number | null;
  done_on: string | null; days_out_of_service: number | null; parts: Parte[] | string; parts_amount: number; labor_amount: number; total_amount: number;
  doc_type: string | null; doc_number: string | null; receipt_file_id: string | null; expense_id: string | null; gasto: string | null; on_time: boolean | null; status: string; void_reason: string | null;
};
type Plan = { id: string; vehicle_id: string; task: string; code: string };

const partes = (o: Orden): Parte[] => (typeof o.parts === "string" ? JSON.parse(o.parts || "[]") : o.parts) ?? [];

/** FLO-08 Órdenes de mantenimiento: preventivo (de un plan, RN-FLO-10) y correctivo, con taller, odómetro, repuestos, mano de obra, días fuera y comprobante. */
export default function Ordenes() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const { datos: op } = useOpciones();
  const [vehiculo, setVehiculo] = useState(sp.get("vehiculo") ?? "");
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [abrir, setAbrir] = useState<string | null>(sp.get("nueva") ? sp.get("nueva") : null);
  const [cerrar, setCerrar] = useState<Orden | null>(null);
  const q = new URLSearchParams({ ...(vehiculo ? { vehiculo } : {}), ...(estado ? { estado } : {}), ...(tipo ? { tipo } : {}) });
  const { datos, error, cargando, recargar } = useDatos<{ data: Orden[] }>(`/v1/flo/ordenes?${q}`);
  if (error) return <ErrorCarga error={error} que="Las órdenes de mantenimiento son del coordinador de delivery." />;
  const filas = datos?.data ?? [];
  const gestiona = Boolean(op?.permisos.mantenimiento);
  async function anular(o: Orden) {
    const r = await confirmAction({ title: `Anular ${o.number}`, message: "La orden queda anulada con su motivo; si el vehículo estaba en el taller, vuelve a estar operativo.", confirmLabel: "Anular", danger: true, reason: { label: "Motivo", min: 5 } });
    if (!r) return;
    try {
      await api(`/v1/flo/ordenes/${o.id}/anular`, { method: "POST", body: { reason: r.reason } });
      toast.ok(`${o.number} anulada.`);
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  const hechas = filas.filter((o) => o.status === "DONE");
  const columnas: Column<Orden>[] = [
    { key: "number", header: "Orden", cardTitle: true, render: (o) => <span className="flex flex-col"><span className="font-medium">{o.number} · {o.kind === "PREVENTIVE" ? "Preventivo" : "Correctivo"}</span><span className="line-clamp-1 text-[12px] text-muted">{o.description}</span></span> },
    { key: "vehiculo", header: "Vehículo", render: (o) => <AlVehiculo id={o.vehicle_id}>{o.vehiculo}</AlVehiculo> },
    { key: "workshop_name", header: "Taller", hideOnMobile: true, render: (o) => o.workshop_name ?? "—" },
    { key: "fechas", header: "Fechas", render: (o) => <span className="flex flex-col"><span>{fecha(o.opened_on)}{o.done_on ? ` → ${fecha(o.done_on)}` : ""}</span>{o.days_out_of_service ? <span className="text-[12px] text-muted">{o.days_out_of_service} días fuera de servicio</span> : o.in_workshop && o.status === "IN_PROGRESS" ? <span className="text-[12px] text-bad">en el taller</span> : null}</span> },
    { key: "odometer_km", header: "Odómetro", align: "right", hideOnMobile: true, render: (o) => numero(o.odometer_km, 1) },
    { key: "total_amount", header: "Total", align: "right", render: (o) => <span>{soles(o.total_amount)}<span className="block text-[11.5px] text-muted">rep. {soles(o.parts_amount)} · m.o. {soles(o.labor_amount)}</span></span> },
    { key: "a_tiempo", header: "A tiempo", hideOnMobile: true, render: (o) => o.on_time === null ? "—" : o.on_time ? <Badge tone="ok">Sí</Badge> : <Badge tone="warn">Tarde</Badge> },
    { key: "acciones", header: "", render: (o) => (
      <span className="flex flex-wrap justify-end gap-1">
        <VerArchivo id={o.receipt_file_id} texto="Comprobante" />
        {o.gasto && <Badge tone="ok">{o.gasto}</Badge>}
        {gestiona && o.status === "IN_PROGRESS" && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setCerrar(o); }}>Cerrar</Button>}
        {gestiona && o.status !== "VOIDED" && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); anular(o); }}>Anular</Button>}
      </span>
    ) },
    { key: "status", header: "Estado", render: (o) => <Estado s={o.status} labels={ORDEN} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Al cerrar un preventivo, su plan avanza: próximo km = km del servicio + intervalo y próxima fecha = fecha del servicio + días (RN-FLO-10). Una orden «en el taller» deja el vehículo sin salir hasta cerrarla."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setAbrir("")}>Orden</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="En curso" valor={datos ? String(filas.filter((o) => o.status === "IN_PROGRESS").length) : undefined} detalle={`${filas.filter((o) => o.status === "IN_PROGRESS" && o.in_workshop).length} en el taller`} destacada />
        <Cifra titulo="Hechas" valor={datos ? String(hechas.length) : undefined} detalle={`${hechas.filter((o) => o.kind === "PREVENTIVE").length} preventivas`} />
        <Cifra titulo="Costo" valor={datos ? soles(hechas.reduce((a, o) => a + Number(o.total_amount), 0)) : undefined} detalle="de las hechas" />
        <Cifra titulo="Preventivo a tiempo" valor={datos && hechas.some((o) => o.on_time !== null) ? `${Math.round((hechas.filter((o) => o.on_time).length / Math.max(1, hechas.filter((o) => o.on_time !== null).length)) * 100)} %` : "—"} detalle="KPI-FLO" />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroVehiculo op={op} value={vehiculo} onChange={setVehiculo} />
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={Object.entries(ORDEN).map(([k, [l]]) => ({ value: k, label: l }))} />
        <FiltroSelect etiqueta="Tipo" value={tipo} onChange={setTipo} options={[{ value: "PREVENTIVE", label: "Preventivo" }, { value: "CORRECTIVE", label: "Correctivo" }]} />
      </div>
      <DataTable rows={filas} columns={columnas} loading={cargando} empty={<Vacio>No hay órdenes con estos filtros.</Vacio>} />
      {abrir !== null && op && <Abrir op={op} plan={abrir} vehiculo={vehiculo} onClose={() => setAbrir(null)} onListo={() => { setAbrir(null); recargar(); }} />}
      {cerrar && op && <Cerrar op={op} o={cerrar} onClose={() => setCerrar(null)} onListo={() => { setCerrar(null); recargar(); }} />}
    </div>
  );
}

function Abrir({ op, plan, vehiculo, onClose, onListo }: { op: Opciones; plan: string; vehiculo: string; onClose: () => void; onListo: () => void }) {
  const { datos: planes } = useDatos<{ data: Plan[] }>("/v1/flo/planes");
  const elegido = planes?.data.find((p) => p.id === plan);
  const [v, setV] = useState({ kind: plan ? "PREVENTIVE" : "CORRECTIVE", vehicle_id: vehiculo, plan_id: plan, description: "", workshop_supplier_id: "", workshop_name: "", opened_on: hoyLima(), in_workshop: true });
  const veh = v.vehicle_id || elegido?.vehicle_id || "";
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string | boolean) => setV((y) => ({ ...y, [k]: x }));
  const talleres = op.proveedores.filter((p) => p.tipo === "SERVICES");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const o = await api<{ number: string }>("/v1/flo/ordenes", { method: "POST", body: { ...v, vehicle_id: veh, plan_id: v.kind === "PREVENTIVE" ? v.plan_id || null : null, workshop_supplier_id: v.workshop_supplier_id || null,
        workshop_name: v.workshop_name || null, description: v.description || null } });
      toast.ok(`Orden ${o.number} abierta.`);
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Abrir orden de mantenimiento" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-abrir" loading={guardando}>Abrir</Button></>}>
      <form id="f-abrir" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Tipo" required><Select value={v.kind} onChange={(e) => pon("kind", e.target.value)} options={[{ value: "PREVENTIVE", label: "Preventivo (de un plan)" }, { value: "CORRECTIVE", label: "Correctivo (falla o reparación)" }]} /></Field>
        <Field label="Vehículo" required><Select value={veh} onChange={(e) => { pon("vehicle_id", e.target.value); pon("plan_id", ""); }} placeholder="Elige" options={op.vehiculos.map((x) => ({ value: x.id, label: x.etiqueta }))} /></Field>
        {v.kind === "PREVENTIVE" && (
          <Field label="Plan" required><Select value={v.plan_id} onChange={(e) => pon("plan_id", e.target.value)} placeholder="Elige" options={(planes?.data ?? []).filter((p) => !veh || p.vehicle_id === veh).map((p) => ({ value: p.id, label: `${p.code} · ${p.task}` }))} /></Field>
        )}
        <Field label="Trabajo o falla" required={v.kind === "CORRECTIVE"}><Textarea value={v.description} maxLength={2000} placeholder={elegido?.task ?? "Qué se hace"} onChange={(e) => pon("description", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taller"><Select value={v.workshop_supplier_id} onChange={(e) => pon("workshop_supplier_id", e.target.value)} placeholder="Otro" options={talleres.map((p) => ({ value: p.id, label: p.nombre }))} /></Field>
          {!v.workshop_supplier_id && <Field label="Nombre del taller"><Input value={v.workshop_name} maxLength={120} onChange={(e) => pon("workshop_name", e.target.value)} /></Field>}
          <Field label="Abierta el" required><Input type="date" value={v.opened_on} max={hoyLima()} onChange={(e) => pon("opened_on", e.target.value)} /></Field>
        </div>
        <Checkbox checked={v.in_workshop} onChange={(x) => pon("in_workshop", x)} label="El vehículo queda en el taller" hint="Mientras esté abierta no sale a ruta ni abre jornada (RN-FLO-11)." />
      </form>
    </Modal>
  );
}

function Cerrar({ op, o, onClose, onListo }: { op: Opciones; o: Orden; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({ done_on: hoyLima(), odometer_km: "", labor_amount: "", days_out_of_service: "" });
  const [ps, setPs] = useState<{ description: string; qty: string; unit_cost: string }[]>(partes(o).map((p) => ({ description: p.description, qty: String(p.qty), unit_cost: String(p.unit_cost) })));
  const [foto, setFoto] = useState<string | null>(null);
  const [g, setG] = useState<GastoForm>(GASTO_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const repuestos = ps.reduce((a, p) => a + Number(p.qty || 0) * Number(p.unit_cost || 0), 0);
  const total = repuestos + Number(v.labor_amount || 0);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(`/v1/flo/ordenes/${o.id}/cerrar`, { method: "POST", body: {
        done_on: v.done_on, odometer_km: Number(v.odometer_km), labor_amount: Number(v.labor_amount || 0), days_out_of_service: v.days_out_of_service ? Number(v.days_out_of_service) : null,
        parts: ps.filter((p) => p.description.trim()).map((p) => ({ description: p.description.trim(), qty: Number(p.qty || 0), unit_cost: Number(p.unit_cost || 0) })),
        foto_data: foto ?? undefined, ...(total > 0 ? cuerpoGasto(g) : {}),
      } });
      toast.ok(`${o.number} cerrada.${o.kind === "PREVENTIVE" ? " El plan se actualizó." : ""}`);
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Cerrar ${o.number}`} description={`${o.vehiculo} · ${o.description}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-cerrar" loading={guardando}>Cerrar orden</Button></>}>
      <form id="f-cerrar" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hecho el" required><Input type="date" value={v.done_on} max={hoyLima()} onChange={(e) => pon("done_on", e.target.value)} /></Field>
          <Field label="Odómetro del servicio (km)" required><Input type="number" step="0.1" inputMode="decimal" value={v.odometer_km} onChange={(e) => pon("odometer_km", e.target.value)} required /></Field>
          <Field label="Mano de obra (S/)"><Input type="number" step="0.01" value={v.labor_amount} onChange={(e) => pon("labor_amount", e.target.value)} /></Field>
          <Field label="Días fuera de servicio" hint="Vacío: se calcula desde que se abrió."><Input type="number" value={v.days_out_of_service} onChange={(e) => pon("days_out_of_service", e.target.value)} /></Field>
        </div>
        <div className="space-y-2">
          <p className="text-[12.5px] font-medium text-muted">Repuestos</p>
          {ps.map((p, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_64px_88px_auto] items-end gap-2">
              <Input aria-label="Repuesto" value={p.description} placeholder="Repuesto" onChange={(e) => setPs(ps.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} />
              <Input aria-label="Cantidad" type="number" step="0.01" value={p.qty} onChange={(e) => setPs(ps.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />
              <Input aria-label="Costo unitario" type="number" step="0.01" value={p.unit_cost} placeholder="S/" onChange={(e) => setPs(ps.map((x, k) => (k === i ? { ...x, unit_cost: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Quitar" onClick={() => setPs(ps.filter((_, k) => k !== i))}>{""}</Button>
            </div>
          ))}
          <Button size="sm" icon={Plus} onClick={() => setPs([...ps, { description: "", qty: "1", unit_cost: "" }])}>Repuesto</Button>
        </div>
        <Alert tone="info">Total: {soles(total)} (repuestos {soles(repuestos)} + mano de obra {soles(Number(v.labor_amount || 0))}).</Alert>
        <Field label="Foto del comprobante"><Foto valor={foto} onChange={setFoto} texto="Foto del comprobante" /></Field>
        {total > 0 && <CamposGasto g={g} onChange={setG} tipo={o.kind === "PREVENTIVE" ? "MAINTENANCE_PREVENTIVE" : "MAINTENANCE_CORRECTIVE"} vehiculo={o.vehicle_id} puedeCrear={op.permisos.gastos} />}
      </form>
    </Modal>
  );
}
