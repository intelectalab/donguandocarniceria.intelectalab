"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlarmClock, CalendarClock, CheckCircle2, ListTodo, Phone, Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { BotonLlamar } from "@/modulos/tel/BotonLlamar";

type Opcion = { value: string; label: string };
type Tarea = {
  id: string; task_type: string; tipo: string; cliente: string | null; celular: string | null; customer_id: string | null; lead_id: string | null; conversation_id: string | null; pedido: string | null;
  marca: string | null; responsable: string | null; due_at: string; note: string | null; status: string; vencida: boolean; done_at: string | null; result: string | null;
  hecha_por: string | null; encargada_por: string | null; puede_completar: boolean;
};
type Lista = Pagina<Tarea> & {
  cifras: { abiertas: number; vencidas: number; hoy: number; hechas: number }; alcance: "mias" | "equipo"; equipo: boolean; telefonia: boolean; ficha: boolean;
  opciones: { tipos: Opcion[]; marcas: Opcion[]; responsables: Opcion[] }; encargar: { puede: boolean; a_otras: boolean }; recortada: boolean;
};
type VistaTareas = "kanban" | "agenda" | "lista";

/** Fecha (AAAA-MM-DD) en hora de Lima, para repartir las tareas por día. */
const diaLima = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const masDias = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const suscribirVista = (aviso: () => void) => { window.addEventListener("vista-crm-17", aviso); return () => window.removeEventListener("vista-crm-17", aviso); };
const leerVista = (): VistaTareas => { try { const v = localStorage.getItem("vista.crm-17"); return v === "agenda" || v === "lista" ? v : "kanban"; } catch { return "kanban"; } };

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
  const [encargar, setEncargar] = useState(false);
  // La vista elegida se recuerda en este navegador.
  const vista = useSyncExternalStore(suscribirVista, leerVista, () => "kanban" as VistaTareas);
  const setVista = (v: VistaTareas) => { try { localStorage.setItem("vista.crm-17", v); } catch { /* sin almacenamiento */ } window.dispatchEvent(new Event("vista-crm-17")); };
  const tablero = vista !== "lista";
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca, tablero }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca, tablero: tablero ? "1" : "" }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/tareas?${q}${tablero ? "" : `&${pag.qs}`}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, permitido, tablero]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no tiene tareas de ventas.</Alert>;
  const c = lista?.cifras;
  const acciones = (t: Tarea) => (
    <>
      {t.conversation_id && <Link href={`/m/crm/crm-02?id=${t.conversation_id}`} className="inline-flex h-8 items-center whitespace-nowrap rounded-lg border border-line px-2.5 text-[12.5px] font-semibold text-primary hover:bg-surface-2">Abrir chat</Link>}
      {t.status === "OPEN" && t.task_type === "CALLBACK" && (lista?.telefonia && (t.customer_id || t.lead_id)
        ? <BotonLlamar ref_={{ customer_id: t.customer_id, lead_id: t.customer_id ? null : t.lead_id }} />
        : <span title="Las llamadas desde el sistema llegan con Telefonía. Mientras tanto, llama desde tu celular."><Button size="sm" variant="ghost" icon={Phone} disabled>Llamar</Button></span>)}
      {t.puede_completar && <Button size="sm" variant="primary" onClick={() => setCompletar(t)}>Hecha</Button>}
    </>
  );
  const columnas: Column<Tarea>[] = [
    { key: "tipo", sortable: true, header: "Tipo", render: (t) => <span className="text-[12.5px] font-semibold text-ink">{t.tipo}</span> },
    { key: "cliente", sortable: true, header: "Cliente o chat", cardTitle: true, render: (t) => (
      <div><p className="font-semibold text-ink">{t.cliente ?? "—"}</p>{t.celular && <p className="font-mono text-[12px] text-muted">{t.celular}</p>}{t.pedido && <p className="text-[11.5px] text-muted">Pedido {t.pedido}</p>}</div>) },
    { key: "marca", sortable: true, header: "Marca", hideOnMobile: true, render: (t) => <span className="text-[12.5px]">{t.marca ?? "—"}</span> },
    ...(lista?.alcance === "equipo" || lista?.equipo ? [{ key: "responsable", sortable: true, header: "Responsable", hideOnMobile: true,
      render: (t: Tarea) => <span className="text-[12.5px]">{t.responsable ?? <span className="text-muted">Sin responsable</span>}</span> }] : []),
    { key: "vence", sortable: true, header: "Vence", render: (t) => (
      <div className="whitespace-nowrap"><span className={t.vencida ? "font-semibold text-bad" : ""}>{fechaHora(t.due_at)}</span>{t.vencida && <span className="ml-1.5"><Badge tone="bad">Vencida</Badge></span>}</div>) },
    { key: "note", header: "Detalle", hideOnMobile: true, render: (t) => <div className="text-[12.5px] text-muted"><span className="line-clamp-2">{t.note ?? "—"}</span>{t.encargada_por && <span className="text-[11.5px]">Encargada por {t.encargada_por}</span>}</div> },
    { key: "status", sortable: true, sortKey: "estado", header: "Estado", render: (t) => <StatusBadge status={t.status} labels={ESTADOS} /> },
    { key: "acciones", header: "", align: "right", render: (t) => <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>{acciones(t)}</div> },
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Ver como" className="inline-flex rounded-full bg-surface-2 p-1">
          {([["kanban", "Kanban"], ["agenda", "Agenda"], ["lista", "Lista"]] as const).map(([v, nombre]) => (
            <button key={v} type="button" aria-pressed={vista === v} onClick={() => setVista(v)}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${vista === v ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink"}`}>{nombre}</button>
          ))}
        </div>
        {lista?.encargar.puede && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEncargar(true)}>{lista.encargar.a_otras ? "Encargar actividad" : "Nueva actividad"}</Button>}
      </div>
      {tablero && lista?.recortada && <Alert tone="info">Hay muchas tareas abiertas: el tablero muestra las 300 más próximas. Usa el buscador o los filtros, o la vista Lista.</Alert>}
      <DataTable {...pag.orden} columns={columnas} rows={tablero ? [] : lista?.data ?? []} pagination={tablero ? undefined : pag.props(lista)} loading={!tablero && !lista && !error} error={tablero ? undefined : error} onRetry={cargar}
        onRowClick={setVer} empty={f.estado === "DONE" ? "Todavía no hay tareas hechas con estos filtros." : "No tienes tareas pendientes con estos filtros."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar cliente, celular, pedido o detalle…" }}
        soloBarra={tablero}
        toolbar={<>
          {!tablero && <FiltroSelect etiqueta="Estado" todos="todas" ancho={150} vacio="Estado: todas" value={f.estado === "ALL" ? "" : f.estado} onChange={(v) => setF({ ...f, estado: v || "ALL" })}
            options={[{ value: "OPEN", label: "Abiertas" }, { value: "DONE", label: "Hechas" }]} />}
          {!tablero && <FiltroSelect etiqueta="Vence" ancho={150} value={f.vence} onChange={(v) => setF({ ...f, vence: v, estado: v ? "OPEN" : f.estado })} options={[{ value: "vencidas", label: "Vencidas" }, { value: "hoy", label: "Hoy" }]} />}
          <FiltroSelect etiqueta="Tipo" ancho={200} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={o?.tipos ?? []} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          {f.alcance === "equipo" && <FiltroSelect etiqueta="Responsable" ancho={200} value={f.responsable} onChange={(v) => setF({ ...f, responsable: v })} options={o?.responsables ?? []} />}
        </>} />
      {tablero && (error ? <Alert tone="bad">{error}</Alert> : lista ? <Tablero key={JSON.stringify(lista.cifras) + lista.data.length} tareas={lista.data} vista={vista} acciones={acciones} onVer={setVer} /> : <p className="text-[13px] text-muted">Cargando…</p>)}
      {encargar && <Encargar onClose={() => setEncargar(false)} onListo={() => { setEncargar(false); cargar(); }} />}
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
          {t.encargada_por && <><dt className="text-muted">Encargada por</dt><dd>{t.encargada_por}</dd></>}
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

/** Kanban (vencidas, hoy, próximos días, hechas) o agenda (hoy, mañana, resto de la semana, más adelante). */
function Tablero({ tareas, vista, acciones, onVer }: { tareas: Tarea[]; vista: VistaTareas; acciones: (t: Tarea) => React.ReactNode; onVer: (t: Tarea) => void }) {
  const [ahora] = useState(() => Date.now());
  const columnas = useMemo(() => {
    const hoy = diaLima(new Date());
    const abiertas = tareas.filter((t) => t.status === "OPEN").sort((a, b) => a.due_at.localeCompare(b.due_at));
    const dia = (t: Tarea) => diaLima(t.due_at);
    const cols: [string, Tarea[], Tone | undefined][] = vista === "kanban"
      ? [
        ["Vencidas", abiertas.filter((t) => new Date(t.due_at).getTime() < ahora), "bad"],
        ["Hoy", abiertas.filter((t) => new Date(t.due_at).getTime() >= ahora && dia(t) === hoy), "warn"],
        ["Próximos días", abiertas.filter((t) => dia(t) > hoy), undefined],
        ["Hechas", tareas.filter((t) => t.status === "DONE"), "ok"],
      ]
      : [
        ["Hoy", abiertas.filter((t) => dia(t) <= hoy), "warn"],
        ["Mañana", abiertas.filter((t) => dia(t) === masDias(hoy, 1)), undefined],
        ["Resto de la semana", abiertas.filter((t) => dia(t) > masDias(hoy, 1) && dia(t) <= masDias(hoy, 7)), undefined],
        ["Más adelante", abiertas.filter((t) => dia(t) > masDias(hoy, 7)), undefined],
      ];
    return cols;
  }, [tareas, vista, ahora]);
  return (
    <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
      {columnas.map(([titulo, items, tono]) => (
        <section key={titulo} className="grid w-[280px] shrink-0 snap-start content-start gap-2 rounded-xl bg-surface-2 p-2.5 lg:w-auto">
          <header className="flex items-center justify-between px-1">
            <h2 className="text-[13.5px] font-semibold text-ink">{titulo}</h2>
            <Badge tone={tono ?? "neutral"}>{numero(items.length)}</Badge>
          </header>
          {items.length === 0 && <p className="px-1 py-3 text-[12.5px] text-muted">Nada por aquí.</p>}
          {items.map((t) => (
            <article key={t.id} role="button" tabIndex={0} onClick={() => onVer(t)} onKeyDown={(e) => { if (e.key === "Enter") onVer(t); }}
              className="grid cursor-pointer gap-1 rounded-lg border border-line bg-surface p-2.5 text-[12.5px] shadow-card hover:border-primary/50">
              <div className="flex items-start justify-between gap-2">
                <b className="text-[13px] text-ink">{t.tipo}</b>
                <Badge tone={t.vencida ? "bad" : "neutral"}>{fechaHora(t.status === "DONE" && t.done_at ? t.done_at : t.due_at)}</Badge>
              </div>
              <span className="font-semibold text-ink">{t.cliente ?? "—"}{t.marca && <span className="font-normal text-muted"> · {t.marca}</span>}</span>
              {t.note && <span className="line-clamp-2 text-muted">{t.note}</span>}
              <span className="text-[11.5px] text-muted">{t.responsable ?? "Sin responsable"}{t.encargada_por ? ` · encargada por ${t.encargada_por}` : ""}</span>
              {t.status === "DONE"
                ? <span className="line-clamp-2"><span className="text-muted">Resultado:</span> {t.result ?? "—"}</span>
                : <div className="mt-1 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>{acciones(t)}</div>}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

type Encargables = { tipos: Opcion[]; marcas: Opcion[]; personas: (Opcion & { marcas: string[] | null })[]; a_otras: boolean; yo: string };

/** Encargar actividad (supervisión a su equipo) o nueva actividad (la vendedora para sí). Se le avisa a la responsable. */
function Encargar({ onClose, onListo }: { onClose: () => void; onListo: () => void }) {
  const { marca: marcaSesion } = useSesion();
  const [op, setOp] = useState<Encargables | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const manana = () => { const h = diaLima(new Date()); const ahora = new Date(); return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", hour12: false }).format(ahora) >= "17" ? masDias(h, 1) : h; };
  const [d, setD] = useState({ task_type: "FOLLOW_UP", brand_id: "", assigned_user_id: "", customer_id: "", due_at: `${manana()}T17:00`, note: "" });
  const [cliente, setCliente] = useState<{ texto: string; elegido: string }>({ texto: "", elegido: "" });
  const [resultados, setResultados] = useState<Opcion[]>([]);

  useEffect(() => {
    api<Encargables>("/v1/crm/tareas/encargables").then((r) => {
      setOp(r);
      const marca = r.marcas.find((m) => m.value === marcaSesion)?.value ?? r.marcas[0]?.value ?? "";
      setD((x) => ({ ...x, brand_id: marca, assigned_user_id: r.a_otras ? "" : r.yo }));
    }).catch((e) => setError(mensajeDe(e)));
  }, [marcaSesion]);
  useEffect(() => {
    const t = cliente.texto.trim();
    if (t.length < 2 || cliente.elegido) return;
    const h = setTimeout(() => api<{ data: Opcion[] }>(`/v1/crm/tareas/clientes?buscar=${encodeURIComponent(t)}`).then((r) => setResultados(r.data)).catch(() => setResultados([])), 300);
    return () => clearTimeout(h);
  }, [cliente]);

  const sugerencias = cliente.texto.trim().length >= 2 && !cliente.elegido ? resultados : [];
  const personas = (op?.personas ?? []).filter((p) => !d.brand_id || p.marcas === null || p.marcas.includes(d.brand_id));
  async function guardar() {
    setEnviando(true);
    setError("");
    try {
      await api("/v1/crm/tareas", { method: "POST", body: { ...d, customer_id: d.customer_id || null } });
      const quien = op?.personas.find((p) => p.value === d.assigned_user_id)?.label;
      toast.ok(op?.a_otras && d.assigned_user_id !== op.yo ? `Actividad encargada y avisada a ${quien}` : "Actividad registrada");
      onListo();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  const listo = d.brand_id && d.assigned_user_id && d.due_at && d.note.trim().length >= 3 && (d.task_type !== "REBUY" || d.customer_id);
  return (
    <Modal open onClose={onClose} title={op?.a_otras ? "Encargar actividad" : "Nueva actividad"}
      description={op?.a_otras ? "La vendedora la ve en Mis tareas y recibe un aviso." : "Queda en tus tareas con su vencimiento."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} disabled={!listo} onClick={guardar}>Guardar actividad</Button></>}>
      {!op && !error && <p className="text-[13px] text-muted">Cargando…</p>}
      {error && <Alert tone="bad">{error}</Alert>}
      {op && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo" required><Select value={d.task_type} onChange={(e) => setD({ ...d, task_type: e.target.value })} options={op.tipos} /></Field>
          <Field label="Marca" required><Select value={d.brand_id} onChange={(e) => setD({ ...d, brand_id: e.target.value, assigned_user_id: op.a_otras ? "" : d.assigned_user_id })} options={op.marcas} /></Field>
          {op.a_otras && (
            <Field label="Encargar a" required className="sm:col-span-2">
              <Select value={d.assigned_user_id} onChange={(e) => setD({ ...d, assigned_user_id: e.target.value })} placeholder="Elige a la vendedora" options={personas} searchable />
            </Field>
          )}
          <Field label="Cliente" required={d.task_type === "REBUY"} className="sm:col-span-2" hint={d.task_type === "REBUY" ? "La recompra siempre es con un cliente." : "Opcional. Escribe al menos 2 letras del nombre, celular o documento."}>
            <div className="relative">
              <Input value={cliente.texto} placeholder="Buscar cliente…" onChange={(e) => { setCliente({ texto: e.target.value, elegido: "" }); setD({ ...d, customer_id: "" }); }} />
              {sugerencias.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-card">
                  {sugerencias.map((r) => (
                    <li key={r.value}><button type="button" className="w-full cursor-pointer px-3 py-1.5 text-left text-[13px] hover:bg-surface-2"
                      onClick={() => { setCliente({ texto: r.label, elegido: r.value }); setD({ ...d, customer_id: r.value }); setResultados([]); }}>{r.label}</button></li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
          <Field label="Vence" required><Input type="datetime-local" value={d.due_at} min={`${diaLima(new Date())}T00:00`} onChange={(e) => setD({ ...d, due_at: e.target.value })} /></Field>
          <Field label="Indicación" required className="sm:col-span-2" hint="Qué hay que hacer, por ejemplo: «Enviar cotización del lechón para 25 personas».">
            <Textarea rows={3} maxLength={255} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
