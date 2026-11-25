"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlarmClock, CalendarClock, CheckCircle2, ListTodo, Phone } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroSelect, Modal, PageHeader, StatusBadge, Tabs, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { BotonLlamar } from "@/modulos/tel/BotonLlamar";

type Opcion = { value: string; label: string };
type Tarea = {
  id: string; task_type: string; tipo: string; cliente: string | null; celular: string | null; customer_id: string | null; lead_id: string | null; conversation_id: string | null; pedido: string | null;
  marca: string | null; responsable: string | null; due_at: string; note: string | null; status: string; vencida: boolean; done_at: string | null; result: string | null;
  hecha_por: string | null; puede_completar: boolean;
};
type Lista = Pagina<Tarea> & {
  cifras: { abiertas: number; vencidas: number; hoy: number; hechas: number }; alcance: "mias" | "equipo"; equipo: boolean; telefonia: boolean; ficha: boolean;
  opciones: { tipos: Opcion[]; marcas: Opcion[]; responsables: Opcion[] };
};

const ESTADOS: Record<string, [string, Tone]> = { OPEN: ["Abierta", "info"], DONE: ["Hecha", "ok"] };

/**
 * CRM-17 Mis tareas: devolver llamada, recompra, seguimiento, seguimiento de encuesta, revisar alerta y chat sin
 * responder, con su vencimiento. La supervisión ve además las del equipo y las que no tienen responsable. Una tarea se
 * completa con su resultado y ya no cambia.
 */
export default function MisTareas() {
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.conversation.view_own") || can("crm.conversation.view_all"));
  const [f, setF] = useState({ alcance: "mias", estado: "OPEN", tipo: "", marca: "", responsable: "", vence: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [completar, setCompletar] = useState<Tarea | null>(null);
  const [ver, setVer] = useState<Tarea | null>(null);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/tareas?${q}&${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no tiene tareas de ventas.</Alert>;
  const c = lista?.cifras;
  const columnas: Column<Tarea>[] = [
    { key: "tipo", sortable: true, header: "Tipo", render: (t) => <span className="text-[12.5px] font-semibold text-ink">{t.tipo}</span> },
    { key: "cliente", sortable: true, header: "Cliente o chat", cardTitle: true, render: (t) => (
      <div><p className="font-semibold text-ink">{t.cliente ?? "—"}</p>{t.celular && <p className="font-mono text-[12px] text-muted">{t.celular}</p>}{t.pedido && <p className="text-[11.5px] text-muted">Pedido {t.pedido}</p>}</div>) },
    { key: "marca", sortable: true, header: "Marca", hideOnMobile: true, render: (t) => <span className="text-[12.5px]">{t.marca ?? "—"}</span> },
    ...(lista?.alcance === "equipo" || lista?.equipo ? [{ key: "responsable", sortable: true, header: "Responsable", hideOnMobile: true,
      render: (t: Tarea) => <span className="text-[12.5px]">{t.responsable ?? <span className="text-muted">Sin responsable</span>}</span> }] : []),
    { key: "vence", sortable: true, header: "Vence", render: (t) => (
      <div className="whitespace-nowrap"><span className={t.vencida ? "font-semibold text-bad" : ""}>{fechaHora(t.due_at)}</span>{t.vencida && <span className="ml-1.5"><Badge tone="bad">Vencida</Badge></span>}</div>) },
    { key: "note", header: "Detalle", hideOnMobile: true, render: (t) => <span className="line-clamp-2 text-[12.5px] text-muted">{t.note ?? "—"}</span> },
    { key: "status", sortable: true, sortKey: "estado", header: "Estado", render: (t) => <StatusBadge status={t.status} labels={ESTADOS} /> },
    { key: "acciones", header: "", align: "right", render: (t) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {t.conversation_id && <Link href={`/m/crm/crm-02?id=${t.conversation_id}`} className="inline-flex h-8 items-center whitespace-nowrap rounded-lg border border-line px-2.5 text-[12.5px] font-semibold text-primary hover:bg-surface-2">Abrir chat</Link>}
        {t.status === "OPEN" && t.task_type === "CALLBACK" && (lista?.telefonia && (t.customer_id || t.lead_id)
          ? <BotonLlamar ref_={{ customer_id: t.customer_id, lead_id: t.customer_id ? null : t.lead_id }} />
          : <span title="Las llamadas desde el sistema llegan con Telefonía. Mientras tanto, llama desde tu celular."><Button size="sm" variant="ghost" icon={Phone} disabled>Llamar</Button></span>)}
        {t.puede_completar && <Button size="sm" variant="primary" onClick={() => setCompletar(t)}>Hecha</Button>}
      </div>) },
  ];
  const o = lista?.opciones;
  return (
    <div className="grid gap-5">
      <PageHeader description="Lo que tienes que hacer con tus clientes: devolver una llamada, ofrecer la recompra, hacer el seguimiento de una encuesta o de un chat sin responder. Cada tarea vence a una hora; al terminarla anota el resultado." />
      {lista?.equipo && (
        <Tabs tabs={[{ key: "mias", label: "Mis tareas" }, { key: "equipo", label: "Todo el equipo" }]} value={f.alcance as "mias" | "equipo"}
          onChange={(k) => setF({ ...f, alcance: k, responsable: "" })} />
      )}
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "OPEN", vence: "" })}><Cifra titulo="Abiertas" valor={numero(c.abiertas)} icono={ListTodo} destacada /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "OPEN", vence: "vencidas" })}><Cifra titulo="Vencidas" valor={numero(c.vencidas)} icono={AlarmClock} tono={c.vencidas ? "bad" : "ok"} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "OPEN", vence: "hoy" })}><Cifra titulo="Vencen hoy" valor={numero(c.hoy)} icono={CalendarClock} tono={c.hoy ? "warn" : undefined} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "DONE", vence: "" })}><Cifra titulo="Hechas" valor={numero(c.hechas)} icono={CheckCircle2} tono="ok" detalle="Clic para verlas" /></button>
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={setVer} empty={f.estado === "DONE" ? "Todavía no hay tareas hechas con estos filtros." : "No tienes tareas pendientes con estos filtros."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar cliente, celular, pedido o detalle…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" todos="todas" ancho={150} vacio="Estado: todas" value={f.estado === "ALL" ? "" : f.estado} onChange={(v) => setF({ ...f, estado: v || "ALL" })}
            options={[{ value: "OPEN", label: "Abiertas" }, { value: "DONE", label: "Hechas" }]} />
          <FiltroSelect etiqueta="Vence" ancho={150} value={f.vence} onChange={(v) => setF({ ...f, vence: v, estado: v ? "OPEN" : f.estado })} options={[{ value: "vencidas", label: "Vencidas" }, { value: "hoy", label: "Hoy" }]} />
          <FiltroSelect etiqueta="Tipo" ancho={200} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={o?.tipos ?? []} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          {f.alcance === "equipo" && <FiltroSelect etiqueta="Responsable" ancho={200} value={f.responsable} onChange={(v) => setF({ ...f, responsable: v })} options={o?.responsables ?? []} />}
        </>} />
      {ver && <FichaTarea t={ver} ficha={Boolean(lista?.ficha)} onClose={() => setVer(null)} onCompletar={() => { setCompletar(ver); setVer(null); }} />}
      {completar && <Completar t={completar} onClose={() => setCompletar(null)} onListo={() => { setCompletar(null); cargar(); }} />}
    </div>
  );
}

