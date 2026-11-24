"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarClock, Headset, KeyRound, Layers, Loader2, Power, TrendingUp } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { PedirAcceso } from "@/components/consola/PedirAcceso";
import { ESTADOS_ACCESO, type Acceso } from "@/components/soporte/AccesosEmpresa";
import { EstadoTicket, PrioridadTicket, type TicketFila } from "@/components/soporte/tickets";
import { AccionesSuscripcion } from "@/components/consola/AccionesSuscripcion";
import { BarraUso, ESTADOS_SUSCRIPCION, type Empresa } from "@/components/consola/empresas";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fecha, fechaHora, soles } from "@/lib/formato";

type Evento = { event: string; from_status: string | null; to_status: string | null; reason: string; actor_name: string; occurred_at: string };
type Ficha = Empresa & {
  hostname: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; creada_por: string | null;
  dominios: { hostname: string; is_primary: boolean; status: string }[];
  suscripcion: null | { id: string; plan_code: string; status: string; status_name: string; started_at: string; status_changed_at: string;
    trial_ends_at: string | null; trial_days_granted: number; historial: Evento[];
    discount_pct: number; discount_reason: string | null; tenant_status: string; transiciones: string[]; efectos: Record<string, string> };
  modulos_encendidos: { module_code: string; name: string; phase: number; sus_source: string | null }[];
  acciones_consola: { action: string; action_name: string; actor_name: string; reason: string | null; occurred_at: string }[];
};

type ComprobanteFila = { id: string; number: string | null; doc_type_name: string; period_start: string | null; period_end: string | null; total: number; saldo: number;
  due_date: string | null; status: string; payment_status_name: string; vencido: boolean; sunat_status_name: string };
type IncidenteFila = { id: string; number: string; title: string; severity_name: string; started_at: string; status_name: string };
type Pestana = "resumen" | "comprobantes" | "tickets" | "incidentes" | "accesos";
const diasDeMora = (v: string | null) => (v ? Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 86400000)) : 0);

/** Lista de una pestaña de la ficha: se pide al abrirla, filtrada por la empresa. */
function Lista<T>({ ruta, children }: { ruta: string; children: (filas: T[] | null, error: string) => ReactNode }) {
  const [filas, setFilas] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { apiConsola<{ data: T[] }>(ruta).then((r) => setFilas(r.data)).catch((e) => setError(mensajeDe(e))); }, [ruta]);
  return <>{children(filas, error)}</>;
}
const EVENTOS: Record<string, string> = { CREATED: "Alta", STATUS_CHANGED: "Cambio de estado", TRIAL_EXTENDED: "Prueba extendida", DISCOUNT: "Descuento", PLAN_CHANGED: "Cambio de plan" };

