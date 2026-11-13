"use client";

import { useState } from "react";
import { Activity, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, IconButton, Input, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { AvisoCerrada, NavVersion, SelectorVersion, accion, num, useDatos, useVersion, useVersionElegida } from "@/modulos/rec/comunes";
import { TIPO, UNIDAD, VARIABLE, lista, type Num, type Version } from "@/modulos/rec/tipos";

type Punto = { id: string; step_seq: number; code: string; variable: string; min_value: Num; max_value: Num; unit: string; is_critical: boolean;
  corrective_action: string; step_description: string | null };
type Respuesta = { data: Punto[]; needs_critical: boolean; has_critical: boolean; recipe_type: string; steps: { seq: number; description: string }[] };

/** REC-06 Puntos de control: variable, rango, unidad, si es crítico y la acción correctiva. */
export default function Puntos() {
  const { can } = useSesion();
  const sel = useVersionElegida();
  const v = useVersion(sel.id);
  return (
    <div className="space-y-5">
      <PageHeader description="Qué se mide (temperatura interna, tiempo, pH, % de salmuera, °Brix, actividad de agua), su rango, si es crítico y qué hacer si sale del rango. Embutidos, caldos, mermeladas, mantecas y curados necesitan un punto crítico de temperatura o tiempo." />
      <SelectorVersion id={sel.id} lista={sel.lista} onChange={sel.elegir} version={v.datos} />
      {v.error && <Alert tone="bad">{v.error}</Alert>}
      {v.datos && <Lista key={v.datos.id} v={v.datos} costos={can("rec.cost.view")} />}
    </div>
  );
}

function Lista({ v, costos }: { v: Version; costos: boolean }) {
  const { can, puede } = useSesion();
  const { datos, cargando, error, recargar } = useDatos<Respuesta>(`/v1/rec/versiones/${v.id}/puntos`);
  const [editando, setEditando] = useState<Punto | null | undefined>(undefined);
  const edita = v.status === "DRAFT" && can("rec.version.edit") && puede("REC", "E");
  const puntos = datos?.data ?? [];
  const falta = datos?.needs_critical && !datos.has_critical;
  const columnas: Column<Punto>[] = [
    { key: "code", header: "Código", render: (c) => <span className="font-mono font-semibold">{c.code}</span> },
    { key: "variable", header: "Variable", cardTitle: true, render: (c) => VARIABLE[c.variable] ?? c.variable },
    { key: "min_value", header: "Rango", render: (c) => <span className="whitespace-nowrap tabular-nums">{numero(c.min_value, 2)} – {numero(c.max_value, 2)} {c.unit}</span> },
    { key: "step_seq", header: "Paso", render: (c) => c.step_seq ? <span title={c.step_description ?? ""}>{c.step_seq}. {(c.step_description ?? "").slice(0, 40)}</span> : <span className="text-muted">Sin paso</span> },
    { key: "is_critical", header: "Crítico", render: (c) => c.is_critical ? <Badge tone="bad">Crítico</Badge> : <span className="text-muted">—</span> },
    { key: "corrective_action", header: "Acción correctiva", hideOnMobile: true, render: (c) => <span className="block min-w-[200px] text-[12.5px]">{c.corrective_action}</span> },
    ...(edita ? [{ key: "acciones", header: "", align: "right", hideInCard: true, render: (c: Punto) => (
      <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
        <IconButton icon={Pencil} label={`Editar ${c.code}`} onClick={() => setEditando(c)} />
        <IconButton icon={Trash2} label={`Quitar ${c.code}`} onClick={() => accion({ title: `¿Quitar ${c.code}?`, danger: true, confirmLabel: "Quitar" },
          () => api(`/v1/rec/puntos/${c.id}`, { method: "DELETE" }), "Punto quitado", recargar)} />
      </span>) }] as Column<Punto>[] : []),
  ];
  return (
    <div className="space-y-5">
      <NavVersion v={v} actual="rec-06" costos={costos} />
      <AvisoCerrada v={v} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra destacada titulo="Puntos de control" valor={datos ? numero(puntos.length) : undefined} detalle={datos ? `${puntos.filter((c) => c.is_critical).length} críticos` : undefined} icono={ShieldCheck} />
        <Cifra titulo="Punto crítico de temperatura o tiempo" valor={!datos ? undefined : !datos.needs_critical ? "No aplica" : datos.has_critical ? "Cumple" : "Falta"}
          detalle={datos ? TIPO[datos.recipe_type] : undefined} tono={!datos ? undefined : falta ? "bad" : "ok"} icono={ShieldAlert} />
        <Cifra titulo="Lecturas fuera de rango" valor="—" detalle="KPI-REC-03: llegan con las órdenes de producción" icono={Activity} />
      </div>
      {falta && <Alert tone="bad" title="Falta un punto crítico">Esta receta no se aprueba sin un punto de control crítico de temperatura interna o de tiempo.</Alert>}
      <DataTable columns={columnas} rows={puntos} rowKey={(c) => c.id} loading={cargando} error={error} onRetry={recargar} onRowClick={edita ? setEditando : undefined}
        empty="La versión todavía no tiene puntos de control." toolbar={edita && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditando(null)}>Agregar punto</Button>} />
      {editando !== undefined && datos && <PuntoForm v={v} c={editando} pasos={datos.steps} n={puntos.length}
        onClose={() => setEditando(undefined)} onGuardado={() => { setEditando(undefined); recargar(); }} />}
    </div>
  );
}

