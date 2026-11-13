"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, IconButton, Input, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { Alergenos, AvisoCerrada, NavVersion, SelectorVersion, accion, num, useDatos, useOpcionesRec, useVersion, useVersionElegida } from "@/modulos/rec/comunes";
import type { Check, Num, Opciones, Version } from "@/modulos/rec/tipos";

type Ingrediente = {
  id: string; seq: number; variant_id: string; sku: string; name: string; qty_kg: string; pct: string; weighing_tolerance_pct: string; is_additive: boolean;
  additive_id: string | null; sin_code: string | null; additive_name: string | null; max_ppm: Num; ppm: string | null; over_limit: boolean; allergen: string | null;
  additive_allergen: string | null; cost: Num; amount: Num; cost_source: string | null;
};
type Respuesta = { data: Ingrediente[]; total_kg: string; allergens: string[]; checks: Check[]; total_cost: Num };

/** REC-03 Ingredientes: kg por lote base, tolerancia de pesaje, alérgeno y, si es aditivo, su código SIN y su dosis en ppm. */
export default function Ingredientes() {
  const { can } = useSesion();
  const op = useOpcionesRec();
  const sel = useVersionElegida();
  const v = useVersion(sel.id);
  return (
    <div className="space-y-5">
      <PageHeader description="Producto o insumo con sus kg por lote base y la tolerancia de pesaje. Un aditivo va con su código SIN del catálogo; su dosis es kg del aditivo / kg totales × 1 000 000 y no supera el límite cargado por Calidad." />
      <SelectorVersion id={sel.id} lista={sel.lista} onChange={sel.elegir} version={v.datos} />
      {v.error && <Alert tone="bad">{v.error}</Alert>}
      {v.datos && op && <Lista key={v.datos.id} v={v.datos} op={op} costos={can("rec.cost.view")} onCambio={v.recargar} />}
    </div>
  );
}

