"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { FiltroSelect, accion, opcionesDe, opcionesEt, useOpcionesCal } from "@/modulos/cal/comunes";
import { ESTADO_ACCION, GRAVEDAD, TIPO_ACCION } from "@/modulos/cal/tipos";

type Fila = { id: string; nonconformity_id: string; action_type: string; description: string; due_date: string | null; done_at: string | null; status: string; evidence_url: string | null;
  nc_number: string; severity: string; responsible_name: string | null; verified_by_name: string | null; overdue: boolean };

/** CAL-09 Acciones correctivas: lo que hay que hacer por cada no conformidad, con responsable, plazo, evidencia y verificación. */
export default function Acciones() {
  const { local } = useSesion();
  const router = useRouter();
  const op = useOpcionesCal();
  const [estado, setEstado] = useState("PENDING");
  const [tipo, setTipo] = useState("");
  const lista = useListado<Fila>("/v1/cal/acciones", { orden: "due_date", filtros: { status: estado, action_type: tipo, site: local } });
  const columnas: Column<Fila>[] = [
    { key: "description", header: "Acción", cardTitle: true, render: (a) => <div className="min-w-[220px]"><p className="font-medium">{a.description}</p><p className="text-[12px] text-muted">{TIPO_ACCION[a.action_type]}</p></div> },
    { key: "nc_number", header: "No conformidad", render: (a) => <button type="button" className="cursor-pointer font-mono text-primary hover:underline" onClick={(e) => { e.stopPropagation(); router.push(`/m/cal/cal-08?id=${a.nonconformity_id}`); }}>{a.nc_number}</button> },
    { key: "severity", header: "Gravedad", render: (a) => <StatusBadge status={a.severity} labels={GRAVEDAD} /> },
    { key: "responsible_name", header: "Responsable", render: (a) => a.responsible_name ?? "—" },
    { key: "due_date", header: "Plazo", sortable: true, render: (a) => <span className={a.overdue ? "font-medium text-bad" : ""}>{fecha(a.due_date)}</span> },
    { key: "evidence_url", header: "Evidencia", hideOnMobile: true, render: (a) => a.evidence_url ?? "—" },
    { key: "status", header: "Estado", render: (a) => <StatusBadge status={a.status} labels={ESTADO_ACCION} /> },
    { key: "acc", header: "", render: (a) => a.status === "PENDING" && op?.can.record
      ? <Button size="sm" onClick={(e) => { e.stopPropagation(); void accion({ title: "¿Acción hecha?", confirmLabel: "Marcar hecha", reason: { label: "Evidencia (foto, documento u orden)", min: 3 } }, (m) => api(`/v1/cal/acciones/${a.id}/estado`, { method: "POST", body: { status: "DONE", evidence_url: m } }), "Acción hecha", lista.recargar); }}>Hecha</Button>
      : a.status === "DONE" && op?.can.close ? <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); void accion({ title: "¿Verificar la acción?", confirmLabel: "Verificar" }, () => api(`/v1/cal/acciones/${a.id}/estado`, { method: "POST", body: { status: "VERIFIED" } }), "Acción verificada", lista.recargar); }}>Verificar</Button> : null },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Quien hace la acción adjunta su evidencia; Calidad la verifica. Una no conformidad se cierra cuando todas sus acciones están verificadas." />
      <DataTable {...lista.tabla} columns={columnas} empty="No hay acciones con esos filtros."
        toolbar={<><FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesEt(ESTADO_ACCION)} /><FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opcionesDe(TIPO_ACCION)} /></>} />
    </div>
  );
}
