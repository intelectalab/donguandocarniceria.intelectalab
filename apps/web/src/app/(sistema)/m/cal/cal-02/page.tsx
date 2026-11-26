"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { FiltroSelect, opcionesDe, qs, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { DIAS, ETAPA, FRECUENCIA, TURNO, type Opciones } from "@/modulos/cal/tipos";

type Prog = { id: string; checklist_id: string; establishment_id: string; area: string; frequency: string; responsible_role: string; weekday: number | null; status: string;
  active_from: string | null; checklist_code: string; checklist_name: string; stage: string; establishment_name: string; role_name: string | null;
  today: { id: string; shift: string; status: string }[] };

/** CAL-02 Programación: qué checklist se hace, dónde, cada cuánto y quién; genera las tareas del día (RN-CAL-09). */
export default function Programacion() {
  const { local, puede } = useSesion();
  const op = useOpcionesCal();
  const [frec, setFrec] = useState("");
  const { datos, error, recargar } = useDatos<{ data: Prog[] }>(`/v1/cal/programacion${qs({ site: local })}`);
  const [editar, setEditar] = useState<Prog | null | undefined>(undefined);
  const gestiona = Boolean(op?.can.checklist) && puede("CAL", "C");
  const columnas: Column<Prog>[] = [
    { key: "area", header: "Área", cardTitle: true, render: (p) => <div><p className="font-medium">{p.area}</p><p className="text-[12px] text-muted">{p.establishment_name}</p></div> },
    { key: "checklist_name", header: "Checklist", render: (p) => <span><b className="font-mono text-[12.5px]">{p.checklist_code}</b> {p.checklist_name}</span> },
    { key: "stage", header: "Etapa", hideOnMobile: true, render: (p) => ETAPA[p.stage] ?? p.stage },
    { key: "frequency", header: "Frecuencia", render: (p) => `${FRECUENCIA[p.frequency]}${p.frequency === "WEEKLY" && p.weekday != null ? ` · ${DIAS[p.weekday]}` : ""}` },
    { key: "role_name", header: "Responsable", render: (p) => p.role_name ?? p.responsible_role },
    { key: "today", header: "Hoy", render: (p) => p.today.length ? <span className="flex flex-wrap gap-1">{p.today.map((t) => <Badge key={t.id} tone={t.status === "DONE" ? "ok" : t.status === "MISSED" ? "bad" : "warn"}>{TURNO[t.shift]}</Badge>)}</span> : <span className="text-muted">—</span> },
    { key: "status", header: "Estado", render: (p) => <StatusBadge status={p.status} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cada mañana se generan las tareas del día: por turno (mañana y tarde), diarias, semanales en su día y mensuales el día 1. Una tarea sin hacer al final del día queda incumplida."
        actions={gestiona && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setEditar(null)}>Nueva programación</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <DataTable rows={(datos?.data ?? []).filter((p) => !frec || p.frequency === frec)} columns={columnas} loading={!datos && !error} onRowClick={gestiona ? (p) => setEditar(p) : undefined} empty="No hay programaciones."
        toolbar={<FiltroSelect label="Frecuencia" value={frec} onChange={setFrec} options={opcionesDe(FRECUENCIA)} />} />
      {editar !== undefined && op && <FormProg p={editar} op={op} onClose={() => setEditar(undefined)} onGuardado={() => { setEditar(undefined); recargar(); }} />}
    </div>
  );
}

function FormProg({ p, op, onClose, onGuardado }: { p: Prog | null; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ checklist_id: p?.checklist_id ?? "", establishment_id: p?.establishment_id ?? op.establishments[0]?.id ?? "", area: p?.area ?? "", frequency: p?.frequency ?? "DAILY",
    responsible_role: p?.responsible_role ?? "CALIDAD", weekday: p?.weekday != null ? String(p.weekday) : "1", status: p?.status ?? "ACTIVE", active_from: p?.active_from ?? "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo={p ? `Programación de ${p.area}` : "Nueva programación"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(p ? `/v1/cal/programacion/${p.id}` : "/v1/cal/programacion", { method: p ? "PUT" : "POST", body: { ...f, weekday: f.frequency === "WEEKLY" ? Number(f.weekday) : null, active_from: f.active_from || null } });
        toast.ok("Programación guardada"); onGuardado();
      }}>
      {(err) => <>
        <Field label="Checklist" required error={err.checklist_id} className="sm:col-span-2"><Select value={f.checklist_id} placeholder="Elegir" options={op.checklists.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} onChange={(e) => set("checklist_id", e.target.value)} /></Field>
        <Field label="Local" required error={err.establishment_id}><Select value={f.establishment_id} options={op.establishments.map((e) => ({ value: e.id, label: e.short ?? e.name }))} onChange={(e) => set("establishment_id", e.target.value)} /></Field>
        <Field label="Área" required error={err.area}><Input value={f.area} maxLength={120} onChange={(e) => set("area", e.target.value)} /></Field>
        <Field label="Frecuencia" required error={err.frequency}><Select value={f.frequency} options={opcionesDe(FRECUENCIA)} onChange={(e) => set("frequency", e.target.value)} /></Field>
        {f.frequency === "WEEKLY" && <Field label="Día" error={err.weekday}><Select value={f.weekday} options={DIAS.map((d, i) => ({ value: String(i), label: d }))} onChange={(e) => set("weekday", e.target.value)} /></Field>}
        <Field label="Responsable" required error={err.responsible_role}><Select value={f.responsible_role} options={op.roles.map((r) => ({ value: r.code, label: r.name }))} onChange={(e) => set("responsible_role", e.target.value)} /></Field>
        <Field label="Desde" error={err.active_from}><Input type="date" value={f.active_from} onChange={(e) => set("active_from", e.target.value)} /></Field>
        <Field label="Estado" error={err.status}><Select value={f.status} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} onChange={(e) => set("status", e.target.value)} /></Field>
        {p?.active_from && <p className="text-[12px] text-muted sm:col-span-2">Vigente desde {fecha(p.active_from)}</p>}
      </>}
    </Dialogo>
  );
}