function Lista({ v, op, costos, onCambio }: { v: Version; op: Opciones; costos: boolean; onCambio: () => void }) {
  const { can, puede } = useSesion();
  const { datos, cargando, error, recargar } = useDatos<Respuesta>(`/v1/rec/versiones/${v.id}/ingredientes`);
  const [editando, setEditando] = useState<Ingrediente | null | undefined>(undefined);
  const edita = v.status === "DRAFT" && can("rec.version.edit") && puede("REC", "E");
  const hecho = () => { recargar(); onCambio(); };

  const columnas: Column<Ingrediente>[] = [
    { key: "seq", header: "#", align: "right", hideOnMobile: true, render: (i) => i.seq },
    { key: "name", header: "Ingrediente", cardTitle: true, render: (i) => <div className="min-w-[160px]"><p>{i.name}</p><p className="font-mono text-[12px] text-muted">{i.sku}</p></div> },
    { key: "qty_kg", header: "Kg por lote", align: "right", render: (i) => <span className="tabular-nums">{numero(i.qty_kg, 4)}</span> },
    { key: "pct", header: "% del total", align: "right", render: (i) => porcentaje(i.pct, 2) },
    { key: "weighing_tolerance_pct", header: "Tolerancia", align: "right", hideOnMobile: true, render: (i) => `± ${porcentaje(i.weighing_tolerance_pct, 1)}` },
    { key: "sin_code", header: "Aditivo", render: (i) => !i.is_additive ? <span className="text-muted">—</span> : i.sin_code ? `SIN ${i.sin_code} · ${i.additive_name}` : <Badge tone="bad">Sin SIN</Badge> },
    { key: "ppm", header: "Dosis", align: "right", render: (i) => i.ppm === null ? <span className="text-muted">—</span>
      : <span className={i.over_limit ? "font-bold text-bad" : ""}>{numero(i.ppm, 0)} ppm{i.max_ppm !== null ? <span className="block text-[11.5px] font-normal text-muted">límite {numero(i.max_ppm, 0)}</span> : <span className="block text-[11.5px] font-normal text-warn">sin límite</span>}</span> },
    { key: "allergen", header: "Alérgeno", render: (i) => i.allergen || i.additive_allergen ? <Badge tone="warn">{i.allergen ?? i.additive_allergen}</Badge> : <span className="text-muted">—</span> },
    ...(costos ? [
      { key: "cost", header: "Costo prom.", align: "right", hideOnMobile: true, render: (i: Ingrediente) => <span title={i.cost_source === "STANDARD" ? "Sin stock: costo estándar" : "Costo promedio del stock"}>{soles(i.cost)}</span> },
      { key: "amount", header: "Importe", align: "right", render: (i: Ingrediente) => soles(i.amount) },
    ] as Column<Ingrediente>[] : []),
    ...(edita ? [{ key: "acciones", header: "", align: "right", hideInCard: true, render: (i: Ingrediente) => (
      <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
        <IconButton icon={Pencil} label={`Editar ${i.name}`} onClick={() => setEditando(i)} />
        <IconButton icon={Trash2} label={`Quitar ${i.name}`} onClick={() => accion({ title: `¿Quitar ${i.name}?`, danger: true, confirmLabel: "Quitar" },
          () => api(`/v1/rec/ingredientes/${i.id}`, { method: "DELETE" }), "Ingrediente quitado", hecho)} />
      </span>) }] as Column<Ingrediente>[] : []),
  ];

  const avisos = datos?.checks ?? [];
  return (
    <div className="space-y-5">
      <NavVersion v={v} actual="rec-03" costos={costos} />
      <AvisoCerrada v={v} />
      <DataTable columns={columnas} rows={datos?.data ?? []} rowKey={(i) => i.id} loading={cargando} error={error} onRetry={recargar}
        onRowClick={edita ? setEditando : undefined} empty="La versión todavía no tiene ingredientes."
        toolbar={<>
          <p className="text-[13px] text-muted">Total: <b className="text-ink tabular-nums">{numero(datos?.total_kg, 4)} kg</b> por lote base{costos && datos?.total_cost ? <> · <b className="text-ink">{soles(datos.total_cost)}</b></> : null}</p>
          {edita && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditando(null)}>Agregar ingrediente</Button>}
        </>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold">Alérgenos de la versión</h2>
          <Alergenos lista={datos?.allergens ?? []} />
          <p className="text-[12.5px] text-muted">Unión de los alérgenos de los ingredientes y aditivos; se fijan al aprobar y no se escriben a mano.</p>
        </section>
        <section className="space-y-2 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold">Validación de aditivos</h2>
          {avisos.length === 0 && <p className="text-[13px] text-muted">La versión no tiene aditivos.</p>}
          {avisos.map((c, i) => <Alert key={i} tone={c.level === "error" ? "bad" : c.level === "warn" ? "warn" : "ok"}>{c.msg}</Alert>)}
        </section>
      </div>
      {editando !== undefined && <IngredienteForm v={v} op={op} ing={editando} total={Number(datos?.total_kg ?? 0)} onClose={() => setEditando(undefined)} onGuardado={() => { setEditando(undefined); hecho(); }} />}
    </div>
  );
}

