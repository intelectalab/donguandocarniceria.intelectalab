"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, TrendingUp } from "lucide-react";
import { Alert, Cifra, DataTable, Modal, PageHeader, Select, StatusBadge, type Column } from "@/components/ui";
import { AccionesSuscripcion } from "@/components/consola/AccionesSuscripcion";
import { BarraUso, ESTADOS_SUSCRIPCION, type Uso } from "@/components/consola/empresas";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { mensajeDe } from "@/lib/api";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { apiConsola } from "@/lib/consola";
import { fecha, fechaHora, porcentaje, soles } from "@/lib/formato";

type Suscripcion = {
  id: string; tenant_id: string; short: string; tenant_name: string; ruc: string | null; plan_code: string; plan_name: string; version: number | null;
  status: string; status_name: string; days_in_status: number; trial_ends_at: string | null; trial_days_granted: number;
  discount_pct: number; discount_reason: string | null; mrr: number; uso: Uso[]; started_at: string; transiciones: string[];
};
type Detalle = Suscripcion & { historial: { event: string; to_status: string | null; reason: string; actor_name: string; occurred_at: string }[]; efectos: Record<string, string> };

/** El uso más alto respecto de su límite (como la columna del prototipo). */
const usoMasAlto = (u: Uso[]) => u.filter((x) => x.pct !== null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0] ?? null;
const EN_CABECERA = ["TRIAL", "ACTIVE", "PAST_DUE", "READ_ONLY", "SUSPENDED"] as const;
const TONO_CIFRA: Record<string, "warn" | "bad" | undefined> = { PAST_DUE: "warn", READ_ONLY: "bad", SUSPENDED: "bad" };

const EVENTOS: Record<string, string> = { CREATED: "Alta", STATUS_CHANGED: "Cambio de estado", TRIAL_EXTENDED: "Prueba extendida", DISCOUNT: "Descuento", PLAN_CHANGED: "Cambio de plan" };

