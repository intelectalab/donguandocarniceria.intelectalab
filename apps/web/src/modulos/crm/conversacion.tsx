"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Check, CheckCheck, Clock, FlaskConical, Lock, MessageSquareText, RotateCcw, Send, StickyNote, Tag, UserCog, X } from "lucide-react";
import { Alert, Badge, Button, DetailList, Field, Modal, Select, Textarea, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";

export type Opcion = { value: string; label: string };
export type Resumen = {
  id: string; status: string; status_name: string; kind: string; kind_name: string; channel_id: string; channel_name: string; channel_number: string; brand_id: string;
  brand_name: string; brand_color: string | null; contacto: string; numero_cliente: string; es_cliente: boolean; customer_id: string | null; lead_id: string | null;
  assigned_user_id: string | null; assigned_name: string | null; entry_point: string; entry_name: string; ad_code: string | null; por_anuncio: boolean;
  opened_at: string; last_inbound_at: string | null; first_response_at: string | null; closed_at: string | null; close_reason: string | null; close_name: string | null;
  espera_min: number; ventana_abierta: boolean; ventana_min: number | null; tags: string[];
};
export type Mensaje = {
  id: string; direction: "IN" | "OUT"; origin: string; origin_name: string; msg_type: string; body: string | null; media: Record<string, unknown> | null;
  referral: { ad_code?: string; headline?: string } | null; unsupported_kind: string | null; sent_at: string; sender_name: string | null; template_name: string | null;
  category: string | null; category_name: string | null; transcript: string | null; estado: string | null; estado_name: string | null; borrado_cliente: boolean; borrado_app: boolean;
  estados: { status: string; name: string; at: string }[]; costo: { amount: number; reason: string } | null; external_id: string;
};
export type Ficha = Resumen & {
  mensajes: Mensaje[]; notas: { at: string; user_name: string; text: string }[];
  ventana: { horas: number; abierta: boolean; vence: string | null; minutos: number | null; anuncio: boolean; anuncio_minutos: number | null; tiktok_seguidos: number | null; tiktok_max: number | null; plantillas: boolean };
  costo_proximo: { usadas: number; cuota: number; servicio: { amount: number; reason: string }; utilidad: { amount: number; reason: string }; marketing: { amount: number; reason: string } } | null;
  proveedor: { conectado: boolean; codigo: string | null; prueba: boolean; aviso: string | null };
  puede: { responder: boolean; reasignar: boolean; cerrar: boolean; notas: boolean; simular: boolean };
  miembros: Opcion[]; cierres: Opcion[]; etiquetas: string[]; respuestas: { id: string; shortcut: string; body: string }[];
  cliente: { id: string; nombre: string; celular: string | null; documento: string | null; pedidos: number; ultimos: { id: string; number: string; status: string; at: string; total: number }[]; marketing: boolean | null } | null;
  lead: { id: string; status: string; source: string; ad_code: string | null; first_contact_at: string; lost_reason: string | null; full_name: string } | null;
  pedidos_chat: { id: string; number: string; status: string; total: number; anuncio: string | null }[];
  tareas: { id: string; task_type: string; due_at: string; note: string | null }[];
};

const LEAD: Record<string, [string, Tone]> = { NEW: ["Nuevo", "info"], CONTACTED: ["Contactado", "info"], QUALIFIED: ["Calificado", "warn"], WON: ["Ganado", "ok"], LOST: ["Perdido", "bad"], DISCARDED: ["Descartado", "neutral"] };
const TAREA: Record<string, string> = { CALLBACK: "Devolver llamada", REBUY: "Recompra", FOLLOW_UP: "Seguimiento", SURVEY_FOLLOW_UP: "Seguimiento de encuesta", ALERT_REVIEW: "Revisar alerta", UNANSWERED_CHAT: "Chat sin responder" };

/** «2 h 15 min», «3 días». */
export function duracion(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${Math.max(0, Math.round(min))} min`;
  if (min < 60 * 24) { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(min / 1440);
  return d === 1 ? "1 día" : `${d} días`;
}

/** Tarifa de WhatsApp con sus 4 decimales (S/ 0,2339). */
export function tarifa(x: number): string {
  return `S/ ${numero(x, 4)}`;
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });
}

export function iniciales(n: string): string {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "?";
}

export function RedEtiqueta({ kind, nombre }: { kind: string; nombre: string }) {
  const tono: Record<string, string> = { WHATSAPP: "bg-[#25D366]/15 text-[#1DAA55]", MESSENGER: "bg-[#3B82F6]/15 text-[#3B82F6]", INSTAGRAM: "bg-[#E1306C]/15 text-[#E1306C]", TIKTOK: "bg-ink/10 text-ink" };
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tono[kind] ?? "bg-surface-2 text-ink"}`}>{nombre}</span>;
}

