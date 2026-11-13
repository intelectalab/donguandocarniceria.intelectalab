"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Clock, ListOrdered, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, IconButton, Input, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { AvisoCerrada, NavVersion, SelectorVersion, accion, num, tiempo, useDatos, useVersion, useVersionElegida } from "@/modulos/rec/comunes";
import { EQUIPO, lista, type Num, type Version } from "@/modulos/rec/tipos";

type Paso = { id: string; seq: number; description: string; duration_min: Num; equipment_category: string | null; control_points: { id: string; code: string; is_critical: boolean }[] };

/** REC-05 Pasos: orden, descripción, tiempo y categoría de equipo. Solo se cambian en borrador. */
export default function Pasos() {
  const { can } = useSesion();
  const sel = useVersionElegida();
  const v = useVersion(sel.id);
  return (
    <div className="space-y-5">
      <PageHeader description="Los pasos en orden, con su tiempo y el equipo que usan (olla, cocina, embutidora, selladora…). Los puntos de control se cuelgan de un paso." />
      <SelectorVersion id={sel.id} lista={sel.lista} onChange={sel.elegir} version={v.datos} />
      {v.error && <Alert tone="bad">{v.error}</Alert>}
      {v.datos && <Lista key={v.datos.id} v={v.datos} costos={can("rec.cost.view")} />}
    </div>
  );
}

function Lista({ v, costos }: { v: Version; costos: boolean }) {
  const { can, puede } = useSesion();
  const { datos, cargando, error, recargar } = useDatos<{ data: Paso[]; total_min: string; control_points: number }>(`/v1/rec/versiones/${v.id}/pasos`);
  const [editando, setEditando] = useState<Paso | null | undefined>(undefined);
  const edita = v.status === "DRAFT" && can("rec.version.edit") && puede("REC", "E");
  const pasos = datos?.data ?? [];
  async function mover(p: Paso, dir: number) {
    try { await api(`/v1/rec/pasos/${p.id}/mover`, { method: "POST", body: { dir } }); recargar(); } catch (e) { toast.error(mensajeDe(e)); }
  }
  const columnas: Column<Paso>[] = [
    { key: "seq", header: "#", align: "right", render: (p) => <span className="font-semibold tabular-nums">{p.seq}</span> },
    { key: "description", header: "Descripción", cardTitle: true, render: (p) => <span className="block min-w-[220px]">{p.description}</span> },
    { key: "duration_min", header: "Tiempo", align: "right", render: (p) => <span className="whitespace-nowrap">{tiempo(p.duration_min)}</span> },
    { key: "equipment_category", header: "Equipo", render: (p) => p.equipment_category ? EQUIPO[p.equipment_category] : "—" },
    { key: "control_points", header: "Control", render: (p) => p.control_points.length
      ? <span className="flex flex-wrap gap-1">{p.control_points.map((c) => <Badge key={c.id} tone={c.is_critical ? "bad" : "info"}>{c.code}{c.is_critical ? " crítico" : ""}</Badge>)}</span> : <span className="text-muted">—</span> },
    ...(edita ? [{ key: "acciones", header: "", align: "right", hideInCard: true, render: (p: Paso) => (
      <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
        <IconButton icon={ArrowUp} label="Subir" disabled={p.seq === pasos[0]?.seq} onClick={() => mover(p, -1)} />
        <IconButton icon={ArrowDown} label="Bajar" disabled={p.seq === pasos[pasos.length - 1]?.seq} onClick={() => mover(p, 1)} />
        <IconButton icon={Pencil} label={`Editar el paso ${p.seq}`} onClick={() => setEditando(p)} />
        <IconButton icon={Trash2} label={`Quitar el paso ${p.seq}`} onClick={() => accion({ title: `¿Quitar el paso ${p.seq}?`, message: p.control_points.length ? "Sus puntos de control quedan sin paso." : undefined, danger: true, confirmLabel: "Quitar" },
          () => api(`/v1/rec/pasos/${p.id}`, { method: "DELETE" }), "Paso quitado", recargar)} />
      </span>) }] as Column<Paso>[] : []),
  ];
  return (
    <div className="space-y-5">
      <NavVersion v={v} actual="rec-05" costos={costos} />
      <AvisoCerrada v={v} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra destacada titulo="Pasos" valor={datos ? numero(pasos.length) : undefined} icono={ListOrdered} />
        <Cifra titulo="Tiempo total" valor={datos ? tiempo(datos.total_min) : undefined} detalle="Incluye reposos y curados" icono={Clock} />
        <Cifra titulo="Puntos de control" valor={datos ? numero(datos.control_points) : undefined} icono={ShieldCheck} />
      </div>
      <DataTable columns={columnas} rows={pasos} rowKey={(p) => p.id} loading={cargando} error={error} onRetry={recargar} onRowClick={edita ? setEditando : undefined}
        empty="La versión todavía no tiene pasos." toolbar={edita && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditando(null)}>Agregar paso</Button>} />
      {editando !== undefined && <PasoForm v={v} p={editando} onClose={() => setEditando(undefined)} onGuardado={() => { setEditando(undefined); recargar(); }} />}
    </div>
  );
}

function PasoForm({ v, p, onClose, onGuardado }: { v: Version; p: Paso | null; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ description: p?.description ?? "", duration_min: p?.duration_min?.toString() ?? "", equipment_category: p?.equipment_category ?? "" });
  return (
    <Dialogo titulo={p ? `Editar el paso ${p.seq}` : "Nuevo paso"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(p ? `/v1/rec/versiones/${v.id}/pasos/${p.id}` : `/v1/rec/versiones/${v.id}/pasos`, { method: p ? "PUT" : "POST",
          body: { description: f.description, duration_min: num(f.duration_min), equipment_category: f.equipment_category || null } });
        toast.ok("Paso guardado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Descripción" required error={e.description} className="sm:col-span-2">
          <Textarea rows={3} maxLength={1000} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} placeholder="Moler recortes y grasa con disco de 8 mm, todo a menos de 4 °C" />
        </Field>
        <Field label="Tiempo" error={e.duration_min} hint="En minutos (un reposo de 12 h son 720)"><Input inputMode="decimal" suffix="min" value={f.duration_min} onChange={(x) => setF({ ...f, duration_min: x.target.value })} /></Field>
        <Field label="Equipo" error={e.equipment_category}><Select value={f.equipment_category} placeholder="Ninguno" options={lista(EQUIPO)} onChange={(x) => setF({ ...f, equipment_category: x.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}
