"use client";

import { useState } from "react";
import { Activity, CircleDollarSign, Plus, TriangleAlert, Wrench } from "lucide-react";
import { Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fechaHora, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { CifraLink, FichaOrden, FiltroSelect, NuevaOrden, qs, useAlAbrir, useDatos, useOpcionesEqu } from "@/modulos/equ/comunes";
import { ESTADO_ORDEN, TIPO_ORDEN, URGENCIA, type Num, type Orden } from "@/modulos/equ/tipos";

type Cifras = { open: number; open_corrective: number; month_cost: Num; availability: Num };

/** EQU-06 Órdenes de mantenimiento: preventivas (del plan) o correctivas (de una falla) con diagnóstico, repuestos, horas, servicio externo, costo y parada. */
export default function Ordenes() {
  const { local, puede } = useSesion();
  const op = useOpcionesEqu();
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("ABIERTAS");
  const lista = useListado<Orden>("/v1/equ/ordenes", { orden: "-reported_at", filtros: { kind: tipo, status: estado, site: local } });
  const c = useDatos<Cifras>(`/v1/equ/cifras/06${qs({ site: local })}`);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  useAlAbrir((p) => { if (p.get("id")) setAbierta(p.get("id")); });
  const crea = Boolean(op?.can.maintain || op?.can.report) && puede("EQU", "C");
  const cambio = () => { lista.recargar(); c.recargar(); };

  const columnas: Column<Orden>[] = [
    { key: "number", header: "Orden", sortable: true, render: (o) => <span className="font-mono font-semibold">{o.number}</span> },
    { key: "equipment_code", header: "Equipo", sortable: true, render: (o) => <div className="min-w-[140px]"><p className="font-mono">{o.equipment_code}</p><p className="text-[12px] text-muted">{o.equipment_name}</p></div> },
    { key: "kind", header: "Tipo", render: (o) => <StatusBadge status={o.kind} labels={TIPO_ORDEN} /> },
    { key: "description", header: "Falla o actividad", cardTitle: true, render: (o) => <span className="line-clamp-2 min-w-[200px] max-w-[320px]">{o.description}</span> },
    { key: "urgency", header: "Urgencia", hideOnMobile: true, render: (o) => <StatusBadge status={o.urgency} labels={URGENCIA} /> },
    { key: "reported_at", header: "Reportada", sortable: true, render: (o) => <span className="whitespace-nowrap">{fechaHora(o.reported_at)}<span className="block text-[12px] text-muted">{o.reported_by_name}</span></span> },
    { key: "downtime_hours", header: "Parada", align: "right", hideOnMobile: true, render: (o) => o.downtime_hours != null ? `${numero(o.downtime_hours, 1)} h` : "—" },
    { key: "total_cost", header: "Costo", sortable: true, align: "right", render: (o) => o.status === "DONE" ? soles(o.total_cost) : "—" },
    { key: "status", header: "Estado", sortable: true, render: (o) => <StatusBadge status={o.status} labels={ESTADO_ORDEN} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Una correctiva deja el equipo fuera de servicio hasta cerrarla (RN-EQU-05). Al cerrar, el costo es mano de obra + repuestos + servicio externo y se carga al centro de costo del equipo (RN-EQU-06)."
        actions={crea && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNueva(true)}>Nueva orden</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Abiertas" valor={c.datos ? numero(c.datos.open) : undefined} detalle="Abiertas o en curso" icono={Wrench} tono={c.datos?.open ? "warn" : "ok"} onClick={() => { setEstado("ABIERTAS"); setTipo(""); }} />
        <CifraLink titulo="Correctivas abiertas" valor={c.datos ? numero(c.datos.open_corrective) : undefined} detalle="Equipos fuera de servicio" icono={TriangleAlert}
          tono={c.datos?.open_corrective ? "bad" : "ok"} onClick={() => { setEstado("ABIERTAS"); setTipo("CORRECTIVE"); }} />
        <CifraLink destacada titulo="Costo del mes" valor={c.datos ? soles(c.datos.month_cost) : undefined} detalle="Órdenes cerradas · KPI-EQU-03" icono={CircleDollarSign} href="/m/equ/equ-09" />
        <CifraLink titulo="Disponibilidad del mes" valor={c.datos?.availability != null ? porcentaje(c.datos.availability, 2) : undefined} detalle="KPI-EQU-01" icono={Activity} href="/m/equ/equ-09" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(o) => setAbierta(o.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar orden, equipo o falla…" }} empty="No hay órdenes con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={[{ value: "ABIERTAS", label: "Abiertas o en curso" },
            ...Object.entries(ESTADO_ORDEN).map(([value, [label]]) => ({ value, label }))]} ancho="sm:w-[190px]" />
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={Object.entries(TIPO_ORDEN).map(([value, [label]]) => ({ value, label }))} />
        </>} />
      {abierta && <FichaOrden id={abierta} op={op} onClose={() => setAbierta(null)} onCambio={cambio} />}
      {nueva && op && <NuevaOrden op={op} onClose={() => setNueva(false)} onCreada={(id) => { setNueva(false); cambio(); setAbierta(id); }} />}
    </div>
  );
}
