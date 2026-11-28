"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Fuel, Plus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { Foto } from "@/modulos/del/Captura";
import { AlVehiculo, ErrorCarga, Estado, FiltroVehiculo, Vacio, VerArchivo, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { CamposGasto, EnlazarGasto, GASTO_VACIO, cuerpoGasto, type GastoForm } from "@/modulos/flo/Gasto";
import { RENDIMIENTO, aIso, ahoraLocal, hoyLima, sumarDias, type Opciones } from "@/modulos/flo/tipos";

type Carga = {
  id: string; number: string; vehicle_id: string; vehiculo: string; conductor: string | null; jornada: string | null; loaded_at: string; odometer_km: number; gallons: number;
  price_per_gal: number; amount: number; full_tank: boolean; station_name: string | null; voucher_no: string | null; doc_type: string | null; doc_number: string | null;
  photo_file_id: string | null; expense_id: string | null; gasto: string | null; estado_gasto: string | null; km_since_full: number | null; km_per_gal: number | null;
  expected_km_per_gal: number | null; efficiency_status: string; source: string; status: string; void_reason: string | null;
};
type Lista = { data: Carga[]; desde: string; hasta: string; resumen: { cargas: number; galones: number; importe: number; sin_gasto: number; bajas: number } };
type Previa = { tope: number; tanque: number; esperado: number; minimo: number; odometro: number; rendimiento: { km_since_full: number; gallons_since_full: number; km_per_gal: number | null } | null };

/** FLO-05 Cargas de combustible: odómetro, galones, precio, tanque lleno, grifo, vale y foto, con su enlace al gasto (RN-FLO-04, 06, 07, 08 y 17). */
export default function Cargas() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const { datos: op } = useOpciones();
  const [desde, setDesde] = useState(sumarDias(hoyLima(), -90));
  const [hasta, setHasta] = useState(hoyLima());
  const [vehiculo, setVehiculo] = useState(sp.get("vehiculo") ?? "");
  const [estado, setEstado] = useState("");
  const [gasto, setGasto] = useState("");
  const [nueva, setNueva] = useState(sp.get("nueva") === "1");
  const [enlazar, setEnlazar] = useState<Carga | null>(null);
  const q = new URLSearchParams({ desde, hasta, ...(vehiculo ? { vehiculo } : {}), ...(estado ? { estado } : {}), ...(gasto ? { gasto } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/flo/cargas?${q}`);
  if (error) return <ErrorCarga error={error} que="Las cargas las registra el conductor desde la app y las corrige el coordinador o administración." />;
  const gestiona = Boolean(op?.permisos.combustible);
  async function anular(c: Carga) {
    const r = await confirmAction({ title: `Anular ${c.number}`, message: "La carga no se borra: queda anulada con su motivo y el rendimiento del vehículo se recalcula.", confirmLabel: "Anular", danger: true, reason: { label: "Motivo", min: 5 } });
    if (!r) return;
    try {
      await api(`/v1/flo/cargas/${c.id}/anular`, { method: "POST", body: { reason: r.reason } });
      toast.ok(`${c.number} anulada.`);
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  const r = datos?.resumen;
  const columnas: Column<Carga>[] = [
    { key: "number", header: "Carga", cardTitle: true, render: (c) => (
      <span className="flex flex-col"><span className="font-medium">{c.number}</span><span className="text-[12px] text-muted">{fechaHora(c.loaded_at)}{c.source === "APP" ? " · app" : c.source === "BASELINE" ? " · base" : ""}</span></span>
    ) },
    { key: "vehiculo", header: "Vehículo", render: (c) => <AlVehiculo id={c.vehicle_id}>{c.vehiculo}</AlVehiculo> },
    { key: "conductor", header: "Conductor", hideOnMobile: true, render: (c) => c.conductor ?? "—" },
    { key: "odometer_km", header: "Odómetro", align: "right", render: (c) => numero(c.odometer_km, 1) },
    { key: "gallons", header: "Galones", align: "right", render: (c) => <span>{numero(c.gallons, 3)}{!c.full_tank && <span className="block text-[11.5px] text-muted">parcial</span>}</span> },
    { key: "amount", header: "Importe", align: "right", render: (c) => <span>{soles(c.amount)}<span className="block text-[11.5px] text-muted">{soles(c.price_per_gal)}/gal</span></span> },
    { key: "km_per_gal", header: "km/gal", align: "right", render: (c) => c.km_per_gal !== null ? <span className={c.efficiency_status === "LOW" ? "font-semibold text-bad" : ""}>{numero(c.km_per_gal, 1)}<span className="block text-[11.5px] text-muted">{numero(c.km_since_full, 1)} km</span></span> : "—" },
    { key: "grifo", header: "Grifo y vale", hideOnMobile: true, render: (c) => <span className="flex flex-col"><span>{c.station_name ?? "—"}</span><span className="text-[12px] text-muted">{c.voucher_no ?? ""}</span></span> },
    { key: "gasto", header: "Gasto", render: (c) => c.gasto ? <Badge tone="ok">{c.gasto}</Badge> : c.status === "ACTIVE" && c.source !== "BASELINE" ? <Badge tone="warn">Sin gasto</Badge> : "—" },
    { key: "acciones", header: "", render: (c) => (
      <span className="flex flex-wrap justify-end gap-1">
        <VerArchivo id={c.photo_file_id} texto="Vale" />
        {gestiona && c.status === "ACTIVE" && !c.expense_id && c.source !== "BASELINE" && <Button size="sm" onClick={(e) => { e.stopPropagation(); setEnlazar(c); }}>Gasto</Button>}
        {gestiona && c.status === "ACTIVE" && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); anular(c); }}>Anular</Button>}
      </span>
    ) },
    { key: "status", header: "Estado", render: (c) => c.status === "VOIDED" ? <Badge>Anulada</Badge> : <Estado s={c.efficiency_status} labels={RENDIMIENTO} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="El rendimiento sale solo con tanque lleno: km desde la carga llena anterior entre los galones cargados desde entonces (RN-FLO-06). Una carga no pasa el tanque × 1,05 (RN-FLO-08) y el odómetro nunca baja (RN-FLO-04)."
        actions={(gestiona || op?.permisos.jornada) && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Registrar carga</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Importe" valor={r ? soles(r.importe) : undefined} detalle={r ? `${r.cargas} cargas` : ""} icono={Fuel} destacada />
        <Cifra titulo="Galones" valor={r ? numero(r.galones, 3) : undefined} detalle="en el periodo" />
        <Cifra titulo="Rendimiento bajo" valor={r ? String(r.bajas) : undefined} detalle="bajo el mínimo esperado" tono={r?.bajas ? "bad" : undefined} />
        <Cifra titulo="Sin gasto en GAS" valor={r ? String(r.sin_gasto) : undefined} detalle="enlázalas al comprobante" tono={r?.sin_gasto ? "warn" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroFecha etiqueta="Desde" value={desde} onChange={(v) => setDesde(v || sumarDias(hoyLima(), -90))} max={hasta} />
        <FiltroFecha etiqueta="Hasta" value={hasta} onChange={(v) => setHasta(v || hoyLima())} min={desde} />
        <FiltroVehiculo op={op} value={vehiculo} onChange={setVehiculo} />
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} vacio="Vigentes" options={[{ value: "VOIDED", label: "Anuladas" }, { value: "TODAS", label: "Todas" }]} />
        <FiltroSelect etiqueta="Gasto" value={gasto} onChange={setGasto} vacio="Con y sin gasto" options={[{ value: "SIN", label: "Sin gasto" }]} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>No hay cargas en estas fechas.</Vacio>} />
      {nueva && op && <Nueva op={op} vehiculo={vehiculo} onClose={() => setNueva(false)} onListo={() => { setNueva(false); recargar(); }} />}
      {enlazar && <EnlazarGasto titulo={`Gasto de ${enlazar.number}`} url={`/v1/flo/cargas/${enlazar.id}/gasto`} tipo="FUEL" vehiculo={enlazar.vehicle_id}
        puedeCrear={Boolean(op?.permisos.gastos)} onClose={() => setEnlazar(null)} onListo={() => { setEnlazar(null); recargar(); }} />}
    </div>
  );
}

function Nueva({ op, vehiculo, onClose, onListo }: { op: Opciones; vehiculo: string; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({ vehicle_id: vehiculo, loaded_at: ahoraLocal(), odometer_km: "", gallons: "", price_per_gal: "", amount: "", full_tank: true, station_supplier_id: "", station_name: "", voucher_no: "" });
  const [foto, setFoto] = useState<string | null>(null);
  const [g, setG] = useState<GastoForm>(GASTO_VACIO);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string | boolean) => setV((y) => ({ ...y, [k]: x }));
  useEffect(() => {
    if (!v.vehicle_id) return;
    const t = window.setTimeout(() => {
      const q = new URLSearchParams({ vehicle_id: v.vehicle_id, loaded_at: aIso(v.loaded_at), full_tank: v.full_tank ? "1" : "0", ...(v.odometer_km ? { odometer_km: v.odometer_km } : {}), ...(v.gallons ? { gallons: v.gallons } : {}) });
      api<Previa>(`/v1/flo/cargas/previa?${q}`).then(setPrevia).catch(() => setPrevia(null));
    }, 350);
    return () => window.clearTimeout(t);
  }, [v.vehicle_id, v.loaded_at, v.odometer_km, v.gallons, v.full_tank]);
  const gal = Number(v.gallons || 0);
  const pasa = previa && gal > previa.tope;
  const kmpg = previa?.rendimiento?.km_per_gal ?? null;
  const grifos = op.proveedores.filter((p) => p.tipo === "SERVICES" && /grifo|combustible|estaci/i.test(p.nombre));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const c = await api<{ number: string; efficiency_status: string; km_per_gal: number | null }>("/v1/flo/cargas", { method: "POST", body: {
        vehicle_id: v.vehicle_id, loaded_at: aIso(v.loaded_at), odometer_km: Number(v.odometer_km), gallons: Number(v.gallons), price_per_gal: v.price_per_gal ? Number(v.price_per_gal) : null,
        amount: v.amount ? Number(v.amount) : null, full_tank: v.full_tank, station_supplier_id: v.station_supplier_id || null, station_name: v.station_name || null, voucher_no: v.voucher_no || null,
        source: "WEB", foto_data: foto ?? undefined, ...cuerpoGasto(g),
      } });
      toast[c.efficiency_status === "LOW" ? "error" : "ok"](c.efficiency_status === "LOW" ? `${c.number}: rendimiento bajo (${numero(c.km_per_gal, 1)} km/gal). Se generó una alerta.` : `${c.number} registrada.`);
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Registrar carga" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-carga" loading={guardando} disabled={Boolean(pasa)}>Guardar</Button></>}>
      <form id="f-carga" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Vehículo" required><Select value={v.vehicle_id} onChange={(e) => pon("vehicle_id", e.target.value)} placeholder="Elige" options={op.vehiculos.map((x) => ({ value: x.id, label: x.etiqueta }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha y hora" required><Input type="datetime-local" value={v.loaded_at} max={ahoraLocal()} onChange={(e) => pon("loaded_at", e.target.value)} /></Field>
          <Field label="Odómetro (km)" required hint={previa ? `Última lectura: ${numero(previa.odometro, 1)}` : undefined}><Input type="number" step="0.1" inputMode="decimal" value={v.odometer_km} onChange={(e) => pon("odometer_km", e.target.value)} required /></Field>
          <Field label="Galones" required error={pasa ? `Pasa el tope de ${numero(previa!.tope, 3)} gal (tanque ${numero(previa!.tanque, 2)} × ${op.parametros.factor_tanque}).` : undefined}
            hint={previa && !pasa ? `Tope ${numero(previa.tope, 3)} gal` : undefined}><Input type="number" step="0.001" inputMode="decimal" value={v.gallons} onChange={(e) => pon("gallons", e.target.value)} required /></Field>
          <Field label="Precio por galón (S/)"><Input type="number" step="0.001" inputMode="decimal" value={v.price_per_gal} onChange={(e) => pon("price_per_gal", e.target.value)} /></Field>
          <Field label="Importe (S/)" hint={v.price_per_gal && gal ? `= ${soles(gal * Number(v.price_per_gal))}` : "o el precio"}><Input type="number" step="0.01" inputMode="decimal" value={v.amount} onChange={(e) => pon("amount", e.target.value)} /></Field>
          <Field label="N.º de vale"><Input value={v.voucher_no} maxLength={30} onChange={(e) => pon("voucher_no", e.target.value.toUpperCase())} /></Field>
        </div>
        <Checkbox checked={v.full_tank} onChange={(x) => pon("full_tank", x)} label="Tanque lleno" hint="Solo con tanque lleno se calcula el rendimiento." />
        {v.full_tank && kmpg !== null && previa && (
          <Alert tone={kmpg < previa.minimo ? "bad" : "ok"} title={`Rendimiento: ${numero(kmpg, 1)} km/gal`}>
            {numero(previa.rendimiento!.km_since_full, 1)} km / {numero(previa.rendimiento!.gallons_since_full, 3)} gal desde la última carga llena. Esperado {numero(previa.esperado, 1)}, mínimo {numero(previa.minimo, 1)}.
            {kmpg < previa.minimo && " Al guardar se genera una alerta de rendimiento (RN-FLO-07)."}
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Grifo"><Select value={v.station_supplier_id} onChange={(e) => pon("station_supplier_id", e.target.value)} placeholder="Otro (escribe el nombre)" options={grifos.map((p) => ({ value: p.id, label: p.nombre }))} /></Field>
          {!v.station_supplier_id && <Field label="Nombre del grifo"><Input value={v.station_name} maxLength={120} onChange={(e) => pon("station_name", e.target.value)} /></Field>}
        </div>
        <Field label="Foto del vale o del surtidor"><Foto valor={foto} onChange={setFoto} texto="Foto del vale" /></Field>
        <CamposGasto g={g} onChange={setG} tipo="FUEL" vehiculo={v.vehicle_id} puedeCrear={op.permisos.gastos} />
      </form>
    </Modal>
  );
}