function PuntoForm({ v, c, pasos, n, onClose, onGuardado }: { v: Version; c: Punto | null; pasos: Respuesta["steps"]; n: number; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ code: c?.code ?? `PC${n + 1}`, variable: c?.variable ?? "CORE_TEMP", min_value: c?.min_value?.toString() ?? "", max_value: c?.max_value?.toString() ?? "",
    unit: c?.unit ?? "°C", is_critical: c?.is_critical ?? false, corrective_action: c?.corrective_action ?? "", step_seq: c?.step_seq ? String(c.step_seq) : "" });
  const min = num(f.min_value), max = num(f.max_value);
  return (
    <Dialogo titulo={c ? `Editar ${c.code}` : "Nuevo punto de control"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(c ? `/v1/rec/versiones/${v.id}/puntos/${c.id}` : `/v1/rec/versiones/${v.id}/puntos`, { method: c ? "PUT" : "POST",
          body: { ...f, min_value: min, max_value: max, step_seq: f.step_seq ? Number(f.step_seq) : 0 } });
        toast.ok("Punto de control guardado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Código" required error={e.code}><Input value={f.code} maxLength={20} onChange={(x) => setF({ ...f, code: x.target.value.toUpperCase() })} /></Field>
        <Field label="Variable" required error={e.variable}>
          <Select value={f.variable} options={lista(VARIABLE)} onChange={(x) => setF({ ...f, variable: x.target.value, unit: UNIDAD[x.target.value] || f.unit })} />
        </Field>
        <Field label="Mínimo" required error={e.min_value}><Input inputMode="decimal" value={f.min_value} onChange={(x) => setF({ ...f, min_value: x.target.value })} /></Field>
        <Field label="Máximo" required error={e.max_value ?? (min !== null && max !== null && min > max ? "El mínimo no puede ser mayor que el máximo." : undefined)}>
          <Input inputMode="decimal" value={f.max_value} onChange={(x) => setF({ ...f, max_value: x.target.value })} />
        </Field>
        <Field label="Unidad" required error={e.unit}><Input value={f.unit} maxLength={20} onChange={(x) => setF({ ...f, unit: x.target.value })} /></Field>
        <Field label="Paso" error={e.step_seq}>
          <Select value={f.step_seq} placeholder="Sin paso" options={pasos.map((s) => ({ value: String(s.seq), label: `${s.seq}. ${s.description.slice(0, 50)}` }))} onChange={(x) => setF({ ...f, step_seq: x.target.value })} />
        </Field>
        <div className="sm:col-span-2"><Checkbox checked={f.is_critical} onChange={(x) => setF({ ...f, is_critical: x })} label="Es crítico (PCC)" hint="Fuera de rango detiene el lote" /></div>
        <Field label="Acción correctiva" required error={e.corrective_action} className="sm:col-span-2">
          <Textarea rows={3} maxLength={255} value={f.corrective_action} onChange={(x) => setF({ ...f, corrective_action: x.target.value })} placeholder="Qué hacer si la lectura sale del rango" />
        </Field>
      </>}
    </Dialogo>
  );
}
