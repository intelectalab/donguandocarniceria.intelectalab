"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Scissors } from "lucide-react";
import { Badge, Button, Checkbox, Cifra, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column, type Tone } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { LINEAS, etiqueta, type TipoCorte } from "@/modulos/cat/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Inactivo", "neutral"] };

/** CAT-04 Tipos de corte: catálogo editable con las líneas a las que aplica cada corte. */
export default function TiposDeCorte() {
  const { can } = useSesion();
  const puedeEditar = can("cat.product.manage");
  const [datos, setDatos] = useState<TipoCorte[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [buscar, setBuscar] = useState("");
  const [linea, setLinea] = useState("");
  const [form, setForm] = useState<{ corte: TipoCorte | null } | null>(null);

  useEffect(() => {
    let vigente = true;
    api<TipoCorte[]>("/v1/cat/tipos-corte").then((f) => { if (vigente) { setDatos(f); setError(""); } })
      .catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [version]);
  const cargar = () => setVersion((n) => n + 1);
  const filas = useMemo(() => datos ?? [], [datos]);
  const cargando = datos === null && !error;

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return filas.filter((c) => (!linea || c.applies_to_lines.includes(linea))
      && (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)));
  }, [filas, buscar, linea]);

  const activos = filas.filter((c) => c.status === "ACTIVE");
  const sinUso = activos.filter((c) => c.variantes_activas === 0).length;
  const lineasCubiertas = new Set(activos.flatMap((c) => c.applies_to_lines)).size;

  const columnas: Column<TipoCorte>[] = [
    { key: "sort_order", header: "#", align: "right", hideOnMobile: true, render: (c) => <span className="tabular-nums text-muted">{c.sort_order}</span> },
    { key: "code", header: "Código", render: (c) => <span className="whitespace-nowrap font-mono font-semibold">{c.code}</span> },
    { key: "name", header: "Corte", cardTitle: true, render: (c) => c.name },
    { key: "lineas", header: "Aplica a", render: (c) => (
      <div className="flex flex-wrap gap-1">{c.applies_to_lines.map((l) => <Badge key={l} tone="neutral">{etiqueta(LINEAS, l)}</Badge>)}</div>
    ) },
    { key: "variantes", header: "Variantes", align: "right", render: (c) => (
      <span className="tabular-nums">{numero(c.variantes_activas)}{c.variantes > c.variantes_activas && <span className="text-muted"> (+{c.variantes - c.variantes_activas} inactivas)</span>}</span>
    ) },
    { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Catálogo editable de cortes y presentaciones con las líneas a las que aplican. Al crear una variante solo se ofrecen los cortes de la línea de su producto."
        actions={puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setForm({ corte: null })}>Nuevo corte</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="Cortes activos" icono={Scissors} destacada valor={cargando ? undefined : numero(activos.length)} detalle={`${numero(filas.length - activos.length)} inactivos`} />
        <Cifra titulo="Líneas con cortes" valor={cargando ? undefined : numero(lineasCubiertas)} detalle={`De ${LINEAS.length} líneas del catálogo`} />
        <Cifra titulo="Activos sin variantes" valor={cargando ? undefined : numero(sinUso)} detalle="Ninguna variante activa los usa" />
      </div>

      <DataTable columns={columnas} rows={visibles} rowKey={(c) => c.id} loading={cargando} error={error} onRetry={cargar}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por código o nombre…" }}
        onRowClick={puedeEditar ? (c) => setForm({ corte: c }) : undefined}
        empty="No hay cortes con esos filtros."
        toolbar={<div className="w-44"><Select value={linea} onChange={(e) => setLinea(e.target.value)} placeholder="Línea: todas" options={LINEAS} /></div>} />

      {form && <CorteForm corte={form.corte} siguiente={(Math.max(0, ...filas.map((c) => c.sort_order)) || 0) + 10}
        onClose={() => setForm(null)} onGuardado={() => { setForm(null); cargar(); }} />}
    </div>
  );
}

/** Crear o editar un tipo de corte. */
function CorteForm({ corte, siguiente, onClose, onGuardado }: { corte: TipoCorte | null; siguiente: number; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState(() => ({
    code: corte?.code ?? "", name: corte?.name ?? "", sort_order: String(corte?.sort_order ?? siguiente),
    status: corte?.status ?? "ACTIVE", applies_to_lines: corte?.applies_to_lines ?? [] as string[],
  }));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const alternar = (l: string, si: boolean) => setV((x) => ({ ...x, applies_to_lines: si ? [...x.applies_to_lines, l] : x.applies_to_lines.filter((y) => y !== l) }));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(""); setErrores({});
    try {
      const body = { ...v, sort_order: v.sort_order === "" ? null : Number(v.sort_order) };
      await api(corte ? `/v1/cat/tipos-corte/${corte.id}` : "/v1/cat/tipos-corte", { method: corte ? "PUT" : "POST", body });
      toast.ok(corte ? "Corte actualizado" : "Corte creado");
      onGuardado();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title={corte ? `Editar corte ${corte.name}` : "Nuevo tipo de corte"}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-corte" variant="primary" loading={guardando}>{corte ? "Guardar cambios" : "Crear corte"}</Button>
      </>}>
      <form id="f-corte" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        <Field label="Código" required error={errores.code} hint="Ej.: SIN_CABEZA">
          <Input value={v.code} onChange={(e) => setV((x) => ({ ...x, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") }))} maxLength={40} className="font-mono uppercase" />
        </Field>
        <Field label="Nombre" required error={errores.name}>
          <Input value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} maxLength={80} />
        </Field>
        <Field label="Orden" error={errores.sort_order} hint="Menor aparece primero en los selectores.">
          <Input type="number" min={0} step={1} value={v.sort_order} onChange={(e) => setV((x) => ({ ...x, sort_order: e.target.value }))} />
        </Field>
        <Field label="Estado" required error={errores.status}>
          <Select value={v.status} onChange={(e) => setV((x) => ({ ...x, status: e.target.value }))} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-[13px] font-medium">Aplica a las líneas <span className="text-bad">*</span></legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LINEAS.map((l) => <Checkbox key={l.value} checked={v.applies_to_lines.includes(l.value)} onChange={(si) => alternar(l.value, si)} label={l.label} />)}
          </div>
          {errores.applies_to_lines && <p className="mt-1.5 text-[12.5px] text-bad">{errores.applies_to_lines}</p>}
        </fieldset>
      </form>
    </Modal>
  );
}
