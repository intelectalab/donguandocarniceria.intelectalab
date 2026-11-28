"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { Foto } from "@/modulos/del/Captura";
import { AlVehiculo, ErrorCarga, Estado, FiltroVehiculo, Vacio, VerArchivo, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { CamposGasto, GASTO_VACIO, cuerpoGasto, type GastoForm } from "@/modulos/flo/Gasto";
import { COSTO, hoyLima, sumarDias, type Opciones } from "@/modulos/flo/tipos";

type Costo = {
  id: string; vehicle_id: string; vehiculo: string; cost_type: string; tipo: string; cost_date: string; period: string; amount: string; proveedor: string | null;
  doc_type: string | null; doc_number: string | null; receipt_file_id: string | null; notes: string | null; gasto: string | null; status: string; void_reason: string | null;
};
type Lista = { data: Costo[]; desde: string; hasta: string; resumen: { total: number; por_tipo: Record<string, number>; sin_gasto: number } };

/** FLO-11 Otros costos del vehículo: alquiler, peajes, cochera, seguros, impuesto vehicular, lavado y otros, con su comprobante (entran al costo total, RN-FLO-16). */
export default function OtrosCostos() {
  const { datos: op } = useOpciones();
  const [desde, setDesde] = useState(sumarDias(hoyLima(), -90));
  const [hasta, setHasta] = useState(hoyLima());
  const [vehiculo, setVehiculo] = useState("");
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const q = new URLSearchParams({ desde, hasta, ...(vehiculo ? { vehiculo } : {}), ...(tipo ? { tipo } : {}), ...(estado ? { estado } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/flo/costos?${q}`);
  if (error) return <ErrorCarga error={error} que="Los otros costos los registran el coordinador y administración." />;
  const gestiona = Boolean(op?.permisos.combustible || op?.permisos.mantenimiento);
  async function anular(c: Costo) {
    const r = await confirmAction({ title: `Anular ${c.tipo} de ${c.vehiculo}`, message: "Queda anulado con su motivo y sale del costo del mes.", confirmLabel: "Anular", danger: true, reason: { label: "Motivo", min: 5 } });
    if (!r) return;
    try {
      await api(`/v1/flo/costos/${c.id}/anular`, { method: "POST", body: { reason: r.reason } });
      toast.ok("Costo anulado.");
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  const r = datos?.resumen;
  const mayores = r ? Object.entries(r.por_tipo).sort((a, b) => b[1] - a[1]) : [];
  const columnas: Column<Costo>[] = [
    { key: "tipo", header: "Costo", cardTitle: true, render: (c) => <span className="flex flex-col"><span className="font-medium">{c.tipo}</span><span className="line-clamp-1 text-[12px] text-muted">{c.notes ?? ""}</span></span> },
    { key: "vehiculo", header: "Vehículo", render: (c) => <AlVehiculo id={c.vehicle_id}>{c.vehiculo}</AlVehiculo> },
    { key: "cost_date", header: "Fecha", sortable: true, render: (c) => <span className="flex flex-col"><span>{fecha(c.cost_date)}</span><span className="text-[12px] text-muted">mes {c.period.slice(5, 7)}/{c.period.slice(0, 4)}</span></span> },
    { key: "proveedor", header: "Proveedor", hideOnMobile: true, render: (c) => c.proveedor ?? "—" },
    { key: "doc", header: "Comprobante", hideOnMobile: true, render: (c) => c.doc_number ?? c.doc_type ?? "—" },
    { key: "amount", header: "Importe", align: "right", render: (c) => soles(c.amount) },
    { key: "acciones", header: "", render: (c) => (
      <span className="flex flex-wrap justify-end gap-1">
        <VerArchivo id={c.receipt_file_id} texto="Comprobante" />
        {c.gasto ? <Badge tone="ok">{c.gasto}</Badge> : c.status === "ACTIVE" && <Badge tone="warn">Sin gasto</Badge>}
        {gestiona && c.status === "ACTIVE" && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); anular(c); }}>Anular</Button>}
      </span>
    ) },
    { key: "status", header: "Estado", render: (c) => <Estado s={c.status} labels={COSTO} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Lo que no es combustible, mantenimiento ni multa. Cada costo va al mes que corresponde y suma en el costo total del vehículo. El alquiler sin factura se estima con la tarifa diaria."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Costo</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Total" valor={r ? soles(r.total) : undefined} detalle={datos ? `${datos.data.length} registros` : ""} destacada />
        {mayores.slice(0, 2).map(([k, v]) => <Cifra key={k} titulo={op?.costos[k] ?? k} valor={soles(v)} detalle="en el periodo" />)}
        <Cifra titulo="Sin gasto en GAS" valor={r ? String(r.sin_gasto) : undefined} detalle="falta el comprobante en GAS" tono={r?.sin_gasto ? "warn" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroFecha etiqueta="Desde" value={desde} onChange={(v) => setDesde(v || sumarDias(hoyLima(), -90))} max={hasta} />
        <FiltroFecha etiqueta="Hasta" value={hasta} onChange={(v) => setHasta(v || hoyLima())} min={desde} />
        <FiltroVehiculo op={op} value={vehiculo} onChange={setVehiculo} />
        <FiltroSelect etiqueta="Tipo" value={tipo} onChange={setTipo} options={Object.entries(op?.costos ?? {}).map(([k, l]) => ({ value: k, label: l }))} />
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} vacio="Vigentes" options={[{ value: "VOIDED", label: "Anulados" }, { value: "TODOS", label: "Todos" }]} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>No hay costos en estas fechas.</Vacio>} />
      {nuevo && op && <Nuevo op={op} onClose={() => setNuevo(false)} onListo={() => { setNuevo(false); recargar(); }} />}
    </div>
  );
}

const TIPO_GASTO: Record<string, string> = { RENT: "RENT", TOLL: "TOLL", PARKING: "PARKING", INSURANCE: "INSURANCE", TAX: "TAX", WASH: "WASH", TIRES: "TIRES", OTHER: "OTHER" };

function Nuevo({ op, onClose, onListo }: { op: Opciones; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({ vehicle_id: "", cost_type: "TOLL", cost_date: hoyLima(), period: hoyLima().slice(0, 7), amount: "", supplier_id: "", notes: "" });
  const [foto, setFoto] = useState<string | null>(null);
  const [g, setG] = useState<GastoForm>(GASTO_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const veh = op.vehiculos.find((x) => x.id === v.vehicle_id);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api("/v1/flo/costos", { method: "POST", body: { ...v, amount: Number(v.amount), supplier_id: v.supplier_id || null, notes: v.notes || null, foto_data: foto ?? undefined, ...cuerpoGasto(g) } });
      toast.ok("Costo registrado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Registrar costo" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-costo" loading={guardando}>Guardar</Button></>}>
      <form id="f-costo" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Vehículo" required><Select value={v.vehicle_id} onChange={(e) => pon("vehicle_id", e.target.value)} placeholder="Elige" options={op.vehiculos.map((x) => ({ value: x.id, label: x.etiqueta }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo" required><Select value={v.cost_type} onChange={(e) => pon("cost_type", e.target.value)} options={Object.entries(op.costos).map(([k, l]) => ({ value: k, label: l }))} /></Field>
          <Field label="Importe (S/)" required><Input type="number" step="0.01" value={v.amount} onChange={(e) => pon("amount", e.target.value)} /></Field>
          <Field label="Fecha" required><Input type="date" value={v.cost_date} max={hoyLima()} onChange={(e) => { pon("cost_date", e.target.value); pon("period", e.target.value.slice(0, 7)); }} /></Field>
          <Field label="Mes al que corresponde" required><Input type="month" value={v.period} onChange={(e) => pon("period", e.target.value)} /></Field>
        </div>
        {v.cost_type === "RENT" && veh && veh.ownership !== "RENTED" && <Alert tone="warn">{veh.etiqueta} es propio: el alquiler es solo de vehículos alquilados.</Alert>}
        <Field label="Proveedor"><Select value={v.supplier_id} onChange={(e) => pon("supplier_id", e.target.value)} placeholder="Sin proveedor" options={op.proveedores.map((p) => ({ value: p.id, label: p.nombre }))} /></Field>
        <Field label="Detalle"><Textarea value={v.notes} maxLength={1000} onChange={(e) => pon("notes", e.target.value)} /></Field>
        <Field label="Foto del comprobante"><Foto valor={foto} onChange={setFoto} texto="Foto del comprobante" /></Field>
        <CamposGasto g={g} onChange={setG} tipo={TIPO_GASTO[v.cost_type] ?? "OTHER"} vehiculo={v.vehicle_id} puedeCrear={op.permisos.gastos} />
      </form>
    </Modal>
  );
}
