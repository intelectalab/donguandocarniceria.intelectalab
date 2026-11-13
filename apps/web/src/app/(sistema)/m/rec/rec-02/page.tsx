"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CopyPlus, Plus, Save, Send, Trash2, X } from "lucide-react";
import { Alert, Button, Cifra, DetailList, Field, IconButton, Input, PageHeader, Select, StatusBadge, Textarea, buttonClass, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Alergenos, AvisoCerrada, NavVersion, SelectorVersion, accion, num, useOpcionesRec, useVersion, useVersionElegida } from "@/modulos/rec/comunes";
import { CONSERVACION, VERSION, lista, type Opciones, type Version } from "@/modulos/rec/tipos";

/** REC-02 Editor de versión: kg base de salida, rendimiento esperado calculado, vida útil, conservación, notas y empaques. Solo se edita en borrador. */
export default function EditorVersion() {
  const { can } = useSesion();
  const op = useOpcionesRec();
  const sel = useVersionElegida();
  const { datos: v, error, recargar } = useVersion(sel.id);
  return (
    <div className="space-y-5">
      <PageHeader description="Kg base de salida, rendimiento esperado (kg base / kg de ingredientes × 100), vida útil, conservación y notas. Solo se edita en borrador; una versión aprobada no cambia." />
      <SelectorVersion id={sel.id} lista={sel.lista} onChange={sel.elegir} version={v} />
      {error && <Alert tone="bad">{error}</Alert>}
      {v && op && <Editor key={`${v.id}-${v.status}`} v={v} op={op} costos={can("rec.cost.view")} onCambio={recargar} />}
    </div>
  );
}

