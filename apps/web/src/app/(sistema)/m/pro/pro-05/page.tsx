"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Checkbox, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { kg, numero, porcentaje } from "@/lib/formato";
import { Seccion, num, useAlAbrir, useOpcionesPro } from "@/modulos/pro/comunes";
import { TIPO_ORDEN, opciones } from "@/modulos/pro/tipos";

/** PRO-05 Nueva orden: receta (versión activa), despiece (plantilla) o envasado, en una línea del local, con su supervisor. */
export default function NuevaOrden() {
  const router = useRouter();
  const op = useOpcionesPro();
  const [f, setF] = useState({ order_type: "RECIPE", line_id: "", recipe_id: "", cutting_template_id: "", source_variant_id: "", output_variant_id: "", planned_output_kg: "",
    planned_date: "", supervisor_user_id: "", notes: "", release: false });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  useAlAbrir((p) => { const r = p.get("recipe"); if (r) setF((x) => ({ ...x, recipe_id: r, planned_output_kg: p.get("kg") ?? "" })); });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const receta = op?.recipes.find((r) => r.id === f.recipe_id);
  const plantilla = op?.templates.find((t) => t.id === f.cutting_template_id);
  const lineas = (op?.lines ?? []).filter((l) => (f.order_type === "CUTTING" ? l.line_type === "CUTTING" : f.order_type === "PACKING" ? l.line_type === "VACUUM_PACK" || l.line_type === "OTHER" : l.line_type !== "CUTTING"));
  const factor = receta && num(f.planned_output_kg) ? (num(f.planned_output_kg) ?? 0) / Number(receta.base_output_kg) : null;

  async function enviar() {
    setEnviando(true); setError(""); setErrores({});
    try {
      const o = await api<{ id: string; number: string }>("/v1/pro/ordenes", { method: "POST", body: {
        ...f, recipe_id: f.order_type === "RECIPE" ? f.recipe_id || null : null, cutting_template_id: f.order_type === "CUTTING" ? f.cutting_template_id || null : null,
        source_variant_id: f.order_type === "PACKING" ? f.source_variant_id || null : null, output_variant_id: f.order_type === "PACKING" ? f.output_variant_id || null : null,
        planned_output_kg: num(f.planned_output_kg), planned_date: f.planned_date || null, supervisor_user_id: f.supervisor_user_id || null, notes: f.notes || null } });
      toast.ok(`Orden ${o.number} creada${f.release ? " y liberada" : ""}`);
      router.push(`/m/pro/pro-11?id=${o.id}`);
    } catch (e) {
      const c = erroresDe(e); setErrores(c); if (!Object.keys(c).length) setError(mensajeDe(e));
    } finally { setEnviando(false); }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader description="La orden toma la versión activa de la receta o de la plantilla de despiece. Liberarla reserva los insumos con FEFO." />
      <Seccion titulo="Datos de la orden">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
          <Field label="Tipo" required error={errores.order_type}><Select value={f.order_type} options={opciones(TIPO_ORDEN)} onChange={(e) => setF({ ...f, order_type: e.target.value, line_id: "" })} /></Field>
          <Field label="Línea" required error={errores.line_id}><Select value={f.line_id} placeholder="Elegir" options={lineas.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} onChange={(e) => set("line_id", e.target.value)} /></Field>
          {f.order_type === "RECIPE" && <Field label="Receta" required error={errores.recipe_id} className="sm:col-span-2">
            <Select value={f.recipe_id} searchable placeholder="Elegir" options={(op?.recipes ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name} (v${r.version}, lote base ${numero(r.base_output_kg)} kg)` }))} onChange={(e) => set("recipe_id", e.target.value)} />
          </Field>}
          {f.order_type === "CUTTING" && <Field label="Plantilla de despiece" required error={errores.cutting_template_id} className="sm:col-span-2">
            <Select value={f.cutting_template_id} placeholder="Elegir" options={(op?.templates ?? []).map((t) => ({ value: t.id, label: `${t.code} · ${t.name} (v${t.version})` }))} onChange={(e) => set("cutting_template_id", e.target.value)} />
          </Field>}
          {f.order_type === "PACKING" && <>
            <Field label="Producto a envasar" required error={errores.source_variant_id}><Select value={f.source_variant_id} searchable placeholder="Elegir" options={(op?.variants ?? []).map((v) => ({ value: v.id, label: `${v.sku} · ${v.name}` }))} onChange={(e) => set("source_variant_id", e.target.value)} /></Field>
            <Field label="Presentación que sale" required error={errores.output_variant_id}><Select value={f.output_variant_id} searchable placeholder="Elegir" options={(op?.variants ?? []).map((v) => ({ value: v.id, label: `${v.sku} · ${v.name}` }))} onChange={(e) => set("output_variant_id", e.target.value)} /></Field>
          </>}
          <Field label={f.order_type === "CUTTING" ? "Kg de entrada planificados" : "Kg a producir"} required error={errores.planned_output_kg}
            hint={factor ? `${numero(factor, 2)} veces el lote base · rendimiento esperado ${porcentaje(receta?.expected_yield_pct, 1)}` : plantilla ? `Entra ${plantilla.input_variant_name}` : undefined}>
            <Input inputMode="decimal" suffix="kg" value={f.planned_output_kg} onChange={(e) => set("planned_output_kg", e.target.value)} />
          </Field>
          <Field label="Fecha" error={errores.planned_date}><Input type="date" value={f.planned_date} onChange={(e) => set("planned_date", e.target.value)} /></Field>
          <Field label="Supervisor" error={errores.supervisor_user_id} hint="Quien supervisa no libera el lote en Calidad"><Select value={f.supervisor_user_id} placeholder="Yo" options={(op?.supervisors ?? []).map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => set("supervisor_user_id", e.target.value)} /></Field>
          <Field label="Notas" error={errores.notes} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <div className="sm:col-span-2"><Checkbox checked={f.release} onChange={(v) => set("release", v)} label="Liberarla ahora" hint="Reserva los insumos y la deja lista para empezar" /></div>
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={() => router.back()}>Cancelar</Button>
            <Button type="submit" variant="primary" loading={enviando}>Crear orden{f.planned_output_kg ? ` de ${kg(num(f.planned_output_kg))}` : ""}</Button>
          </div>
        </form>
      </Seccion>
    </div>
  );
}
