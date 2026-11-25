"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, FlaskConical, Hourglass, Inbox, Megaphone, MessagesSquare, Search } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Conversacion, duracion, hora, iniciales, RedEtiqueta, type Ficha, type Opcion, type Resumen } from "@/modulos/crm/conversacion";

type Fila = Resumen & { ultimo: { texto: string; at: string; direction: string } | null };
type Lista = {
  data: Fila[]; total: number; current_page: number; last_page: number;
  cifras: { abiertas: number; en_cola: number; mias: number; sin_responder: number; por_vencer: number; por_anuncio: number }; limite: number;
  canales: Opcion[]; personas: Opcion[]; redes: Opcion[]; estado_agente: { estado: string; estado_name: string; miembro: boolean }; simulador: boolean;
  puede: { responder: boolean; reasignar: boolean };
};

const VACIO = { estado: "OPEN", canal: "", red: "", asignada: "", sin_responder: false, por_vencer: false, por_anuncio: false, buscar: "" };

/**
 * CRM-01 Bandeja: los chats de los números donde atiendes, con el tiempo sin respuesta y la ventana vigente. A la
 * derecha, la conversación elegida (en el celular se abre en su propia pantalla).
 */
export default function Bandeja() {
  const router = useRouter();
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.conversation.view_own") || can("crm.conversation.view_all"));
  const [f, setF] = useState({ ...VACIO, asignada: can("crm.conversation.view_all") ? "" : "me" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [conv, setConv] = useState<Ficha | null>(null);
  const [pag, setPag] = useState({ n: 1, clave: "" });
  const [simular, setSimular] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  // La página vuelve a 1 cuando cambian los filtros o la marca.
  const clave = JSON.stringify(f) + marca;
  const pagina = pag.clave === clave ? pag.n : 1;
  const setPagina = (n: number) => setPag({ n, clave });

  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: marca !== "ALL" ? marca : "" }).filter(([, v]) => v !== "" && v !== false).map(([k, v]) => [k, v === true ? "1" : String(v)]));
    q.set("page", String(pagina)); q.set("per_page", "40");
    api<Lista>(`/v1/crm/conversaciones?${q}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, marca, pagina, permitido]);
  useEffect(() => cargar(), [cargar]);

  const elegido = sel && lista?.data.some((x) => x.id === sel) ? sel : lista?.data[0]?.id ?? null;
  const cargarConv = useCallback(() => {
    if (!elegido) return;
    api<Ficha>(`/v1/crm/conversaciones/${elegido}`).then(setConv).catch((e) => toast.error(mensajeDe(e)));
  }, [elegido]);
  useEffect(() => cargarConv(), [cargarConv]);

  // Se actualiza sola cada 20 segundos (chats nuevos, asignaciones, ventanas).
  useEffect(() => {
    const t = setInterval(() => { cargar(); cargarConv(); }, 20000);
    return () => clearInterval(t);
  }, [cargar, cargarConv]);

  if (!permitido) return <Alert tone="warn">Tu rol no atiende chats.</Alert>;

  async function marcarEstado(estado: string) {
    try {
      await api("/v1/crm/mi-estado", { method: "POST", body: { estado } });
      toast.ok(estado === "ONLINE" ? "Estás en línea: recibes chats nuevos" : estado === "AWAY" ? "Estás ausente: no recibes chats nuevos" : "Te desconectaste");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  function abrir(id: string) {
    if (typeof window !== "undefined" && window.innerWidth < 1024) router.push(`/m/crm/crm-02?id=${id}`);
    else setSel(id);
  }

  const c = lista?.cifras;
  const filtro = (k: Partial<typeof VACIO>) => setF({ ...VACIO, asignada: f.asignada, ...k });
  const ea = lista?.estado_agente;
  return (
    <div className="grid gap-5">
      <PageHeader description="Los chats de los números y cuentas donde atiendes. Cada uno muestra la red, el número, cuánto lleva sin respuesta (en horario de atención) y la ventana vigente para responder sin plantilla."
        actions={<div className="flex flex-wrap items-center gap-2">
          {ea?.miembro && (
            <div className="w-[190px]">
              <Select aria-label="Mi estado" value={ea.estado} onChange={(e) => marcarEstado(e.target.value)}
                options={[{ value: "ONLINE", label: "● En línea" }, { value: "AWAY", label: "◐ Ausente" }, { value: "OFFLINE", label: "○ Desconectada" }]} />
            </div>
          )}
          {lista?.simulador && <Button icon={FlaskConical} onClick={() => setSimular(true)}>Simular chat nuevo</Button>}
        </div>} />
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <button type="button" className="cursor-pointer text-left" onClick={() => filtro({})}><Cifra titulo="Abiertas" valor={String(c.abiertas)} icono={MessagesSquare} destacada detalle={`${c.mias} asignadas a mí`} /></button>
          <button type="button" className="cursor-pointer text-left" onClick={() => setF({ ...VACIO, asignada: "none" })}><Cifra titulo="En cola" valor={String(c.en_cola)} icono={Inbox} tono={c.en_cola ? "warn" : undefined} detalle="Sin vendedora asignada" /></button>
          <button type="button" className="cursor-pointer text-left" onClick={() => filtro({ sin_responder: true })}><Cifra titulo={`Sin responder > ${lista.limite} min`} valor={String(c.sin_responder)} icono={AlarmClock} tono={c.sin_responder ? "bad" : "ok"} detalle="El cliente espera" /></button>
          <button type="button" className="cursor-pointer text-left" onClick={() => filtro({ por_vencer: true })}><Cifra titulo="Ventana por vencer" valor={String(c.por_vencer)} icono={Hourglass} tono={c.por_vencer ? "warn" : undefined} detalle="Menos de 2 h para responder gratis" /></button>
          <button type="button" className="cursor-pointer text-left" onClick={() => filtro({ por_anuncio: true })}><Cifra titulo="Llegaron por anuncio" valor={String(c.por_anuncio)} icono={Megaphone} detalle="Clic a WhatsApp, código o TikTok" /></button>
        </div>
      )}
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        <section className="grid content-start overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="grid gap-2 border-b border-line p-3">
            <div className="flex gap-1">
              {[["OPEN", "Abiertas"], ["CLOSED", "Cerradas"], ["ALL", "Todas"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setF({ ...f, estado: v })}
                  className={`cursor-pointer rounded-full px-3 py-1 text-[12.5px] font-semibold ${f.estado === v ? "bg-primary text-primary-ink" : "bg-surface-2 text-ink hover:brightness-95"}`}>{l}</button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input className="!pl-9" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar contacto, número o anuncio…" aria-label="Buscar" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FiltroSelect etiqueta="Número" ancho={170} value={f.canal} onChange={(v) => setF({ ...f, canal: v })} options={lista?.canales ?? []} />
              <FiltroSelect etiqueta="Red" todos="todas" ancho={170} value={f.red} onChange={(v) => setF({ ...f, red: v })} options={lista?.redes ?? []} />
              <div className="col-span-2">
                <FiltroSelect etiqueta="Asignada" todos="todas" ancho={360} value={f.asignada} onChange={(v) => setF({ ...f, asignada: v })}
                  options={[{ value: "me", label: "A mí" }, { value: "none", label: "En cola" }, ...(lista?.personas ?? [])]} />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Checkbox checked={f.sin_responder} onChange={(v) => setF({ ...f, sin_responder: v })} label="Sin responder" />
              <Checkbox checked={f.por_vencer} onChange={(v) => setF({ ...f, por_vencer: v })} label="Ventana por vencer" />
              <Checkbox checked={f.por_anuncio} onChange={(v) => setF({ ...f, por_anuncio: v })} label="Por anuncio" />
            </div>
          </div>
          <ul className="max-h-[70vh] overflow-y-auto">
            {!lista && !error && <li className="p-6 text-center text-[13px] text-muted">Cargando…</li>}
            {lista && lista.data.length === 0 && <li className="p-6 text-center text-[13px] text-muted">No hay conversaciones con estos filtros.</li>}
            {lista?.data.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => abrir(x.id)}
                  className={`grid w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line/70 px-3 py-2.5 text-left hover:bg-surface-2/60 ${elegido === x.id ? "bg-primary-soft/60" : ""}`}>
                  <span className="grid size-10 place-items-center rounded-full border-2 bg-surface-2 text-[13px] font-semibold text-ink" style={{ borderColor: x.brand_color ?? "var(--color-line)" }}>{iniciales(x.contacto)}</span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate text-[13.5px] font-semibold text-ink">{x.contacto}</span>
                    <span className="truncate text-[12.5px] text-muted">{x.ultimo?.texto ?? "—"}</span>
                    <span className="flex flex-wrap gap-1">
                      <RedEtiqueta kind={x.kind} nombre={x.channel_name} />
                      {x.por_anuncio && <span className="rounded-md bg-info/15 px-1.5 py-0.5 text-[11px] text-info">Anuncio {x.ad_code ?? ""}</span>}
                      {!x.es_cliente && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink">Lead</span>}
                    </span>
                  </span>
                  <span className="grid justify-items-end gap-1 text-[11px] text-muted">
                    <span>{x.ultimo ? hora(x.ultimo.at) : ""}</span>
                    {x.espera_min > 0 ? <Badge tone={x.espera_min > (lista.limite ?? 15) ? "bad" : "warn"}>{x.espera_min >= 720 && x.last_inbound_at ? `Desde ${fecha(x.last_inbound_at).slice(0, 5)}` : duracion(x.espera_min)}</Badge>
                      : x.status === "CLOSED" ? <Badge tone="neutral">Cerrada</Badge>
                      : x.ventana_abierta ? ((x.ventana_min ?? 999) < 120 ? <Badge tone="warn">Vence {duracion(x.ventana_min)}</Badge> : null)
                      : <Badge tone="bad">{x.kind === "WHATSAPP" ? "Solo plantilla" : "Ventana vencida"}</Badge>}
                    <span>{x.assigned_name ? x.assigned_name.split(" ")[0] : "En cola"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {lista && lista.last_page > 1 && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12.5px] text-muted">
              <span>{lista.total} chats</span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
                <Button size="sm" variant="ghost" disabled={pagina >= lista.last_page} onClick={() => setPagina(pagina + 1)}>Siguiente</Button>
              </span>
            </div>
          )}
        </section>
        <div className="hidden lg:block">
          {conv && conv.id === elegido ? <Conversacion c={conv} enLista onCambio={(x) => { setConv(x); cargar(); }} />
            : <section className="grid min-h-[300px] place-items-center rounded-xl border border-line bg-surface p-6 text-[13px] text-muted shadow-card">Elige una conversación.</section>}
        </div>
      </div>
      {simular && lista && <SimularNuevo canales={lista.canales} onClose={() => setSimular(false)} onListo={(id) => { setSimular(false); setSel(id); cargar(); }} />}
    </div>
  );
}

function SimularNuevo({ canales, onClose, onListo }: { canales: Opcion[]; onClose: () => void; onListo: (id: string) => void }) {
  const [d, setD] = useState({ channel_id: canales[0]?.value ?? "", from: "+51900", name: "", texto: "Hola, quiero hacer un pedido para mañana", anuncio: "" });
  const [error, setError] = useState("");
  return (
    <Modal open onClose={onClose} title="Simular un chat nuevo" description="Solo en el entorno de prueba: entra como si llegara del proveedor, con el aviso de registro, el reparto y el lead."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={async () => {
        setError("");
        try {
          const r = await api<{ conversation_id: string; assigned: string | null }>("/v1/crm/simular", { method: "POST", body: { ...d, anuncio: d.anuncio || null, name: d.name || null } });
          toast.ok(r.assigned ? "Chat recibido y asignado" : "Chat recibido: quedó en cola (nadie en turno y en línea)");
          onListo(r.conversation_id);
        } catch (e) { setError(mensajeDe(e)); }
      }}>Recibir</Button></>}>
      <div className="grid gap-3">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Número o cuenta"><Select value={d.channel_id} onChange={(e) => setD({ ...d, channel_id: e.target.value })} options={canales} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Celular del cliente" hint="Formato internacional."><Input value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} /></Field>
          <Field label="Nombre (opcional)"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        </div>
        <Field label="Mensaje"><Textarea rows={3} maxLength={1000} value={d.texto} onChange={(e) => setD({ ...d, texto: e.target.value })} /></Field>
        <Field label="Código de anuncio (opcional)" hint="Como si llegara por un anuncio de clic a WhatsApp: abre la ventana gratuita de 72 h."><Input value={d.anuncio} onChange={(e) => setD({ ...d, anuncio: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
