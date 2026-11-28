"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Cifra, Field, FiltroSelect, IconButton, Input, Modal, PageHeader, Select, Textarea, buttonClass, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { ErrorCarga, EstadoVersion, FiltroVersion, Seccion, Vacio, mesCorto, opcionesDe, s0, useDatos, useOpciones, type Opciones, type Totales, type Tipo, type Version } from "@/modulos/prs/comunes";

type Celda = { id: string; amount: number; note: string | null } | null;
type Fila = { key: string; concept_id: string; code: string; name: string; type: Tipo; parent_id: string | null; brand_id: string | null; establishment_id: string | null;
  cost_center_id: string | null; celdas: Celda[]; total: number; dimension: string };
type Grupo = { id: string; name: string; code: string; type: Tipo; meses: number[]; total: number };
type Datos = { version: Version; meses: string[]; filas: Fila[]; grupos: Grupo[]; por_mes: { ingreso: number; gasto: number; resultado: number }[]; totales: Totales;
  sin_mapeo: { id: string; code: string; name: string }[]; otras: { id: string; version_no: number; status: string; name: string }[] };

/** PRS-03 Edición de versión: matriz concepto × mes (soles sin IGV) con filtros por marca, local y centro de costo; totales por fila y columna. */
export default function Edicion() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const router = useRouter();
  const { datos: op } = useOpciones();
  const [f, setF] = useState({ marca: "", local: "", centro: "" });
  const id = sp.get("id") || op?.versiones.find((v) => v.status === "APPROVED")?.id || op?.versiones[0]?.id || "";
  const q = new URLSearchParams(Object.entries(f).filter(([, x]) => x) as [string, string][]);
  const { datos, error, cargando, recargar } = useDatos<Datos>(id ? `/v1/prs/versiones/${id}?${q}` : null);
  const [celda, setCelda] = useState<{ fila: Fila; i: number } | null>(null);
  const [fila, setFila] = useState<Fila | "nueva" | null>(null);
  const [creando, setCreando] = useState(false);
  if (error) return <ErrorCarga error={error} que="Las versiones del presupuesto las ven quienes tienen acceso a Presupuesto." />;
  const v = datos?.version;
  const editable = Boolean(v?.editable && op?.puede.editar);

  async function revision() {
    if (!v) return;
    setCreando(true);
    try {
      const n = await api<Version>(`/v1/prs/presupuestos/${v.budget_id}/versiones`, { method: "POST", body: { desde: v.id } });
      toast.ok(`Revisión ${n.etiqueta} creada en borrador`);
      router.push(`/m/prs/prs-03?id=${n.id}`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCreando(false);
    }
  }
  async function quitarFila(x: Fila) {
    if (!v || !(await confirmAction({ title: `¿Quitar ${x.name} · ${x.dimension}?`, message: "Se quitan sus 12 meses de esta versión en borrador.", confirmLabel: "Quitar", danger: true }))) return;
    try {
      await api(`/v1/prs/versiones/${v.id}/filas/quitar`, { method: "POST", body: { clave: x.key } });
      toast.ok("Fila quitada");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const grupos = datos?.grupos ?? [];
  return (
    <div className="space-y-4">
      <PageHeader description="Matriz concepto × mes en soles sin IGV. Cada celda es una línea: una sola por concepto, mes, marca, local y centro de costo (RN-PRS-13)."
        actions={v && <>
          <Link className={buttonClass("secondary")} href={`/m/prs/prs-04?id=${v.id}`}>Carga y copia</Link>
          <Link className={buttonClass("secondary")} href={`/m/prs/prs-05?id=${v.id}`}>Envío y aprobación</Link>
          {editable && <Button variant="primary" icon={Plus} onClick={() => setFila("nueva")}>Agregar fila</Button>}
        </>} />
      <div className="flex flex-wrap gap-2">
        {op && <FiltroVersion versiones={op.versiones} value={id} onChange={(x) => router.push(`/m/prs/prs-03?id=${x}`)} />}
        <FiltroSelect etiqueta="Marca" todos="todas" value={f.marca} onChange={(x) => setF({ ...f, marca: x })} options={opcionesDe(op?.marcas ?? [], false)} />
        <FiltroSelect etiqueta="Local" value={f.local} onChange={(x) => setF({ ...f, local: x })} options={opcionesDe(op?.locales ?? [], false)} ancho={190} />
        <FiltroSelect etiqueta="Centro" value={f.centro} onChange={(x) => setF({ ...f, centro: x })} options={opcionesDe(op?.centros ?? [])} ancho={200} />
      </div>
      {v && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <EstadoVersion s={v.status} /><span className="font-medium text-ink">{v.etiqueta} · {v.name}</span>
          {v.aprobada_por && <span>· aprobada por {v.aprobada_por}</span>}{v.enviada_por && v.status === "SUBMITTED" && <span>· enviada por {v.enviada_por}</span>}
        </div>)}
      {v && !v.editable && (
        <Alert tone="warn" title="Esta versión no se modifica (RN-PRS-04)">
          Está {v.estado.toLowerCase()}: sus líneas quedan como están. Para cambiar algo crea una revisión en borrador.
          {op?.puede.editar && <span className="mt-2 block"><Button size="sm" variant="primary" loading={creando} onClick={revision}>Crear revisión en borrador</Button></span>}
        </Alert>)}
      {v?.status === "REJECTED" && v.decision_comment && <Alert tone="bad" title={`Rechazada por ${v.rechazada_por ?? "Gerencia"}`}>{v.decision_comment}</Alert>}
      {datos && datos.sin_mapeo.length > 0 && (
        <Alert tone="warn" title="Conceptos sin mapeo (RN-PRS-02)">
          {datos.sin_mapeo.map((c) => `${c.code} ${c.name}`).join(", ")}: mapéalos en <Link className="text-primary underline" href="/m/prs/prs-02">Conceptos presupuestales</Link> antes de enviar.
        </Alert>)}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Ingresos del año" valor={datos ? s0(datos.totales.ingreso) : undefined} destacada />
        <Cifra titulo="Costo de ventas" valor={datos ? s0(datos.totales.costo) : undefined} />
        <Cifra titulo="Gastos" valor={datos ? s0(datos.totales.gasto) : undefined} />
        <Cifra titulo="Resultado" valor={datos ? s0(datos.totales.resultado) : undefined} tono={datos && datos.totales.resultado < 0 ? "bad" : "ok"} />
      </div>
      <Seccion titulo="Matriz" className="!p-0">
        {cargando && <p className="p-4 text-[13px] text-muted">Cargando…</p>}
        {datos && !datos.filas.length && <div className="p-4"><Vacio>Esta versión no tiene líneas{f.marca || f.local || f.centro ? " con esos filtros" : ""}. {editable ? "Agrega filas o usa «Carga y copia»." : ""}</Vacio></div>}
        {datos && datos.filas.length > 0 && (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-[12.5px]">
              <thead className="sticky top-0 z-20 bg-surface-2 text-muted">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[210px] border-b border-line bg-surface-2 px-3 py-2 text-left font-semibold">Concepto · dimensión</th>
                  {datos.meses.map((m) => <th key={m} className="border-b border-line px-2 py-2 text-right font-semibold">{mesCorto(m)}</th>)}
                  <th className="border-b border-line px-3 py-2 text-right font-semibold">Total</th>
                  {editable && <th className="border-b border-line" />}
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <GrupoFilas key={g.id} g={g} filas={datos.filas.filter((x) => (x.parent_id ?? x.concept_id) === g.id)} editable={editable}
                    onCelda={(x, i) => setCelda({ fila: x, i })} onEditar={(x) => setFila(x)} onQuitar={quitarFila} />
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface-2 font-semibold">
                {(["ingreso", "gasto", "resultado"] as const).map((k) => (
                  <tr key={k}>
                    <td className="sticky left-0 bg-surface-2 px-3 py-1.5">{k === "ingreso" ? "Ingresos" : k === "gasto" ? "Costo y gasto" : "Resultado"}</td>
                    {datos.por_mes.map((x, i) => <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${k === "resultado" && x[k] < 0 ? "text-bad" : ""}`}>{numero(Math.round(x[k]), 0)}</td>)}
                    <td className="px-3 py-1.5 text-right tabular-nums">{numero(Math.round(datos.por_mes.reduce((a, x) => a + x[k], 0)), 0)}</td>
                    {editable && <td />}
                  </tr>))}
              </tfoot>
            </table>
          </div>)}
      </Seccion>
      {celda && v && <EditarCelda v={v} meses={datos!.meses} {...celda} onClose={() => setCelda(null)} onListo={() => { setCelda(null); recargar(); }} />}
      {fila && v && op && <EditarFila op={op} v={v} meses={datos?.meses ?? []} fila={fila === "nueva" ? null : fila} onClose={() => setFila(null)} onListo={() => { setFila(null); recargar(); }} />}
    </div>
  );
}

function GrupoFilas({ g, filas, editable, onCelda, onEditar, onQuitar }: { g: Grupo; filas: Fila[]; editable: boolean; onCelda: (x: Fila, i: number) => void; onEditar: (x: Fila) => void; onQuitar: (x: Fila) => void }) {
  return (
    <>
      <tr className="bg-surface-2/50 font-semibold">
        <td className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5">{g.name}</td>
        {g.meses.map((x, i) => <td key={i} className="border-b border-line px-2 py-1.5 text-right tabular-nums">{x ? numero(Math.round(x), 0) : "—"}</td>)}
        <td className="border-b border-line px-3 py-1.5 text-right tabular-nums">{numero(Math.round(g.total), 0)}</td>
        {editable && <td className="border-b border-line" />}
      </tr>
      {filas.map((x) => (
        <tr key={x.key} className="hover:bg-surface-2/40">
          <td className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5">
            <button type="button" className={`text-left ${editable ? "cursor-pointer hover:text-primary" : "cursor-default"}`} onClick={() => editable && onEditar(x)}>
              <span className="block font-medium">{x.name}</span><span className="block text-[11.5px] text-muted">{x.dimension}</span>
            </button>
          </td>
          {x.celdas.map((c, i) => (
            <td key={i} className="border-b border-line px-1 py-1 text-right tabular-nums">
              <button type="button" disabled={!editable} onClick={() => onCelda(x, i)} title={c?.note ?? undefined}
                className={`w-full rounded px-1 py-0.5 text-right ${editable ? "cursor-pointer hover:bg-primary-soft" : "cursor-default"} ${c ? "" : "text-muted"}`}>
                {c ? numero(Math.round(c.amount), 0) : "·"}
              </button>
            </td>))}
          <td className="border-b border-line px-3 py-1.5 text-right font-medium tabular-nums">{numero(Math.round(x.total), 0)}</td>
          {editable && <td className="border-b border-line px-1"><IconButton icon={Trash2} label="Quitar fila" onClick={() => onQuitar(x)} /></td>}
        </tr>))}
    </>
  );
}

function EditarCelda({ v, meses, fila, i, onClose, onListo }: { v: Version; meses: string[]; fila: Fila; i: number; onClose: () => void; onListo: () => void }) {
  const c = fila.celdas[i];
  const [monto, setMonto] = useState(c ? String(c.amount) : "");
  const [nota, setNota] = useState(c?.note ?? "");
  const [guardando, setGuardando] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      if (c && monto === "") await api(`/v1/prs/lineas/${c.id}`, { method: "DELETE" });
      else if (c) await api(`/v1/prs/lineas/${c.id}`, { method: "PUT", body: { amount: monto, note: nota || null } });
      else await api(`/v1/prs/versiones/${v.id}/lineas`, { method: "POST", body: { concept_id: fila.concept_id, month: meses[i], brand_id: fila.brand_id,
        establishment_id: fila.establishment_id, cost_center_id: fila.cost_center_id, amount: monto, note: nota || null } });
      toast.ok("Línea guardada");
      onListo();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} placement="center" size="sm" title={`${fila.name} · ${mesCorto(meses[i])} ${meses[i].slice(0, 4)}`} description={fila.dimension} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-prs-celda" loading={guardando}>Guardar</Button></>}>
      <form id="f-prs-celda" onSubmit={guardar} className="space-y-3">
        <Field label="Importe en soles sin IGV" hint={c ? "Déjalo vacío para quitar la línea." : undefined}>
          <Input type="number" step="0.01" min={0} inputMode="decimal" autoFocus value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Field>
        <Field label="Nota"><Textarea rows={2} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function EditarFila({ op, v, meses, fila, onClose, onListo }: { op: Opciones; v: Version; meses: string[]; fila: Fila | null; onClose: () => void; onListo: () => void }) {
  const hojas = op.conceptos.filter((c) => !c.is_group && c.status === "ACTIVE");
  const [d, setD] = useState({ concept_id: fila?.concept_id ?? "", brand_id: fila?.brand_id ?? "", establishment_id: fila?.establishment_id ?? "", cost_center_id: fila?.cost_center_id ?? "" });
  const [imp, setImp] = useState<string[]>(fila ? fila.celdas.map((c) => (c ? String(c.amount) : "")) : Array(12).fill(""));
  const [todos, setTodos] = useState("");
  const [guardando, setGuardando] = useState(false);
  const total = imp.reduce((a, x) => a + (Number(x) || 0), 0);
  function concepto(id: string) {
    const c = hojas.find((x) => x.id === id);
    setD({ ...d, concept_id: id, cost_center_id: d.cost_center_id || c?.default_cost_center_id || "" });
  }
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api(`/v1/prs/versiones/${v.id}/filas`, { method: "POST", body: { concept_id: d.concept_id, brand_id: d.brand_id || null, establishment_id: d.establishment_id || null,
        cost_center_id: d.cost_center_id || null, importes: imp.map((x) => (x === "" ? null : x)), clave_anterior: fila?.key ?? null } });
      toast.ok(fila ? "Fila guardada" : "Fila agregada");
      onListo();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={fila ? `${fila.name} · ${fila.dimension}` : "Agregar fila"} size="lg" dismissable={!guardando}
      description="Concepto, al menos una dimensión (marca, local o centro de costo) y el importe de cada mes en soles sin IGV."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-prs-fila" loading={guardando}>Guardar · {s0(total)}</Button></>}>
      <form id="f-prs-fila" onSubmit={guardar} className="space-y-3">
        <Field label="Concepto" required><Select value={d.concept_id} placeholder="Elige el concepto" onChange={(e) => concepto(e.target.value)}
          options={hojas.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Marca"><Select value={d.brand_id} placeholder="Todas" onChange={(e) => setD({ ...d, brand_id: e.target.value })} options={opcionesDe(op.marcas, false)} /></Field>
          <Field label="Local"><Select value={d.establishment_id} placeholder="Todos" onChange={(e) => setD({ ...d, establishment_id: e.target.value })} options={opcionesDe(op.locales, false)} /></Field>
          <Field label="Centro de costo"><Select value={d.cost_center_id} placeholder="Ninguno" onChange={(e) => setD({ ...d, cost_center_id: e.target.value })} options={opcionesDe(op.centros)} /></Field>
        </div>
        {!d.brand_id && !d.establishment_id && !d.cost_center_id && <Alert tone="info">Elige al menos una dimensión (RN-PRS-01).</Alert>}
        <div className="flex items-end gap-2">
          <Field label="Mismo importe en los 12 meses" className="flex-1"><Input type="number" step="0.01" min={0} value={todos} onChange={(e) => setTodos(e.target.value)} /></Field>
          <Button onClick={() => setImp(Array(12).fill(todos))} disabled={todos === ""}>Aplicar</Button>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {meses.map((m, i) => (
            <Field key={m} label={`${mesCorto(m)} ${m.slice(2, 4)}`}>
              <Input type="number" step="0.01" min={0} inputMode="decimal" value={imp[i]} onChange={(e) => setImp(imp.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>))}
        </div>
      </form>
    </Modal>
  );
}