function IngredienteForm({ v, op, ing, total, onClose, onGuardado }: { v: Version; op: Opciones; ing: Ingrediente | null; total: number; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({
    variant_id: ing?.variant_id ?? "", qty_kg: ing ? String(Number(ing.qty_kg)) : "", weighing_tolerance_pct: ing ? String(Number(ing.weighing_tolerance_pct)) : "2",
    is_additive: ing?.is_additive ?? false, additive_id: ing?.additive_id ?? "", allergen: ing?.allergen ?? "",
  });
  const aditivo = op.additives.find((a) => a.id === f.additive_id);
  const kg = num(f.qty_kg) ?? 0;
  const totalNuevo = total - (ing ? Number(ing.qty_kg) : 0) + kg;
  const dosis = f.is_additive && totalNuevo > 0 ? (kg / totalNuevo) * 1_000_000 : null;
  const supera = dosis !== null && aditivo?.max_ppm !== null && aditivo?.max_ppm !== undefined && dosis > Number(aditivo.max_ppm);
  function elegirInsumo(id: string) {
    // Si el insumo es un aditivo del catálogo, se marca solo con su SIN.
    const a = op.additives.find((x) => x.variant_id === id && x.status === "ACTIVE");
    setF({ ...f, variant_id: id, is_additive: a ? true : f.is_additive, additive_id: a ? a.id : f.additive_id, allergen: f.allergen || (a?.allergen ?? "") });
  }
  return (
    <Dialogo titulo={ing ? `Editar ${ing.name}` : `Agregar ingrediente a v${v.version}`} boton={ing ? "Guardar" : "Agregar"} onClose={onClose}
      enviar={async () => {
        const body = { ...f, qty_kg: num(f.qty_kg), weighing_tolerance_pct: num(f.weighing_tolerance_pct), additive_id: f.is_additive ? f.additive_id || null : null, allergen: f.allergen || null };
        await api(ing ? `/v1/rec/versiones/${v.id}/ingredientes/${ing.id}` : `/v1/rec/versiones/${v.id}/ingredientes`, { method: ing ? "PUT" : "POST", body });
        toast.ok(ing ? "Ingrediente guardado" : "Ingrediente agregado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Producto o insumo" required error={e.variant_id} className="sm:col-span-2">
          <Select value={f.variant_id} placeholder="Elegir" searchable options={op.inputs.map((x) => ({ value: x.id, label: `${x.name} (${x.sku})` }))} onChange={(x) => elegirInsumo(x.target.value)} />
        </Field>
        <Field label="Kg por lote base" required error={e.qty_kg} hint="Hasta 4 decimales (0.0015)"><Input inputMode="decimal" suffix="kg" value={f.qty_kg} onChange={(x) => setF({ ...f, qty_kg: x.target.value })} /></Field>
        <Field label="Tolerancia de pesaje" error={e.weighing_tolerance_pct}><Input inputMode="decimal" suffix="%" value={f.weighing_tolerance_pct} onChange={(x) => setF({ ...f, weighing_tolerance_pct: x.target.value })} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={f.is_additive} onChange={(c) => setF({ ...f, is_additive: c })} label="Es aditivo" hint="Un aditivo exige su código SIN del catálogo" /></div>
        {f.is_additive && <Field label="Aditivo del catálogo" required error={e.additive_id} className="sm:col-span-2">
          <Select value={f.additive_id} placeholder="Elegir" options={op.additives.filter((a) => a.status === "ACTIVE" || a.id === f.additive_id).map((a) => ({ value: a.id, label: `SIN ${a.sin_code} · ${a.name}` }))}
            onChange={(x) => setF({ ...f, additive_id: x.target.value })} />
        </Field>}
        <Field label="Alérgeno" error={e.allergen} hint="Mostaza, apio, sulfitos, gluten…" className="sm:col-span-2"><Input value={f.allergen} maxLength={20} onChange={(x) => setF({ ...f, allergen: x.target.value })} /></Field>
        {dosis !== null && <div className="sm:col-span-2">
          <Alert tone={supera ? "bad" : aditivo?.max_ppm ? "ok" : "warn"} title={`Dosis: ${numero(dosis, 0)} ppm`}>
            {supera ? `Supera el límite de ${numero(aditivo?.max_ppm, 0)} ppm: la versión no se aprueba así.` : aditivo?.max_ppm ? `Dentro del límite de ${numero(aditivo.max_ppm, 0)} ppm.` : "Sin límite cargado: la aprobación avisa y queda registrada."}
          </Alert>
        </div>}
      </>}
    </Dialogo>
  );
}
