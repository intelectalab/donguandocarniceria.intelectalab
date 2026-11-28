"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Badge, Button, Cifra, DataTable, FiltroSelect, PageHeader, toast, type Column } from "@/components/ui";
import { apiDescargar, mensajeDe } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { AlVehiculo, ErrorCarga, Seccion, Vacio, useDatos } from "@/modulos/flo/comunes";
import { hoyLima } from "@/modulos/flo/tipos";

type Fila = {
  vehicle_id: string; vehiculo: string; ownership: string; modalidad: string; combustible: number; mantenimiento: number; multas: number; alquiler: number;
  alquiler_devengado: boolean; peajes: number; seguros: number; otros: number; depreciacion: number; conductor: number; km: number; entregas: number;
  jornadas: number; utilizacion: number; total: number; por_km: number | null; por_entrega: number | null;
};
type Modalidad = { por_entrega: number | null; por_km: number | null; total: number; entregas: number; km: number };
type Comparativo = {
  zone_id: string; zona: string; entregas_propio: number; propio: number | null; entregas_alquilado: number; alquilado: number | null;
  tercero: number | null; empresa: string | null; mejor: string | null;
};
type Tablero = {
  mes: string; filas: Fila[]; totales: Omit<Fila, "vehicle_id" | "vehiculo" | "ownership" | "modalidad" | "alquiler_devengado" | "utilizacion">;
  kpis: { costo_km: number | null; costo_entrega: number | null; mant_km: number | null; km_entrega: number | null; por_modalidad: Record<string, Modalidad> };
  comparativo: Comparativo[];
};

/** Los últimos 12 meses para elegir (AAAA-MM). */
function meses(): { value: string; label: string }[] {
  const [a, m] = hoyLima().slice(0, 7).split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    const v = d.toISOString().slice(0, 7);
    const l = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
    return { value: v, label: l.charAt(0).toUpperCase() + l.slice(1) };
  });
}

const s = (v: number | null | undefined) => (v === null || v === undefined ? "—" : soles(v));