function FichaTarea({ t, ficha, onClose, onCompletar }: { t: Tarea; ficha: boolean; onClose: () => void; onCompletar: () => void }) {
  return (
    <Modal open onClose={onClose} title={t.tipo} description={[t.cliente, t.marca].filter(Boolean).join(" · ")}
      footer={t.puede_completar ? <Button variant="primary" onClick={onCompletar}>Marcar hecha</Button> : undefined}>
      <div className="grid gap-3 text-[13px]">
        <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2">
          <dt className="text-muted">Estado</dt><dd><StatusBadge status={t.status} labels={ESTADOS} />{t.vencida && <span className="ml-1.5"><Badge tone="bad">Vencida</Badge></span>}</dd>
          <dt className="text-muted">Vence</dt><dd>{fechaHora(t.due_at)}</dd>
          <dt className="text-muted">Responsable</dt><dd>{t.responsable ?? "Sin responsable"}</dd>
          <dt className="text-muted">Celular</dt><dd className="font-mono">{t.celular ?? "—"}</dd>
          <dt className="text-muted">Pedido</dt><dd>{t.pedido ?? "—"}</dd>
          <dt className="text-muted">Detalle</dt><dd>{t.note ?? "—"}</dd>
          {t.status === "DONE" && <><dt className="text-muted">Resultado</dt><dd>{t.result}</dd><dt className="text-muted">Hecha</dt><dd>{fechaHora(t.done_at)} · {t.hecha_por ?? "—"}</dd></>}
        </dl>
        <div className="flex flex-wrap gap-2">
          {t.conversation_id && <Link href={`/m/crm/crm-02?id=${t.conversation_id}`} className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-primary hover:bg-surface-2">Abrir el chat</Link>}
          {ficha && t.customer_id && <Link href={`/m/crm/crm-04?id=${t.customer_id}`} className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-primary hover:bg-surface-2">Ver ficha 360</Link>}
        </div>
      </div>
    </Modal>
  );
}

function Completar({ t, onClose, onListo }: { t: Tarea; onClose: () => void; onListo: () => void }) {
  const [r, setR] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setEnviando(true);
    try {
      await api(`/v1/crm/tareas/${t.id}/hecha`, { method: "POST", body: { resultado: r } });
      toast.ok("Tarea completada");
      onListo();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Completar tarea" description={`${t.tipo}${t.cliente ? ` · ${t.cliente}` : ""}. Una tarea hecha no se reabre.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} disabled={r.trim().length < 3} onClick={guardar}>Completar</Button></>}>
      <Field label="Resultado" required error={error} hint="Qué pasó: lo que dijo el cliente, si compró, cuándo volver a contactarlo.">
        <Textarea rows={4} maxLength={1000} value={r} onChange={(e) => setR(e.target.value)} />
      </Field>
    </Modal>
  );
}