function Editor({ v, op, costos, onCambio }: { v: Version; op: Opciones; costos: boolean; onCambio: () => void }) {
  const { can, puede } = useSesion();
  const router = useRouter();
  const edita = v.status === "DRAFT" && can("rec.version.edit") && puede("REC", "E");
  const [f, setF] = useState({ base_output_kg: String(Number(v.base_output_kg)), shelf_life_days: v.shelf_life_days?.toString() ?? "", storage: v.storage, notes: v.notes ?? "" });
  const [empaques, setEmpaques] = useState(v.packaging.map((p) => ({ variant_id: p.variant_id, per: p.per, qty: String(p.qty ?? "") })));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const total = Number(v.total_kg ?? 0);
  const base = num(f.base_output_kg) ?? 0;
  const rend = total > 0 ? Math.round((base / total) * 10000) / 100 : null;
  const enRango = rend !== null && rend >= 1 && rend <= op.max_yield_pct;
  const nombreEmpaque = (id: string) => op.packaging.find((p) => p.id === id)?.name ?? op.inputs.find((p) => p.id === id)?.name ?? "Empaque";

  async function guardar() {
    setGuardando(true); setErrores({});
    try {
      await api(`/v1/rec/versiones/${v.id}`, { method: "PUT", body: {
        base_output_kg: num(f.base_output_kg), shelf_life_days: f.shelf_life_days === "" ? null : Number(f.shelf_life_days), storage: f.storage, notes: f.notes,
        packaging: empaques.filter((p) => p.variant_id).map((p) => ({ ...p, qty: num(p.qty) })) } });
      toast.ok("Versión guardada");
      onCambio();
    } catch (e) {
      const c = erroresDe(e); setErrores(c);
      toast.error(Object.keys(c).length ? "Revisa los datos marcados." : mensajeDe(e));
    } finally { setGuardando(false); }
  }
  async function nuevaDesdeEsta() {
    try {
      const n = await api<{ id: string; version: number }>(`/v1/rec/recetas/${v.recipe_id}/versiones`, { method: "POST", body: { from_version_id: v.id } });
      toast.ok(`Versión ${n.version} creada en borrador`);
      router.push(`/m/rec/rec-02?v=${n.id}`);
    } catch (e) { toast.error(mensajeDe(e)); }
  }

  return (
    <div className="space-y-5">
      <NavVersion v={v} actual="rec-02" costos={costos} />
      <AvisoCerrada v={v} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Kg de ingredientes por lote" valor={numero(total, 4)} detalle="Suma de los ingredientes" />
        <Cifra destacada titulo="Rendimiento esperado" valor={rend !== null ? porcentaje(rend, 2) : "—"} tono={rend === null ? undefined : enRango ? "ok" : "bad"}
          detalle={`${numero(base, 3)} / ${numero(total, 4)} × 100 · rango 1 %–${numero(op.max_yield_pct)} %`} />
        <Cifra titulo="Merma esperada" valor={rend !== null ? kg(Math.max(0, total - base)) : "—"} detalle={rend !== null && rend > 100 ? "Absorbe agua o caldo" : "Ingredientes − salida"} />
        {costos
          ? <Cifra titulo="Costo estándar por kg" valor={soles(v.standard_cost_per_kg ?? v.live_cost_per_kg ?? null)} detalle={v.standard_cost_per_kg ? "Fijado al aprobar" : "Con el costo promedio de hoy"} />
          : <Cifra titulo="Vida útil" valor={v.shelf_life_days ? `${v.shelf_life_days} días` : "Sin definir"} tono={v.shelf_life_days ? undefined : "warn"} />}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold">Datos de la versión</h2>
            <div className="flex flex-wrap gap-2">
              {v.status === "DRAFT" && can("rec.version.edit") && <Button size="sm" icon={Send} onClick={() => accion({ title: `¿Enviar v${v.version} a revisión?`, message: "Calidad recibe el aviso. Mientras está en revisión no se edita.", confirmLabel: "Enviar" },
                () => api(`/v1/rec/versiones/${v.id}/enviar`, { method: "POST" }), "Versión enviada a revisión", onCambio)}>Enviar a revisión</Button>}
              {v.status === "IN_REVIEW" && <Link className={buttonClass("primary", "sm")} href={`/m/rec/rec-07?v=${v.id}`}>Revisar y aprobar</Link>}
              {can("rec.version.edit") && (v.status === "APPROVED" || v.status === "RETIRED") && <Button size="sm" icon={CopyPlus} onClick={nuevaDesdeEsta}>Nueva versión desde esta</Button>}
              {edita && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => accion({ title: `¿Borrar el borrador v${v.version}?`, message: "Se borran sus ingredientes, pasos y puntos de control.", danger: true, confirmLabel: "Borrar" },
                () => api(`/v1/rec/versiones/${v.id}`, { method: "DELETE" }), "Borrador borrado", () => router.push("/m/rec/rec-01"))}>Borrar</Button>}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Kg base de salida" required error={errores.base_output_kg}>
              <Input inputMode="decimal" suffix="kg" disabled={!edita} value={f.base_output_kg} onChange={(e) => setF({ ...f, base_output_kg: e.target.value })} />
            </Field>
            <Field label="Vida útil" error={errores.shelf_life_days} hint="Obligatoria para aprobar (RN-REC-10)">
              <Input inputMode="numeric" suffix="días" disabled={!edita} value={f.shelf_life_days} onChange={(e) => setF({ ...f, shelf_life_days: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="Conservación" required error={errores.storage}>
              <Select disabled={!edita} value={f.storage} options={lista(CONSERVACION)} onChange={(e) => setF({ ...f, storage: e.target.value })} />
            </Field>
            <Field label="Notas de la versión" error={errores.notes} className="sm:col-span-3">
              <Textarea rows={3} disabled={!edita} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Qué cambia frente a la versión anterior y por qué" />
            </Field>
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">Empaques por lote</h3>
            {empaques.length === 0 && <p className="text-[13px] text-muted">Sin empaques.</p>}
            <ul className="space-y-2">
              {empaques.map((p, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_6rem_auto] items-center gap-2">
                  {edita
                    ? <Select aria-label="Empaque" value={p.variant_id} placeholder="Elegir" options={op.packaging.map((x) => ({ value: x.id, label: `${x.sku} · ${x.name}` }))}
                      onChange={(e) => setEmpaques(empaques.map((y, j) => (j === i ? { ...y, variant_id: e.target.value } : y)))} />
                    : <span className="truncate text-[13px]">{nombreEmpaque(p.variant_id)}</span>}
                  <Select aria-label="Base" disabled={!edita} value={p.per} options={[{ value: "UNIT", label: "Por unidad" }, { value: "KG", label: "Por kg" }]}
                    onChange={(e) => setEmpaques(empaques.map((y, j) => (j === i ? { ...y, per: e.target.value as "KG" | "UNIT" } : y)))} />
                  <Input aria-label="Cantidad" inputMode="decimal" disabled={!edita} value={p.qty} onChange={(e) => setEmpaques(empaques.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
                  {edita ? <IconButton icon={X} label="Quitar empaque" onClick={() => setEmpaques(empaques.filter((_, j) => j !== i))} /> : <span />}
                </li>
              ))}
            </ul>
            {edita && <Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => setEmpaques([...empaques, { variant_id: "", per: "UNIT", qty: "1" }])}>Agregar empaque</Button>}
          </div>
          {edita && <div className="flex justify-end"><Button variant="primary" icon={Save} loading={guardando} onClick={guardar}>Guardar</Button></div>}
        </section>
        <section className="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold">Historial de la versión</h2>
          <DetailList items={[
            { label: "Estado", value: <StatusBadge status={v.status} labels={VERSION} /> },
            { label: "Creada por", value: v.created_by_name ?? "—" },
            { label: "Aprobada", value: v.approved_at ? `${fechaHora(v.approved_at)} · ${v.approved_by_name ?? ""}` : "—" },
            { label: "Retirada", value: v.retired_at ? `${fechaHora(v.retired_at)} · ${v.retired_by_name ?? ""}` : "—" },
          ]} />
          <div>
            <p className="mb-1 text-[12px] text-muted">Alérgenos {v.status === "APPROVED" || v.status === "RETIRED" ? "(fijados al aprobar)" : "(de sus ingredientes)"}</p>
            <Alergenos lista={v.status === "APPROVED" || v.status === "RETIRED" ? v.allergens : v.live_allergens} />
          </div>
          {v.approval_warnings && <Alert tone="warn" title="Advertencias al aprobar"><span className="whitespace-pre-line">{v.approval_warnings}</span></Alert>}
          <ol className="space-y-3 border-l border-line pl-4">
            {v.history.slice().reverse().map((h, i) => (
              <li key={i} className="text-[13px]">
                <p><span className="font-semibold">{h.action}</span> <span className="text-[12px] text-muted">{fechaHora(h.at)}{h.user ? ` · ${h.user}` : ""}</span></p>
                {h.detail && <p className="text-[12.5px] text-muted">{h.detail}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
