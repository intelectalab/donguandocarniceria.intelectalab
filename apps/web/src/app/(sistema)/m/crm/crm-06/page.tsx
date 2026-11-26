"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Headset, Inbox, MessageCircleWarning, Timer } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { duracion, RedEtiqueta } from "@/modulos/crm/conversacion";

type Opcion = { value: string; label: string };
type Panel = {
  cifras: { abiertos: number; en_cola: number; cola_vencida: number; sin_responder: number; primera_respuesta: number | null; primera_respuesta_chats: number; en_linea: number; vendedoras: number };
  limites: { sin_responder: number; cola: number; meta: number }; dia: string; hoy: string;
  opciones: { marcas: Opcion[]; canales: Opcion[]; estados: Opcion[] }; puede: { reasignar: boolean; estado: boolean }; yo: string;
};
type Chat = { id: string; contacto: string; celular: string | null; canal: string; kind: string; marca: string; atiende: string | null; assigned_user_id: string | null; entrada: string; espera: number; en_cola_min: number | null; soy_miembro: boolean; miembros: Opcion[] };
type Vendedora = { id: string; nombre: string; estado: string; estado_name: string; numeros: string; abiertos: number; tope: number; sin_responder: number; primera_respuesta: number | null; pedidos: number; alertas: number };

const ESTADOS: Record<string, [string, Tone]> = { ONLINE: ["En línea", "ok"], AWAY: ["Ausente", "warn"], OFFLINE: ["Desconectada", "neutral"] };

/**
 * CRM-06 Supervisión en vivo: para la supervisora, los chats abiertos por vendedora, la cola sin asignar, los chats sin
 * responder más del límite en horario, la primera respuesta del día y las vendedoras en línea. Reasigna o toma un chat y
 * cambia el estado de una vendedora. Se actualiza sola cada 20 segundos.
 */
