"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, FileText, Play, Plus, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { DataTable, type Column } from "@/components/ui";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import {
  Badge,
  Button,
  Cifra,
  FiltroSelect,
  Modal,
  PageHeader,
  confirmAction,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { BadgeEstadoSep, guardarIdSepActivo, ProyectoSep } from "@/modulos/sep/comun";

type RespuestaProyectos = {
  separations: ProyectoSep[];
  brands: { id: string; code: string; name: string; status: string; company_id: string; company_name: string; company_ruc: string }[];
  companies: { id: string; legal_name: string; trade_name: string; ruc: string; ose_status: string; ose_provider: string }[];
  dest_types: Record<string, string>;
  statuses: Record<string, string>;
  kpis: {
    in_progress_real_count: number;
    completed_real_count: number;
    simulations_count: number;
    stock_qty_difference: number;
    stock_transfer_lots_count: number;
    orders_resolved_pct: number | null;
    orders_resolved_count: number;
    orders_total_count: number;
  };
};

export default function Sep01Proyectos() {
  const [data, setData] = useState<RespuestaProyectos | null>(null);
  const [fBrand, setFBrand] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDest, setFDest] = useState("");
  const [fSimulation, setFSimulation] = useState("");
  const [versionMeta, setVersionMeta] = useState(0);
  const [detalle, setDetalle] = useState<ProyectoSep | null>(null);
  const lista = useListado<ProyectoSep>("/v1/sep/proyectos", {
    orden: "-s.number",
    filtros: { brand_id: fBrand, status: fStatus, dest_type: fDest, simulation: fSimulation },
  });

  useEffect(() => {
    let vigente = true;
    api.get<RespuestaProyectos>("/sep/proyectos?per_page=1")
      .then((res) => {
        if (!vigente) return;
        setData(res);
      })
      .catch((e) => {
        if (vigente) toast.error(e instanceof ApiError ? e.message : "No se pudieron cargar los proyectos.");
      });
    return () => {
      vigente = false;
    };
  }, [versionMeta]);

  function cargar() {
    lista.recargar();
    setVersionMeta((version) => version + 1);
  }

  async function cancelarProyecto(p: ProyectoSep) {
    const r = await confirmAction({
      title: `Cancelar ${p.number}`,
      message: `Se cancelará el proyecto de separación de ${p.brand_name}. Los datos de la marca no habrán cambiado.`,
      confirmLabel: "Cancelar proyecto",
      danger: true,
      reason: { label: "Motivo de cancelación", min: 5 },
    });
    if (!r) return;
    try {
      await api.post(`/sep/proyectos/${p.id}/cancelar`, {
        reason: r.reason || "Cancelado desde la lista de proyectos de separación.",
      });
      toast.ok(`Proyecto ${p.number} cancelado.`);
      cargar();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo cancelar.");
    }
  }

  const columnas: Column<ProyectoSep>[] = [
    {
      key: "number", header: "Número", sortable: true, sortKey: "s.number", cardTitle: true,
      render: (p) => (
        <span className="font-mono font-semibold">
          {p.number}
          {p.simulation && <span className="ml-1.5"><Badge tone="info">Simulación</Badge></span>}
        </span>
      ),
    },
    {
      key: "brand_name", header: "Marca", sortable: true, sortKey: "b.name",
      render: (p) => (
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-line" style={{ background: p.brand_color }} />
          <div>
            <div className="font-medium">{p.brand_name}</div>
            <div className="text-[11px] text-muted">Código {p.brand_code}</div>
          </div>
        </div>
      ),
    },
    {
      key: "dest_type_name", header: "Destino",
      render: (p) => (
        <div>
          <div className="text-[12.5px] font-medium">{p.dest_type_name}</div>
          <div className="text-[11.5px] text-muted">{p.dest_display}</div>
        </div>
      ),
    },
    {
      key: "cutoff_date", header: "Corte", sortable: true, sortKey: "s.cutoff_date",
      render: (p) => (
        <div className="space-y-1">
          <div className="font-mono text-[12.5px]">{fecha(p.cutoff_date)}</div>
          <Badge tone={p.period_closed ? "ok" : "warn"}>{p.period_closed ? "Mes cerrado" : "Mes abierto"}</Badge>
        </div>
      ),
    },
    {
      key: "status", header: "Estado",
      render: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <BadgeEstadoSep status={p.status} label={p.status_name} />
          {p.simulation && <Badge tone="info">Simulación</Badge>}
        </div>
      ),
    },
    {
      key: "prepared_by_name", header: "Preparó", hideOnMobile: true,
      render: (p) => (
        <div>
          <div>{p.prepared_by_name || "—"}</div>
          {p.prepared_at && <div className="text-[11px] text-muted">{fechaHora(p.prepared_at)}</div>}
        </div>
      ),
    },
    {
      key: "approved_by_name", header: "Aprobó", hideOnMobile: true,
      render: (p) => (
        <div>
          <div>{p.approved_by_name || "—"}</div>
          {p.approved_at && <div className="text-[11px] text-muted">{fechaHora(p.approved_at)}</div>}
        </div>
      ),
    },
    {
      key: "progress", header: "Avance",
      render: (p) => (
        <div className="min-w-[90px]">
          <div
            role="progressbar"
            aria-label={`Avance de ${p.number}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={p.progress.pct}
            className="h-1.5 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className={`h-full rounded-full ${p.status === "FAILED" ? "bg-bad" : "bg-primary"}`}
              style={{ width: `${Math.min(100, Math.max(0, p.progress.pct))}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {p.progress.done + p.progress.excluded}/{p.progress.total} resueltos
          </div>
        </div>
      ),
    },
    {
      key: "actions", header: "Acciones", align: "right",
      render: (p) => (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
          <Link
            href={`/m/sep/sep-03?id=${p.id}`}
            onClick={() => guardarIdSepActivo(p.id)}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-medium hover:bg-surface-alt"
          >
            <CheckCircle2 size={13} /> Validaciones
          </Link>
          <Link
            href={`/m/sep/sep-04?id=${p.id}`}
            onClick={() => guardarIdSepActivo(p.id)}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-medium hover:bg-surface-alt"
          >
            Alcance <ArrowRight size={12} />
          </Link>
          {["VALIDATED", "APPROVED"].includes(p.status) && (
            <Link
              href={`/m/sep/sep-08?id=${p.id}`}
              onClick={() => guardarIdSepActivo(p.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary-soft px-2.5 py-1 text-[12px] font-medium text-primary"
            >
              <ShieldCheck size={13} /> Usuarios y locales
            </Link>
          )}
          {["APPROVED", "EXECUTING", "FAILED"].includes(p.status) && (
            <Link
              href={`/m/sep/sep-09?id=${p.id}`}
              onClick={() => guardarIdSepActivo(p.id)}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-white"
            >
              <Play size={13} /> Ejecutar
            </Link>
          )}
          {p.status === "COMPLETED" && (
            <Link
              href={`/m/sep/sep-11?id=${p.id}`}
              onClick={() => guardarIdSepActivo(p.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-medium hover:bg-surface-alt"
            >
              <FileText size={13} /> Acta
            </Link>
          )}
          {!["COMPLETED", "CANCELLED"].includes(p.status) && (
            <button
              type="button"
              onClick={() => cancelarProyecto(p)}
              className="inline-flex items-center gap-1 rounded-lg border border-bad/30 px-2 py-1 text-[12px] text-bad hover:bg-bad/10"
              aria-label={`Cancelar ${p.number}`}
              title="Cancelar proyecto"
            >
              <XCircle size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        description="Cada separación transfiere una marca a otro RUC de la empresa, a otra empresa de la plataforma o a un sistema externo, con fecha de corte mensual y sin alterar el historial."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={cargar} disabled={lista.cargando}>
              <RefreshCw size={14} /> Actualizar
            </Button>
            <Link
              href="/m/sep/sep-02"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary/90"
            >
              <Plus size={14} /> Nueva separación
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <Cifra
          titulo="En curso"
          valor={data ? String(data.kpis.in_progress_real_count) : undefined}
          detalle="Desde el borrador hasta la ejecución"
        />
        <Cifra
          titulo="Completadas"
          valor={data ? String(data.kpis.completed_real_count) : undefined}
          detalle="Separaciones reales finalizadas"
        />
        <Cifra
          titulo="Simulaciones"
          valor={data ? String(data.kpis.simulations_count) : undefined}
          detalle="Ensayos sin cambiar datos"
        />
        <Cifra
          titulo="Diferencia de stock"
          valor={data ? numero(data.kpis.stock_qty_difference, 3) : undefined}
          detalle={`${data?.kpis.stock_transfer_lots_count ?? 0} lotes traspasados · objetivo: 0`}
          tono={(data?.kpis.stock_qty_difference ?? 0) === 0 ? "ok" : "bad"}
        />
        <Cifra
          titulo="Pedidos abiertos resueltos"
          valor={data?.kpis.orders_resolved_pct == null ? "—" : `${data.kpis.orders_resolved_pct}%`}
          detalle={
            data?.kpis.orders_total_count
              ? `${data.kpis.orders_resolved_count} de ${data.kpis.orders_total_count} pedidos`
              : "Sin separaciones ejecutadas"
          }
          tono={data?.kpis.orders_resolved_pct != null && data.kpis.orders_resolved_pct < 100 ? "warn" : undefined}
        />
      </div>

      <section>
        <div className="mb-3">
          <h2 className="text-[14.5px] font-semibold">Proyectos de separación de marcas</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Selecciona un proyecto para revisar sus validaciones, configurar el alcance por área, aprobarlo (4 ojos) y ejecutarlo.
          </p>
        </div>
        <DataTable
          {...lista.tabla}
          columns={columnas}
          onRowClick={setDetalle}
          search={{ ...lista.tabla.search, placeholder: "Buscar número, marca, empresa o destino…" }}
          empty="No hay proyectos de separación con esos filtros."
          toolbar={
            <>
              <FiltroSelect
                etiqueta="Marca"
                todos="Todas"
                value={fBrand}
                onChange={(value) => { setFBrand(value); lista.tabla.pagination.onPageChange(1); }}
                options={(data?.brands ?? []).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
              />
              <FiltroSelect
                etiqueta="Destino"
                todos="Todos"
                value={fDest}
                onChange={(value) => { setFDest(value); lista.tabla.pagination.onPageChange(1); }}
                options={Object.entries(data?.dest_types ?? {}).map(([value, label]) => ({ value, label }))}
              />
              <FiltroSelect
                etiqueta="Estado"
                todos="Todos"
                value={fStatus}
                onChange={(value) => { setFStatus(value); lista.tabla.pagination.onPageChange(1); }}
                options={Object.entries(data?.statuses ?? {}).map(([value, label]) => ({ value, label }))}
              />
              <FiltroSelect
                etiqueta="Tipo"
                todos="Todos"
                value={fSimulation}
                onChange={(value) => { setFSimulation(value); lista.tabla.pagination.onPageChange(1); }}
                options={[{ value: "0", label: "Real" }, { value: "1", label: "Simulación" }]}
              />
            </>
          }
        />
      </section>

      <Modal
        open={Boolean(detalle)}
        onClose={() => setDetalle(null)}
        title={detalle ? `${detalle.number} · ${detalle.brand_name}` : "Detalle de separación"}
        description="Información del proyecto y su avance"
        size="lg"
        placement="right"
        footer={
          detalle && (
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                href={`/m/sep/${detalle.status === "DRAFT" ? "sep-03" : "sep-09"}?id=${detalle.id}`}
                onClick={() => guardarIdSepActivo(detalle.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary/90"
              >
                Abrir asistente <ArrowRight size={14} />
              </Link>
              <Link
                href={`/m/sep/sep-12?brand=${detalle.brand_id}`}
                onClick={() => guardarIdSepActivo(detalle.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-alt"
              >
                Historial de la marca
              </Link>
              <Button variant="secondary" onClick={() => setDetalle(null)}>Cerrar</Button>
            </div>
          )
        }
      >
        {detalle && (
          <div className="space-y-5">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Marca</dt><dd className="mt-0.5 text-[13px]">{detalle.brand_name}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Estado</dt><dd className="mt-0.5"><BadgeEstadoSep status={detalle.status} label={detalle.status_name} /></dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Empresa de origen</dt><dd className="mt-0.5 text-[13px]">{detalle.origin_company_name} · RUC {detalle.origin_ruc}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Destino</dt><dd className="mt-0.5 text-[13px]">{detalle.dest_type_name} · {detalle.dest_display}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Fecha de corte</dt><dd className="mt-0.5 text-[13px]">{fecha(detalle.cutoff_date)} · rige desde {fecha(detalle.effective_from)}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Simulación</dt><dd className="mt-0.5 text-[13px]">{detalle.simulation ? "Sí, sin cambiar datos" : "No"}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Período del corte</dt><dd className="mt-0.5 text-[13px]">{detalle.period_closed ? "Cerrado" : "Abierto"}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Cuentas por cobrar</dt><dd className="mt-0.5 text-[13px]">{detalle.receivables_policy === "ASSIGN" ? "Se ceden al destino" : "Quedan en el origen"}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Elementos</dt><dd className="mt-0.5 text-[13px]">{`${detalle.progress.total} en total · ${detalle.progress.done} hechos · ${detalle.progress.excluded} excluidos · ${detalle.progress.failed} fallidos`}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Preparó</dt><dd className="mt-0.5 text-[13px]">{detalle.prepared_by_name || "—"}{detalle.prepared_at ? ` · ${fechaHora(detalle.prepared_at)}` : ""}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Aprobó</dt><dd className="mt-0.5 text-[13px]">{detalle.approved_by_name || "—"}{detalle.approved_at ? ` · ${fechaHora(detalle.approved_at)}` : ""}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase text-muted">Validaciones</dt><dd className="mt-0.5 text-[13px]">{detalle.checks_run_at ? fechaHora(detalle.checks_run_at) : "Sin ejecutar"}</dd></div>
              {detalle.export && <div className="sm:col-span-2"><dt className="text-[11.5px] font-semibold uppercase text-muted">Paquete de exportación</dt><dd className="mt-0.5 break-words text-[13px]">{detalle.export.file_name} · SHA-256 {detalle.export.sha256.slice(0, 16)}…</dd></div>}
              {detalle.act && <div className="sm:col-span-2"><dt className="text-[11.5px] font-semibold uppercase text-muted">Acta</dt><dd className="mt-0.5 text-[13px]">{detalle.act.file_name} · {fechaHora(detalle.act.generated_at)}</dd></div>}
              {detalle.warn_note && <div className="sm:col-span-2"><dt className="text-[11.5px] font-semibold uppercase text-muted">Nota de advertencias</dt><dd className="mt-0.5 text-[13px]">{detalle.warn_note}</dd></div>}
              {detalle.approval_note && <div className="sm:col-span-2"><dt className="text-[11.5px] font-semibold uppercase text-muted">Nota de aprobación</dt><dd className="mt-0.5 text-[13px]">{detalle.approval_note}</dd></div>}
              {detalle.cancel_reason && <div className="sm:col-span-2"><dt className="text-[11.5px] font-semibold uppercase text-muted">Motivo de cancelación</dt><dd className="mt-0.5 text-[13px]">{detalle.cancel_reason}</dd></div>}
              {detalle.notes && <div className="sm:col-span-2"><dt className="text-[11.5px] font-semibold uppercase text-muted">Notas</dt><dd className="mt-0.5 text-[13px]">{detalle.notes}</dd></div>}
            </dl>

            {detalle.history.length > 0 && (
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase text-muted">Historial</h3>
                <ol className="space-y-3 border-l border-line pl-4">
                  {[...detalle.history].reverse().map((entry, index) => (
                    <li key={`${entry.at}-${index}`} className="relative">
                      <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-primary" />
                      <p className="text-[13px] font-medium">{data?.statuses[entry.status] ?? "Actualización"}</p>
                      <p className="text-[11.5px] text-muted">{fechaHora(entry.at)}{entry.by_name ? ` · ${entry.by_name}` : ""}</p>
                      {entry.note && <p className="mt-0.5 text-[12.5px]">{entry.note}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
