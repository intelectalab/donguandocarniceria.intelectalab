"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, ClipboardCheck, FilePen, Plus, TrendingUp } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, buttonClass, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { Alergenos, CifraLink, FiltroSelect, qs, useDatos, useOpcionesRec } from "@/modulos/rec/comunes";
import { TIPO, TIPOS, VERSION, type Num, type Opciones } from "@/modulos/rec/tipos";

type Fila = {
  id: string; code: string; name: string; recipe_type: string; status: string; brand_id: string; brand_name: string; product_name: string; line_code: string | null;
  current_id: string | null; current_version: number | null; current_yield_pct: Num; current_cost_per_kg: Num; current_recalc_cost_per_kg: Num;
  current_allergens: string[] | null; pending_id: string | null; pending_version: number | null; pending_status: string | null;
};
type Cifras = { active: number; with_current: number; in_review: number; drafts: number; cost_alerts: number | null; cost_alert_pct: number; control_points: number };
type Receta = {
  id: string; code: string; name: string; recipe_type: string; status: string; brand_name: string; product_name: string; output_variant_id: string | null;
  output_variant_name: string | null; line_code: string | null; product_id: string;
  versions: { id: string; version: number; status: string; base_output_kg: Num; expected_yield_pct: Num; standard_cost_per_kg: Num; approved_at: string | null;
    approved_by_name: string | null; retired_at: string | null; created_by_name: string | null }[];
};

