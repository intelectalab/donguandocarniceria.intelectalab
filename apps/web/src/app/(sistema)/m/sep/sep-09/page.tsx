"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, FileText, Package, Play, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cifra,
  DataTable,
  Modal,
  PageHeader,
  type Column,
  confirmAction,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { BadgeItemSep, BarraProyectoSep, DetalleSep, ItemSep, useProyectoSep } from "@/modulos/sep/comun";
import { ResumenAprobacionSep } from "@/modulos/sep/ResumenAprobacionSep";
import { usePaginaLocal } from "@/lib/paginas";

export default function Sep09EjecucionYMonitoreo() {
  const { data, setData, loading, cambiarProyecto } = useProyectoSep();
  const [busy, setBusy] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [detalleItem, setDetalleItem] = useState<ItemSep | null>(null);

  async function ejecutar() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<DetalleSep>(`/sep/proyectos/${data.separation.id}/ejecutar`, {});
      setData(res);
      if (res.separation.status === "COMPLETED") {
        toast.ok(`Separación ${res.separation.number} ejecutada y completada.`);
      } else {
        toast.info(`Ejecución procesada (${res.separation.status_name}).`);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo ejecutar la separación.");
    } finally {
      setBusy(false);
    }
  }

  async function reintentarItem(item: ItemSep) {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<DetalleSep>(`/sep/proyectos/${data.separation.id}/ejecutar`, { item_id: item.id });
      setData(res);
      if (res.separation.status === "COMPLETED") {
        toast.ok(`Separación ${res.separation.number} completada.`);
      } else {
        toast.info(`Se reintentó «${item.label}». Quedan ${res.progress.pending} pendientes y ${res.progress.failed} con error.`);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `No se pudo reintentar «${item.label}».`);
    } finally {
      setBusy(false);
    }
  }

  async function cancelar() {
    if (!data) return;
    const confirmacion = await confirmAction({
      title: `Cancelar ${data.separation.number}`,
      message: `Se cancelará el proyecto de separación de ${data.separation.brand_name}. Los datos de la marca no habrán cambiado.`,
      confirmLabel: "Cancelar proyecto",
      danger: true,
      reason: { label: "Motivo de cancelación", min: 5 },
    });
    if (!confirmacion) return;

    setBusy(true);
    try {
      const res = await api.post<DetalleSep>(`/sep/proyectos/${data.separation.id}/cancelar`, {
        reason: confirmacion.reason ?? "",
      });
      setData(res);
      toast.ok(`Proyecto ${res.separation.number} cancelado.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo cancelar el proyecto.");
    } finally {
      setBusy(false);
    }
  }

  const s = data?.separation;
  const p = data?.progress ?? { total: 0, done: 0, excluded: 0, failed: 0, pending: 0, pct: 0 };
  const items = data?.items ?? [];
  const tipos = Array.from(new Map(items.map((item) => [item.item_type, item.item_type_name] as const)));
  const termino = buscar.trim().toLocaleLowerCase("es");
  const itemsFiltrados = items.filter((item) => {
    if (filtroTipo && item.item_type !== filtroTipo) return false;
    if (filtroEstado && item.status !== filtroEstado) return false;
    return !termino || [
      item.item_type_name,
      item.label,
      item.action_name,
      item.error,
      item.result,
      item.exclude_reason,
    ].some((value) => typeof value === "string" && value.toLocaleLowerCase("es").includes(termino));
  });
  const paginaItems = usePaginaLocal(itemsFiltrados, `${s?.id ?? ""}|${buscar}|${filtroTipo}|${filtroEstado}`);
  const columnas: Column<ItemSep>[] = [
    { key: "item_type_name", header: "Área" },
    { key: "label", header: "Elemento", cardTitle: true, className: "font-medium" },
    { key: "action_name", header: "Acción", render: (item) => <Badge tone="info">{item.action_name}</Badge> },
    { key: "status", header: "Estado", render: (item) => <BadgeItemSep status={item.status} /> },
    {
      key: "resultado",
      header: "Resultado o detalle",
      render: (item) => item.error
        ? <span className="font-medium text-bad">{item.error}</span>
        : <span className="text-muted">{item.result || item.exclude_reason || "—"}</span>,
    },
    {
      key: "acciones",
      header: "Acciones",
      render: (item) => (
        item.status === "FAILED" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              void reintentarItem(item);
            }}
            disabled={busy}
          >
            <RefreshCw size={13} /> Reintentar
          </Button>
        ) : null
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        description="Revisa el resumen de lo propuesto, registra la aprobación de otra persona y sigue la ejecución de cada elemento. Si alguno falla, puedes reintentar los pendientes y fallidos."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => cambiarProyecto(s?.id || "")} disabled={loading || busy}>
              <RefreshCw size={14} /> Actualizar
            </Button>
            {s && ["APPROVED", "EXECUTING", "FAILED"].includes(s.status) && (
              <Button variant="primary" onClick={ejecutar} disabled={busy}>
                <Play size={14} /> {s.status === "FAILED"
                  ? "Continuar y reintentar"
                  : s.simulation ? "Ejecutar simulación" : "Ejecutar separación"}
              </Button>
            )}
            {s && ["DRAFT", "VALIDATED", "APPROVED"].includes(s.status) && (
              <Button variant="danger" onClick={cancelar} disabled={busy}>
                Cancelar proyecto
              </Button>
            )}
            {s && (
              <Link
                href={`/m/sep/sep-10?id=${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-alt"
              >
                <Package size={14} /> Paquete
              </Link>
            )}
            {s?.status === "COMPLETED" && (
              <Link
                href={`/m/sep/sep-11?id=${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white"
              >
                <FileText size={14} /> Ver Acta <ArrowRight size={14} />
              </Link>
            )}
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Cifra titulo="Elementos" valor={String(p.total)} detalle="Incluidos y excluidos" />
        <Cifra titulo="Hechos" valor={String(p.done)} detalle="Ejecutados sin error" tono="ok" />
        <Cifra titulo="Excluidos" valor={String(p.excluded)} detalle="Fuera del alcance" />
        <Cifra
          titulo="Fallidos"
          valor={String(p.failed)}
          detalle={p.failed === 0 ? "Sin errores" : "Reintentar elementos fallidos"}
          tono={p.failed === 0 ? undefined : "bad"}
        />
        <Cifra
          titulo="Avance"
          valor={`${p.pct}%`}
          detalle={`${p.done + p.excluded} de ${p.total} resueltos`}
          tono={p.pct === 100 ? "ok" : "warn"}
        />
      </div>

      <ResumenAprobacionSep data={data} loading={loading} onDataChange={setData} />

      {s?.status === "COMPLETED" && (
        <Alert tone="ok" title={`Separación ${s.number} completada (${s.completed_at})`}>
          Todos los ítems fueron ejecutados o excluidos con sustento. El acta de separación con huella SHA-256 está disponible.
        </Alert>
      )}

      {s?.status === "FAILED" && (
        <Alert tone="bad" title="Algunos ítems fallaron durante la ejecución">
          Los elementos ya ejecutados se conservan sin duplicarse. Puedes reintentar cada elemento con error o continuar la ejecución de todos los pendientes y fallidos desde el botón superior.
        </Alert>
      )}

      <Card>
        <CardHeader title="Avance por elemento" subtitle="Selecciona una fila para consultar su detalle." />
        <DataTable
          rowKey={(item) => item.id}
          columns={columnas}
          rows={paginaItems.filas}
          pagination={paginaItems.props}
          loading={loading}
          onRowClick={setDetalleItem}
          search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar elemento o resultado…" }}
          toolbar={
            <>
              <label className="flex items-center gap-2 text-[12.5px] text-muted">
                Área
                <select
                  value={filtroTipo}
                  onChange={(event) => setFiltroTipo(event.target.value)}
                  className="h-9 min-w-0 rounded-[9px] border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-primary"
                >
                  <option value="">Todas</option>
                  {tipos.map(([tipo, nombre]) => <option key={tipo} value={tipo}>{nombre}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-muted">
                Estado
                <select
                  value={filtroEstado}
                  onChange={(event) => setFiltroEstado(event.target.value)}
                  className="h-9 min-w-0 rounded-[9px] border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-primary"
                >
                  <option value="">Todos</option>
                  <option value="PENDING">Pendiente</option>
                  <option value="DONE">Ejecutado</option>
                  <option value="EXCLUDED">Excluido</option>
                  <option value="FAILED">Con error</option>
                </select>
              </label>
            </>
          }
          empty="No hay elementos para los filtros seleccionados."
        />
      </Card>

      <Modal
        open={Boolean(detalleItem)}
        onClose={() => setDetalleItem(null)}
        title={detalleItem?.label || "Detalle del elemento"}
        description={detalleItem?.item_type_name}
        size="md"
        footer={<Button variant="secondary" onClick={() => setDetalleItem(null)}>Cerrar</Button>}
      >
        {detalleItem && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-[11.5px] font-semibold uppercase text-muted">Acción</dt>
              <dd className="mt-0.5 text-[13px]">{detalleItem.action_name}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold uppercase text-muted">Estado</dt>
              <dd className="mt-0.5"><BadgeItemSep status={detalleItem.status} /></dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold uppercase text-muted">Intentos</dt>
              <dd className="mt-0.5 text-[13px]">{detalleItem.attempts}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold uppercase text-muted">Última ejecución correcta</dt>
              <dd className="mt-0.5 text-[13px]">{detalleItem.executed_at || "—"}</dd>
            </div>
            {detalleItem.result && (
              <div className="sm:col-span-2">
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Resultado</dt>
                <dd className="mt-0.5 text-[13px]">{detalleItem.result}</dd>
              </div>
            )}
            {detalleItem.error && (
              <div className="sm:col-span-2">
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Detalle del error</dt>
                <dd className="mt-0.5 text-[13px] text-bad">{detalleItem.error}</dd>
              </div>
            )}
            {detalleItem.exclude_reason && (
              <div className="sm:col-span-2">
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Motivo de exclusión</dt>
                <dd className="mt-0.5 text-[13px]">{detalleItem.exclude_reason}</dd>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </div>
  );
}
