"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Clock, Inbox, KeyRound, Send, UserPlus } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, Input, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { Conversacion, EstadoTicket, PlazoTicket, PrioridadTicket, type Ticket, type TicketFila } from "@/components/soporte/tickets";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { PedirAcceso } from "@/components/consola/PedirAcceso";
import { mensajeDe } from "@/lib/api";
import { usePagina } from "@/lib/paginas";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type Persona = { id: string; full_name: string; role: string };
type Bandeja = {
  data: TicketFila[]; current_page: number; last_page: number; per_page: number; total: number;
  cifras: { abiertos: number; sin_respuesta: number; vencidos: number; sin_asignar: number; mediana_primera_respuesta: number | null };
  plazos: { primera_respuesta_horas: Record<"URGENT" | "HIGH" | "NORMAL" | "LOW", number>; cierre_automatico_dias: number };
  personal: Persona[]; empresas: { id: string; short: string }[];
  categorias: Record<string, string>; prioridades: Record<string, string>; estados: Record<string, string>;
};
type Filtros = { status: string; priority: string; tenant: string; assigned: string; search: string };

/** Bandeja de tickets: los pedidos de ayuda de todas las empresas, con el plazo de la primera respuesta. */
export default function BandejaTickets() {
  return <Suspense><Contenido /></Suspense>;
}

