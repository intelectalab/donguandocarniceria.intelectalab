"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Field,
  Textarea,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { BadgeEstadoSep, DetalleSep } from "@/modulos/sep/comun";
import { usePaginaLocal } from "@/lib/paginas";

export function ResumenAprobacionSep({
  data,
  loading,
  onDataChange,
}: {
  data: DetalleSep | null;
  loading: boolean;
  onDataChange: (data: DetalleSep) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function aprobar() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<DetalleSep>(`/sep/proyectos/${data.separation.id}/aprobar`, {
        note: note.trim(),
      });
      onDataChange(res);
      setNote("");
      toast.ok(`Separación ${res.separation.number} aprobada.`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo aprobar la separación.");
    } finally {
      setBusy(false);
    }
  }

  const s = data?.separation;
  const historial = s?.history ?? [];
  const porTipo = Object.entries(data?.items_by_type ?? {}).map(([tipo, lista]) => {
    const acciones = new Map<string, number>();
    for (const item of lista) {
      acciones.set(item.action_name, (acciones.get(item.action_name) ?? 0) + 1);
    }
    const resueltos = lista.filter((item) => item.status === "DONE" || item.status === "EXCLUDED").length;
    return {
      tipo,
      nombre: lista[0]?.item_type_name ?? tipo,
      total: lista.length,
      acciones: [...acciones].map(([nombre, total]) => `${nombre} (${total})`).join(" · ") || "—",
      resueltos,
      avance: lista.length ? Math.round((resueltos / lista.length) * 100) : 0,
      tieneError: lista.some((item) => item.status === "FAILED"),
    };
  });
  const paginaTipos = usePaginaLocal(porTipo, s?.id ?? "");
  const paginaHistorial = usePaginaLocal(historial, `${s?.id ?? ""}|history`);
  const columnasTipos: Column<(typeof porTipo)[number]>[] = [
    { key: "nombre", header: "Área", cardTitle: true, className: "font-medium" },
    { key: "total", header: "Elementos", align: "right" },
    { key: "acciones", header: "Acciones" },
    {
      key: "avance",
      header: "Avance",
      render: (row) => (
        <div className="min-w-[100px]">
          <div
            role="progressbar"
            aria-label={`Avance de ${row.nombre}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={row.avance}
            className="h-2 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className={`h-full rounded-full ${row.tieneError ? "bg-bad" : "bg-primary"}`}
              style={{ width: `${row.avance}%` }}
            />
          </div>
          <span className="text-[11.5px] text-muted">{row.resueltos}/{row.total}</span>
        </div>
      ),
    },
  ];
  const columnasHistorial: Column<(typeof historial)[number]>[] = [
    { key: "at", header: "Fecha y hora", cardTitle: true },
    { key: "by_name", header: "Responsable", render: (event) => event.by_name || "—" },
    { key: "status", header: "Estado", render: (event) => <BadgeEstadoSep status={event.status} /> },
    { key: "note", header: "Nota", render: (event) => event.note || "—" },
  ];

  return (
    <div className="space-y-4">
      {!s?.period_closed && !s?.simulation && (
        <Alert tone="warn" title="El período contable del mes de corte aún está abierto">
          Para aprobar y ejecutar la separación, primero debe cerrarse en la empresa de origen el período correspondiente al corte ({s?.cutoff_date}).
        </Alert>
      )}

      {s?.status === "DRAFT" && (
        <Alert tone="warn" title="Proyecto aún en borrador">
          Completa primero las validaciones previas para habilitar la aprobación.{" "}
          <Link href={`/m/sep/sep-03?id=${s.id}`} className="font-semibold underline">
            Ir a Validaciones previas
          </Link>
        </Alert>
      )}

      {s?.status === "VALIDATED" && (
        <Card>
          <CardHeader
            title="Aprobación de gerencia"
            subtitle="Al aprobar se congela el alcance y la fecha de corte. Debe aprobar una persona distinta de quien preparó el proyecto."
          />
          <CardBody className="space-y-3">
            <Field label="Nota y sustento de aprobación" hint="Ingresa al menos dos caracteres.">
              <Textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ej. Aprobado tras el cierre contable y la revisión del inventario."
              />
            </Field>
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={aprobar}
                disabled={busy || note.trim().length < 2 || (!s.period_closed && !s.simulation)}
              >
                Confirmar aprobación
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {s?.simulation && (
        <Alert tone="info" title="Ejecución de simulación">
          Se revisará cada elemento sin emitir comprobantes, mover existencias ni cambiar canales o usuarios.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Resumen por área" subtitle="Acciones propuestas y avance de cada grupo" />
          <DataTable
            rowKey={(row) => row.tipo}
            columns={columnasTipos}
            rows={paginaTipos.filas}
            pagination={paginaTipos.props}
            loading={loading}
            empty="No hay elementos en el alcance de este proyecto."
          />
        </Card>

        <Card>
          <CardHeader title="Aprobación y ejecución" subtitle="Responsables, fechas y cierre contable" />
          <CardBody className="space-y-3">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Preparado por</dt>
                <dd className="mt-0.5 text-[13px]">{s?.prepared_by_name || "—"}</dd>
                <dd className="text-[12px] text-muted">{s?.prepared_at || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Validado</dt>
                <dd className="mt-0.5 text-[13px]">{s?.validated_at || "Pendiente"}</dd>
                {s?.warn_note && <dd className="text-[12px] text-muted">Advertencias: {s.warn_note}</dd>}
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Aprobado por</dt>
                <dd className="mt-0.5 text-[13px]">{s?.approved_by_name || "Pendiente"}</dd>
                <dd className="text-[12px] text-muted">{s?.approved_at || "—"}</dd>
                {s?.approval_note && <dd className="text-[12px] text-muted">Nota: {s.approval_note}</dd>}
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Período de corte</dt>
                <dd className="mt-0.5 text-[13px]">{s?.cutoff_date || "—"}</dd>
                <dd className="mt-1">
                  <Badge tone={s?.period_closed ? "ok" : "warn"}>
                    {s?.period_closed ? "Cerrado" : "Abierto"}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Ejecución</dt>
                <dd className="mt-0.5 text-[13px]">{s?.executed_at || "Pendiente"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Completada</dt>
                <dd className="mt-0.5 text-[13px]">{s?.completed_at || "Pendiente"}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>

      {s?.approved_by && (
        <Alert tone="ok" title={`Aprobada por ${s.approved_by_name} (${s.approved_at})`}>
          {s.approval_note || "Aprobación registrada."}
        </Alert>
      )}

      <Card>
        <CardHeader title="Bitácora del proyecto" subtitle="Cambios de estado y responsables" />
        <DataTable
          rowKey={(event) => `${event.at}|${event.status}`}
          columns={columnasHistorial}
          rows={paginaHistorial.filas}
          pagination={paginaHistorial.props}
          loading={loading}
          empty="Este proyecto aún no tiene movimientos registrados."
        />
      </Card>
    </div>
  );
}
