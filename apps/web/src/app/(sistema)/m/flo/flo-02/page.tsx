"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Badge, Cifra, DataTable, FiltroFecha, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { numero } from "@/lib/formato";
import { ErrorCarga, FiltroVehiculo, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { MapaFlota, SerieTiempo, colorTono, type PuntoFlota } from "@/modulos/flo/Mapa";
import { JORNADA, hora, hoyLima } from "@/modulos/flo/tipos";

type Recorrido = {
  vehiculo: { id: string; etiqueta: string }; fecha: string; limite: number;
  jornadas: { id: string; number: string; status: string; started_at: string; ended_at: string | null; conductor: string; km_odometer: number | null }[];
  puntos: { t: string; lat: number; lng: number; v: number }[];
  paradas: { desde: string; hasta: string; minutos: number; lat: number; lng: number }[];
  entregas: { seq: number; status: string; number: string; lat: number | null; lng: number | null; closed_at: string | null }[];
  dias_con_recorrido: string[]; local: { name: string; lat: number; lng: number } | null;
  resumen: { km: number; max: number; paradas: number; excesos: number; minutos: number };
};

const ENTREGA: Record<string, [string, "ok" | "bad" | "warn" | "neutral"]> = { DELIVERED: ["Entregado", "ok"], HANDED_OFF: ["Entregado (traspaso)", "ok"], FAILED: ["No entregado", "bad"], PENDING: ["Pendiente", "warn"], ARRIVED: ["En la puerta", "warn"] };

/** FLO-02 Recorrido histórico: reproduce el recorrido de un vehículo en una fecha con paradas, detenciones y velocidad. */
export default function RecorridoHistorico() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const { datos: op } = useOpciones();
  const [vehiculo, setVehiculo] = useState(sp.get("vehiculo") ?? "");
  const [fecha, setFecha] = useState(sp.get("fecha") ?? hoyLima());
  const [idx, setIdx] = useState<number | null>(null);
  const [idxMapa, setIdxMapa] = useState<number | null>(null);
  const vid = vehiculo || op?.vehiculos.find((v) => v.vehicle_type !== "BICYCLE")?.id || "";
  const { datos, error, cargando } = useDatos<Recorrido>(vid ? `/v1/flo/vehiculos/${vid}/recorrido?fecha=${fecha}` : null);

  if (error) return <ErrorCarga error={error} que="El recorrido histórico es del coordinador de delivery y de gerencia." />;
  const pts = datos?.puntos ?? [];
  const actual = idx !== null ? pts[idx] : null;
  const enMapa = idxMapa !== null ? pts[idxMapa] : null;
  const puntos: PuntoFlota[] = [
    ...(datos?.local ? [{ id: "local", lat: datos.local.lat, lng: datos.local.lng, label: "Local", title: datos.local.name, color: "#6b6b6b" }] : []),
    ...(datos?.paradas ?? []).map((p, i) => ({ id: `det-${i}`, lat: p.lat, lng: p.lng, label: "", chico: true, color: colorTono("warn"), title: `Detenido ${p.minutos} min · ${hora(p.desde)} a ${hora(p.hasta)}` })),
    ...(datos?.entregas ?? []).filter((e) => e.lat !== null && e.lng !== null).map((e) => ({
      id: `ent-${e.seq}`, lat: e.lat!, lng: e.lng!, label: String(e.seq), color: colorTono(ENTREGA[e.status]?.[1] ?? "neutral"), title: `${e.number} · ${ENTREGA[e.status]?.[0] ?? e.status}${e.closed_at ? ` · ${hora(e.closed_at)}` : ""}`,
    })),
    ...(enMapa ? [{ id: "aqui", lat: enMapa.lat, lng: enMapa.lng, label: hora(enMapa.t), color: "#922242" }] : []),
  ];
  const fijar = () => setIdxMapa(idx);
  const colParadas: Column<Recorrido["paradas"][number]>[] = [
    { key: "desde", header: "Desde", cardTitle: true, render: (p) => hora(p.desde) },
    { key: "hasta", header: "Hasta", render: (p) => hora(p.hasta) },
    { key: "minutos", header: "Minutos", align: "right", render: (p) => numero(p.minutos, 0) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader description="El recorrido de una unidad en un día: el trazo del GPS, dónde se detuvo y cuánto, las entregas de sus rutas y la velocidad. Mueve la barra para ver dónde estaba a cada hora." />
      <div className="flex flex-wrap gap-2">
        <FiltroVehiculo op={op} value={vid} onChange={(v) => { setVehiculo(v); setIdx(null); setIdxMapa(null); }} vacio="Elige un vehículo" />
        <FiltroFecha etiqueta="Fecha" value={fecha} max={hoyLima()} onChange={(v) => { setFecha(v || hoyLima()); setIdx(null); setIdxMapa(null); }} />
      </div>
      {datos && datos.dias_con_recorrido.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">Días con recorrido:
          {datos.dias_con_recorrido.map((d) => (
            <button key={d} type="button" onClick={() => { setFecha(d); setIdx(null); setIdxMapa(null); }}
              className={`cursor-pointer rounded-full border px-2 py-0.5 ${d === fecha ? "border-primary text-primary" : "border-line text-ink hover:border-primary"}`}>{d.slice(8, 10)}/{d.slice(5, 7)}</button>
          ))}
        </p>
      )}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos ? <Vacio>Elige un vehículo.</Vacio> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Km por GPS" valor={numero(datos.resumen.km, 1)} detalle={`${datos.jornadas.length} jornada(s)`} destacada />
            <Cifra titulo="Velocidad máxima" valor={`${numero(datos.resumen.max, 0)} km/h`} detalle={`límite ${datos.limite} km/h`} tono={datos.resumen.max > datos.limite ? "bad" : undefined} />
            <Cifra titulo="Detenciones" valor={String(datos.resumen.paradas)} detalle="de 2 min o más" />
            <Cifra titulo="Tiempo en jornada" valor={`${Math.floor(datos.resumen.minutos / 60)} h ${datos.resumen.minutos % 60} min`} detalle={datos.resumen.excesos ? `${datos.resumen.excesos} posiciones sobre el límite` : "sin excesos"} tono={datos.resumen.excesos ? "warn" : undefined} />
          </div>
          {pts.length === 0 ? <Alert tone="info">No hay posiciones de {datos.vehiculo.etiqueta} el {fecha.split("-").reverse().join("/")}. Solo se rastrea durante la jornada (RN-FLO-02).</Alert> : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Seccion titulo={datos.vehiculo.etiqueta}>
                <MapaFlota height={420} puntos={puntos} trazos={[{ id: "r", puntos: pts.map((p) => [p.lat, p.lng]) }]} />
                <div className="mt-3 space-y-1">
                  <input type="range" min={0} max={pts.length - 1} value={idx ?? 0} aria-label="Momento del recorrido" className="w-full accent-[var(--primary)]"
                    onChange={(e) => setIdx(Number(e.target.value))} onMouseUp={fijar} onTouchEnd={fijar} onKeyUp={fijar} />
                  <p className="text-[12.5px] text-ink">{actual ? `${hora(actual.t)} · ${numero(actual.v, 0)} km/h` : `Desde ${hora(pts[0].t)} hasta ${hora(pts[pts.length - 1].t)}`}
                    <span className="text-muted"> · pines: local (gris), entregas (número), detenciones (puntos ámbar)</span></p>
                </div>
              </Seccion>
              <div className="space-y-3">
                <Seccion titulo="Jornadas">
                  {datos.jornadas.map((j) => (
                    <p key={j.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span>{j.number} · {j.conductor} · {hora(j.started_at)} a {hora(j.ended_at)}{j.km_odometer !== null ? ` · ${numero(j.km_odometer, 1)} km por odómetro` : ""}</span>
                      <StatusBadge status={j.status} labels={JORNADA} />
                    </p>
                  ))}
                </Seccion>
                <Seccion titulo="Velocidad"><SerieTiempo puntos={pts.map((p) => ({ t: p.t, v: p.v }))} limite={datos.limite} unidad="km/h" alto={140} titulo="Velocidad durante el día" /></Seccion>
                <Seccion titulo={`Entregas (${datos.entregas.length})`}>
                  {datos.entregas.length === 0 ? <Vacio>Sin rutas de reparto ese día.</Vacio> : (
                    <ul className="space-y-1 text-[13px]">
                      {datos.entregas.map((e) => <li key={e.seq} className="flex items-center justify-between gap-2"><span>{e.seq}. {e.number}{e.closed_at ? ` · ${hora(e.closed_at)}` : ""}</span><Badge tone={ENTREGA[e.status]?.[1] ?? "neutral"}>{ENTREGA[e.status]?.[0] ?? e.status}</Badge></li>)}
                    </ul>
                  )}
                </Seccion>
              </div>
            </div>
          )}
          {datos.paradas.length > 0 && <DataTable rows={datos.paradas} rowKey={(p) => p.desde} columns={colParadas} empty="Sin detenciones." />}
        </>
      )}
    </div>
  );
}