/** Ventana de la red (24 h, 48 h de TikTok) y la de 72 h por anuncio. */
export function Ventanas({ c }: { c: Ficha }) {
  if (c.status === "CLOSED") return null;
  const v = c.ventana;
  return (
    <div className="flex flex-wrap gap-1.5">
      {c.kind === "TIKTOK"
        ? <Badge tone={v.abierta ? ((v.minutos ?? 0) < 240 ? "warn" : "info") : "bad"} dot>{v.abierta ? `TikTok 48 h: quedan ${duracion(v.minutos)} · ${v.tiktok_seguidos}/${v.tiktok_max} seguidos` : "TikTok: ventana de 48 h vencida"}</Badge>
        : <Badge tone={v.abierta ? ((v.minutos ?? 0) < 120 ? "warn" : "ok") : "bad"} dot>{v.abierta ? `Ventana de ${v.horas} h: quedan ${duracion(v.minutos)}` : v.plantillas ? "Fuera de ventana: solo plantilla" : `Ventana de ${v.horas} h vencida`}</Badge>}
      {v.anuncio && <Badge tone="info" dot>Anuncio, 72 h gratis: {duracion(v.anuncio_minutos)}</Badge>}
      {c.tags.map((t) => <span key={t} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink">{t}</span>)}
    </div>
  );
}

function Estado({ m }: { m: Mensaje }) {
  if (m.direction !== "OUT" || !m.estado) return null;
  const I = m.estado === "READ" || m.estado === "DELIVERED" ? CheckCheck : m.estado === "SENT" ? Check : m.estado === "NOT_SENT" ? X : Clock;
  return <span title={m.estado_name ?? ""} className={`inline-flex items-center ${m.estado === "READ" ? "text-info" : m.estado === "NOT_SENT" || m.estado === "FAILED" ? "text-bad" : ""}`}><I className="size-3.5" /></span>;
}

function Cuerpo({ m }: { m: Mensaje }) {
  const media = m.media ?? {};
  return (
    <div className="grid gap-1">
      {m.template_name && <span className="text-[11px] font-semibold uppercase tracking-wide opacity-75">Plantilla · {m.category_name} · {m.template_name}</span>}
      {m.msg_type === "UNSUPPORTED" ? <span className="italic opacity-80">Mensaje no disponible ({m.unsupported_kind === "VIEW_ONCE" ? "«ver una vez»" : m.unsupported_kind === "LIVE_LOCATION" ? "ubicación en vivo" : "temporal"}): WhatsApp no lo entrega con la coexistencia.</span>
        : m.msg_type === "AUDIO" ? <span>Nota de voz{m.transcript ? <span className="mt-1 block text-[12.5px] italic opacity-85">Transcripción: {m.transcript}</span> : null}</span>
        : m.msg_type === "LOCATION" ? <span>Ubicación: {String(media.label ?? "")} ({String(media.lat ?? "")}, {String(media.lng ?? "")})</span>
        : m.msg_type === "IMAGE" ? <span>[Foto] {m.body}</span>
        : m.msg_type === "DOCUMENT" ? <span>[Documento] {m.body}</span>
        : m.msg_type === "PRODUCT" ? <span><b className="block text-[11px] uppercase tracking-wide opacity-75">Producto del catálogo</b>{m.body}</span>
        : <span className="whitespace-pre-wrap break-words">{m.body}</span>}
      {m.referral && <span className="text-[11.5px] opacity-80">Llegó por el anuncio {m.referral.ad_code} {m.referral.headline ? `· ${m.referral.headline}` : ""}</span>}
      {m.borrado_cliente && <span className="text-[11.5px] font-semibold text-warn">Borrado por el cliente: se conserva el original</span>}
      {m.borrado_app && <span className="text-[11.5px] font-semibold text-bad">Borrado en la app del celular: se conserva y se alertó a la supervisora</span>}
    </div>
  );
}

/** El hilo: mensajes y notas internas por día; clic en un mensaje para ver su detalle. */
function Hilo({ c, onMensaje }: { c: Ficha; onMensaje: (m: Mensaje) => void }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => { if (caja.current) caja.current.scrollTop = caja.current.scrollHeight; }, [c.mensajes.length, c.notas.length]);
  const items = [...c.mensajes.map((m) => ({ at: m.sent_at, m })), ...c.notas.map((n) => ({ at: n.at, n }))].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div ref={caja} className="grid max-h-[56vh] min-h-[280px] content-start gap-2 overflow-y-auto rounded-xl bg-surface-2/50 p-3">
      {items.length === 0 && <p className="py-10 text-center text-[13px] text-muted">Sin mensajes.</p>}
      {items.map((it, i) => {
        const d = fecha(it.at);
        const sep = i === 0 || fecha(items[i - 1].at) !== d ? <p key={`d${i}`} className="justify-self-center rounded-full bg-surface px-3 py-0.5 text-[11px] text-muted shadow-card">{d}</p> : null;
        if ("n" in it && it.n) {
          return [sep, (
            <div key={`n${i}`} className="justify-self-stretch rounded-lg border border-dashed border-warn/50 bg-warn/10 px-3 py-2 text-[12.5px]">
              <b>Nota interna · {it.n.user_name}:</b> {it.n.text}<span className="ml-2 text-[11px] text-muted">{hora(it.at)} · solo la ve el equipo</span>
            </div>
          )];
        }
        const m = (it as { m: Mensaje }).m;
        const sale = m.direction === "OUT";
        const sistema = m.origin === "SYSTEM";
        return [sep, (
          <button key={m.id} type="button" onClick={() => onMensaje(m)} title="Ver el detalle del mensaje"
            className={`max-w-[82%] cursor-pointer rounded-2xl px-3 py-2 text-left text-[13.5px] shadow-card ${sale ? "justify-self-end rounded-br-md" : "justify-self-start rounded-bl-md bg-surface text-ink"} ${sale && sistema ? "bg-surface-2 text-ink" : sale ? "bg-primary text-primary-ink" : ""}`}>
            <Cuerpo m={m} />
            <span className={`mt-1 flex items-center justify-end gap-1.5 text-[10.5px] ${sale && !sistema ? "opacity-80" : "text-muted"}`}>
              {sistema && <Bot className="size-3" />}
              {hora(m.sent_at)}{sale ? ` · ${m.sender_name ?? m.origin_name}` : ""}
              {m.costo && <span>· {m.costo.amount > 0 ? tarifa(m.costo.amount) : "gratis"}</span>}
              <Estado m={m} />
            </span>
          </button>
        )];
      })}
    </div>
  );
}