function Tarjeta({ titulo, children, extra }: { titulo: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-[15px] font-bold text-ink">{titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** OPS-03 Ficha de la empresa: suscripción e historial, uso por límite, módulos y acciones de la consola sobre ella. */
function FichaEmpresa() {
  const id = useSearchParams().get("id");
  const yo = useUsuarioConsola();
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  const [tab, setTab] = useState<Pestana>("resumen");
  const [pedir, setPedir] = useState(false);
  const cargar = () => { if (id) apiConsola<Ficha>(`/empresas/${id}`).then(setF).catch((e) => setError(mensajeDe(e))); };

  useEffect(cargar, [id]);

  const volver = <Link href="/consola/empresas" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"><ArrowLeft size={14} />Empresas</Link>;
  if (!id || error) return <div className="grid gap-4">{volver}<Alert tone="bad">{error || "Falta la empresa."}</Alert></div>;
  if (!f) return <div className="grid place-items-center py-20 text-muted"><Loader2 className="animate-spin" /></div>;
  const s = f.suscripcion;

  return (
    <div className="grid gap-5">
      {volver}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[22px] font-bold text-ink">{f.short}</h2>
        {s ? <StatusBadge status={s.status} labels={ESTADOS_SUSCRIPCION} /> : <Badge>Sin suscripción · piloto</Badge>}
        {f.tenant_status === "SUSPENDED" && <Badge tone="bad" dot>Acceso suspendido</Badge>}
      </div>
      <PageHeader description={`${f.name}${f.ruc ? ` · RUC ${f.ruc}` : ""}. La consola ve su suscripción, su uso y los módulos encendidos; sus datos de negocio, solo con un acceso de soporte que la empresa apruebe.`}
        actions={<div className="flex flex-wrap gap-2">
          {s && yo.puede["tenant.status"] && <Button icon={Power} onClick={() => { setTab("resumen"); setTimeout(() => document.getElementById("suscripcion")?.scrollIntoView({ behavior: "smooth" }), 50); }}>Suspender o reactivar</Button>}
          {(yo.puede["access.request_ro"] || yo.puede["access.request_rw"]) && <Button variant="primary" icon={KeyRound} onClick={() => setPedir(true)}>Solicitar acceso de soporte</Button>}
        </div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Cifra titulo="Plan" valor={f.plan_name ?? "Piloto"} icono={Layers} detalle={s ? (s.discount_pct > 0 ? `Mensual · −${s.discount_pct} %` : "Mensual") : "Sin suscripción"} />
        <Cifra titulo="Estado" valor={s ? s.status_name : "Sin suscripción"} icono={CalendarClock}
          tono={s ? (["PAST_DUE"].includes(s.status) ? "warn" : ["READ_ONLY", "SUSPENDED"].includes(s.status) ? "bad" : s.status === "ACTIVE" ? "ok" : undefined) : undefined}
          detalle={f.days_in_status !== null ? (f.days_in_status === 0 ? "Desde hoy" : `${f.days_in_status} ${f.days_in_status === 1 ? "día" : "días"} en el estado`) : undefined} />
        <Cifra titulo="MRR" valor={soles(f.mrr)} detalle="Sin IGV, con descuento" icono={TrendingUp} destacada />
        <button type="button" onClick={() => setTab("tickets")} className="cursor-pointer rounded-xl text-left [&>div]:h-full" title="Ver sus tickets">
          <Cifra titulo="Tickets abiertos" valor={String(f.tickets_abiertos)} tono={f.tickets_abiertos ? "warn" : undefined} icono={Headset} />
        </button>
        <button type="button" onClick={() => setTab("accesos")} className="col-span-2 cursor-pointer rounded-xl text-left lg:col-span-1 [&>div]:h-full" title="Ver sus accesos de soporte">
          <Cifra titulo="Accesos de soporte vigentes" valor={String(f.accesos_vigentes)} icono={KeyRound} />
        </button>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "resumen", label: "Resumen" }, { key: "comprobantes", label: "Comprobantes del SaaS" }, { key: "tickets", label: "Tickets" },
        { key: "incidentes", label: "Incidentes" }, { key: "accesos", label: "Accesos de soporte" },
      ]} />

      {tab === "comprobantes" && (
        <Lista<ComprobanteFila> ruta={`/facturacion?tenant=${f.id}&per_page=100`}>{(filas, err) => (
          <DataTable rows={filas ?? []} loading={!filas && !err} error={err} empty="Todavía no tiene comprobantes del SaaS." columns={[
            { key: "number", header: "Comprobante", cardTitle: true, render: (c) => <div><p className="font-mono text-[12.5px] font-semibold text-ink">{c.number ?? "Borrador"}</p><p className="text-[12px] text-muted">{c.doc_type_name}</p></div> },
            { key: "period_start", header: "Período", render: (c) => (c.period_start && c.period_end ? `${fecha(c.period_start)} – ${fecha(c.period_end)}` : "—") },
            { key: "total", header: "Total", align: "right", render: (c) => soles(c.total) },
            { key: "due_date", header: "Vence", render: (c) => (c.due_date ? fecha(c.due_date) : "—") },
            { key: "status", header: "Estado", render: (c) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={c.status === "DRAFT" ? "neutral" : c.vencido ? "bad" : c.saldo > 0 ? "warn" : "ok"} dot>{c.status === "DRAFT" ? "Borrador" : c.vencido ? "Vencido" : c.payment_status_name}</Badge>
                {c.vencido && <span className="text-[12px] text-bad">{diasDeMora(c.due_date)} días de mora</span>}
              </div>
            ) },
            { key: "sunat_status_name", header: "SUNAT", hideOnMobile: true, render: (c) => (c.status === "ISSUED" ? c.sunat_status_name : "—") },
          ]} />
        )}</Lista>
      )}
      {tab === "tickets" && (
        <Lista<TicketFila> ruta={`/tickets?tenant=${f.id}&per_page=100`}>{(filas, err) => (
          <DataTable rows={filas ?? []} loading={!filas && !err} error={err} empty="No tiene tickets." onRowClick={(t) => router.push(`/consola/tickets?ticket=${t.id}`)} columns={[
            { key: "subject", header: "Ticket", cardTitle: true, render: (t) => <div><p className="font-semibold text-ink">{t.subject}</p><p className="text-[12px] text-muted">{t.number} · {t.category_name}</p></div> },
            { key: "priority", header: "Prioridad", render: (t) => <PrioridadTicket t={t} /> },
            { key: "status", header: "Estado", render: (t) => <EstadoTicket t={t} /> },
            { key: "assigned_name", header: "Atiende", hideOnMobile: true, render: (t) => t.assigned_name ?? <span className="text-muted">Sin asignar</span> },
            { key: "opened_at", header: "Abierto", hideOnMobile: true, render: (t) => fechaHora(t.opened_at) },
          ]} />
        )}</Lista>
      )}
      {tab === "incidentes" && (
        <Lista<IncidenteFila> ruta={`/incidentes?tenant=${f.id}&per_page=100`}>{(filas, err) => (
          <DataTable rows={filas ?? []} loading={!filas && !err} error={err} empty="No la afectó ningún incidente." onRowClick={(i) => router.push(`/consola/incidentes?incidente=${i.id}`)} columns={[
            { key: "title", header: "Incidente", cardTitle: true, render: (i) => <div><p className="font-semibold text-ink">{i.title}</p><p className="text-[12px] text-muted">{i.number}</p></div> },
            { key: "severity_name", header: "Severidad" },
            { key: "started_at", header: "Inicio", render: (i) => fechaHora(i.started_at) },
            { key: "status_name", header: "Estado" },
          ]} />
        )}</Lista>
      )}
      {tab === "accesos" && (
        <Lista<Acceso> ruta={`/accesos?tenant=${f.id}&per_page=100`}>{(filas, err) => (
          <DataTable rows={filas ?? []} loading={!filas && !err} error={err} empty="La consola no ha pedido accesos a esta empresa." onRowClick={(a) => router.push(`/consola/accesos?acceso=${a.id}`)} columns={[
            { key: "reason", header: "Motivo", cardTitle: true, render: (a) => <div><p className="text-ink">{a.reason}</p><p className="text-[12px] text-muted">{a.platform_user_name}{a.ticket_number ? ` · ${a.ticket_number}` : ""}</p></div> },
            { key: "level_name", header: "Nivel" },
            { key: "status", header: "Estado", render: (a) => <StatusBadge status={a.status} labels={ESTADOS_ACCESO} /> },
            { key: "expires_at", header: "Vence", hideOnMobile: true, render: (a) => (a.expires_at ? fechaHora(a.expires_at) : "—") },
            { key: "created_at", header: "Pedido", hideOnMobile: true, render: (a) => fechaHora(a.created_at) },
          ]} />
        )}</Lista>
      )}
      {pedir && <PedirAcceso empresa={f.id} onClose={() => setPedir(false)} onPedido={() => { setPedir(false); cargar(); setTab("accesos"); }} />}

      {tab === "resumen" && <>

      <div className="grid gap-5 lg:grid-cols-2">
        <Tarjeta titulo="Datos de la empresa">
          <DetailList items={[
            { label: "Razón social", value: f.name },
            { label: "RUC", value: f.ruc },
            { label: "Rubro", value: f.business_type_name },
            { label: "Dominio", value: f.dominios.length ? f.dominios.map((d) => d.hostname).join(", ") : "Sin dominio propio" },
            { label: "Contacto del alta", value: f.contact_name ? <>{f.contact_name}<br /><span className="text-muted">{[f.contact_email, f.contact_phone].filter(Boolean).join(" · ")}</span></> : null },
            { label: "Alta", value: `${fecha(f.created_at)}${f.creada_por ? ` · por ${f.creada_por}` : ""}` },
            { label: "Último ingreso de sus usuarios", value: f.last_login ? fechaHora(f.last_login) : "Nadie ingresó todavía" },
          ]} />
        </Tarjeta>

        <div id="suscripcion" className="scroll-mt-20"><Tarjeta titulo="Suscripción">
          {s ? (
            <div className="grid gap-4">
            <DetailList items={[
              { label: "Plan", value: f.plan_name },
              { label: "Estado", value: `${s.status_name} desde el ${fecha(s.status_changed_at)}` },
              { label: "Fin de la prueba", value: s.trial_ends_at ? `${fecha(s.trial_ends_at)} (${s.trial_days_granted} días)` : "—" },
              { label: "MRR", value: f.mrr ? soles(f.mrr) : "No suma mientras está en prueba" },
              { label: "Desde", value: fecha(s.started_at) },
              { label: "Descuento pactado", value: s.discount_pct > 0 ? `${s.discount_pct} % · ${s.discount_reason ?? ""}` : "Sin descuento" },
            ]} />
            <AccionesSuscripcion s={s} efectos={s.efectos} puedeEstado={yo.puede["tenant.status"]} puedePlanes={yo.puede["plans.manage"]} onCambio={cargar} />
            </div>
          ) : (
            <p className="text-[13.5px] text-muted">Opera sin suscripción (piloto o empresa interna): no tiene límites, cobros ni bloqueos.</p>
          )}
        </Tarjeta></div>
      </div>

      <Tarjeta titulo="Uso de los límites del plan">
        <div className="grid gap-4 sm:grid-cols-3">
          {f.uso.map((u) => (
            <div key={u.clave} className="grid gap-1.5">
              <p className="text-[12.5px] text-muted">{u.nombre} activos</p>
              <BarraUso uso={u} />
            </div>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Módulos encendidos" extra={<span className="text-[12.5px] text-muted">{f.modulos_encendidos.length}</span>}>
        <div className="flex flex-wrap gap-1.5">
          {f.modulos_encendidos.map((m) => (
            <span key={m.module_code} title={m.sus_source === "CORE" ? "Núcleo de la plataforma" : m.sus_source === "PLAN" ? "Incluido en el plan" : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12.5px] text-ink">
              {m.name.split(":")[0]}
            </span>
          ))}
        </div>
      </Tarjeta>

      <div className="grid gap-5 lg:grid-cols-2">
        <Tarjeta titulo="Historial de la suscripción">
          {s?.historial.length ? (
            <ol className="grid gap-3">
              {s.historial.map((e, i) => (
                <li key={i} className="border-l-2 border-line pl-3">
                  <p className="text-[13.5px] font-semibold text-ink">{EVENTOS[e.event] ?? e.event}{e.to_status ? ` · ${ESTADOS_SUSCRIPCION[e.to_status]?.[0] ?? e.to_status}` : ""}</p>
                  <p className="text-[13px] text-muted">{e.reason}</p>
                  <p className="text-[12px] text-muted">{fechaHora(e.occurred_at)} · {e.actor_name}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-[13.5px] text-muted">Sin movimientos.</p>}
        </Tarjeta>

        <Tarjeta titulo="Acciones de la consola sobre la empresa">
          {f.acciones_consola.length ? (
            <ol className="grid gap-3">
              {f.acciones_consola.map((a, i) => (
                <li key={i} className="border-l-2 border-line pl-3">
                  <p className="text-[13.5px] font-semibold text-ink">{a.action_name}</p>
                  {a.reason && <p className="text-[13px] text-muted">{a.reason}</p>}
                  <p className="text-[12px] text-muted">{fechaHora(a.occurred_at)} · {a.actor_name}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-[13.5px] text-muted">La consola no ha hecho cambios sobre esta empresa.</p>}
        </Tarjeta>
      </div>
      </>}
    </div>
  );
}

export default function Page() {
  return <Suspense><FichaEmpresa /></Suspense>;
}
