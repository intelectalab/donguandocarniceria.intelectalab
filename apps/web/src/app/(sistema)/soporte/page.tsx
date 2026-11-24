"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, LifeBuoy, Plus, Send, Star } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, toast, type Column } from "@/components/ui";
import { AccesosEmpresa } from "@/components/soporte/AccesosEmpresa";
import { Conversacion, EstadoTicket, PrioridadTicket, type Ticket, type TicketFila } from "@/components/soporte/tickets";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";

type Lista = { data: TicketFila[]; categorias: Record<string, string>; prioridades: Record<string, string> };

/** Soporte: la empresa pide ayuda al equipo de GestionCarnica, sigue la conversación y califica la atención. */
export default function Soporte() {
  return <Suspense><Contenido /></Suspense>;
}

/** Dos pestañas: los tickets y los accesos de soporte (OPS-14), cada una con sus permisos. */
function Contenido() {
  const sesion = useSesion();
  const router = useRouter();
  const params = useSearchParams();
  const tickets = sesion.can("ops.ticket.create") || sesion.can("ops.ticket.view_all");
  const accesos = ["approve", "revoke", "view_log"].some((p) => sesion.can(`ops.support_access.${p}`));
  const tab = (params.get("tab") === "accesos" && accesos) || !tickets ? "accesos" : "tickets";
  const ir = (t: "tickets" | "accesos", extra = "") => router.replace(`/soporte?tab=${t}${extra}`, { scroll: false });

  if (!tickets && !accesos) return <Alert tone="info">Tu rol no abre tickets de soporte. Pide ayuda a quien administra el sistema en tu empresa.</Alert>;
  return (
    <div className="grid gap-5">
      {tickets && accesos && (
        <Tabs value={tab} onChange={(t) => ir(t)} tabs={[{ key: "tickets", label: "Tickets" }, { key: "accesos", label: "Accesos de soporte" }]} />
      )}
      {tab === "accesos"
        ? <AccesosEmpresa abierto={params.get("acceso")} onAbrir={(id) => ir("accesos", id ? `&acceso=${id}` : "")} />
        : <MisTickets />}
    </div>
  );
}