function CajaRespuesta({ c, onCambio }: { c: Ficha; onCambio: (x: Ficha) => void }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [nota, setNota] = useState(false);
  const libre = c.status !== "CLOSED" && c.ventana.abierta && !(c.kind === "TIKTOK" && (c.ventana.tiktok_seguidos ?? 0) >= (c.ventana.tiktok_max ?? 10));

  function escribir(v: string) {
    const m = v.match(/^(\/[a-z0-9_]+) $/i);
    const r = m ? c.respuestas.find((x) => x.shortcut.toLowerCase() === m[1].toLowerCase()) : null;
    setTexto(r ? r.body : v);
  }

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      const r = await api<{ mensaje: { estado: string; aviso: string | null }; conversacion: Ficha }>(`/v1/crm/conversaciones/${c.id}/mensajes`, { method: "POST", body: { texto } });
      setTexto("");
      onCambio(r.conversacion);
      if (r.mensaje.aviso) toast.info(r.mensaje.aviso);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  const k = c.costo_proximo;
  const textoCosto = c.status === "CLOSED" ? "Conversación cerrada: reábrela para escribir."
    : c.kind === "TIKTOK" ? (c.ventana.abierta ? `TikTok: se responde dentro de 48 h y como máximo ${c.ventana.tiktok_max} mensajes seguidos sin respuesta del cliente. Sin plantillas.` : "TikTok: pasaron más de 48 h; solo el cliente puede reabrir la conversación.")
    : !k ? (c.ventana.abierta ? `${c.kind_name}: ventana de ${c.ventana.horas} h abierta; los mensajes no se cobran.` : `${c.kind_name}: la ventana de ${c.ventana.horas} h venció y no hay plantillas. Espera a que el cliente escriba.`)
    : !c.ventana.abierta ? `Fuera de la ventana de 24 h: solo plantillas aprobadas (utilidad ${k.utilidad.amount ? tarifa(k.utilidad.amount) : "gratis"}, marketing ${k.marketing.amount ? tarifa(k.marketing.amount) : "gratis"}). Las plantillas llegan en la siguiente tanda.`
    : `Próxima respuesta: ${k.servicio.amount ? `${tarifa(k.servicio.amount)} (se agotaron las ${numero(k.cuota)} respuestas gratis del mes)` : k.servicio.reason.includes("anuncio") ? "gratis por la ventana de anuncio de 72 h" : `gratis (respuesta ${numero(k.usadas + 1)} de ${numero(k.cuota)} gratis del mes en este número)`} · utilidad ${k.utilidad.amount ? tarifa(k.utilidad.amount) : "gratis"} · marketing ${k.marketing.amount ? tarifa(k.marketing.amount) : "gratis"}.`;

  if (!c.puede.responder) {
    return (
      <div className="grid gap-2">
        <Alert tone="warn">{c.assigned_user_id ? `Este chat está asignado a ${c.assigned_name}: solo ella o la supervisora responden.` : "El chat está en cola: la supervisora lo asigna o lo toma."}</Alert>
        <p className="text-[12px] text-muted">{textoCosto}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {!c.proveedor.conectado && <Alert tone="info">{c.proveedor.aviso}</Alert>}
      <Textarea rows={3} maxLength={4096} value={texto} disabled={!libre} onChange={(e) => escribir(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && libre) { e.preventDefault(); enviar(); } }}
        placeholder={libre ? "Escribe un mensaje o un atajo (/delivery, /pago, /peso) y Enter para enviar…" : "No se puede escribir un mensaje libre ahora"} aria-label="Mensaje" />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Send} disabled={!libre || !texto.trim()} loading={enviando} onClick={enviar}>Enviar</Button>
        {c.respuestas.length > 0 && (
          <div className="w-[200px]">
            <Select value="" disabled={!libre} onChange={(e) => { const r = c.respuestas.find((x) => x.id === e.target.value); if (r) setTexto(r.body); }} placeholder="Respuestas rápidas"
              options={c.respuestas.map((r) => ({ value: r.id, label: r.shortcut }))} aria-label="Respuestas rápidas" />
          </div>
        )}
        {c.puede.notas && <Button variant="ghost" icon={StickyNote} onClick={() => setNota(true)}>Nota interna</Button>}
      </div>
      <p className="text-[12px] text-muted">{textoCosto}</p>
      {nota && <NotaInterna c={c} onClose={() => setNota(false)} onCambio={(x) => { setNota(false); onCambio(x); }} />}
    </div>
  );
}

