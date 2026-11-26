"use client";

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { FiltroSelect, Seccion, num, opcionesDe, opcionesEt, useAlAbrir, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { ETAPA, RESULTADO, TURNO } from "@/modulos/cal/tipos";

type Fila = { id: string; number: string; stage: string; area: string | null; shift: string | null; inspected_at: string; status: string; result: string | null; score_pct: string | null;
  production_order_ref: string | null; critical_failed: number; checklist_code: string; checklist_name: string; inspector_name: string | null; lot_code: string | null; establishment_name: string | null };
type Item = { id: string; seq: number; question: string; answer_type: string; min_value: string | null; max_value: string | null; is_critical: boolean; requires_photo: boolean };
type Resp = { si?: boolean; n?: string; texto?: string; foto?: string; conforme?: boolean };
type Lote = { id: string; code: string; product_name: string };

/** CAL-03 Inspección: responder un checklist en el celular; el puntaje y los ítems críticos deciden el resultado (RN-CAL-08). */
export default function Inspeccion() {
  const [vista, setVista] = useState<"nueva" | "historial">("nueva");
  return (
    <div className="space-y-4">
      <PageHeader description="Responde cada pregunta. Un ítem crítico no conforme da resultado no conforme aunque el puntaje alcance el mínimo, y avisa a Calidad." />
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "nueva", label: "Nueva inspección" }, { key: "historial", label: "Inspecciones" }]} />
      {vista === "nueva" ? <Nueva onHecha={() => setVista("historial")} /> : <Historial />}
    </div>
  );
}

function Nueva({ onHecha }: { onHecha: () => void }) {
  const { local } = useSesion();
  const op = useOpcionesCal();
  const [chk, setChk] = useState("");
  const [loteId, setLoteId] = useState("");
  const [area, setArea] = useState("");
  const [turno, setTurno] = useState("M");
  const [notas, setNotas] = useState("");
  const [r, setR] = useState<Record<string, Resp>>({});
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  useAlAbrir((p) => { setChk(p.get("checklist") ?? ""); setLoteId(p.get("lot") ?? ""); });
  const { datos: d } = useDatos<{ items: Item[] }>(chk ? `/v1/cal/checklists/${chk}` : null);
  const lotes = useDatos<{ data: Lote[] }>("/v1/cal/lotes?per_page=100").datos?.data ?? [];
  const items = d?.items ?? [];
  const conforme = (it: Item): boolean | null => {
    const x = r[it.id]; if (!x) return null;
    if (it.answer_type === "YES_NO") return x.si ?? null;
    if (it.answer_type === "NUMBER") { const v = num(x.n ?? ""); if (v === null) return null; return (it.min_value === null || v >= Number(it.min_value)) && (it.max_value === null || v <= Number(it.max_value)); }
    return x.conforme ?? null;
  };
  const respondidas = items.filter((it) => conforme(it) !== null);
  const puntaje = respondidas.length ? (respondidas.filter((it) => conforme(it)).length / items.length) * 100 : null;
  const critico = items.some((it) => it.is_critical && conforme(it) === false);
  const set = (id: string, v: Resp) => setR((x) => ({ ...x, [id]: { ...x[id], ...v } }));

  async function enviar() {
    setEnviando(true); setError("");
    try {
      const res = await api<{ number: string; result: string; score_pct: string }>("/v1/cal/inspecciones", { method: "POST", body: {
        checklist_id: chk, lot_id: loteId || null, area: area || null, shift: turno, notes: notas || null, finish: true, establishment_id: local !== "ALL" ? local : null,
        answers: items.map((it) => { const x = r[it.id] ?? {}; return { item_id: it.id, answer_bool: it.answer_type === "YES_NO" ? x.si ?? null : null, answer_num: it.answer_type === "NUMBER" ? num(x.n ?? "") : null,
          answer_text: x.texto || null, photo_url: x.foto || null, is_conforming: it.answer_type === "TEXT" || it.answer_type === "PHOTO" ? x.conforme ?? null : null }; }) } });
      if (res.result === "PASS") toast.ok(`${res.number}: conforme (${porcentaje(res.score_pct, 0)})`); else toast.error(`${res.number}: no conforme (${porcentaje(res.score_pct, 0)})`);
      setR({}); setNotas(""); onHecha();
    } catch (e) { setError(mensajeDe(e)); } finally { setEnviando(false); }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Seccion titulo="Qué se inspecciona">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Checklist" required className="sm:col-span-2"><Select value={chk} placeholder="Elegir" options={(op?.checklists ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name} (${ETAPA[c.stage]})` }))} onChange={(e) => { setChk(e.target.value); setR({}); }} /></Field>
          <Field label="Lote" hint="Para recepción, proceso o empaque"><Select value={loteId} searchable placeholder="Ninguno" options={lotes.map((l) => ({ value: l.id, label: `${l.code} · ${l.product_name}` }))} onChange={(e) => setLoteId(e.target.value)} /></Field>
          <Field label="Área"><Input value={area} onChange={(e) => setArea(e.target.value)} /></Field>
          <Field label="Turno"><Select value={turno} options={["M", "T", "N"].map((k) => ({ value: k, label: TURNO[k] }))} onChange={(e) => setTurno(e.target.value)} /></Field>
        </div>
      </Seccion>
      {items.length > 0 && <Seccion titulo="Preguntas" acciones={puntaje !== null && <Badge tone={critico || puntaje < Number(op?.min_score_pct ?? 90) ? "bad" : "ok"}>{porcentaje(puntaje, 0)}{critico ? " · crítico no conforme" : ""}</Badge>}>
        <ol className="space-y-3">
          {items.map((it) => { const c = conforme(it); return (
            <li key={it.id} className={`rounded-[9px] border p-3 ${c === false ? "border-bad/40 bg-bad-soft/40" : "border-line"}`}>
              <p className="mb-2 text-[14px] font-medium">{it.seq}. {it.question} {it.is_critical && <Badge tone="bad">Crítico</Badge>}</p>
              {it.answer_type === "YES_NO" && <div className="grid grid-cols-2 gap-2">
                <Button variant={r[it.id]?.si === true ? "primary" : "secondary"} onClick={() => set(it.id, { si: true })}>Sí, conforme</Button>
                <Button variant={r[it.id]?.si === false ? "danger" : "secondary"} onClick={() => set(it.id, { si: false })}>No</Button>
              </div>}
              {it.answer_type === "NUMBER" && <Input inputMode="decimal" aria-label={it.question} placeholder={`De ${it.min_value ?? "—"} a ${it.max_value ?? "—"}`} value={r[it.id]?.n ?? ""} onChange={(e) => set(it.id, { n: e.target.value })} />}
              {(it.answer_type === "TEXT" || it.answer_type === "PHOTO") && <div className="space-y-2">
                {it.answer_type === "TEXT" && <Input aria-label={it.question} value={r[it.id]?.texto ?? ""} onChange={(e) => set(it.id, { texto: e.target.value })} />}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant={r[it.id]?.conforme === true ? "primary" : "secondary"} onClick={() => set(it.id, { conforme: true })}>Conforme</Button>
                  <Button variant={r[it.id]?.conforme === false ? "danger" : "secondary"} onClick={() => set(it.id, { conforme: false })}>No conforme</Button>
                </div>
              </div>}
              {(it.requires_photo || it.answer_type === "PHOTO") && <Input className="mt-2" aria-label="Foto" placeholder="Ruta de la foto (fotos/…)" value={r[it.id]?.foto ?? ""} onChange={(e) => set(it.id, { foto: e.target.value })} />}
            </li>); })}
        </ol>
        <Field label="Observaciones" className="mt-3"><Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></Field>
        {error && <div className="mt-3"><Alert tone="bad">{error}</Alert></div>}
        <Button className="mt-3 w-full sm:w-auto" variant="primary" icon={ClipboardCheck} loading={enviando} disabled={respondidas.length < items.length} onClick={() => void enviar()}>
          Terminar inspección ({respondidas.length} de {items.length})
        </Button>
      </Seccion>}
    </div>
  );
}