function Contenido() {
  const router = useRouter();
  const abierto = useSearchParams().get("ticket");
  const [f, setF] = useState<Filtros>({ status: "ACTIVOS", priority: "", tenant: "", assigned: "", search: "" });
  const [b, setB] = useState<Bandeja | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina(JSON.stringify(f));

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiConsola<Bandeja>(`/tickets?${q}&${pag.qs}`).then((r) => { setB(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => {
    const t = setTimeout(cargar, f.search ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, f.search]);

  const ver = (id: string | null) => router.replace(id ? `/consola/tickets?ticket=${id}` : "/consola/tickets", { scroll: false });
  const opciones = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));

  const columnas: Column<TicketFila>[] = [
    { key: "subject", sortable: true, header: "Ticket", cardTitle: true, render: (t) => (
      <div><p className="font-semibold text-ink">{t.subject}</p><p className="text-[12.5px] text-muted">{t.number} · {t.tenant_short} · {t.category_name}</p></div>
    ) },
    { key: "priority", sortable: true, header: "Prioridad", render: (t) => <PrioridadTicket t={t} /> },
    { key: "status", sortable: true, header: "Estado", render: (t) => <div className="grid gap-0.5"><EstadoTicket t={t} /><PlazoTicket p={t.plazo} /></div> },
    { key: "assigned_name", sortable: true, header: "Atiende", hideOnMobile: true, render: (t) => t.assigned_name ?? <span className="text-muted">Sin asignar</span> },
    { key: "opened_at", sortable: true, header: "Abierto", hideOnMobile: true, render: (t) => <div><p>{fechaHora(t.opened_at)}</p><p className="text-[12px] text-muted">{t.opened_by_name}</p></div> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Los pedidos de ayuda de todas las empresas. Urgentes y los que vencen antes van primero; urgente cuenta las 24 horas, el resto el horario de soporte (lunes a sábado de 9 a 18)." />
      {b && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Cifra titulo="Abiertos" valor={String(b.cifras.abiertos)} icono={Inbox} destacada />
          <Cifra titulo="Sin primera respuesta" valor={String(b.cifras.sin_respuesta)} tono={b.cifras.sin_respuesta ? "warn" : undefined} />
          <Cifra titulo="Plazo vencido" valor={String(b.cifras.vencidos)} tono={b.cifras.vencidos ? "bad" : "ok"} icono={AlertTriangle} />
          <Cifra titulo="Sin asignar" valor={String(b.cifras.sin_asignar)} tono={b.cifras.sin_asignar ? "warn" : undefined} />
          <Cifra titulo="Mediana de 1.ª respuesta" valor={b.cifras.mediana_primera_respuesta === null ? "—" : `${b.cifras.mediana_primera_respuesta.toLocaleString("es-PE")} h`} detalle="Tickets de este mes" icono={Clock} />
        </div>
      )}
      {b && (
        <p className="text-[12.5px] text-muted">
          Plazos de primera respuesta: urgente {b.plazos.primera_respuesta_horas.URGENT} h (las 24 horas) · alta {b.plazos.primera_respuesta_horas.HIGH} h · normal {b.plazos.primera_respuesta_horas.NORMAL} h · baja {b.plazos.primera_respuesta_horas.LOW} h, en horario de soporte (lunes a sábado de 9 a 18). Un ticket resuelto sin respuesta del cliente se cierra solo a los {b.plazos.cierre_automatico_dias} días.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input aria-label="Buscar" placeholder="Buscar asunto, número o empresa" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todos los estados"
          options={[{ value: "ACTIVOS", label: "Por atender (abiertos)" }, ...opciones(b?.estados ?? {})]} />
        <Select aria-label="Prioridad" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} placeholder="Toda prioridad" options={opciones(b?.prioridades ?? {})} />
        <Select aria-label="Empresa" value={f.tenant} onChange={(e) => setF({ ...f, tenant: e.target.value })} placeholder="Todas las empresas"
          options={(b?.empresas ?? []).map((e) => ({ value: e.id, label: e.short }))} />
        <Select aria-label="Atiende" value={f.assigned} onChange={(e) => setF({ ...f, assigned: e.target.value })} placeholder="Cualquiera"
          options={[{ value: "NONE", label: "Sin asignar" }, ...(b?.personal ?? []).map((p) => ({ value: p.id, label: p.full_name }))]} />
      </div>
      <DataTable {...pag.orden} columns={columnas} rows={b?.data ?? []} loading={!b && !error} error={error} onRetry={cargar} onRowClick={(t) => ver(t.id)} pagination={pag.props(b)}
        empty="No hay tickets con estos filtros." />
      {abierto && b && <DetalleConsola key={abierto} id={abierto} personal={b.personal} onClose={() => ver(null)} onCambio={cargar} />}
    </div>
  );
}

function DetalleConsola({ id, personal, onClose, onCambio }: { id: string; personal: Persona[]; onClose: () => void; onCambio: () => void }) {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["ticket.manage"]);
  const [t, setT] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("WAITING_CUSTOMER");
  const [enviando, setEnviando] = useState(false);
  const [pedir, setPedir] = useState(false);
  const [incidentes, setIncidentes] = useState<{ id: string; number: string; title: string }[]>([]);
  const puedePedir = Boolean(yo.puede["access.request_ro"] || yo.puede["access.request_rw"]);

  useEffect(() => {
    apiConsola<Ticket>(`/tickets/${id}`).then(setT).catch((e) => setError(mensajeDe(e)));
    apiConsola<{ id: string; number: string; title: string }[]>("/incidentes/para-vincular").then(setIncidentes).catch(() => undefined);
  }, [id]);

  async function vincular(incidente: string) {
    try {
      await apiConsola(`/tickets/${id}/incidente`, { method: "POST", body: { incident_id: incidente || null } });
      setT((x) => (x ? { ...x, incident_id: incidente || null } : x));
      toast.ok(incidente ? "Ticket vinculado al incidente" : "Ticket desvinculado");
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function enviar(ruta: "responder" | "asignar", body: object, aviso: string) {
    setEnviando(true);
    try {
      setT(await apiConsola<Ticket>(`/tickets/${id}/${ruta}`, { method: "POST", body }));
      if (ruta === "responder") setTexto("");
      toast.ok(aviso);
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t ? `${t.number} · ${t.subject}` : "Ticket"}
      description={t ? <span className="inline-flex flex-wrap items-center gap-2"><EstadoTicket t={t} /><PrioridadTicket t={t} /><span>{t.tenant_short} · {t.category_name}</span></span> : undefined}>
      {error ? <Alert tone="bad">{error}</Alert> : !t ? <p className="text-muted">Cargando…</p> : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line p-3.5">
            <div className="grid gap-1 text-[13px]">
              <PlazoTicket p={t.plazo} />
              {t.satisfaction && <span className="text-muted">Calificación del cliente: {t.satisfaction} de 5</span>}
              {puede && (incidentes.length > 0 || t.incident_id) && (
                <Field label="Causado por un incidente">
                  <Select value={t.incident_id ?? ""} onChange={(e) => vincular(e.target.value)} placeholder="Ninguno"
                    options={incidentes.map((i) => ({ value: i.id, label: `${i.number} · ${i.title}` }))} />
                </Field>
              )}
              {puedePedir && t.status !== "CLOSED" && (
                <Button size="sm" variant="ghost" icon={KeyRound} className="justify-self-start" onClick={() => setPedir(true)}>Pedir acceso a la empresa</Button>
              )}
            </div>
            {puede && t.status !== "CLOSED" ? (
              <div className="flex items-end gap-2">
                <Field label="Atiende">
                  <Select value={t.assigned_platform_user ?? ""} placeholder="Sin asignar" disabled={enviando}
                    onChange={(e) => enviar("asignar", { platform_user_id: e.target.value || null }, "Asignación guardada")}
                    options={personal.map((p) => ({ value: p.id, label: p.full_name }))} />
                </Field>
                {t.assigned_platform_user !== yo.id && (
                  <Button icon={UserPlus} disabled={enviando} onClick={() => enviar("asignar", { platform_user_id: yo.id }, "Ahora lo atiendes tú")}>Tomarlo</Button>
                )}
              </div>
            ) : <span className="text-[13px] text-muted">Atiende: {t.assigned_name ?? "nadie"}</span>}
          </div>
          {pedir && <PedirAcceso empresa={t.tenant_id} ticket={t.id} onClose={() => setPedir(false)} onPedido={() => { setPedir(false); toast.ok("Lo ves en Accesos de soporte"); }} />}
          <Conversacion t={t} lado="consola" />
          {t.status === "CLOSED" ? (
            <p className="text-[13px] text-muted">El ticket está cerrado.</p>
          ) : puede ? (
            <div className="grid gap-3">
              <Field label="Respuesta al cliente" hint="Le llega como aviso en la campana del sistema.">
                <Textarea rows={4} maxLength={5000} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Queda como">
                  <Select value={estado} onChange={(e) => setEstado(e.target.value)} options={[
                    { value: "WAITING_CUSTOMER", label: "Espera respuesta del cliente" }, { value: "IN_PROGRESS", label: "En proceso" }, { value: "RESOLVED", label: "Resuelto" },
                  ]} />
                </Field>
                <Button variant="primary" icon={Send} disabled={enviando || texto.trim().length < 2} onClick={() => enviar("responder", { body: texto, status: estado }, "Respuesta enviada")}>Responder</Button>
              </div>
            </div>
          ) : <p className="text-[13px] text-muted">Tu rol puede ver los tickets, pero no responderlos.</p>}
        </div>
      )}
    </Modal>
  );
}
