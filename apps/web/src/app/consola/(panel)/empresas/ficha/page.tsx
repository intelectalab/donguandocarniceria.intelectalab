"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Alert, Badge, DetailList, PageHeader, StatusBadge } from "@/components/ui";
import { BarraUso, ESTADOS_SUSCRIPCION, type Empresa } from "@/components/consola/empresas";
import { mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fecha, fechaHora, soles } from "@/lib/formato";

type Evento = { event: string; from_status: string | null; to_status: string | null; reason: string; actor_name: string; occurred_at: string };
type Ficha = Empresa & {
  hostname: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; creada_por: string | null;
  dominios: { hostname: string; is_primary: boolean; status: string }[];
  suscripcion: null | { id: string; plan_code: string; status: string; status_name: string; started_at: string; status_changed_at: string;
    trial_ends_at: string | null; trial_days_granted: number; historial: Evento[] };
  modulos_encendidos: { module_code: string; name: string; phase: number; sus_source: string | null }[];
  acciones_consola: { action: string; actor_name: string; reason: string | null; occurred_at: string }[];
};

const ACCIONES: Record<string, string> = { TENANT_CREATED: "Alta de la empresa" };
const EVENTOS: Record<string, string> = { CREATED: "Alta", STATUS_CHANGED: "Cambio de estado", TRIAL_EXTENDED: "Prueba extendida", PLAN_CHANGED: "Cambio de plan" };

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
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (id) apiConsola<Ficha>(`/empresas/${id}`).then(setF).catch((e) => setError(mensajeDe(e)));
  }, [id]);

  const volver = <Link href="/consola/empresas" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"><ArrowLeft size={14} />Empresas</Link>;
  if (!id || error) return <div className="grid gap-4">{volver}<Alert tone="bad">{error || "Falta la empresa."}</Alert></div>;
  if (!f) return <div className="grid place-items-center py-20 text-muted"><Loader2 className="animate-spin" /></div>;
  const s = f.suscripcion;

  return (
    <div className="grid gap-5">
      {volver}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[22px] font-bold text-ink">{f.short}</h1>
        {s ? <StatusBadge status={s.status} labels={ESTADOS_SUSCRIPCION} /> : <Badge>Sin suscripción · piloto</Badge>}
      </div>
      <PageHeader code="OPS-03" description={`${f.name}${f.ruc ? ` · RUC ${f.ruc}` : ""}. La consola ve su suscripción, su uso y los módulos encendidos; sus datos de negocio, solo con un acceso de soporte que la empresa apruebe.`} />

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

        <Tarjeta titulo="Suscripción">
          {s ? (
            <DetailList items={[
              { label: "Plan", value: f.plan_name },
              { label: "Estado", value: `${s.status_name} desde el ${fecha(s.status_changed_at)}` },
              { label: "Fin de la prueba", value: s.trial_ends_at ? `${fecha(s.trial_ends_at)} (${s.trial_days_granted} días)` : "—" },
              { label: "MRR", value: f.mrr ? soles(f.mrr) : "No suma mientras está en prueba" },
              { label: "Desde", value: fecha(s.started_at) },
            ]} />
          ) : (
            <p className="text-[13.5px] text-muted">Opera sin suscripción (piloto o empresa interna): no tiene límites, cobros ni bloqueos.</p>
          )}
        </Tarjeta>
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
              <span className="font-mono text-[11px] text-accent">{m.module_code}</span>{m.name.split(":")[0]}
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
                  <p className="text-[13.5px] font-semibold text-ink">{ACCIONES[a.action] ?? a.action}</p>
                  {a.reason && <p className="text-[13px] text-muted">{a.reason}</p>}
                  <p className="text-[12px] text-muted">{fechaHora(a.occurred_at)} · {a.actor_name}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-[13.5px] text-muted">La consola no ha hecho cambios sobre esta empresa.</p>}
        </Tarjeta>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><FichaEmpresa /></Suspense>;
}