function MisTickets() {
  const sesion = useSesion();
  const router = useRouter();
  const abierto = useSearchParams().get("ticket");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [nuevo, setNuevo] = useState(false);

  const cargar = useCallback(() => {
    api<Lista>("/v1/soporte/tickets").then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => cargar(), [cargar]);

  const puedeAbrir = Boolean(sesion.can("ops.ticket.create"));
  const todos = Boolean(sesion.can("ops.ticket.view_all"));
  const ver = (id: string | null) => router.replace(id ? `/soporte?ticket=${id}` : "/soporte", { scroll: false });

  const columnas: Column<TicketFila>[] = [
    { key: "subject", header: "Ticket", cardTitle: true, render: (t) => (
      <div><p className="font-semibold text-ink">{t.subject}</p><p className="text-[12.5px] text-muted">{t.number} · {t.category_name}</p></div>
    ) },
    ...(todos ? [{ key: "opened_by_name", header: "Lo abrió", hideOnMobile: true, render: (t: TicketFila) => t.opened_by_name }] : []),
    { key: "priority", header: "Prioridad", hideOnMobile: true, render: (t) => <PrioridadTicket t={t} /> },
    { key: "status", header: "Estado", render: (t) => <EstadoTicket t={t} paraEmpresa /> },
    { key: "opened_at", header: "Abierto", hideOnMobile: true, render: (t) => fechaHora(t.opened_at) },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description={todos ? "Los pedidos de ayuda de tu empresa al equipo de GestionCarnica y en qué quedó cada uno." : "Tus pedidos de ayuda al equipo de GestionCarnica y en qué quedó cada uno."}
        actions={puedeAbrir ? <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo ticket</Button> : undefined} />
      <DataTable columns={columnas} rows={lista?.data ?? []} loading={!lista && !error} error={error} onRetry={cargar} onRowClick={(t) => ver(t.id)}
        empty={<span className="inline-flex items-center gap-2"><LifeBuoy size={16} aria-hidden="true" />Aún no hay tickets. Si algo no funciona o tienes una duda, abre uno.</span>} />
      {nuevo && lista && <NuevoTicket lista={lista} onClose={() => setNuevo(false)} onCreado={(t) => { setNuevo(false); cargar(); ver(t.id); }} />}
      {abierto && <DetalleTicket key={abierto} id={abierto} onClose={() => ver(null)} onCambio={cargar} />}
    </div>
  );
}

function NuevoTicket({ lista, onClose, onCreado }: { lista: Lista; onClose: () => void; onCreado: (t: Ticket) => void }) {
  const [f, setF] = useState({ subject: "", description: "", category: "", priority: "NORMAL" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const t = await api<Ticket>("/v1/soporte/tickets", { method: "POST", body: f });
      toast.ok(`Ticket ${t.number} enviado`);
      onCreado(t);
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title="Nuevo ticket" description="Cuéntanos qué pasa. Te avisamos en la campana cuando soporte responda."
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-ticket" icon={Send} loading={guardando}>Enviar</Button></>}>
      <form id="f-ticket" onSubmit={enviar} className="grid gap-4">
        <Field label="Asunto" required error={errores.subject}>
          <Input value={f.subject} maxLength={150} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Ej.: no sale la boleta del pedido de ayer" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tema" required error={errores.category}>
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Elige un tema"
              options={Object.entries(lista.categorias).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Prioridad" required error={errores.priority} hint="Urgente: el negocio está detenido.">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}
              options={Object.entries(lista.prioridades).map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        <Field label="Detalle" required error={errores.description} hint="Qué intentabas hacer, qué pasó y desde cuándo.">
          <Textarea rows={6} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

function DetalleTicket({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const [t, setT] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [texto, setTexto] = useState("");
  const [estrellas, setEstrellas] = useState(0);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<Ticket>(`/v1/soporte/tickets/${id}`).then(setT).catch((e) => setError(mensajeDe(e)));
  }, [id]);

  async function enviar(ruta: "responder" | "cerrar", body: object, aviso: string) {
    setEnviando(true);
    try {
      setT(await api<Ticket>(`/v1/soporte/tickets/${id}/${ruta}`, { method: "POST", body }));
      setTexto("");
      toast.ok(aviso);
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  const cerrado = t?.status === "CLOSED";
  const resuelto = t?.status === "RESOLVED";
  return (
    <Modal open onClose={onClose} size="lg" title={t ? `${t.number} · ${t.subject}` : "Ticket"}
      description={t ? <span className="inline-flex flex-wrap items-center gap-2"><EstadoTicket t={t} paraEmpresa /><PrioridadTicket t={t} /><span>{t.category_name}</span></span> : undefined}>
      {error ? <Alert tone="bad">{error}</Alert> : !t ? <p className="text-muted">Cargando…</p> : (
        <div className="grid gap-5">
          <Conversacion t={t} lado="empresa" />
          {(resuelto || (cerrado && !t.satisfaction)) && (
            <div className="grid gap-2 rounded-xl border border-line p-3.5">
              <p className="text-[13.5px] font-semibold text-ink">{resuelto ? "¿Quedó resuelto? Califica la atención y cierra el ticket." : "¿Cómo te atendimos?"}</p>
              <div className="flex gap-1" role="radiogroup" aria-label="Calificación">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={estrellas === n} aria-label={`${n} de 5`} onClick={() => setEstrellas(n)}
                    className="cursor-pointer rounded p-0.5 text-warn transition-transform hover:scale-110">
                    <Star size={22} fill={n <= estrellas ? "currentColor" : "none"} />
                  </button>
                ))}
              </div>
              <Button variant="primary" icon={CheckCircle2} disabled={enviando || (cerrado && !estrellas)} className="justify-self-start"
                onClick={() => enviar("cerrar", { satisfaction: estrellas || null }, cerrado ? "Gracias por calificar" : "Ticket cerrado")}>
                {cerrado ? "Enviar calificación" : "Cerrar ticket"}
              </Button>
            </div>
          )}
          {cerrado ? (
            <p className="text-[13px] text-muted">Este ticket está cerrado{t.satisfaction ? ` · calificaste ${t.satisfaction} de 5` : ""}. Si vuelve a pasar, abre uno nuevo.</p>
          ) : (
            <div className="grid gap-2">
              <Field label={resuelto ? "¿Sigue sin funcionar? Escríbenos y lo reabrimos" : "Responder"}>
                <Textarea rows={3} maxLength={5000} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={Send} disabled={enviando || texto.trim().length < 2} onClick={() => enviar("responder", { body: texto }, "Mensaje enviado")}>Enviar</Button>
                {!resuelto && <Button disabled={enviando} onClick={() => enviar("cerrar", {}, "Ticket cerrado")}>Ya no necesito ayuda</Button>}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