type Detalle = Fila & { answers: { question: string; answer_bool: boolean | null; answer_num: string | null; answer_text: string | null; is_conforming: boolean | null; is_critical: boolean }[]; notes: string | null };

function Historial() {
  const { local } = useSesion();
  const [res, setRes] = useState("");
  const [etapa, setEtapa] = useState("");
  const lista = useListado<Fila>("/v1/cal/inspecciones", { orden: "-inspected_at", filtros: { result: res, stage: etapa, site: local } });
  const [ver, setVer] = useState<string | null>(null);
  const { datos: d } = useDatos<Detalle>(ver ? `/v1/cal/inspecciones/${ver}` : null);
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Número", sortable: true, render: (i) => <span className="font-mono font-semibold">{i.number}</span> },
    { key: "checklist_name", header: "Checklist", cardTitle: true, render: (i) => <div><p className="font-medium">{i.checklist_name}</p><p className="text-[12px] text-muted">{ETAPA[i.stage]}{i.area ? ` · ${i.area}` : ""}</p></div> },
    { key: "lot_code", header: "Lote u orden", render: (i) => <span className="font-mono text-[12.5px]">{i.lot_code ?? i.production_order_ref ?? "—"}</span> },
    { key: "inspected_at", header: "Fecha", sortable: true, render: (i) => fechaHora(i.inspected_at) },
    { key: "inspector_name", header: "Inspector", hideOnMobile: true, render: (i) => i.inspector_name ?? "—" },
    { key: "score_pct", header: "Puntaje", align: "right", render: (i) => porcentaje(i.score_pct, 0) },
    { key: "status", header: "Resultado", render: (i) => <span className="flex flex-wrap gap-1"><StatusBadge status={i.result} labels={RESULTADO} />{i.critical_failed > 0 && <Badge tone="bad">Crítico</Badge>}</span> },
  ];
  return (
    <>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(i) => setVer(i.id)} search={{ ...lista.tabla.search, placeholder: "Buscar número, checklist, lote o inspector…" }}
        toolbar={<><FiltroSelect label="Resultado" value={res} onChange={setRes} options={opcionesEt(RESULTADO)} /><FiltroSelect label="Etapa" value={etapa} onChange={setEtapa} options={opcionesDe(ETAPA)} /></>} />
      {ver && d && d.id === ver && <Modal open onClose={() => setVer(null)} size="lg" title={`${d.number} · ${d.checklist_name}`}>
        <div className="space-y-3">
          <p className="text-[13px] text-muted">{fechaHora(d.inspected_at)} · {d.inspector_name} · <StatusBadge status={d.result} labels={RESULTADO} /> {porcentaje(d.score_pct, 0)}</p>
          <ol className="divide-y divide-line rounded-[9px] border border-line text-[13px]">
            {(d.answers ?? []).map((a, i) => <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
              <span>{a.question}{a.is_critical && <Badge tone="bad">Crítico</Badge>}</span>
              <span className="text-right">{a.answer_num ?? a.answer_text ?? (a.answer_bool === null ? "" : a.answer_bool ? "Sí" : "No")} {a.is_conforming === false ? <Badge tone="bad">No conforme</Badge> : <Badge tone="ok">Conforme</Badge>}</span>
            </li>)}
          </ol>
          {d.notes && <p className="text-[13px]">{d.notes}</p>}
        </div>
      </Modal>}
    </>
  );
}