/** SUS-11 Suscripciones de clientes: estado, días en el estado, MRR y uso; detalle con historial, extender prueba, descuento y cambio de estado. */
export default function Suscripciones() {
  const yo = useUsuarioConsola();
  const [filas, setFilas] = useState<Suscripcion[] | null>(null);
  const [error, setError] = useState("");
  const [estado, setEstado] = useState("");
  const [abierta, setAbierta] = useState<Detalle | null>(null);

  const cargar = () => apiConsola<{ data: Suscripcion[] }>("/suscripciones").then((r) => { setFilas(r.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  useEffect(() => { cargar(); }, []);
  const abrir = (id: string) => apiConsola<Detalle>(`/suscripciones/${id}`).then(setAbierta).catch((e) => setError(mensajeDe(e)));
  const visibles = useMemo(() => (filas ?? []).filter((f) => !estado || f.status === estado), [filas, estado]);
  const ord = useOrdenLocal(visibles, {
    short: (s) => s.short, plan_name: (s) => s.plan_name, status: (s) => s.status_name, trial_ends_at: (s) => (s.status === "TRIAL" ? s.trial_ends_at : null),
    mrr: (s) => s.mrr, users: (s) => s.uso[0]?.usado ?? null, uso_alto: (s) => usoMasAlto(s.uso)?.pct ?? null,
  });
  const pagina = usePaginaLocal(ord.filas, `${estado}|${ord.orden.sort}`);

  const columnas: Column<Suscripcion>[] = [
    { key: "short", sortable: true, header: "Empresa", cardTitle: true, render: (s) => <div><p className="font-semibold text-ink">{s.short}</p><p className="text-[12.5px] text-muted">{s.ruc ? `RUC ${s.ruc}` : s.tenant_name}</p></div> },
    { key: "plan_name", sortable: true, header: "Plan", render: (s) => <>{s.plan_name}{s.version ? <span className="text-muted"> · v{s.version}</span> : null}</> },
    { key: "status", sortable: true, header: "Estado", render: (s) => <div className="grid gap-0.5"><StatusBadge status={s.status} labels={ESTADOS_SUSCRIPCION} /><span className="text-[12px] text-muted">{s.days_in_status === 0 ? "desde hoy" : `hace ${s.days_in_status} días`}</span></div> },
    { key: "trial_ends_at", sortable: true, header: "Fin de la prueba", hideOnMobile: true, render: (s) => s.status === "TRIAL" ? fecha(s.trial_ends_at) : "—" },
    { key: "mrr", sortable: true, header: "MRR", align: "right", render: (s) => <>{s.mrr ? soles(s.mrr) : "—"}{s.discount_pct > 0 && <span className="block text-[12px] text-muted">−{porcentaje(s.discount_pct)}</span>}</> },
    { key: "users", sortable: true, header: "Usuarios", hideOnMobile: true, render: (s) => s.uso[0] ? <BarraUso uso={s.uso[0]} /> : "—" },
    { key: "uso_alto", sortable: true, header: "Uso más alto", hideOnMobile: true, render: (s) => { const u = usoMasAlto(s.uso);
      return u ? <span className={`text-[12.5px] ${(u.pct ?? 0) >= 100 ? "font-semibold text-bad" : (u.pct ?? 0) >= 80 ? "text-warn" : ""}`}>{porcentaje(u.pct ?? 0)} de {u.nombre.toLowerCase()}</span> : <span className="text-muted">—</span>; } },
  ];
  const vivas = (filas ?? []).filter((f) => f.status !== "CANCELLED");
  // MRR como el prototipo: activas y con deuda (ya viene con el descuento y sin IGV).
  const mrr = (filas ?? []).filter((f) => f.status === "ACTIVE" || f.status === "PAST_DUE").reduce((t, f) => t + (f.mrr || 0), 0);

  return (
    <div className="grid gap-5">
      <PageHeader description="La suscripción de cada empresa cliente con su plan y versión, el estado y los días que lleva, su MRR y su uso. Abre una para ver su historial, extender la prueba, pactar un descuento o cambiar su estado." />
      {error && <Alert tone="bad">{error}</Alert>}
      {filas && (
        <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Cifra titulo="MRR" valor={soles(mrr)} detalle="Activas y con deuda, sin IGV" icono={TrendingUp} destacada />
          <Cifra titulo="Empresas" valor={String(vivas.length)} detalle="Con suscripción vigente" icono={Building2} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {EN_CABECERA.map((k) => {
            const n = (filas ?? []).filter((f) => f.status === k).length;
            return (
              <button key={k} type="button" onClick={() => setEstado(estado === k ? "" : k)} title={`Ver solo ${ESTADOS_SUSCRIPCION[k][0].toLowerCase()}`}
                className={`grid cursor-pointer rounded-xl text-left [&>div]:h-full ${estado === k ? "ring-2 ring-primary" : ""}`}>
                <Cifra titulo={ESTADOS_SUSCRIPCION[k][0]} valor={String(n)} tono={n ? TONO_CIFRA[k] : undefined} />
              </button>
            );
          })}
        </div>
        </div>
      )}
      <DataTable {...ord.orden} columns={columnas} rows={pagina.filas} pagination={pagina.props} loading={!filas && !error} onRowClick={(s) => abrir(s.id)}
        empty="Aún no hay suscripciones: las empresas que se dan de alta desde la consola aparecen aquí."
        toolbar={<Select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado"
          options={[{ value: "", label: "Todos los estados" }, ...Object.entries(ESTADOS_SUSCRIPCION).map(([v, [l]]) => ({ value: v, label: l }))]} />} />

      {abierta && (
        <Modal open onClose={() => setAbierta(null)} size="lg" title={`${abierta.short} · ${abierta.plan_name}`}
          description={`${abierta.status_name} · desde ${fecha(abierta.started_at)}${abierta.discount_pct > 0 ? ` · descuento ${porcentaje(abierta.discount_pct)} (${abierta.discount_reason})` : ""}`}>
          <div className="grid gap-5">
            <AccionesSuscripcion s={abierta} efectos={abierta.efectos} puedeEstado={yo.puede["tenant.status"]} puedePlanes={yo.puede["plans.manage"]}
              onCambio={() => { cargar(); abrir(abierta.id); }} />
            <Link href={`/consola/empresas/ficha?id=${abierta.tenant_id}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
              <Building2 size={14} /> Ver la ficha de la empresa
            </Link>
            <div>
              <h3 className="mb-2 font-display text-[14px] font-bold text-ink">Historial</h3>
              <ol className="grid gap-3">
                {abierta.historial.map((e, i) => (
                  <li key={i} className="border-l-2 border-line pl-3">
                    <p className="text-[13.5px] font-semibold text-ink">{EVENTOS[e.event] ?? e.event}{e.event === "STATUS_CHANGED" && e.to_status ? ` · ${ESTADOS_SUSCRIPCION[e.to_status]?.[0]}` : ""}</p>
                    <p className="text-[13px] text-muted">{e.reason}</p>
                    <p className="text-[12px] text-muted">{fechaHora(e.occurred_at)} · {e.actor_name}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
