"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Cifra, DataTable, FiltroFecha, PageHeader, type Column } from "@/components/ui";
import { numero, porcentaje } from "@/lib/formato";
import { ErrorCarga, Seccion, Vacio, useDatos } from "@/modulos/flo/comunes";
import { SerieTiempo } from "@/modulos/flo/Mapa";
import { hoyLima, sumarDias } from "@/modulos/flo/tipos";

type FilaV = { vehicle_id: string; vehiculo: string; esperado: number; minimo: number; n: number; km: number; gal: number; bajas: number; kmpg: number | null; desvio_pct: number | null; bajo: boolean;
  serie: { t: string; kmpg: number; numero: string }[] };
type FilaC = { conductor: string; vehiculo: string; esperado: number; minimo: number; n: number; km: number; gal: number; bajas: number; kmpg: number | null; desvio_pct: number | null; bajo: boolean };
type Datos = { desde: string; hasta: string; tolerancia: number; flota: { kmpg: number | null; km: number; gal: number; cargas: number; bajas: number; alertas: number };
  vehiculos: FilaV[]; conductores: FilaC[]; semanas: { semana: string; kmpg: number | null }[] };

/** FLO-06 Rendimiento de combustible: km por galón por vehículo y conductor frente al esperado, con tendencia y alertas (RN-FLO-06 y 07). */
export default function Rendimiento() {
  const [desde, setDesde] = useState(sumarDias(hoyLima(), -90));
  const [hasta, setHasta] = useState(hoyLima());
  const { datos, error, cargando } = useDatos<Datos>(`/v1/flo/rendimiento?desde=${desde}&hasta=${hasta}`);
  if (error) return <ErrorCarga error={error} que="El rendimiento lo ven el coordinador, administración y gerencia." />;
  const desvio = (x: { desvio_pct: number | null; bajo: boolean }) => x.desvio_pct === null ? "—" : <span className={x.bajo ? "font-semibold text-bad" : x.desvio_pct < 0 ? "text-warn" : "text-ok"}>{x.desvio_pct > 0 ? "+" : ""}{porcentaje(x.desvio_pct, 1)}</span>;
  const colV: Column<FilaV>[] = [
    { key: "vehiculo", header: "Vehículo", cardTitle: true, render: (x) => <Link href={`/m/flo/flo-05?vehiculo=${x.vehicle_id}`} className="font-medium text-primary hover:underline">{x.vehiculo}</Link> },
    { key: "kmpg", header: "km/gal real", align: "right", render: (x) => <span className={x.bajo ? "font-semibold text-bad" : "font-semibold"}>{numero(x.kmpg, 1)}</span> },
    { key: "esperado", header: "Esperado", align: "right", render: (x) => <span>{numero(x.esperado, 1)}<span className="block text-[11.5px] text-muted">mín. {numero(x.minimo, 1)}</span></span> },
    { key: "desvio_pct", header: "Desvío", align: "right", render: desvio },
    { key: "km", header: "Km", align: "right", hideOnMobile: true, render: (x) => numero(x.km, 1) },
    { key: "gal", header: "Galones", align: "right", hideOnMobile: true, render: (x) => numero(x.gal, 3) },
    { key: "n", header: "Cargas llenas", align: "right", render: (x) => <span>{x.n}{x.bajas > 0 && <Badge tone="bad">{x.bajas} bajas</Badge>}</span> },
  ];
  const colC: Column<FilaC>[] = [
    { key: "conductor", header: "Conductor", cardTitle: true, render: (x) => <span className="flex flex-col"><span className="font-medium">{x.conductor}</span><span className="text-[12px] text-muted">{x.vehiculo}</span></span> },
    { key: "kmpg", header: "km/gal", align: "right", render: (x) => <span className={x.bajo ? "font-semibold text-bad" : ""}>{numero(x.kmpg, 1)}</span> },
    { key: "esperado", header: "Esperado", align: "right", render: (x) => numero(x.esperado, 1) },
    { key: "desvio_pct", header: "Desvío", align: "right", render: desvio },
    { key: "n", header: "Cargas", align: "right", render: (x) => x.n },
  ];
  const f = datos?.flota;
  return (
    <div className="space-y-4">
      <PageHeader description={`Rendimiento = km desde la carga llena anterior ÷ galones cargados desde entonces. Por debajo del esperado − ${datos?.tolerancia ?? 15} % sale una alerta (RN-FLO-07).`} />
      <div className="flex flex-wrap gap-2">
        <FiltroFecha etiqueta="Desde" value={desde} onChange={(v) => setDesde(v || sumarDias(hoyLima(), -90))} max={hasta} />
        <FiltroFecha etiqueta="Hasta" value={hasta} onChange={(v) => setHasta(v || hoyLima())} min={desde} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Km recorridos" valor={f ? numero(f.km, 0) : undefined} detalle={f ? `${f.cargas} cargas llenas` : ""} destacada />
        <Cifra titulo="Galones" valor={f ? numero(f.gal, 1) : undefined} detalle={f?.kmpg ? `${numero(f.kmpg, 1)} km/gal de toda la flota` : ""} />
        <Cifra titulo="Cargas con rendimiento bajo" valor={f ? String(f.bajas) : undefined} detalle="bajo el mínimo" tono={f?.bajas ? "bad" : undefined} />
        <Cifra titulo="Alertas de rendimiento" valor={f ? String(f.alertas) : undefined} detalle="abiertas o atendidas" tono={f?.alertas ? "warn" : undefined} />
      </div>
      <DataTable rows={datos?.vehiculos ?? []} rowKey={(x) => x.vehicle_id} columns={colV} loading={cargando} empty={<Vacio>Sin cargas llenas en estas fechas.</Vacio>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(datos?.vehiculos ?? []).filter((x) => x.serie.length > 1).map((x) => (
          <Seccion key={x.vehicle_id} titulo={`Tendencia · ${x.vehiculo}`}>
            <SerieTiempo puntos={x.serie.map((s) => ({ t: s.t, v: s.kmpg }))} min={x.minimo} unidad="km/gal" alto={130} titulo={`Rendimiento de ${x.vehiculo}`} />
            <p className="mt-1 text-[12px] text-muted">La línea punteada es el mínimo ({numero(x.minimo, 1)} km/gal); los puntos rojos quedaron debajo.</p>
          </Seccion>
        ))}
      </div>
      <Seccion titulo="Por conductor"><DataTable rows={datos?.conductores ?? []} rowKey={(x) => `${x.conductor}-${x.vehiculo}`} columns={colC} empty="Sin datos." /></Seccion>
    </div>
  );
}
