"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, RefreshCw, SkipForward } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, porcentaje } from "@/lib/formato";
import { EstadoPasoBadge, PasoAlta } from "@/modulos/onb/comun";

type EstadoGeneral = {
  run: {
    id: string;
    tenant_name: string;
    industry: string;
    plan_code: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    go_live_at: string | null;
    first_accepted_document_at: string | null;
  };
  subscription: { status: string; plan_code: string; trial_ends_at: string | null } | null;
  progress: {
    pct: number;
    done: number;
    req: number;
    all: number;
    all_done: number;
    pending: number;
    days: number;
    kpi_onb_02_days: number | null;
    next_step: PasoAlta | null;
  };
  kpi_onb_03_error_pct: number;
  reminder_days: number;
  steps: PasoAlta[];
};

export default function Onb02ListaPasosPage() {
  const [datos, setDatos] = useState<EstadoGeneral | null>(null);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState("");

  function cargar() {
    setCargando(true);
    api<EstadoGeneral>("/v1/onb/pasos")
      .then(setDatos)
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function marcarHecho(code: string) {
    setProcesando(code);
    try {
      const r = await api<EstadoGeneral>(`/v1/onb/pasos/${code}/completar`, { method: "POST" });
      setDatos(r);
      toast.ok("Paso marcado como hecho.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando("");
    }
  }

  async function omitir(code: string) {
    setProcesando(code);
    try {
      const r = await api<EstadoGeneral>(`/v1/onb/pasos/${code}/omitir`, {
        method: "POST",
        body: JSON.stringify({ reason: "Omitido desde la lista de pasos" }),
      });
      setDatos(r);
      toast.ok("Paso omitido.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando("");
    }
  }

  async function cambiarObligatorio(code: string, is_required: boolean) {
    setProcesando(code);
    try {
      const r = await api<EstadoGeneral>(`/v1/onb/pasos/${code}/obligatorio`, {
        method: "PUT",
        body: JSON.stringify({ is_required }),
      });
      setDatos(r);
      toast.ok(is_required ? "Paso marcado como obligatorio." : "Paso marcado como opcional.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando("");
    }
  }

  const p = datos?.progress;
  const run = datos?.run;

  return (
    <div className="space-y-5">
      <PageHeader
        description="Pasos obligatorios y opcionales con estado, prerrequisitos, responsable y avance; «Continuar donde quedé» lleva al siguiente paso posible."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {run?.status === "IN_PROGRESS" && p?.next_step && (
              <Link
                href={p.next_step.url}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:opacity-95"
              >
                Continuar donde quedé: {p.next_step.name} <ArrowRight size={14} />
              </Link>
            )}
            <Button variant="secondary" icon={RefreshCw} loading={cargando} onClick={cargar}>
              Actualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Cifra
          titulo="Avance del alta"
          valor={p ? porcentaje(p.pct, 0) : "…"}
          detalle={p ? `${p.done} de ${p.req} obligatorios` : ""}
          tono={p && p.pct >= 100 ? "ok" : undefined}
        />
        <Cifra
          titulo="Pasos completados"
          valor={p ? `${p.all_done} / ${p.all}` : "…"}
          detalle={p ? `${p.pending} pendientes` : ""}
        />
        <Cifra
          titulo="Días desde el inicio"
          valor={p ? String(p.days) : "…"}
          detalle={run ? `Inicio ${fecha(run.started_at)}` : ""}
        />
        <Cifra
          titulo="Prueba gratuita"
          valor={datos?.subscription?.trial_ends_at ? fecha(datos.subscription.trial_ends_at) : "—"}
          detalle={datos?.subscription ? `Plan ${datos.subscription.plan_code}` : "Sin suscripción (piloto)"}
        />
        <Cifra
          titulo="Tiempo de alta"
          valor={p?.kpi_onb_02_days != null ? `${p.kpi_onb_02_days} días` : "—"}
          detalle="Hasta el primer comprobante"
        />
      </div>

      {run?.status === "COMPLETED" && (
        <Alert tone="ok" title="Alta completada">
          La empresa completó su alta el {fechaHora(run.completed_at)} · inicio de operación{" "}
          <b>{fecha(run.go_live_at)}</b>.
        </Alert>
      )}

      {run?.status === "IN_PROGRESS" && p && p.days >= (datos?.reminder_days ?? 3) && p.pending > 0 && (
        <Alert tone="warn" title="Pasos pendientes">
          Hay {p.pending} pasos pendientes y ya pasaron {p.days} días desde el inicio del alta.
        </Alert>
      )}

      <DataTable<PasoAlta>
        rows={datos?.steps ?? []}
        loading={cargando}
        rowKey={(r) => r.id}
        empty="No hay pasos registrados."
        columns={[
          { key: "seq", header: "#", align: "right", render: (r) => r.seq },
          {
            key: "name",
            header: "Paso",
            render: (r) => (
              <div>
                <Link href={r.url} className="font-semibold text-primary hover:underline">
                  {r.name}
                </Link>
                <div className="text-[12px] text-muted">{r.screen}</div>
              </div>
            ),
          },
          {
            key: "is_required",
            header: "Tipo",
            render: (r) => (
              <Badge tone={r.is_required ? "warn" : "neutral"}>
                {r.is_required ? "Obligatorio" : "Opcional"}
              </Badge>
            ),
          },
          {
            key: "status",
            header: "Estado",
            render: (r) => <EstadoPasoBadge status={r.status} />,
          },
          {
            key: "pre",
            header: "Prerrequisitos",
            render: (r) =>
              r.prerequisites.length === 0 ? (
                <span className="text-muted">—</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {r.prerequisites.map((pre) => (
                    <Badge key={pre.code} tone={pre.missing ? "warn" : "ok"}>
                      {pre.name}
                    </Badge>
                  ))}
                </div>
              ),
          },
          {
            key: "owner_role_name",
            header: "Responsable",
            render: (r) => r.owner_role_name,
          },
          {
            key: "completed_at",
            header: "Hecho",
            render: (r) =>
              r.completed_at ? (
                <div>
                  <div>{fechaHora(r.completed_at)}</div>
                  {r.completed_by && <div className="text-[12px] text-muted">{r.completed_by}</div>}
                </div>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
          {
            key: "acciones",
            header: "Acciones",
            align: "right",
            render: (r) => (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <Link
                  href={r.url}
                  className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium hover:bg-surface-2"
                >
                  Abrir
                </Link>
                {run?.status === "IN_PROGRESS" && r.status === "PENDING" && r.step_code !== "GO_LIVE" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={CheckCircle2}
                    loading={procesando === r.step_code}
                    onClick={() => marcarHecho(r.step_code)}
                  >
                    Marcar hecho
                  </Button>
                )}
                {run?.status === "IN_PROGRESS" && r.status === "PENDING" && !r.is_required && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={SkipForward}
                    loading={procesando === r.step_code}
                    onClick={() => omitir(r.step_code)}
                  >
                    Omitir
                  </Button>
                )}
                {run?.status === "IN_PROGRESS" && r.status === "PENDING" && !r.is_fixed_required && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={procesando === r.step_code}
                    onClick={() => cambiarObligatorio(r.step_code, !r.is_required)}
                  >
                    {r.is_required ? "Hacer opcional" : "Hacer obligatorio"}
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
