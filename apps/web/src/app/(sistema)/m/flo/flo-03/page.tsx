"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Alert, Button, Cifra, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje } from "@/lib/formato";
import { Foto } from "@/modulos/del/Captura";
import { AlVehiculo, ErrorCarga, Estado, FiltroVehiculo, Vacio, VerArchivo, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { JORNADA, hora, hoyLima, sumarDias } from "@/modulos/flo/tipos";

type Jornada = {
  id: string; number: string; trip_date: string; status: string; vehicle_id: string; vehiculo: string; conductor: string | null; ruta: string | null;
  started_at: string | null; ended_at: string | null; odometer_start: number | null; odometer_end: number | null; km_odometer: number | null; km_gps: number | null;
  km_diff_pct: number | null; fuera_tolerancia: boolean; deliveries: number | null; km_por_entrega: number | null; notes: string | null; end_notes: string | null;
  start_photo_file_id: string | null; end_photo_file_id: string | null; tiene_recorrido: boolean;
};
type Lista = { data: Jornada[]; desde: string; hasta: string; tolerancia: number; resumen: { jornadas: number; km: number; entregas: number; km_por_entrega: number | null; fuera_tolerancia: number; abiertas: number } };

/** FLO-03 Jornadas y km reales: odómetro inicial y final, km por odómetro y por GPS, entregas y km por entrega (RN-FLO-05). */
export default function Jornadas() {
  const { datos: op } = useOpciones();
  const [desde, setDesde] = useState(sumarDias(hoyLima(), -13));
  const [hasta, setHasta] = useState(hoyLima());
  const [vehiculo, setVehiculo] = useState("");
  const [estado, setEstado] = useState("");
  const [cerrar, setCerrar] = useState<Jornada | null>(null);
  const q = new URLSearchParams({ desde, hasta, ...(vehiculo ? { vehiculo } : {}), ...(estado ? { estado } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/flo/jornadas?${q}`);
  if (error) return <ErrorCarga error={error} que="Las jornadas las ve el coordinador; el repartidor ve la suya en la app." />;
  const r = datos?.resumen;
  const columnas: Column<Jornada>[] = [
    { key: "trip_date", header: "Fecha", sortable: true, cardTitle: true, render: (j) => (
      <span className="flex flex-col"><span className="font-medium">{fecha(j.trip_date)} · {j.number}</span><span className="text-[12px] text-muted">{hora(j.started_at)} a {hora(j.ended_at)}</span></span>
    ) },
    { key: "vehiculo", header: "Vehículo", render: (j) => <AlVehiculo id={j.vehicle_id}>{j.vehiculo}</AlVehiculo> },
    { key: "conductor", header: "Conductor", render: (j) => j.conductor ?? "—" },
    { key: "ruta", header: "Ruta", hideOnMobile: true, render: (j) => j.ruta ?? "—" },
    { key: "odometro", header: "Odómetro", hideOnMobile: true, render: (j) => j.odometer_start !== null ? `${numero(j.odometer_start, 1)} → ${j.odometer_end !== null ? numero(j.odometer_end, 1) : "…"}` : "—" },
    { key: "km_odometer", header: "Km reales", align: "right", sortable: true, render: (j) => numero(j.km_odometer, 1) },
    { key: "km_gps", header: "Km GPS", align: "right", render: (j) => numero(j.km_gps, 1) },
    { key: "km_diff_pct", header: "Diferencia", align: "right", render: (j) => j.km_diff_pct === null ? "—" : <span className={j.fuera_tolerancia ? "font-semibold text-bad" : ""}>{porcentaje(j.km_diff_pct, 1)}</span> },
    { key: "deliveries", header: "Entregas", align: "right", render: (j) => numero(j.deliveries, 0) },
    { key: "km_por_entrega", header: "Km/entrega", align: "right", hideOnMobile: true, render: (j) => numero(j.km_por_entrega, 2) },
    { key: "acciones", header: "", hideInCard: false, render: (j) => (
      <span className="flex flex-wrap justify-end gap-1">
        {j.tiene_recorrido && <Link href={`/m/flo/flo-02?vehiculo=${j.vehicle_id}&fecha=${j.trip_date}`} className="text-[12.5px] font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>Recorrido</Link>}
        <VerArchivo id={j.start_photo_file_id} texto="Tablero" />
        {j.status === "OPEN" && op?.permisos.vivo && <Button size="sm" onClick={(e) => { e.stopPropagation(); setCerrar(j); }}>Cerrar</Button>}
      </span>
    ) },
    { key: "status", header: "Estado", render: (j) => <Estado s={j.status} labels={JORNADA} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description={`Km reales = odómetro final − inicial. Si se alejan de los km del GPS más de ${datos?.tolerancia ?? 15} %, la jornada queda marcada y sale una alerta (RN-FLO-05).`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Km reales" valor={r ? numero(r.km, 1) : undefined} detalle={r ? `${r.jornadas} jornadas` : ""} destacada />
        <Cifra titulo="Entregas" valor={r ? numero(r.entregas, 0) : undefined} detalle={r?.km_por_entrega ? `${numero(r.km_por_entrega, 2)} km por entrega` : ""} />
        <Cifra titulo="Fuera de tolerancia" valor={r ? String(r.fuera_tolerancia) : undefined} detalle="odómetro vs GPS" tono={r?.fuera_tolerancia ? "warn" : undefined} />
        <Cifra titulo="Abiertas" valor={r ? String(r.abiertas) : undefined} detalle="jornadas en curso" />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroFecha etiqueta="Desde" value={desde} onChange={(v) => setDesde(v || sumarDias(hoyLima(), -13))} max={hasta} />
        <FiltroFecha etiqueta="Hasta" value={hasta} onChange={(v) => setHasta(v || hoyLima())} min={desde} />
        <FiltroVehiculo op={op} value={vehiculo} onChange={setVehiculo} />
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={Object.entries(JORNADA).map(([k, [l]]) => ({ value: k, label: l }))} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>No hay jornadas en estas fechas. La demo tiene jornadas del 01/09 al 10/10/2026 y las de hoy.</Vacio>} />
      {cerrar && <Cerrar j={cerrar} onClose={() => setCerrar(null)} onListo={() => { setCerrar(null); recargar(); }} />}
    </div>
  );
}

function Cerrar({ j, onClose, onListo }: { j: Jornada; onClose: () => void; onListo: () => void }) {
  const { datos: op } = useOpciones();
  const [odo, setOdo] = useState("");
  const [nota, setNota] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const checklist = Object.fromEntries(Object.keys(op?.checklist ?? {}).map((k) => [k, true]));
      await api(`/v1/flo/jornadas/${j.id}/cerrar`, { method: "POST", body: { odometer: Number(odo), checklist, notes: nota || undefined, foto_data: foto ?? undefined } });
      toast.ok(`Jornada ${j.number} cerrada.`);
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Cerrar ${j.number}`} description={`${j.vehiculo} · ${j.conductor ?? ""}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-cerrar" loading={guardando}>Cerrar jornada</Button></>}>
      <form id="f-cerrar" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Alert tone="info">Ciérrala desde aquí solo si el conductor no pudo hacerlo en la app (sin batería, sin señal). Lo normal es que la cierre él con la foto del tablero.</Alert>
        <Field label="Odómetro final (km)" required hint={`Empezó en ${numero(j.odometer_start, 1)} km`}><Input type="number" step="0.1" inputMode="decimal" value={odo} onChange={(e) => setOdo(e.target.value)} required /></Field>
        <Field label="Foto del tablero" required hint="Con el odómetro legible (RN-FLO-04)."><Foto valor={foto} onChange={setFoto} texto="Foto del tablero" /></Field>
        <Field label="Observación"><Textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} placeholder="Por qué se cierra desde la web" /></Field>
      </form>
    </Modal>
  );
}
