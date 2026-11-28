"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Thermometer } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha as fmtFecha, numero } from "@/lib/formato";
import { ErrorCarga, Estado, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { SerieTiempo } from "@/modulos/flo/Mapa";
import { ALERTA, ahoraLocal, aIso, hora, type Alerta } from "@/modulos/flo/tipos";

type Excursion = {
  trip_id: string | null; inicio: string; fin: string; max: number; min: number; lecturas: number; sigue: boolean; minutos: number;
  jornada: string | null; alerta: Alerta | null; grave: boolean;
};
type Vista = {
  vehiculos: { id: string; etiqueta: string }[];
  vehiculo: { id: string; etiqueta: string; sensor: string | null } | null;
  fecha?: string; rango?: { min: number; max: number }; limite?: number;
  lecturas?: { t: string; c: number; ok: boolean; trip_id: string | null; source: string }[];
  excursiones?: Excursion[]; dias?: string[];
  resumen?: { lecturas: number; fuera: number; max: number | null; min: number | null; minutos_mes: number; excursiones_graves: number };
};

const grados = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${numero(v, 1)} °C`);

/** FLO-13 Temperatura de la cadena de frío (RN-FLO-14): lecturas del día, rango y excursiones con sus pedidos a revisión. */
export default function Temperatura() {
  const { datos: op } = useOpciones();
  const [vehiculo, setVehiculo] = useState("");
  const [dia, setDia] = useState("");
  const [manual, setManual] = useState(false);
  const q = new URLSearchParams({ ...(vehiculo ? { vehiculo } : {}), ...(dia ? { fecha: dia } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Vista>(`/v1/flo/temperatura?${q}`);
  if (error) return <ErrorCarga error={error} que="La temperatura la siguen el coordinador de reparto, calidad y el gerente." />;
  const r = datos?.resumen;
  const v = datos?.vehiculo;
  const lect = datos?.lecturas ?? [];
  const puedeRegistrar = Boolean(op?.permisos.jornada || op?.permisos.vivo);
  const columnas: Column<Excursion>[] = [
    { key: "inicio", header: "Excursión", cardTitle: true, render: (e) => (
      <span className="flex flex-col"><span className="font-medium">{fmtFecha(e.inicio.slice(0, 10))} · {hora(e.inicio)} a {e.sigue ? "sigue" : hora(e.fin)}</span>
        <span className="text-[12px] text-muted">{e.jornada ?? "sin jornada"}</span></span>
    ) },
    { key: "minutos", header: "Minutos", align: "right", render: (e) => <span className={e.grave ? "font-semibold text-bad" : ""}>{e.minutos} min</span> },
    { key: "max", header: "Máx.", align: "right", render: (e) => grados(e.max) },
    { key: "lecturas", header: "Lecturas", align: "right", hideOnMobile: true, render: (e) => e.lecturas },
    { key: "grave", header: "", render: (e) => (e.grave ? <Badge tone="bad">Pasa el límite</Badge> : <Badge tone="warn">Dentro del límite</Badge>) },
    { key: "alerta", header: "Alerta", render: (e) => e.alerta ? (
      <Link href={`/m/flo/flo-14?vehiculo=${e.alerta.vehicle_id ?? ""}`} className="flex flex-wrap items-center gap-1 text-primary hover:underline">
        {e.alerta.number} <Estado s={e.alerta.status} labels={ALERTA} />{e.alerta.pendientes > 0 && <Badge tone="warn">{e.alerta.pendientes} pedidos por revisar</Badge>}
      </Link>
    ) : "—" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="La caja térmica de los vehículos refrigerados manda su lectura cada pocos minutos. Si pasa más del límite fuera de rango, se abre una alerta y los pedidos de esa ruta pasan a revisión de calidad."
        actions={puedeRegistrar && v && <Button icon={Thermometer} onClick={() => setManual(true)}>Lectura manual</Button>} />
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Vehículo" value={vehiculo || v?.id || ""} onChange={(x) => { setVehiculo(x); setDia(""); }} ancho={200} vacio="Primer refrigerado"
          options={(datos?.vehiculos ?? []).map((x) => ({ value: x.id, label: x.etiqueta }))} />
        <FiltroSelect etiqueta="Día" value={dia || datos?.fecha || ""} onChange={setDia} ancho={170} vacio="Último con lecturas"
          options={(datos?.dias ?? []).map((d) => ({ value: d, label: fmtFecha(d) }))} />
      </div>
      {datos && !v && <Alert tone="info">No hay vehículos refrigerados en la flota. La temperatura se registra solo en los que tienen caja de frío.</Alert>}
      {v && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Rango" valor={datos?.rango ? `${datos.rango.min} a ${datos.rango.max} °C` : undefined} detalle={v.sensor ? `sensor ${v.sensor}` : "sin sensor, lectura manual"} destacada />
            <Cifra titulo="Lecturas del día" valor={r ? String(r.lecturas) : undefined} detalle={r ? `${r.fuera} fuera de rango` : ""} tono={r?.fuera ? "warn" : undefined} />
            <Cifra titulo="Mín. y máx." valor={r ? `${grados(r.min)} / ${grados(r.max)}` : undefined} detalle="del día" />
            <Cifra titulo="Minutos fuera en el mes" valor={r ? String(r.minutos_mes) : undefined} detalle={r ? `${r.excursiones_graves} pasaron el límite de ${datos?.limite ?? 15} min` : ""} tono={r?.excursiones_graves ? "bad" : undefined} />
          </div>
          <Seccion titulo={`${v.etiqueta} · ${datos?.fecha ? fmtFecha(datos.fecha) : ""}`}>
            {cargando ? <Vacio>Cargando…</Vacio> : (
              <SerieTiempo puntos={lect.map((l) => ({ t: l.t, v: l.c }))} min={datos?.rango?.min} max={datos?.rango?.max} unidad="°C" alto={200} titulo="Temperatura durante el día" />
            )}
            <p className="mt-2 text-[12px] text-muted">La banda verde es el rango permitido. Los puntos rojos están fuera de rango.</p>
          </Seccion>
          <Seccion titulo="Excursiones de los últimos 45 días">
            <DataTable rows={datos?.excursiones ?? []} columns={columnas} rowKey={(e) => `${e.trip_id ?? ""}${e.inicio}`} loading={cargando} empty={<Vacio>Sin salidas de rango. La cadena de frío se mantuvo.</Vacio>} />
          </Seccion>
        </>
      )}
      {manual && v && <Manual vehiculo={v} onClose={() => setManual(false)} onListo={() => { setManual(false); recargar(); }} />}
    </div>
  );
}

function Manual({ vehiculo, onClose, onListo }: { vehiculo: { id: string; etiqueta: string }; onClose: () => void; onListo: () => void }) {
  const [cuando, setCuando] = useState(ahoraLocal());
  const [temp, setTemp] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const r = await api<{ alerta: Alerta | null }>("/v1/flo/temperatura", { method: "POST", body: { vehicle_id: vehiculo.id, read_at: aIso(cuando), temp_c: Number(temp), source: "MANUAL" } });
      if (r.alerta) toast.error(`${r.alerta.title}: se abrió la alerta ${r.alerta.number}.`);
      else toast.ok("Lectura registrada.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Lectura manual · ${vehiculo.etiqueta}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-temp" loading={guardando} disabled={temp === ""}>Guardar</Button></>}>
      <form id="f-temp" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <p className="text-[13px] text-muted">Para cuando el sensor falla: el conductor lee el termómetro de la caja y lo anota aquí.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Temperatura (°C)" required><Input type="number" step="0.1" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} /></Field>
          <Field label="Hora de la lectura" required><Input type="datetime-local" value={cuando} max={ahoraLocal()} onChange={(e) => setCuando(e.target.value)} /></Field>
        </div>
      </form>
    </Modal>
  );
}
