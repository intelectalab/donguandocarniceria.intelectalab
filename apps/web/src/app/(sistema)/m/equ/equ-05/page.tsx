"use client";

import { useState } from "react";
import { AlarmClock, CalendarCheck, ClipboardList, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { CifraLink, FichaOrden, FiltroSelect, num, opcionesEquipo, qs, useDatos, useOpcionesEqu } from "@/modulos/equ/comunes";
import { ESTADO_PLAN, type Num, type Opciones, type Plan } from "@/modulos/equ/tipos";

type Cifras = { active: number; due: number; overdue: number; overdue_days: number; compliance: { value: Num; on_time: number; total: number } };

/** EQU-05 Planes preventivos: actividad, frecuencia en días u horas de uso, responsable y repuestos esperados (RN-EQU-07). */
export default function Planes() {
  const { local, puede } = useSesion();
  const op = useOpcionesEqu();
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");
  const { datos, error, recargar } = useDatos<{ data: Plan[] }>(`/v1/equ/planes${qs({ site: local, state: estado, q })}`);
  const c = useDatos<Cifras>(`/v1/equ/cifras/05${qs({ site: local })}`);
  const [editando, setEditando] = useState<Plan | null | undefined>(undefined);
  const [orden, setOrden] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const gestiona = Boolean(op?.can.maintain) && puede("EQU", "C");

  async function generar() {
    setGenerando(true);
    try {
      const r = await api<{ created: string[]; overdue: string[] }>("/v1/equ/planes/generar", { method: "POST" });
      if (r.created.length) toast.ok(`${r.created.length} orden(es) preventiva(s) creada(s): ${r.created.join(", ")}`);
      else toast.info("No hay planes que toquen sin su orden abierta.");
      recargar(); c.recargar();
    } catch (e) { toast.error(mensajeDe(e)); } finally { setGenerando(false); }
  }

  const columnas: Column<Plan>[] = [
    { key: "equipment_code", header: "Equipo", render: (p) => <div className="min-w-[140px]"><p className="font-mono font-semibold">{p.equipment_code}</p><p className="text-[12px] text-muted">{p.equipment_name}</p></div> },
    { key: "activity", header: "Actividad", cardTitle: true, render: (p) => <span className="min-w-[180px]">{p.activity}</span> },
    { key: "freq", header: "Frecuencia", render: (p) => <span className="whitespace-nowrap">{p.frequency_days ? `Cada ${p.frequency_days} días` : `Cada ${p.frequency_hours} h de uso`}</span> },
    { key: "next", header: "Próxima", render: (p) => p.frequency_days
      ? <span className="whitespace-nowrap">{fecha(p.next_due_on)}{p.days_left !== null && <span className={`block text-[12px] ${p.days_left < 0 ? "text-bad" : "text-muted"}`}>{p.days_left < 0 ? `hace ${-p.days_left} d` : p.days_left === 0 ? "hoy" : `en ${p.days_left} d`}</span>}</span>
      : <span className="whitespace-nowrap">{numero(p.next_due_hours, 0)} h<span className={`block text-[12px] ${Number(p.hours_left) <= 0 ? "text-bad" : "text-muted"}`}>horómetro {numero(p.hour_meter, 1)} h</span></span> },
    { key: "responsible_name", header: "Responsable", hideOnMobile: true, render: (p) => p.responsible_name ?? "—" },
    { key: "expected_parts", header: "Repuestos esperados", hideOnMobile: true, render: (p) => <span className="line-clamp-2 max-w-[200px]">{p.expected_parts ?? "—"}</span> },
    { key: "last_done_on", header: "Última", hideOnMobile: true, render: (p) => fecha(p.last_done_on) },
    { key: "state", header: "Estado", render: (p) => <span className="flex flex-wrap items-center gap-1"><StatusBadge status={p.state} labels={ESTADO_PLAN} />
      {p.open_order_number && <button type="button" className="cursor-pointer font-mono text-[12px] text-primary underline-offset-2 hover:underline"
        onClick={(e) => { e.stopPropagation(); setOrden(p.open_order_id!); }}>{p.open_order_number}</button>}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Cada plan crea su orden preventiva al llegar la fecha o las horas de uso (cada mañana, o con «Generar órdenes»). Con más de ${c.datos?.overdue_days ?? 7} días de atraso se avisa al jefe de producción (RN-EQU-07).`}
        actions={gestiona && <>
          <Button icon={RefreshCw} loading={generando} onClick={generar}>Generar órdenes que tocan</Button>
          <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setEditando(null)}>Nuevo plan</Button>
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Planes activos" valor={c.datos ? numero(c.datos.active) : undefined} detalle="Por fecha u horas de uso" icono={ClipboardList} onClick={() => setEstado("")} />
        <CifraLink titulo="Tocan ahora" valor={c.datos ? numero(c.datos.due) : undefined} detalle="Llegó la fecha o las horas" icono={AlarmClock} tono={c.datos?.due ? "warn" : "ok"} onClick={() => setEstado("DUE")} />
        <CifraLink titulo="Vencidos" valor={c.datos ? numero(c.datos.overdue) : undefined} detalle={`Más de ${c.datos?.overdue_days ?? 7} días · aviso al jefe`} icono={TriangleAlert}
          tono={c.datos?.overdue ? "bad" : "ok"} onClick={() => setEstado("OVERDUE")} />
        <CifraLink destacada titulo="Cumplimiento del preventivo" valor={c.datos?.compliance.value != null ? porcentaje(c.datos.compliance.value, 1) : "—"}
          detalle={c.datos ? `${c.datos.compliance.on_time} de ${c.datos.compliance.total} a tiempo este mes · KPI-EQU-04` : undefined} icono={CalendarCheck} href="/m/equ/equ-09" />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      <DataTable rows={datos?.data ?? []} rowKey={(p) => p.id} columns={columnas} loading={!datos && !error} empty="No hay planes con esos filtros."
        onRowClick={gestiona ? (p) => setEditando(p) : undefined}
        search={{ value: q, onChange: setQ, placeholder: "Buscar equipo, actividad o responsable…" }}
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={Object.entries(ESTADO_PLAN).map(([value, [label]]) => ({ value, label }))} />} />
      {editando !== undefined && op && <FormPlan p={editando} op={op} onClose={() => setEditando(undefined)} onGuardado={() => { setEditando(undefined); recargar(); c.recargar(); }} />}
      {orden && <FichaOrden id={orden} op={op} onClose={() => setOrden(null)} onCambio={() => { recargar(); c.recargar(); }} />}
    </div>
  );
}

function FormPlan({ p, op, onClose, onGuardado }: { p: Plan | null; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [porHoras, setPorHoras] = useState(Boolean(p?.frequency_hours && !p?.frequency_days));
  const [f, setF] = useState({
    equipment_id: p?.equipment_id ?? "", activity: p?.activity ?? "", frequency_days: p?.frequency_days ? String(p.frequency_days) : "",
    frequency_hours: p?.frequency_hours ? String(p.frequency_hours) : "", next_due_on: p?.next_due_on ?? "", next_due_hours: p?.next_due_hours != null ? String(Number(p.next_due_hours)) : "",
    responsible_employee_id: p?.responsible_employee_id ?? "", expected_parts: p?.expected_parts ?? "", status: p?.status ?? "ACTIVE",
  });
  const eq = op.equipment.find((e) => e.id === f.equipment_id);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo={p ? `Plan de ${p.equipment_code}` : "Nuevo plan preventivo"} boton="Guardar plan" onClose={onClose}
      aviso="Sin próxima fecha u horas, se calcula desde hoy o desde el horómetro actual."
      enviar={async () => {
        await api(p ? `/v1/equ/planes/${p.id}` : "/v1/equ/planes", { method: p ? "PUT" : "POST", body: {
          ...f, frequency_days: porHoras ? null : (f.frequency_days ? Number(f.frequency_days) : null), frequency_hours: porHoras ? (f.frequency_hours ? Number(f.frequency_hours) : null) : null,
          next_due_on: porHoras ? null : f.next_due_on || null, next_due_hours: porHoras ? num(f.next_due_hours) : null,
          responsible_employee_id: f.responsible_employee_id || null, expected_parts: f.expected_parts || null,
        } });
        toast.ok("Plan guardado");
        onGuardado();
      }}>
      {(err) => <>
        <Field label="Equipo" required error={err.equipment_id} className="sm:col-span-2">
          <Select value={f.equipment_id} placeholder="Elegir" searchable disabled={Boolean(p)} options={opcionesEquipo(op)} onChange={(x) => set("equipment_id", x.target.value)} />
        </Field>
        <Field label="Actividad" required error={err.activity} className="sm:col-span-2"><Input value={f.activity} maxLength={255} onChange={(x) => set("activity", x.target.value)} /></Field>
        <Field label="Frecuencia por" error={err.frequency_days}>
          <Select value={porHoras ? "H" : "D"} options={[{ value: "D", label: "Días" }, { value: "H", label: "Horas de uso" }]} onChange={(x) => setPorHoras(x.target.value === "H")} />
        </Field>
        {porHoras
          ? <Field label="Cada" required error={err.frequency_hours}><Input inputMode="numeric" suffix="h de uso" value={f.frequency_hours} onChange={(x) => set("frequency_hours", x.target.value.replace(/\D/g, ""))} /></Field>
          : <Field label="Cada" required error={err.frequency_days}><Input inputMode="numeric" suffix="días" value={f.frequency_days} onChange={(x) => set("frequency_days", x.target.value.replace(/\D/g, ""))} /></Field>}
        {porHoras
          ? <Field label="Próxima a las" error={err.next_due_hours} hint={eq ? `Horómetro actual: ${numero(eq.hour_meter, 1)} h` : undefined}><Input inputMode="decimal" suffix="h" value={f.next_due_hours} onChange={(x) => set("next_due_hours", x.target.value)} /></Field>
          : <Field label="Próxima fecha" error={err.next_due_on}><Input type="date" value={f.next_due_on} onChange={(x) => set("next_due_on", x.target.value)} /></Field>}
        <Field label="Responsable" error={err.responsible_employee_id}>
          <Select value={f.responsible_employee_id} placeholder="Elegir" searchable options={op.employees.map((e) => ({ value: e.id, label: `${e.full_name}${e.position ? ` · ${e.position}` : ""}` }))}
            onChange={(x) => set("responsible_employee_id", x.target.value)} />
        </Field>
        <Field label="Repuestos esperados" error={err.expected_parts} className="sm:col-span-2"><Input value={f.expected_parts} maxLength={255} onChange={(x) => set("expected_parts", x.target.value)} /></Field>
        <Field label="Estado" error={err.status}><Select value={f.status} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} onChange={(x) => set("status", x.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}