function NotaInterna({ c, onClose, onCambio }: { c: Ficha; onClose: () => void; onCambio: (x: Ficha) => void }) {
  const [t, setT] = useState("");
  return (
    <Modal open onClose={onClose} title="Nota interna" description="La ve el equipo; el cliente nunca."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!t.trim()} onClick={async () => {
        try { onCambio(await api<Ficha>(`/v1/crm/conversaciones/${c.id}/notas`, { method: "POST", body: { texto: t } })); toast.ok("Nota guardada"); } catch (e) { toast.error(mensajeDe(e)); }
      }}>Guardar nota</Button></>}>
      <Textarea rows={4} maxLength={1000} value={t} onChange={(e) => setT(e.target.value)} aria-label="Nota" />
    </Modal>
  );
}

function DetalleMensaje({ m, onClose }: { m: Mensaje; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={m.direction === "IN" ? "Mensaje del cliente" : "Mensaje enviado"}>
      <div className="grid gap-4">
        <DetailList items={[
          { label: "Fecha", value: fechaHora(m.sent_at) }, { label: "Origen", value: m.direction === "IN" ? "Cliente" : m.origin_name },
          { label: "Enviado por", value: m.sender_name ?? (m.direction === "IN" ? "Cliente" : "Sistema") }, { label: "Tipo", value: m.msg_type },
          ...(m.costo ? [{ label: "Costo", value: `${m.costo.amount > 0 ? tarifa(m.costo.amount) : "Gratis"} · ${m.costo.reason}` }] : []),
          ...(m.transcript ? [{ label: "Transcripción", value: m.transcript }] : []),
          { label: "Id del proveedor", value: <span className="break-all font-mono text-[11.5px]">{m.external_id}</span> },
        ]} />
        {m.estados.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-[13px] font-semibold text-ink">Estados</p>
            {m.estados.map((e, i) => <p key={i} className="text-[12.5px]"><span className="tabular-nums text-muted">{fechaHora(e.at)}</span> · {e.name}</p>)}
          </div>
        )}
        <Alert tone="info"><Lock className="mr-1 inline size-3.5" />Los mensajes no se editan ni se borran, tampoco por la API. Si hay que corregir, se envía un mensaje nuevo.</Alert>
      </div>
    </Modal>
  );
}

