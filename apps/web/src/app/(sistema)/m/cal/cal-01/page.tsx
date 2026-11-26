"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column, type Tone } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { FiltroSelect, accion, num, olvidarOpcionesCal, opcionesDe, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { ETAPA, TIPO_RESPUESTA } from "@/modulos/cal/tipos";

type Fila = { id: string; code: string; name: string; stage: string; version: number; status: string; activated_at: string | null; items: number; critical_items: number; schedules: number; last_used: string | null };
type Item = { question: string; answer_type: string; min_value: string; max_value: string; is_critical: boolean; requires_photo: boolean };
type Detalle = { id: string; code: string; name: string; stage: string; version: number; status: string; activated_at: string | null; versions: { id: string; version: number; status: string }[];
  items: { question: string; answer_type: string; min_value: string | null; max_value: string | null; is_critical: boolean; requires_photo: boolean }[] };
const ESTADO: Record<string, [string, Tone]> = { DRAFT: ["Borrador", "neutral"], ACTIVE: ["Activo", "ok"], RETIRED: ["Retirado", "neutral"] };

/** CAL-01 Plantillas de checklist: preguntas por etapa con su tipo de respuesta, rango e ítems críticos; versionadas (RN-CAL-08). */
export default function Checklists() {
  const { puede } = useSesion();
  const op = useOpcionesCal();
  const [etapa, setEtapa] = useState("");
  const lista = useListado<Fila>("/v1/cal/checklists", { orden: "code", filtros: { stage: etapa } });
  const [abierto, setAbierto] = useState<string | null | undefined>(undefined);
  const gestiona = Boolean(op?.can.checklist) && puede("CAL", "C");
  const columnas: Column<Fila>[] = [
    { key: "code", header: "Código", sortable: true, render: (c) => <span className="font-mono font-semibold">{c.code}</span> },
    { key: "name", header: "Checklist", sortable: true, cardTitle: true, render: (c) => <span className="font-medium">{c.name}</span> },
    { key: "stage", header: "Etapa", sortable: true, render: (c) => ETAPA[c.stage] ?? c.stage },
    { key: "version", header: "Versión", align: "right", render: (c) => `v${c.version}` },
    { key: "items", header: "Preguntas", align: "right", render: (c) => <span>{c.items}{c.critical_items > 0 && <span className="text-[12px] text-bad"> · {c.critical_items} crítica(s)</span>}</span> },
    { key: "schedules", header: "Programaciones", align: "right", hideOnMobile: true },
    { key: "last_used", header: "Último uso", hideOnMobile: true, render: (c) => fechaHora(c.last_used) },
    { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} labels={ESTADO} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={`Una inspección es conforme con ${op?.min_score_pct ?? 90} % de puntaje o más y sin ningún ítem crítico no conforme. Un checklist usado no se edita: se crea su nueva versión.`}
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setAbierto(null)}>Nuevo checklist</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(c) => setAbierto(c.id)} search={{ ...lista.tabla.search, placeholder: "Buscar código o nombre…" }}
        toolbar={<FiltroSelect label="Etapa" value={etapa} onChange={setEtapa} options={opcionesDe(ETAPA)} ancho="sm:w-[200px]" />} />
      {abierto !== undefined && <Editor id={abierto} edita={gestiona} onClose={() => setAbierto(undefined)} onCambio={(id) => { olvidarOpcionesCal(); lista.recargar(); setAbierto(id); }} />}
    </div>
  );
}

function Editor({ id, edita, onClose, onCambio }: { id: string | null; edita: boolean; onClose: () => void; onCambio: (id: string) => void }) {
  const { datos: d } = useDatos<Detalle>(id ? `/v1/cal/checklists/${id}` : null);
  if (id && (!d || d.id !== id)) return null;
  return <Formulario key={d?.id ?? "nuevo"} d={id ? d ?? null : null} edita={edita} onClose={onClose} onCambio={onCambio} />;
}