/** REC-01 Recetas: lista por producto, tipo, marca y estado de la versión vigente, con su costo estándar por kg. */
export default function Recetas() {
  const { marca, can, puede } = useSesion();
  const op = useOpcionesRec();
  const [tipo, setTipo] = useState("");
  const [vigente, setVigente] = useState("");
  const lista = useListado<Fila>("/v1/rec/recetas", { orden: "code", filtros: { recipe_type: tipo, vigente, brand: marca } });
  const c = useDatos<Cifras>(`/v1/rec/cifras/01${qs({ brand: marca })}`);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const costos = can("rec.cost.view");
  const edita = can("rec.version.edit") && puede("REC", "C");

  if (op && !op.see_recipe) {
    return <Alert tone="info" title="Receta reservada">En producción ves los kg de tu orden en la orden de producción; la receta completa y su costo los ven el jefe de producción y Calidad.</Alert>;
  }

  const columnas: Column<Fila>[] = [
    { key: "code", header: "Código", sortable: true, render: (f) => <span className="font-mono font-semibold">{f.code}</span> },
    { key: "name", header: "Receta", sortable: true, cardTitle: true, render: (f) => <div className="min-w-[160px]"><p className="font-medium">{f.name}</p><p className="text-[12px] text-muted">{f.product_name}</p></div> },
    { key: "brand_name", header: "Marca", sortable: true, hideOnMobile: true, render: (f) => f.brand_name },
    { key: "recipe_type", header: "Tipo", sortable: true, render: (f) => TIPO[f.recipe_type] ?? f.recipe_type },
    { key: "current_version", header: "Vigente", render: (f) => f.current_id ? <span className="whitespace-nowrap">v{f.current_version} <StatusBadge status="APPROVED" labels={VERSION} /></span> : <Badge tone="warn">Sin aprobar</Badge> },
    { key: "pending_version", header: "En curso", render: (f) => f.pending_id ? <span className="whitespace-nowrap">v{f.pending_version} <StatusBadge status={f.pending_status} labels={VERSION} /></span> : <span className="text-muted">—</span> },
    { key: "current_yield_pct", header: "Rend. esperado", sortable: true, align: "right", render: (f) => porcentaje(f.current_yield_pct, 2) },
    ...(costos ? [{ key: "current_cost_per_kg", header: "Costo est. por kg", sortable: true, align: "right", render: (f: Fila) => f.current_cost_per_kg !== null ? soles(f.current_cost_per_kg) : "—" }] as Column<Fila>[] : []),
    { key: "current_allergens", header: "Alérgenos", hideOnMobile: true, render: (f) => f.current_allergens ? <Alergenos lista={f.current_allergens} /> : <span className="text-muted">—</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="La receta oficial de cada producto terminado: su versión vigente, la versión en curso y el costo estándar por kg con el costo promedio real de cada insumo."
        actions={edita && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNueva(true)}>Nueva receta</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Recetas activas" valor={c.datos ? numero(c.datos.active) : undefined} detalle={c.datos ? `${c.datos.with_current} con versión aprobada` : undefined} icono={BookOpen}
          onClick={() => setVigente("")} />
        <CifraLink titulo="En revisión" valor={c.datos ? numero(c.datos.in_review) : undefined} detalle="Esperan la aprobación de Calidad" icono={ClipboardCheck}
          tono={c.datos?.in_review ? "warn" : undefined} href="/m/rec/rec-07" />
        <CifraLink titulo="Borradores" valor={c.datos ? numero(c.datos.drafts) : undefined} detalle="Versiones en edición" icono={FilePen} />
        {costos
          ? <CifraLink titulo={`Costo que varió más de ${c.datos?.cost_alert_pct ?? 5} %`} valor={c.datos?.cost_alerts !== undefined && c.datos?.cost_alerts !== null ? numero(c.datos.cost_alerts) : undefined}
            detalle="KPI-REC-01 · último recálculo" icono={TrendingUp} tono={c.datos?.cost_alerts ? "warn" : "ok"} href="/m/rec/rec-09" />
          : <CifraLink titulo="Puntos de control" valor={c.datos ? numero(c.datos.control_points) : undefined} detalle="En todas las versiones" icono={ClipboardCheck} />}
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(f) => setAbierta(f.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar código, receta, producto o marca…" }} empty="No hay recetas con esos filtros."
        toolbar={<>
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={TIPOS} />
          <FiltroSelect label="Versión vigente" value={vigente} onChange={setVigente} ancho="sm:w-[200px]"
            options={[{ value: "SI", label: "Con versión aprobada" }, { value: "NO", label: "Sin versión aprobada" }]} />
        </>} />
      {abierta && <FichaReceta id={abierta} op={op} onClose={() => setAbierta(null)} onCambio={() => { lista.recargar(); c.recargar(); }} />}
      {nueva && op && <NuevaReceta op={op} onClose={() => setNueva(false)} />}
    </div>
  );
}

function FichaReceta({ id, op, onClose, onCambio }: { id: string; op: Opciones | null; onClose: () => void; onCambio: () => void }) {
  const { can, puede } = useSesion();
  const router = useRouter();
  const { datos: r, error, recargar } = useDatos<Receta>(`/v1/rec/recetas/${id}`);
  const [editando, setEditando] = useState(false);
  const [creando, setCreando] = useState(false);
  const edita = can("rec.version.edit") && puede("REC", "E");
  const costos = can("rec.cost.view");
  const vigente = r?.versions.find((v) => v.status === "APPROVED");
  const enCurso = r?.versions.find((v) => v.status === "DRAFT" || v.status === "IN_REVIEW");
  async function nuevaVersion() {
    if (!r) return;
    setCreando(true);
    try {
      const v = await api<{ id: string; version: number }>(`/v1/rec/recetas/${r.id}/versiones`, { method: "POST", body: {} });
      toast.ok(`Versión ${v.version} creada en borrador`);
      router.push(`/m/rec/rec-02?v=${v.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear la versión.");
    } finally { setCreando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={r ? `${r.code} · ${r.name}` : "Receta"}
      footer={r && <>
        {edita && <Button onClick={() => setEditando(true)}>Editar receta</Button>}
        {vigente && <Link className={buttonClass("secondary")} href={`/m/rec/rec-08?v=${vigente.id}`}>Escalar</Link>}
        {vigente && <Link className={buttonClass("secondary")} href={`/m/rec/rec-10?v=${vigente.id}`}>Ficha técnica</Link>}
        {edita && !enCurso && <Button variant="primary" icon={Plus} loading={creando} onClick={nuevaVersion}>Nueva versión</Button>}
        {enCurso && <Link className={buttonClass("primary")} href={`/m/rec/rec-02?v=${enCurso.id}`}>Abrir v{enCurso.version}</Link>}
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {r && <div className="space-y-5">
        <DetailList items={[
          { label: "Producto", value: r.product_name }, { label: "Marca", value: r.brand_name }, { label: "Tipo", value: TIPO[r.recipe_type] ?? r.recipe_type },
          { label: "Presentación por defecto", value: r.output_variant_name ?? "—" }, { label: "Línea de producción", value: r.line_code ?? "—" },
          { label: "Estado", value: <StatusBadge status={r.status} /> },
        ]} />
        <section>
          <h2 className="mb-2 text-[14px] font-semibold">Versiones</h2>
          <DataTable rows={r.versions} rowKey={(v) => v.id} onRowClick={(v) => router.push(`/m/rec/rec-02?v=${v.id}`)} columns={[
            { key: "version", header: "Versión", cardTitle: true, render: (v) => <span className="font-semibold">v{v.version}</span> },
            { key: "status", header: "Estado", render: (v) => <StatusBadge status={v.status} labels={VERSION} /> },
            { key: "base_output_kg", header: "Kg base", align: "right", render: (v) => numero(v.base_output_kg, 3) },
            { key: "expected_yield_pct", header: "Rend.", align: "right", render: (v) => porcentaje(v.expected_yield_pct, 2) },
            ...(costos ? [{ key: "standard_cost_per_kg", header: "Costo por kg", align: "right" as const, render: (v: Receta["versions"][number]) => soles(v.standard_cost_per_kg) }] : []),
            { key: "approved_at", header: "Aprobada", render: (v) => v.approved_at ? `${fecha(v.approved_at)} · ${v.approved_by_name ?? ""}` : "—" },
            { key: "retired_at", header: "Retirada", hideOnMobile: true, render: (v) => fecha(v.retired_at) },
          ]} />
        </section>
      </div>}
      {editando && r && op && <EditarReceta r={r} op={op} onClose={() => setEditando(false)} onGuardado={() => { setEditando(false); recargar(); onCambio(); }} />}
    </Modal>
  );
}

function EditarReceta({ r, op, onClose, onGuardado }: { r: Receta; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ name: r.name, recipe_type: r.recipe_type, line_code: r.line_code ?? "", output_variant_id: r.output_variant_id ?? "", status: r.status });
  return (
    <Dialogo titulo={`Editar ${r.code}`} boton="Guardar" onClose={onClose} aviso="El contenido de la receta (ingredientes, pasos y controles) se cambia en una versión."
      enviar={async () => { await api(`/v1/rec/recetas/${r.id}`, { method: "PUT", body: { ...f, line_code: f.line_code || null, output_variant_id: f.output_variant_id || null } }); toast.ok("Receta guardada"); onGuardado(); }}>
      {(e) => <>
        <Field label="Nombre" required error={e.name} className="sm:col-span-2"><Input value={f.name} maxLength={80} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Tipo" required error={e.recipe_type}><Select value={f.recipe_type} options={TIPOS} onChange={(x) => setF({ ...f, recipe_type: x.target.value })} /></Field>
        <Field label="Estado" error={e.status}><Select value={f.status} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} onChange={(x) => setF({ ...f, status: x.target.value })} /></Field>
        <Field label="Presentación por defecto" error={e.output_variant_id}>
          <Select value={f.output_variant_id} placeholder="Elegir" options={op.output_variants.filter((v) => v.product_id === r.product_id).map((v) => ({ value: v.id, label: `${v.sku} · ${v.name}` }))}
            onChange={(x) => setF({ ...f, output_variant_id: x.target.value })} />
        </Field>
        <Field label="Línea de producción" error={e.line_code} hint="Por ejemplo L1-EMB"><Input value={f.line_code} maxLength={20} list="rec-lineas" onChange={(x) => setF({ ...f, line_code: x.target.value.toUpperCase() })} /></Field>
        <datalist id="rec-lineas">{op.lines.map((l) => <option key={l} value={l} />)}</datalist>
      </>}
    </Dialogo>
  );
}

/** Formulario de nueva receta: crea la receta y su versión 1 en borrador, y abre sus ingredientes. */
function NuevaReceta({ op, onClose }: { op: Opciones; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ product_id: "", code: "RC-", name: "", recipe_type: "SAUSAGE", line_code: "", output_variant_id: "", base_output_kg: "10" });
  const producto = op.products.find((p) => p.id === f.product_id);
  const presentaciones = op.output_variants.filter((v) => v.product_id === f.product_id);
  return (
    <Dialogo titulo="Nueva receta" boton="Crear receta y versión 1" onClose={onClose}
      aviso="La versión 1 nace en borrador con la vida útil y conservación del producto. Luego agregas ingredientes, pasos y puntos de control y la envías a revisión."
      enviar={async () => {
        const r = await api<{ version: { id: string }; recipe: { code: string } }>("/v1/rec/recetas", { method: "POST", body: {
          ...f, base_output_kg: f.base_output_kg.replace(",", "."), line_code: f.line_code || null, output_variant_id: f.output_variant_id || null } });
        toast.ok(`Receta ${r.recipe.code} creada: agrega sus ingredientes`);
        router.push(`/m/rec/rec-03?v=${r.version.id}`);
      }}>
      {(e) => <>
        <Field label="Producto terminado" required error={e.product_id} className="sm:col-span-2">
          <Select value={f.product_id} placeholder="Elegir" searchable options={op.products.map((p) => ({ value: p.id, label: `${p.name} · ${p.brand_name}` }))}
            onChange={(x) => { const p = op.products.find((y) => y.id === x.target.value); setF({ ...f, product_id: x.target.value, output_variant_id: "", name: f.name || (p?.name ?? "") }); }} />
        </Field>
        <Field label="Código" required error={e.code} hint="RC- y tres letras"><Input value={f.code} maxLength={40} onChange={(x) => setF({ ...f, code: x.target.value.toUpperCase() })} /></Field>
        <Field label="Nombre" required error={e.name}><Input value={f.name} maxLength={80} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Tipo" required error={e.recipe_type} hint="Embutidos, caldos, mermeladas, mantecas y curados necesitan un punto crítico">
          <Select value={f.recipe_type} options={TIPOS} onChange={(x) => setF({ ...f, recipe_type: x.target.value })} />
        </Field>
        <Field label="Kg base de salida" required error={e.base_output_kg} hint="Lo que sale de un lote base">
          <Input inputMode="decimal" value={f.base_output_kg} suffix="kg" onChange={(x) => setF({ ...f, base_output_kg: x.target.value })} />
        </Field>
        <Field label="Presentación por defecto" error={e.output_variant_id}>
          <Select value={f.output_variant_id} placeholder={f.product_id ? "La primera del producto" : "Elige el producto"} disabled={!f.product_id}
            options={presentaciones.map((v) => ({ value: v.id, label: `${v.sku} · ${v.name}` }))} onChange={(x) => setF({ ...f, output_variant_id: x.target.value })} />
        </Field>
        <Field label="Línea de producción" error={e.line_code}><Input value={f.line_code} maxLength={20} list="rec-lineas-n" onChange={(x) => setF({ ...f, line_code: x.target.value.toUpperCase() })} /></Field>
        <datalist id="rec-lineas-n">{op.lines.map((l) => <option key={l} value={l} />)}</datalist>
        {producto && <p className="text-[12.5px] text-muted sm:col-span-2">Vida útil del producto: {producto.shelf_life_days ?? "—"} días · marca {producto.brand_name}.</p>}
      </>}
    </Dialogo>
  );
}