function Reasignar({ c, onClose, onCambio }: { c: Ficha; onClose: () => void; onCambio: (x: Ficha) => void }) {
  const [d, setD] = useState({ user_id: c.assigned_user_id ?? "", nota: "" });
  return (
    <Modal open onClose={onClose} title="Reasignar o tomar el chat" description="Solo a miembros del número. Queda el historial de asignaciones."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={async () => {
        try { onCambio(await api<Ficha>(`/v1/crm/conversaciones/${c.id}/asignar`, { method: "POST", body: { user_id: d.user_id || null, nota: d.nota || null } })); toast.ok(d.user_id ? "Chat reasignado" : "Chat devuelto a la cola"); } catch (e) { toast.error(mensajeDe(e)); }
      }}>Guardar</Button></>}>
      <div className="grid gap-3">
        <Field label="Asignar a"><Select value={d.user_id} onChange={(e) => setD({ ...d, user_id: e.target.value })} placeholder="Devolver a la cola" options={c.miembros} /></Field>
        <Field label="Nota" hint="Opcional: por qué se reasigna."><Textarea rows={2} maxLength={255} value={d.nota} onChange={(e) => setD({ ...d, nota: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Cerrar({ c, onClose, onCambio }: { c: Ficha; onClose: () => void; onCambio: (x: Ficha) => void }) {
  const [motivo, setMotivo] = useState(c.pedidos_chat.length ? "ORDER_CREATED" : "NO_PURCHASE");
  return (
    <Modal open onClose={onClose} title="Cerrar la conversación"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={async () => {
        try { onCambio(await api<Ficha>(`/v1/crm/conversaciones/${c.id}/cerrar`, { method: "POST", body: { motivo } })); toast.ok("Conversación cerrada"); } catch (e) { toast.error(mensajeDe(e)); }
      }}>Cerrar</Button></>}>
      <Field label="Motivo"><Select value={motivo} onChange={(e) => setMotivo(e.target.value)} options={c.cierres.filter((x) => c.pedidos_chat.length || x.value !== "ORDER_CREATED")} /></Field>
    </Modal>
  );
}

function Etiquetas({ c, onClose, onCambio }: { c: Ficha; onClose: () => void; onCambio: (x: Ficha) => void }) {
  const [sel, setSel] = useState(new Set(c.tags));
  return (
    <Modal open onClose={onClose} title="Etiquetas"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={async () => {
        try { onCambio(await api<Ficha>(`/v1/crm/conversaciones/${c.id}/etiquetas`, { method: "PUT", body: { tags: [...sel] } })); toast.ok("Etiquetas guardadas"); } catch (e) { toast.error(mensajeDe(e)); }
      }}>Guardar</Button></>}>
      <div className="flex flex-wrap gap-2">
        {c.etiquetas.map((t) => (
          <Button key={t} size="sm" variant={sel.has(t) ? "primary" : "secondary"} onClick={() => { const n = new Set(sel); if (n.has(t)) n.delete(t); else n.add(t); setSel(n); }}>{t}</Button>
        ))}
      </div>
    </Modal>
  );
}

function Simular({ c, onClose, onCambio }: { c: Ficha; onClose: () => void; onCambio: (x: Ficha) => void }) {
  const [d, setD] = useState({ tipo: "TEXT", texto: "Hola, ¿siguen atendiendo?" });
  return (
    <Modal open onClose={onClose} title="Simular un mensaje del cliente" description="Solo en el entorno de prueba: entra como si llegara del proveedor."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={async () => {
        try { onCambio(await api<Ficha>(`/v1/crm/conversaciones/${c.id}/simular`, { method: "POST", body: d })); toast.ok(d.tipo === "GROUP" ? "Mensaje de grupo descartado (los grupos no se sincronizan)" : "Mensaje recibido"); } catch (e) { toast.error(mensajeDe(e)); }
      }}>Recibir</Button></>}>
      <div className="grid gap-3">
        <Field label="Tipo"><Select value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value })} options={[
          { value: "TEXT", label: "Texto" }, { value: "VIEW_ONCE", label: "Foto «ver una vez» (no disponible)" }, { value: "LIVE_LOCATION", label: "Ubicación en vivo (no disponible)" },
          { value: "GROUP", label: "Mensaje de un grupo (se descarta)" }, { value: "DELETE", label: "El cliente borra su último mensaje" },
        ]} /></Field>
        {["TEXT", "GROUP"].includes(d.tipo) && <Field label="Texto"><Textarea rows={3} maxLength={1000} value={d.texto} onChange={(e) => setD({ ...d, texto: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}

/** Encabezado, hilo y caja de respuesta de una conversación, con sus acciones. */
export function Conversacion({ c, onCambio, enLista }: { c: Ficha; onCambio: (x: Ficha) => void; enLista?: boolean }) {
  const [abierto, setAbierto] = useState<"reasignar" | "cerrar" | "etiquetas" | "simular" | null>(null);
  const [msg, setMsg] = useState<Mensaje | null>(null);

  async function reabrir() {
    try { onCambio(await api<Ficha>(`/v1/crm/conversaciones/${c.id}/reabrir`, { method: "POST" })); toast.ok("Conversación reabierta"); } catch (e) { toast.error(mensajeDe(e)); }
  }

  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-ink">{c.contacto}</h2>
            <Badge tone={c.status === "CLOSED" ? "neutral" : "info"}>{c.status_name}</Badge>
            {c.es_cliente ? <Badge tone="ok">Cliente</Badge> : <Badge tone="info">Lead</Badge>}
          </div>
          <p className="text-[12.5px] text-muted">
            <RedEtiqueta kind={c.kind} nombre={c.kind_name} /> {c.channel_name} · {c.numero_cliente} · {c.entry_name}{c.ad_code ? ` ${c.ad_code}` : ""} · {c.assigned_name ? `Atiende ${c.assigned_name}` : "En cola"}
            {c.close_name ? ` · Cerrada: ${c.close_name}` : ""}
          </p>
          <Ventanas c={c} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {c.puede.reasignar && <Button size="sm" icon={UserCog} onClick={() => setAbierto("reasignar")}>Reasignar</Button>}
          {c.puede.notas && <Button size="sm" icon={Tag} onClick={() => setAbierto("etiquetas")}>Etiquetas</Button>}
          {c.status === "CLOSED"
            ? (c.puede.cerrar || c.puede.reasignar) && <Button size="sm" icon={RotateCcw} onClick={reabrir}>Reabrir</Button>
            : c.puede.cerrar && <Button size="sm" icon={X} onClick={() => setAbierto("cerrar")}>Cerrar</Button>}
          {enLista && <Link href={`/m/crm/crm-02?id=${c.id}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-primary hover:underline"><MessageSquareText className="size-3.5" />Abrir</Link>}
          {c.puede.simular && <Button size="sm" variant="ghost" icon={FlaskConical} onClick={() => setAbierto("simular")} title="Entrada de prueba, como si llegara del proveedor">Simular cliente</Button>}
        </div>
      </div>
      <Hilo c={c} onMensaje={setMsg} />
      <CajaRespuesta c={c} onCambio={onCambio} />
      {msg && <DetalleMensaje m={msg} onClose={() => setMsg(null)} />}
      {abierto === "reasignar" && <Reasignar c={c} onClose={() => setAbierto(null)} onCambio={(x) => { setAbierto(null); onCambio(x); }} />}
      {abierto === "cerrar" && <Cerrar c={c} onClose={() => setAbierto(null)} onCambio={(x) => { setAbierto(null); onCambio(x); }} />}
      {abierto === "etiquetas" && <Etiquetas c={c} onClose={() => setAbierto(null)} onCambio={(x) => { setAbierto(null); onCambio(x); }} />}
      {abierto === "simular" && <Simular c={c} onClose={() => setAbierto(null)} onCambio={(x) => { setAbierto(null); onCambio(x); }} />}
    </section>
  );
}

/** Panel lateral: cliente o lead, pedido de este chat y tareas abiertas. */
export function PanelCliente({ c }: { c: Ficha }) {
  return (
    <div className="grid content-start gap-3">
      {c.cliente && (
        <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h3 className="text-[14px] font-semibold text-ink">Cliente</h3>
          <DetailList items={[
            { label: "Nombre", value: c.cliente.nombre }, { label: "Celular", value: c.cliente.celular ?? "—" },
            { label: "Documento", value: c.cliente.documento ?? "Sin documento" }, { label: "Pedidos", value: numero(c.cliente.pedidos) },
            { label: "Marketing", value: c.cliente.marketing === true ? <Badge tone="ok">Consentimiento otorgado</Badge> : c.cliente.marketing === false ? <Badge tone="bad">Dio de baja</Badge> : <Badge tone="neutral">Sin consentimiento</Badge> },
          ]} />
          {c.cliente.ultimos.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-[12.5px] font-semibold text-ink">Pedidos recientes</p>
              {c.cliente.ultimos.map((o) => (
                <p key={o.id} className="flex justify-between gap-2 text-[12.5px]"><span className="font-mono">{o.number}</span><span className="text-muted">{fecha(o.at)}</span><span className="tabular-nums">{soles(o.total)}</span></p>
              ))}
            </div>
          )}
        </section>
      )}
      {c.lead && (
        <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h3 className="text-[14px] font-semibold text-ink">Lead</h3>
          <DetailList items={[
            { label: "Estado", value: <Badge tone={LEAD[c.lead.status]?.[1] ?? "neutral"}>{LEAD[c.lead.status]?.[0] ?? c.lead.status}</Badge> },
            { label: "Anuncio", value: c.lead.ad_code ?? "—" }, { label: "Primer contacto", value: fechaHora(c.lead.first_contact_at) },
          ]} />
          <p className="text-[12px] text-muted">Pasa a cliente con su primer pedido.</p>
        </section>
      )}
      <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-[14px] font-semibold text-ink">Pedido de este chat</h3>
        {c.pedidos_chat.length ? c.pedidos_chat.map((o) => (
          <p key={o.id} className="flex justify-between gap-2 text-[12.5px]"><span className="font-mono font-semibold">{o.number}</span><span className="tabular-nums">{soles(o.total)}</span></p>
        )) : <p className="text-[12.5px] text-muted">Aún no hay pedido vinculado. «Crear pedido» llega en una próxima tanda.</p>}
      </section>
      {c.tareas.length > 0 && (
        <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h3 className="text-[14px] font-semibold text-ink">Tareas abiertas</h3>
          {c.tareas.map((t) => <p key={t.id} className="text-[12.5px]"><b>{TAREA[t.task_type] ?? t.task_type}</b> · vence {fechaHora(t.due_at)}{t.note ? <span className="block text-muted">{t.note}</span> : null}</p>)}
        </section>
      )}
    </div>
  );
}