export default function Supervision() {
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.conversation.view_all"));
  const [f, setF] = useState({ dia: "", marca: "", canal: "" });
  const [p, setP] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [vuelta, setVuelta] = useState(0);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const filtros = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();

  const cargar = useCallback(() => {
    if (!permitido) return;
    api<Panel>(`/v1/crm/supervision${filtros ? `?${filtros}` : ""}`).then((x) => { setP(x); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [filtros, permitido]);
  useEffect(() => cargar(), [cargar, vuelta]);
  useEffect(() => {
    const t = setInterval(() => setVuelta((n) => n + 1), 20000);
    return () => clearInterval(t);
  }, []);

  if (!permitido) return <Alert tone="warn">La supervisión en vivo es de la supervisora de ventas y la gerencia.</Alert>;
  const c = p?.cifras;
  const lim = p?.limites;
  const lenta = c && lim && c.primera_respuesta !== null && c.primera_respuesta > lim.meta;
  return (
    <div className="grid gap-5">
      <PageHeader description="Los chats abiertos de tus números ahora: la cola sin asignar, los que esperan respuesta y cada vendedora con su estado, sus chats abiertos sobre su tope, su primera respuesta y sus pedidos del día. El tiempo de espera cuenta solo en el horario de atención." />
      <div className="flex flex-wrap items-end gap-3">
        <FiltroFecha etiqueta="Día" visible value={f.dia || p?.dia || ""} max={p?.hoy} onChange={(v) => setF({ ...f, dia: v })} />
        <div className="w-full sm:w-[200px]"><FiltroSelect etiqueta="Marca" todos="todas" ancho={200} value={f.marca} onChange={(v) => setF({ ...f, marca: v, canal: "" })} options={p?.opciones.marcas ?? []} /></div>
        <div className="w-full sm:w-[240px]"><FiltroSelect etiqueta="Número" ancho={240} value={f.canal} onChange={(v) => setF({ ...f, canal: v })} options={p?.opciones.canales ?? []} /></div>
        {p && f.dia && f.dia !== p.hoy && <p className="text-[12px] text-muted">La primera respuesta y los pedidos son del {fecha(p.dia)}; la cola y los chats sin responder son de ahora.</p>}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {c && lim && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Cifra titulo="Chats abiertos" valor={numero(c.abiertos)} icono={Inbox} destacada />
          <Cifra titulo="En cola" valor={numero(c.en_cola)} icono={Clock} tono={c.cola_vencida ? "bad" : undefined}
            detalle={c.cola_vencida ? `${c.cola_vencida} pasó los ${lim.cola} min` : `Aviso a los ${lim.cola} min`} />
          <Cifra titulo={`Sin responder más de ${lim.sin_responder} min`} valor={numero(c.sin_responder)} icono={MessageCircleWarning} tono={c.sin_responder ? "bad" : "ok"} detalle="En horario de atención" />
          <Cifra titulo="Primera respuesta (mediana)" valor={c.primera_respuesta === null ? "—" : duracion(c.primera_respuesta)} icono={Timer}
            tono={c.primera_respuesta === null ? undefined : lenta ? "warn" : "ok"} detalle={`Meta ${lim.meta} min · ${numero(c.primera_respuesta_chats)} chats`} />
          <Cifra titulo="Vendedoras en línea" valor={`${c.en_linea} de ${c.vendedoras}`} icono={Headset} tono={c.vendedoras && !c.en_linea ? "warn" : undefined} />
        </div>
      )}
      {p && (
        <div className="grid items-start gap-5 2xl:grid-cols-2">
          <TablaChats tipo="cola" titulo="Cola sin asignar" vacio="No hay chats en cola." filtros={filtros} panel={p} vuelta={vuelta} onCambio={cargar} />
          <TablaChats tipo="sin-responder" titulo={`Sin responder más de ${p.limites.sin_responder} min`} vacio="Todos los chats tienen respuesta." filtros={filtros} panel={p} vuelta={vuelta} onCambio={cargar} />
        </div>
      )}
      {p && <TablaVendedoras filtros={filtros} panel={p} vuelta={vuelta} onCambio={cargar} />}
    </div>
  );
}

function TablaChats({ tipo, titulo, vacio, filtros, panel, vuelta, onCambio }: { tipo: string; titulo: string; vacio: string; filtros: string; panel: Panel; vuelta: number; onCambio: () => void }) {
  const router = useRouter();
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const [r, setR] = useState<Pagina<Chat> | null>(null);
  const [error, setError] = useState("");
  const [reasignar, setReasignar] = useState<Chat | null>(null);
  const pag = usePagina(filtros + q, 8);
  useEffect(() => {
    const t = setTimeout(() => setQ(buscar.trim()), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    const extra = [filtros, q ? `buscar=${encodeURIComponent(q)}` : "", pag.qs].filter(Boolean).join("&");
    api<Pagina<Chat>>(`/v1/crm/supervision/${tipo}?${extra}`).then((x) => { setR(x); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [tipo, filtros, q, pag.qs]);
  useEffect(() => cargar(), [cargar, vuelta]);

  async function tomar(ch: Chat) {
    try {
      await api(`/v1/crm/conversaciones/${ch.id}/asignar`, { method: "POST", body: { user_id: panel.yo } });
      toast.ok("Chat tomado");
      cargar();
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  const columnas: Column<Chat>[] = [
    { key: "contacto", sortable: true, header: "Contacto", cardTitle: true, render: (x) => <div><p className="font-semibold text-ink">{x.contacto}</p>{x.celular && <p className="font-mono text-[12px] text-muted">{x.celular}</p>}</div> },
    { key: "canal", sortable: true, header: "Número", render: (x) => <div className="text-[12.5px]"><RedEtiqueta kind={x.kind} nombre={x.canal.replace(/^[^·]+·\s*/, "")} /><p className="mt-0.5 text-[11.5px] text-muted">{x.entrada}</p></div> },
    { key: "atiende", sortable: true, header: "Atiende", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.atiende ?? <span className="text-muted">En cola</span>}</span> },
    { key: "espera", sortable: true, header: "Esperando", align: "right", render: (x) => <Badge tone="bad">{duracion(x.espera)}</Badge> },
    { key: "acciones", header: "", align: "right", hideInCard: false, render: (x) => panel.puede.reasignar ? (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="ghost" onClick={() => setReasignar(x)}>Reasignar</Button>
        {x.soy_miembro && x.assigned_user_id !== panel.yo && <Button size="sm" variant="primary" onClick={() => tomar(x)}>Tomar</Button>}
      </div>) : null },
  ];
  return (
    <section className="grid min-w-0 content-start gap-2">
      <h2 className="text-[14px] font-semibold text-ink">{titulo}{r ? <span className="ml-2 text-[12.5px] font-normal text-muted">{numero(r.total)}</span> : null}</h2>
      <DataTable {...pag.orden} columns={columnas} rows={r?.data ?? []} pagination={pag.props(r)} loading={!r && !error} error={error} onRetry={cargar} empty={vacio}
        onRowClick={(x) => router.push(`/m/crm/crm-02?id=${x.id}`)} search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar contacto, celular o vendedora…" }} />
      {reasignar && <Reasignar chat={reasignar} onClose={() => setReasignar(null)} onListo={() => { setReasignar(null); cargar(); onCambio(); }} />}
    </section>
  );
}

function Reasignar({ chat, onClose, onListo }: { chat: Chat; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ user_id: chat.assigned_user_id ?? "", nota: "" });
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setEnviando(true);
    try {
      await api(`/v1/crm/conversaciones/${chat.id}/asignar`, { method: "POST", body: { user_id: d.user_id || null, nota: d.nota || null } });
      toast.ok(d.user_id ? "Chat reasignado" : "Chat devuelto a la cola");
      onListo();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Reasignar el chat" description={`${chat.contacto} · ${chat.canal}. Solo a miembros del número; queda el historial de asignaciones.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3">
        <Field label="Asignar a"><Select value={d.user_id} onChange={(e) => setD({ ...d, user_id: e.target.value })} placeholder="Devolver a la cola" options={chat.miembros} /></Field>
        <Field label="Nota (opcional)"><Input maxLength={255} value={d.nota} onChange={(e) => setD({ ...d, nota: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function TablaVendedoras({ filtros, panel, vuelta, onCambio }: { filtros: string; panel: Panel; vuelta: number; onCambio: () => void }) {
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [r, setR] = useState<Pagina<Vendedora> | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina(filtros + q + estado);
  useEffect(() => {
    const t = setTimeout(() => setQ(buscar.trim()), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    const extra = [filtros, q ? `buscar=${encodeURIComponent(q)}` : "", estado ? `estado=${estado}` : "", pag.qs].filter(Boolean).join("&");
    api<Pagina<Vendedora>>(`/v1/crm/supervision/vendedoras?${extra}`).then((x) => { setR(x); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [filtros, q, estado, pag.qs]);
  useEffect(() => cargar(), [cargar, vuelta]);

  async function cambiar(v: Vendedora, e: string) {
    try {
      await api(`/v1/crm/vendedoras/${v.id}/estado`, { method: "POST", body: { estado: e } });
      toast.ok(`${v.nombre}: ${ESTADOS[e]?.[0] ?? e}`);
      cargar();
      onCambio();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  const columnas: Column<Vendedora>[] = [
    { key: "nombre", sortable: true, header: "Vendedora", cardTitle: true, render: (v) => <div><p className="font-semibold text-ink">{v.nombre}</p><p className="text-[11.5px] text-muted">{v.numeros}</p></div> },
    { key: "estado", sortable: true, header: "Estado", render: (v) => panel.puede.estado ? (
      <div onClick={(e) => e.stopPropagation()} className="w-[150px]">
        <Select aria-label={`Estado de ${v.nombre}`} value={v.estado} onChange={(e) => cambiar(v, e.target.value)} options={panel.opciones.estados} />
      </div>) : <StatusBadge status={v.estado} labels={ESTADOS} /> },
    { key: "abiertos", sortable: true, header: "Abiertos / tope", render: (v) => (
      <div className="min-w-[120px]" title="Chats abiertos en todos sus números sobre su tope">
        <span className="text-[12.5px] tabular-nums">{v.abiertos} / {v.tope}</span>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={`h-full ${v.abiertos >= v.tope ? "bg-bad" : v.abiertos >= v.tope * 0.8 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.min(100, (v.abiertos / Math.max(1, v.tope)) * 100)}%` }} /></div>
      </div>) },
    { key: "sin_responder", sortable: true, header: "Sin responder", align: "right", render: (v) => v.sin_responder ? <Badge tone="bad">{v.sin_responder}</Badge> : <span className="tabular-nums">0</span> },
    { key: "primera_respuesta", sortable: true, header: "1.ª respuesta del día", align: "right", render: (v) => <span className={v.primera_respuesta !== null && v.primera_respuesta > panel.limites.meta ? "text-warn" : ""}>{duracion(v.primera_respuesta)}</span> },
    { key: "pedidos", sortable: true, header: "Pedidos del día", align: "right", render: (v) => <span className="tabular-nums">{v.pedidos}</span> },
    { key: "alertas", sortable: true, header: "Alertas abiertas", align: "right", render: (v) => v.alertas ? <Badge tone="bad">{v.alertas}</Badge> : <span className="tabular-nums">0</span> },
  ];
  return (
    <section className="grid min-w-0 content-start gap-2">
      <h2 className="text-[14px] font-semibold text-ink">Vendedoras{r ? <span className="ml-2 text-[12.5px] font-normal text-muted">{numero(r.total)}</span> : null}</h2>
      <DataTable {...pag.orden} columns={columnas} rows={r?.data ?? []} pagination={pag.props(r)} loading={!r && !error} error={error} onRetry={cargar}
        empty="Ninguna vendedora atiende estos números." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar vendedora o número…" }}
        toolbar={<FiltroSelect etiqueta="Estado" ancho={170} value={estado} onChange={setEstado} options={panel.opciones.estados} />} />
    </section>
  );
}