function Formulario({ d, edita, onClose, onCambio }: { d: Detalle | null; edita: boolean; onClose: () => void; onCambio: (id: string) => void }) {
  const [f, setF] = useState({ code: d?.code ?? "", name: d?.name ?? "", stage: d?.stage ?? "RECEPTION" });
  const [items, setItems] = useState<Item[]>(d ? d.items.map((i) => ({ ...i, min_value: i.min_value ?? "", max_value: i.max_value ?? "" })) : [{ question: "", answer_type: "YES_NO", min_value: "", max_value: "", is_critical: false, requires_photo: false }]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const borrador = !d || d.status === "DRAFT";
  const editable = edita && borrador;
  const setItem = (i: number, k: keyof Item, v: string | boolean) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  async function guardar() {
    setGuardando(true); setError("");
    try {
      const r = await api<{ id: string }>(d ? `/v1/cal/checklists/${d.id}` : "/v1/cal/checklists", { method: d ? "PUT" : "POST",
        body: { ...f, items: items.map((i) => ({ ...i, min_value: num(i.min_value), max_value: num(i.max_value) })) } });
      toast.ok("Checklist guardado"); onCambio(r.id);
    } catch (e) { const c = erroresDe(e); setError(Object.values(c)[0] ?? mensajeDe(e)); } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={d ? `${d.code} · v${d.version}` : "Nuevo checklist"}
      footer={<>
        <Button onClick={onClose}>Cerrar</Button>
        {edita && d && d.status !== "DRAFT" && <Button onClick={async () => { try { const r = await api<{ id: string }>(`/v1/cal/checklists/${d.id}/version`, { method: "POST" }); toast.ok("Nueva versión en borrador"); onCambio(r.id); } catch (e) { toast.error(mensajeDe(e)); } }}>Crear nueva versión</Button>}
        {edita && d?.status === "DRAFT" && <Button onClick={() => accion({ title: `¿Activar ${d.code} v${d.version}?`, message: "La versión anterior se retira y sus programaciones pasan a esta.", confirmLabel: "Activar" },
          () => api(`/v1/cal/checklists/${d.id}/activar`, { method: "POST" }), "Checklist activo", () => onCambio(d.id))}>Activar</Button>}
        {editable && <Button variant="primary" loading={guardando} onClick={() => void guardar()}>Guardar</Button>}
      </>}>
      <div className="space-y-4">
        {d && <div className="flex flex-wrap gap-2">{d.versions.map((v) => <Badge key={v.id} tone={v.status === "ACTIVE" ? "ok" : "neutral"}>v{v.version} · {ESTADO[v.status]?.[0]}</Badge>)}</div>}
        {d && !borrador && <Alert tone="info">Esta versión no se edita. Para cambiar preguntas, crea su nueva versión.</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Código" required><Input value={f.code} disabled={!editable || Boolean(d)} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Nombre" required className="sm:col-span-2"><Input value={f.name} disabled={!editable} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Etapa" required><Select value={f.stage} disabled={!editable} options={opcionesDe(ETAPA)} onChange={(e) => setF({ ...f, stage: e.target.value })} /></Field>
        </div>
        <ol className="space-y-3">
          {items.map((it, i) => <li key={i} className="space-y-2 rounded-[9px] border border-line p-3">
            <div className="flex gap-2"><span className="pt-2 text-[12px] text-muted">{i + 1}.</span>
              <Input aria-label="Pregunta" placeholder="Pregunta" value={it.question} disabled={!editable} onChange={(e) => setItem(i, "question", e.target.value)} />
              {editable && <button type="button" aria-label="Quitar" className="cursor-pointer p-2 text-muted hover:text-bad" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}
            </div>
            <div className="grid gap-2 sm:grid-cols-[150px_100px_100px_1fr]">
              <Select aria-label="Tipo de respuesta" value={it.answer_type} disabled={!editable} options={opcionesDe(TIPO_RESPUESTA)} onChange={(e) => setItem(i, "answer_type", e.target.value)} />
              {it.answer_type === "NUMBER" ? <>
                <Input aria-label="Mínimo" placeholder="Mín." inputMode="decimal" value={it.min_value} disabled={!editable} onChange={(e) => setItem(i, "min_value", e.target.value)} />
                <Input aria-label="Máximo" placeholder="Máx." inputMode="decimal" value={it.max_value} disabled={!editable} onChange={(e) => setItem(i, "max_value", e.target.value)} />
              </> : <><span /><span /></>}
              <div className="flex flex-wrap gap-4"><Checkbox checked={it.is_critical} disabled={!editable} onChange={(v) => setItem(i, "is_critical", v)} label="Crítico" />
                <Checkbox checked={it.requires_photo} disabled={!editable} onChange={(v) => setItem(i, "requires_photo", v)} label="Pide foto" /></div>
            </div>
          </li>)}
        </ol>
        {editable && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setItems([...items, { question: "", answer_type: "YES_NO", min_value: "", max_value: "", is_critical: false, requires_photo: false }])}>Agregar pregunta</Button>}
        {d && <p className="text-[12px] text-muted">Activo desde {fecha(d.activated_at)}</p>}
      </div>
    </Modal>
  );
}
