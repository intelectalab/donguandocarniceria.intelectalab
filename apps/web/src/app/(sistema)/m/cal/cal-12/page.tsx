"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, StatusBadge, Textarea, Tabs, toast, type Column, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { Periodo } from "@/modulos/des/comunes";
import { FiltroSelect, Seccion, Tabla, opcionesEt, qs, useAlAbrir, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { ESTADO_TAREA, ETAPA, FRECUENCIA, TURNO } from "@/modulos/cal/tipos";
import type { Num } from "@/modulos/pro/tipos";

type Tarea = { id: string; task_date: string; shift: string; status: string; area: string; frequency: string; checklist_code: string; checklist_name: string; stage: string;
  establishment_name: string; done_by_name: string | null; done_at: string | null; evidence_url: string | null; notes: string | null; inspection_id: string | null; inspection_number: string | null; inspection_result: string | null };
type Resumen = { establishment_name: string; area: string; stage: string; tasks: number; done: number; missed: number; pending: number; compliance_pct: Num };
type Limpieza = { period: { from: string; to: string }; summary: Resumen[]; data: Tarea[]; today: Tarea[] };

const tono = (v: Num): Tone => (v === null ? "neutral" : Number(v) >= 95 ? "ok" : Number(v) >= 85 ? "warn" : "bad");

/** CAL-12 Plan de limpieza y BPM: tareas del programa por área, su cumplimiento del mes y las de hoy para marcarlas hechas con su evidencia. */
export default function Limpieza() {
  const { local, puede } = useSesion();
  const op = useOpcionesCal();
  const [mes, setMes] = useState("");
  const [estado, setEstado] = useState("");
  const [tab, setTab] = useState("hoy");
  const [hacer, setHacer] = useState<Tarea | null>(null);
  useAlAbrir((p) => { setMes(p.get("month") ?? ""); if (p.get("month")) setTab("mes"); });
  const { datos: d, error, recargar } = useDatos<Limpieza>(`/v1/cal/limpieza${qs({ month: mes, status: estado, site: local })}`);
  const marcar = op?.can.record && puede("CAL", "E");
  const columnas: Column<Tarea>[] = [
    { key: "task_date", header: "Fecha", render: (t) => <div className="whitespace-nowrap"><p>{fecha(t.task_date)}</p><p className="text-[12px] text-muted">{TURNO[t.shift] ?? t.shift}</p></div> },
    { key: "area", header: "Área", cardTitle: true, render: (t) => <div><p className="font-medium">{t.area}</p><p className="text-[12px] text-muted">{t.checklist_name} · {t.establishment_name}</p></div> },
    { key: "frequency", header: "Frecuencia", hideOnMobile: true, render: (t) => FRECUENCIA[t.frequency] ?? t.frequency },
    { key: "done_by_name", header: "Hecha por", render: (t) => t.done_by_name ? <div><p>{t.done_by_name}</p><p className="text-[12px] text-muted">{fechaHora(t.done_at)}</p></div> : "—" },
    { key: "inspection_number", header: "Evidencia", hideOnMobile: true, render: (t) => t.inspection_number ? `Inspección ${t.inspection_number}` : t.evidence_url ?? t.notes ?? "—" },
    { key: "status", header: "Estado", render: (t) => <StatusBadge status={t.status} labels={ESTADO_TAREA} /> },
    { key: "acc", header: "", render: (t) => marcar && t.status === "PENDING" ? <Button size="sm" icon={Check} onClick={(e) => { e.stopPropagation(); setHacer(t); }}>Hecha</Button> : null },
  ];
  const hoy = d?.today ?? [];
  return (
    <div className="space-y-5">
      <PageHeader description={d ? `Tareas de limpieza y buenas prácticas del ${fecha(d.period.from)} al ${fecha(d.period.to)}. Una tarea sin marcar al cerrar el día queda incumplida.` : "Tareas de limpieza y buenas prácticas."}
        actions={<Periodo mes={mes} setMes={setMes} />} />
      {error && <Alert tone="bad">{error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "hoy", label: "Hoy", count: hoy.filter((t) => t.status === "PENDING").length }, { key: "mes", label: "Cumplimiento del mes" }, { key: "todas", label: "Todas las tareas" }]} />
      {tab === "hoy" && <DataTable rows={hoy} columns={columnas} loading={!d && !error} empty="No hay tareas programadas para hoy." />}
      {tab === "mes" && d && <Seccion titulo="Cumplimiento por área">
        <Tabla cabeza={["Local", "Área", "Tipo", "Tareas", "Hechas", "Incumplidas", "Pendientes", "Cumplimiento"]} filas={d.summary.map((r) => [r.establishment_name, r.area, ETAPA[r.stage] ?? r.stage,
          r.tasks, r.done, r.missed, r.pending, <Badge key="c" tone={tono(r.compliance_pct)}>{r.compliance_pct === null ? "—" : porcentaje(r.compliance_pct, 1)}</Badge>])} vacio="No hay tareas en el período." />
      </Seccion>}
      {tab === "todas" && <DataTable rows={d?.data ?? []} columns={columnas} loading={!d && !error} empty="No hay tareas con estos filtros."
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesEt(ESTADO_TAREA)} />} />}
      {hacer && <MarcarHecha tarea={hacer} onClose={() => setHacer(null)} onHecha={() => { setHacer(null); recargar(); }} />}
    </div>
  );
}

function MarcarHecha({ tarea, onClose, onHecha }: { tarea: Tarea; onClose: () => void; onHecha: () => void }) {
  const [f, setF] = useState({ evidence_url: "", notes: "" });
  return (
    <Dialogo titulo={`${tarea.area} · ${fecha(tarea.task_date)}`} boton="Marcar hecha" onClose={onClose}
      enviar={async () => { await api(`/v1/cal/tareas/${tarea.id}/hecha`, { method: "POST", body: { evidence_url: f.evidence_url || null, notes: f.notes || null } }); toast.ok("Tarea marcada"); onHecha(); }}>
      {(err) => <>
        <p className="text-[13px] text-muted sm:col-span-2">{tarea.checklist_name}</p>
        <Field label="Evidencia" error={err.evidence_url} className="sm:col-span-2" hint="Ruta de la foto"><Input value={f.evidence_url} onChange={(e) => setF((x) => ({ ...x, evidence_url: e.target.value }))} /></Field>
        <Field label="Notas" error={err.notes} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} /></Field>
      </>}
    </Dialogo>
  );
}