/** FLO-12 Costo total por vehículo (RN-FLO-16) y comparativo propio / alquilado / tercero por zona (RN-FLO-17). */
export default function CostoTotal() {
  const [opcionesMes] = useState(meses);
  const [mes, setMes] = useState(opcionesMes[0].value);
  const [bajando, setBajando] = useState(false);
  const { datos, error, cargando } = useDatos<Tablero>(`/v1/flo/tablero?mes=${mes}`);
  if (error) return <ErrorCarga error={error} que="El costo total de la flota lo ven el gerente y administración." />;
  const t = datos?.totales;
  const k = datos?.kpis;
  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/flo/tablero/exportar?mes=${mes}`, `costo-flota-${mes}.xlsx`);
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setBajando(false);
    }
  }
  const columnas: Column<Fila>[] = [
    { key: "vehiculo", header: "Vehículo", cardTitle: true, render: (f) => <span className="flex flex-col"><AlVehiculo id={f.vehicle_id}>{f.vehiculo}</AlVehiculo><span className="text-[12px] text-muted">{f.modalidad}</span></span> },
    { key: "combustible", header: "Combustible", align: "right", hideOnMobile: true, render: (f) => s(f.combustible) },
    { key: "mantenimiento", header: "Mantenim.", align: "right", hideOnMobile: true, render: (f) => s(f.mantenimiento) },
    { key: "alquiler", header: "Alquiler", align: "right", hideOnMobile: true, render: (f) => (
      <span className="flex flex-col items-end">{s(f.alquiler)}{f.alquiler_devengado && <span className="text-[11px] text-muted">estimado</span>}</span>
    ) },
    { key: "depreciacion", header: "Deprec.", align: "right", hideOnMobile: true, render: (f) => s(f.depreciacion) },
    { key: "conductor", header: "Conductor", align: "right", hideOnMobile: true, render: (f) => s(f.conductor) },
    { key: "otros", header: "Multas y otros", align: "right", hideOnMobile: true, render: (f) => s(f.multas + f.peajes + f.seguros + f.otros) },
    { key: "total", header: "Total", align: "right", sortable: true, render: (f) => <span className="font-semibold">{s(f.total)}</span> },
    { key: "km", header: "Km", align: "right", render: (f) => numero(f.km, 0) },
    { key: "entregas", header: "Entregas", align: "right", render: (f) => numero(f.entregas, 0) },
    { key: "por_km", header: "S/ por km", align: "right", sortable: true, render: (f) => s(f.por_km) },
    { key: "por_entrega", header: "S/ por entrega", align: "right", sortable: true, render: (f) => s(f.por_entrega) },
    { key: "utilizacion", header: "Uso", align: "right", hideOnMobile: true, render: (f) => <span className="whitespace-nowrap">{porcentaje(f.utilizacion)}</span> },
  ];
  const colComp: Column<Comparativo>[] = [
    { key: "zona", header: "Zona", cardTitle: true, render: (c) => <span className="font-medium">{c.zona}</span> },
    { key: "propio", header: "Propio", align: "right", render: (c) => <span className="flex flex-col items-end">{s(c.propio)}<span className="text-[11px] text-muted">{c.entregas_propio} entregas</span></span> },
    { key: "alquilado", header: "Alquilado", align: "right", render: (c) => <span className="flex flex-col items-end">{s(c.alquilado)}<span className="text-[11px] text-muted">{c.entregas_alquilado} entregas</span></span> },
    { key: "tercero", header: "Tercero", align: "right", render: (c) => <span className="flex flex-col items-end">{s(c.tercero)}<span className="text-[11px] text-muted">{c.empresa ?? "sin tarifa"}</span></span> },
    { key: "mejor", header: "Más barato", render: (c) => (c.mejor ? <Badge tone="ok">{c.mejor}</Badge> : "—") },
  ];
  const modal = Object.entries(k?.por_modalidad ?? {});
  return (
    <div className="space-y-4">
      <PageHeader description="Todo lo que cuesta cada vehículo en el mes: combustible, mantenimiento, alquiler, depreciación, conductor, multas y otros, dividido entre sus km y sus entregas."
        actions={<Button icon={Download} loading={bajando} onClick={exportar} disabled={!datos?.filas.length}>Excel</Button>} />
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Mes" value={mes} onChange={(v) => setMes(v || opcionesMes[0].value)} options={opcionesMes} vacio="Mes actual" ancho={190} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Costo del mes" valor={t ? soles(t.total) : undefined} detalle={t ? `${datos?.filas.length ?? 0} vehículos · ${numero(t.jornadas, 0)} jornadas` : ""} destacada />
        <Cifra titulo="Por km" valor={k ? s(k.costo_km) : undefined} detalle={t ? `${numero(t.km, 0)} km recorridos` : ""} />
        <Cifra titulo="Por entrega" valor={k ? s(k.costo_entrega) : undefined} detalle={t ? `${numero(t.entregas, 0)} entregas` : ""} />
        <Cifra titulo="Mantenimiento por km" valor={k?.mant_km !== null && k?.mant_km !== undefined ? `S/ ${numero(k.mant_km, 3)}` : k ? "—" : undefined} detalle={k?.km_entrega ? `${numero(k.km_entrega, 1)} km por entrega` : ""} />
      </div>
      {modal.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {modal.map(([m, v]) => (
            <Seccion key={m} titulo={m === "OWN" ? "Flota propia" : m === "RENTED" ? "Flota alquilada" : m}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
                <div><dt className="text-muted">Total</dt><dd className="font-semibold tabular-nums">{soles(v.total)}</dd></div>
                <div><dt className="text-muted">Entregas</dt><dd className="tabular-nums">{numero(v.entregas, 0)}</dd></div>
                <div><dt className="text-muted">Por entrega</dt><dd className="tabular-nums">{s(v.por_entrega)}</dd></div>
                <div><dt className="text-muted">Por km</dt><dd className="tabular-nums">{s(v.por_km)}</dd></div>
              </dl>
            </Seccion>
          ))}
        </div>
      )}
      <DataTable rows={datos?.filas ?? []} columns={columnas} rowKey={(f) => f.vehicle_id} loading={cargando}
        empty={<Vacio>No hay costos ni recorridos en este mes. La demo tiene datos de septiembre y octubre de 2026.</Vacio>} />
      <Seccion titulo="Propio, alquilado o tercero: costo por entrega en cada zona">
        <DataTable rows={datos?.comparativo ?? []} columns={colComp} rowKey={(c) => c.zone_id} loading={cargando}
          empty={<Vacio>Sin entregas por zona en este mes.</Vacio>} />
      </Seccion>
    </div>
  );
}
