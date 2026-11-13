"use client";

import { useState } from "react";
import Link from "next/link";
import { FlaskConical, Gauge, ListChecks, ShieldAlert } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { CifraLink, FiltroSelect, olvidarOpcionesRec, useDatos, useOpcionesRec } from "@/modulos/rec/comunes";
import { FUNCION, VERSION, lista, type Num, type Opciones } from "@/modulos/rec/tipos";

type Aditivo = { id: string; sin_code: string; name: string; function_class: string; max_ppm: Num; max_ppm_source: string | null; allergen: string | null;
  variant_id: string | null; variant_name: string | null; sku: string | null; status: string; uses: number };
type Ficha = Aditivo & { usage: { version_id: string; version: number; status: string; code: string; name: string; qty_kg: string; ppm: string; over_limit: boolean }[] };
type Cifras = { additives: number; with_limit: number; without_limit: number; used: number };

/** REC-04 Catálogo de aditivos: código SIN, función, límite máximo configurable y alérgenos. */
export default function Aditivos() {
  const { can, puede } = useSesion();
  const op = useOpcionesRec();
  const [funcion, setFuncion] = useState("");
  const [limite, setLimite] = useState("");
  const tabla = useListado<Aditivo>("/v1/rec/aditivos", { orden: "sin_code", porPagina: 50, filtros: { function_class: funcion, limite } });
  const c = useDatos<Cifras>("/v1/rec/cifras/04");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editando, setEditando] = useState<Aditivo | null | undefined>(undefined);
  const edita = (can("rec.version.approve") || can("rec.version.edit")) && puede("REC", "E");
  const hecho = () => { setEditando(undefined); olvidarOpcionesRec(); tabla.recargar(); c.recargar(); };

  const columnas: Column<Aditivo>[] = [
    { key: "sin_code", header: "SIN", sortable: true, render: (a) => <span className="font-mono font-semibold">{a.sin_code}</span> },
    { key: "name", header: "Nombre", sortable: true, cardTitle: true, render: (a) => a.name },
    { key: "function_class", header: "Función", sortable: true, render: (a) => FUNCION[a.function_class] ?? a.function_class },
    { key: "max_ppm", header: "Límite", sortable: true, align: "right", render: (a) => a.max_ppm !== null ? `${numero(a.max_ppm, 0)} ppm` : <Badge tone="warn">Sin límite</Badge> },
    { key: "max_ppm_source", header: "Fuente del límite", hideOnMobile: true, render: (a) => <span className="text-[12.5px]">{a.max_ppm_source ?? "—"}</span> },
    { key: "allergen", header: "Alérgeno", hideOnMobile: true, render: (a) => a.allergen ?? "—" },
    { key: "uses", header: "Versiones", sortable: true, align: "right", render: (a) => numero(a.uses) },
    { key: "status", header: "Estado", render: (a) => <StatusBadge status={a.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Código SIN, nombre, función, límite máximo y alérgenos. Los límites los carga Calidad con la norma de la que salen; sin límite cargado, la aprobación de la receta avisa y queda registrada."
        actions={edita && <Button variant="primary" onClick={() => setEditando(null)} disabled={!op}>Nuevo aditivo</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Aditivos" valor={c.datos ? numero(c.datos.additives) : undefined} detalle="En el catálogo" icono={FlaskConical} onClick={() => setLimite("")} />
        <CifraLink titulo="Con límite cargado" valor={c.datos ? numero(c.datos.with_limit) : undefined} detalle="Por Calidad" icono={Gauge} tono="ok" onClick={() => setLimite("SI")} />
        <CifraLink titulo="Sin límite" valor={c.datos ? numero(c.datos.without_limit) : undefined} detalle="La aprobación avisa" icono={ShieldAlert} tono={c.datos?.without_limit ? "warn" : undefined} onClick={() => setLimite("NO")} />
        <CifraLink titulo="Usados en recetas" valor={c.datos ? numero(c.datos.used) : undefined} detalle="En alguna versión" icono={ListChecks} />
      </div>
      <DataTable {...tabla.tabla} columns={columnas} onRowClick={(a) => setAbierto(a.id)} search={{ ...tabla.tabla.search, placeholder: "Buscar SIN, nombre o alérgeno…" }}
        empty="No hay aditivos con esos filtros."
        toolbar={<>
          <FiltroSelect label="Función" value={funcion} onChange={setFuncion} options={lista(FUNCION)} ancho="sm:w-[200px]" />
          <FiltroSelect label="Límite" value={limite} onChange={setLimite} options={[{ value: "SI", label: "Con límite" }, { value: "NO", label: "Sin límite" }]} />
        </>} />
      {abierto && <FichaAditivo id={abierto} edita={edita} onClose={() => setAbierto(null)} onEditar={(a) => { setAbierto(null); setEditando(a); }} />}
      {editando !== undefined && op && <AditivoForm a={editando} op={op} onClose={() => setEditando(undefined)} onGuardado={hecho} />}
    </div>
  );
}

function FichaAditivo({ id, edita, onClose, onEditar }: { id: string; edita: boolean; onClose: () => void; onEditar: (a: Aditivo) => void }) {
  const { datos: a, error } = useDatos<Ficha>(`/v1/rec/aditivos/${id}`);
  return (
    <Modal open onClose={onClose} size="lg" title={a ? `SIN ${a.sin_code} · ${a.name}` : "Aditivo"} footer={edita && a && <Button variant="primary" onClick={() => onEditar(a)}>Editar</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {a && <div className="space-y-5">
        <DetailList items={[
          { label: "Función", value: FUNCION[a.function_class] ?? a.function_class },
          { label: "Límite", value: a.max_ppm !== null ? `${numero(a.max_ppm, 0)} ppm` : "Sin límite cargado" },
          { label: "Fuente del límite", value: a.max_ppm_source ?? "—" }, { label: "Alérgeno", value: a.allergen ?? "—" },
          { label: "Insumo de almacén", value: a.variant_name ? `${a.sku} · ${a.variant_name}` : "—" }, { label: "Estado", value: <StatusBadge status={a.status} /> },
        ]} />
        <section>
          <h2 className="mb-2 text-[14px] font-semibold">Uso en recetas</h2>
          <DataTable rows={a.usage} rowKey={(u) => u.version_id} empty="No se usa en ninguna versión." columns={[
            { key: "code", header: "Receta", cardTitle: true, render: (u) => <Link className="text-primary hover:underline" href={`/m/rec/rec-03?v=${u.version_id}`}>{u.code} · {u.name} v{u.version}</Link> },
            { key: "status", header: "Estado", render: (u) => <StatusBadge status={u.status} labels={VERSION} /> },
            { key: "qty_kg", header: "Kg", align: "right", render: (u) => numero(u.qty_kg, 4) },
            { key: "ppm", header: "Dosis", align: "right", render: (u) => <span className={u.over_limit ? "font-bold text-bad" : ""}>{numero(u.ppm, 0)} ppm</span> },
          ]} />
        </section>
      </div>}
    </Modal>
  );
}

function AditivoForm({ a, op, onClose, onGuardado }: { a: Aditivo | null; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ sin_code: a?.sin_code ?? "", name: a?.name ?? "", function_class: a?.function_class ?? "PRESERVATIVE", max_ppm: a?.max_ppm?.toString() ?? "",
    max_ppm_source: a?.max_ppm_source ?? "", allergen: a?.allergen ?? "", variant_id: a?.variant_id ?? "", status: a?.status ?? "ACTIVE" });
  return (
    <Dialogo titulo={a ? `Editar SIN ${a.sin_code}` : "Nuevo aditivo"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(a ? `/v1/rec/aditivos/${a.id}` : "/v1/rec/aditivos", { method: a ? "PUT" : "POST", body: {
          ...f, max_ppm: f.max_ppm.trim() === "" ? null : Number(f.max_ppm.replace(",", ".")), max_ppm_source: f.max_ppm_source || null, allergen: f.allergen || null, variant_id: f.variant_id || null } });
        toast.ok("Aditivo guardado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Código SIN" required error={e.sin_code} hint="Como 250, 451(i) o 1422"><Input value={f.sin_code} maxLength={20} onChange={(x) => setF({ ...f, sin_code: x.target.value.trim().toLowerCase() })} /></Field>
        <Field label="Nombre" required error={e.name}><Input value={f.name} maxLength={80} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Función" required error={e.function_class}><Select value={f.function_class} options={lista(FUNCION)} onChange={(x) => setF({ ...f, function_class: x.target.value })} /></Field>
        <Field label="Estado" error={e.status}><Select value={f.status} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} onChange={(x) => setF({ ...f, status: x.target.value })} /></Field>
        <Field label="Límite máximo" error={e.max_ppm} hint="Vacío: sin límite (la aprobación avisa)"><Input inputMode="decimal" suffix="ppm" value={f.max_ppm} onChange={(x) => setF({ ...f, max_ppm: x.target.value })} /></Field>
        <Field label="Norma o fuente del límite" required={f.max_ppm.trim() !== ""} error={e.max_ppm_source}><Input value={f.max_ppm_source} maxLength={255} onChange={(x) => setF({ ...f, max_ppm_source: x.target.value })} /></Field>
        <Field label="Alérgeno" error={e.allergen}><Input value={f.allergen} maxLength={20} onChange={(x) => setF({ ...f, allergen: x.target.value })} /></Field>
        <Field label="Insumo de almacén" error={e.variant_id} hint="Al elegir este insumo en una receta, se marca como aditivo">
          <Select value={f.variant_id} placeholder="Ninguno" searchable options={op.inputs.map((x) => ({ value: x.id, label: `${x.name} (${x.sku})` }))} onChange={(x) => setF({ ...f, variant_id: x.target.value })} />
        </Field>
      </>}
    </Dialogo>
  );
}
