"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Cifra,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Textarea,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { BarraProyectoSep, ChequeoSep, DetalleSep, useProyectoSep } from "@/modulos/sep/comun";
import { usePaginaLocal } from "@/lib/paginas";
import { fechaHora } from "@/lib/formato";

export default function Sep03ValidacionesPrevias() {
  const router = useRouter();
  const { data, setData, loading, cambiarProyecto } = useProyectoSep();
  const [warnNote, setWarnNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [detalle, setDetalle] = useState<ChequeoSep | null>(null);

  async function correrChequeos() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<DetalleSep>(`/sep/proyectos/${data.separation.id}/chequeos`, {});
      setData(res);
      toast.ok("Validaciones previas actualizadas.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudieron correr las validaciones.");
    } finally {
      setBusy(false);
    }
  }

  async function validarProyecto() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<DetalleSep>(`/sep/proyectos/${data.separation.id}/validar`, {
        warn_note: warnNote || data.separation.warn_note || "Advertencias revisadas y aceptadas",
      });
      setData(res);
      toast.ok(`Proyecto ${res.separation.number} marcado como validado.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo validar el proyecto.");
    } finally {
      setBusy(false);
    }
  }

  const s = data?.separation;
  const sum = data?.checks_summary ?? { total: 0, pass: 0, warn: 0, fail: 0 };
  const checks = data?.checks ?? [];
  const paginaChecks = usePaginaLocal(checks, s?.id ?? "");
  const columnas: Column<ChequeoSep>[] = [
    { key: "seq", header: "N.º", align: "right" },
    { key: "title", header: "Validación", cardTitle: true, className: "font-medium" },
    { key: "detail", header: "Detalle" },
    { key: "count", header: "Casos", align: "right" },
    {
      key: "result",
      header: "Resultado",
      render: (check) => (
        <Badge tone={check.result === "PASS" ? "ok" : check.result === "WARN" ? "warn" : "bad"}>
          {check.result === "PASS" ? "Conforme" : check.result === "WARN" ? "Advertencia" : "Bloqueante"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        description="Lista de 15 chequeos automáticos antes de aprobar la separación: corte a fin de mes, período contable, pedidos en preparación, rutas abiertas, comprobantes al OSE, series destino, conteo de stock y consentimiento de clientes."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={correrChequeos} disabled={busy || loading || !s}>
              <RefreshCw size={14} /> Volver a verificar
            </Button>
            {s && ["DRAFT", "VALIDATED"].includes(s.status) && (
              <Button variant="primary" onClick={validarProyecto} disabled={busy || sum.fail > 0}>
                <CheckCircle2 size={14} /> Marcar como validada
              </Button>
            )}
            {s && (
              <Button variant="primary" onClick={() => router.push(`/m/sep/sep-04?id=${s.id}`)}>
                Ir a Catálogo y series <ArrowRight size={14} />
              </Button>
            )}
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Cifra titulo="Chequeos totales" valor={String(sum.total)} detalle="15 validaciones previas" />
        <Cifra titulo="Conformes" valor={String(sum.pass)} detalle="Sin observaciones" tono="ok" />
        <Cifra
          titulo="Advertencias"
          valor={String(sum.warn)}
          detalle="Exigen nota de aceptación"
          tono={sum.warn > 0 ? "warn" : "ok"}
        />
        <Cifra
          titulo="Bloqueantes"
          valor={String(sum.fail)}
          detalle={sum.fail === 0 ? "Listo para validar" : "Impiden pasar a validada"}
          tono={sum.fail === 0 ? "ok" : "bad"}
        />
      </div>

      {sum.fail > 0 && (
        <Alert tone="bad" title="Hay validaciones bloqueantes">
          Corrige los puntos en rojo (por ejemplo, terminar los pedidos en preparación o reparto de la marca) y pulsa «Volver a verificar» antes de validar el proyecto.
        </Alert>
      )}

      {sum.fail === 0 && sum.warn > 0 && s && ["DRAFT", "VALIDATED"].includes(s.status) && (
        <Card>
          <CardBody className="space-y-3">
            <Field label="Nota de aceptación de advertencias">
              <Textarea
                rows={2}
                value={warnNote || s.warn_note || ""}
                onChange={(e) => setWarnNote(e.target.value)}
                placeholder="Explica por qué se aceptan las advertencias (p. ej. el período contable de setiembre se cerrará antes de aprobar y ejecutar)."
              />
            </Field>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Resultado de las 15 validaciones previas"
          subtitle={s?.checks_run_at ? `Última corrida: ${s.checks_run_at}` : "Verificación en tiempo real"}
        />
        <DataTable
          rowKey={(check) => check.code}
          columns={columnas}
          rows={paginaChecks.filas}
          pagination={paginaChecks.props}
          loading={loading}
          onRowClick={setDetalle}
          empty="No hay resultados de validación para este proyecto."
        />
      </Card>

      <Modal
        open={Boolean(detalle)}
        onClose={() => setDetalle(null)}
        title={detalle?.title ?? "Detalle de validación"}
        description="Resultado del chequeo previo"
        size="md"
        placement="right"
        footer={<Button variant="secondary" onClick={() => setDetalle(null)}>Cerrar</Button>}
      >
        {detalle && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-[11.5px] font-semibold uppercase text-muted">Resultado</dt>
              <dd className="mt-0.5 text-[13px]">
                {detalle.result === "PASS" ? "Conforme" : detalle.result === "WARN" ? "Advertencia" : "Bloqueante"}
              </dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold uppercase text-muted">Casos</dt>
              <dd className="mt-0.5 text-[13px]">{detalle.count}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11.5px] font-semibold uppercase text-muted">Detalle</dt>
              <dd className="mt-0.5 text-[13px]">{detalle.detail}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11.5px] font-semibold uppercase text-muted">Verificado</dt>
              <dd className="mt-0.5 text-[13px]">{fechaHora(detalle.run_at)} · {detalle.run_by}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </div>
  );
}
