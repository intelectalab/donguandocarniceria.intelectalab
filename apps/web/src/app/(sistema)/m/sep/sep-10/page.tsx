"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Download, Package, ShieldCheck } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Cifra,
  DataTable,
  Modal,
  PageHeader,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { ArchivoExportacionSep, BarraProyectoSep, descargarArchivoTexto, DetalleSep, ExportacionSep, useProyectoSep } from "@/modulos/sep/comun";
import { usePaginaLocal } from "@/lib/paginas";

function formatoTamano(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("es-PE", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB`;
}

export default function Sep10PaqueteExportacion() {
  const { data, setData, cambiarProyecto } = useProyectoSep();
  const [busy, setBusy] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; title: string; csv: string } | null>(null);
  const [ahora, setAhora] = useState<number | null>(null);

  useEffect(() => {
    const timers = [window.setTimeout(() => setAhora(Date.now()), 0)];
    const vence = data?.separation.export?.expires_at;
    if (vence) {
      const restante = Date.parse(vence) - Date.now();
      if (restante > 0) timers.push(window.setTimeout(() => setAhora(Date.now()), restante + 1));
    }
    return () => timers.forEach(window.clearTimeout);
  }, [data?.separation.export?.expires_at]);

  async function generarPaquete() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<{ export: ExportacionSep; detail: DetalleSep }>(`/sep/proyectos/${data.separation.id}/paquete`, {});
      setData(res.detail);
      toast.ok(`Paquete ${res.export.export_number} generado con huella SHA-256.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo generar el paquete.");
    } finally {
      setBusy(false);
    }
  }

  async function aprobarPaquete() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<{ export: ExportacionSep; detail: DetalleSep }>(
        `/sep/proyectos/${data.separation.id}/paquete/aprobar`,
        {}
      );
      setData(res.detail);
      toast.ok(`Paquete ${res.export.export_number} aprobado para descarga.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo aprobar el paquete.");
    } finally {
      setBusy(false);
    }
  }

  async function descargarPaquete() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(`/sep/proyectos/${data.separation.id}/paquete/enlace`, {});
      window.location.href = res.url;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo obtener el enlace de descarga.");
    } finally {
      setBusy(false);
    }
  }

  const s = data?.separation;
  const exp = s?.export;
  const files: ArchivoExportacionSep[] = exp?.files ?? [];
  const paginaArchivos = usePaginaLocal(files, exp?.export_number ?? s?.id ?? "");
  const enlaceVigente = exp?.status === "READY"
    && Boolean(exp.expires_at)
    && (ahora === null || Date.parse(exp.expires_at!) > ahora);
  const paqueteDescargable = enlaceVigente && Boolean(exp?.download_available);
  const estadoDescarga = !exp
    ? "Sin generar"
    : exp.status === "PENDING_APPROVAL"
      ? "Por aprobar"
      : exp.status === "REJECTED"
        ? "Rechazado"
        : !enlaceVigente
          ? "Vencido"
          : exp.download_available
            ? "Listo"
            : "Regenerar";
  const detalleDescarga = !exp
    ? "Genera el paquete"
    : exp.status === "PENDING_APPROVAL"
      ? "Requiere aprobación de otra persona"
      : exp.status === "REJECTED"
        ? "La aprobación fue rechazada"
        : paqueteDescargable
          ? `Vigente hasta ${exp.expires_at!.slice(0, 10)}`
          : exp.download_available
            ? "El enlace venció; regenera el paquete"
            : "Regenera el paquete para habilitar la descarga";
  const columnas: Column<ArchivoExportacionSep>[] = [
    { key: "name", header: "Archivo CSV", cardTitle: true, className: "font-mono font-semibold" },
    { key: "title", header: "Contenido" },
    { key: "rows", header: "Registros", align: "right" },
    {
      key: "personal_data",
      header: "Datos personales",
      render: (file) => (
        <Badge tone={file.personal_data ? "warn" : "neutral"}>
          {file.personal_data ? "Sí (Ley 29733)" : "No"}
        </Badge>
      ),
    },
    { key: "sha256", header: "SHA-256 del archivo", render: (file) => <span className="font-mono text-[11px] text-muted">{file.sha256?.slice(0, 20)}…</span> },
    {
      key: "acciones",
      header: "Acciones",
      render: (file) => (
        <Button
          variant="secondary"
          disabled={!enlaceVigente}
          onClick={(event) => {
            event.stopPropagation();
            descargarArchivoTexto(file.name, file.csv);
          }}
        >
          <Download size={13} /> Descargar CSV
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        description={s?.dest_type === "OTHER_RUC"
          ? "Genera y revisa los archivos de respaldo de la marca: catálogo, precios, stock al corte, cuentas por cobrar y pedidos abiertos. La exportación queda registrada con una huella SHA-256."
          : "Genera y revisa los archivos de salida para la otra cuenta o sistema: catálogo, precios, clientes con consentimiento, stock al corte, cuentas por cobrar y pedidos abiertos. La exportación queda registrada con una huella SHA-256."}
        actions={
          <div className="flex items-center gap-2">
            {s && (
              <Button
                variant="primary"
                onClick={generarPaquete}
                disabled={busy || !["APPROVED", "EXECUTING", "FAILED", "COMPLETED"].includes(s.status)}
              >
                <Package size={14} /> {exp ? "Regenerar paquete" : "Generar paquete de exportación"}
              </Button>
            )}
            {s && exp && exp.status === "PENDING_APPROVAL" && (
              <Button variant="secondary" onClick={aprobarPaquete} disabled={busy}>
                <ShieldCheck size={14} /> Aprobar descarga (4 ojos)
              </Button>
            )}
            {s && exp && (
              <Button variant="secondary" onClick={descargarPaquete} disabled={busy || !paqueteDescargable}>
                <Download size={14} /> Descargar paquete ZIP
              </Button>
            )}
            {s && (
              <Link
                href={`/m/sep/sep-11?id=${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-alt"
              >
                Ir al Acta <ArrowRight size={14} />
              </Link>
            )}
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Cifra
          titulo="Registros"
          valor={exp ? String(exp.total_rows) : "—"}
          detalle={exp ? `${files.length} conjuntos de datos` : "Genera el paquete"}
          tono={exp?.status === "READY" ? "ok" : "warn"}
        />
        <Cifra
          titulo="Huella SHA-256"
          valor={exp?.sha256 ? `${exp.sha256.slice(0, 14)}…` : "—"}
          detalle={exp ? "Integridad del paquete" : "Se calcula al generar"}
        />
        <Cifra
          titulo="Tamaño del paquete"
          valor={exp?.size_bytes !== undefined ? formatoTamano(exp.size_bytes) : "—"}
          detalle="Archivo ZIP con los CSV y el manifiesto JSON"
        />
        <Cifra
          titulo="Descarga del paquete"
          valor={estadoDescarga}
          detalle={detalleDescarga}
          tono={paqueteDescargable ? "ok" : exp?.status === "PENDING_APPROVAL" ? "warn" : undefined}
        />
      </div>

      {s?.dest_type === "OTHER_RUC" ? (
        <Alert tone="info" title="Respaldo opcional">
          La marca y sus datos siguen en GestionCarnica; puedes generar este paquete como respaldo.
        </Alert>
      ) : s && (
        <Alert tone={exp ? "ok" : "warn"} title="Paquete necesario para el destino">
          La separación a {s.dest_type_name.toLowerCase()} se completa con los archivos del paquete y su huella SHA-256.
        </Alert>
      )}

      {files.some((file) => file.personal_data && file.rows > 0) && (
        <Alert tone={exp?.status === "READY" ? "info" : "warn"} title="Control de datos personales">
          El paquete incluye datos de clientes y requiere aprobación de otra persona, salvo que ya se haya aprobado junto con la separación. El acceso vence a las 72 horas.
        </Alert>
      )}
      {exp?.status === "READY" && !exp.download_available && (
        <Alert tone="warn" title="Paquete anterior sin archivo descargable">
          Regenera el paquete para crear el ZIP y habilitar el enlace seguro de descarga.
        </Alert>
      )}
      {exp?.status === "READY" && exp.download_available && !enlaceVigente && (
        <Alert tone="warn" title="Enlace vencido">
          Regenera el paquete para emitir un nuevo enlace seguro de descarga.
        </Alert>
      )}

      {exp ? (
        <Card>
          <CardHeader
            title={`Contenido del paquete ${exp.file_name}`}
            subtitle={`Huella SHA-256 completa: ${exp.sha256}. Selecciona una fila para revisar su contenido.`}
          />
          <DataTable
            rowKey={(file) => file.code}
            columns={columnas}
            rows={paginaArchivos.filas}
            pagination={paginaArchivos.props}
            onRowClick={enlaceVigente ? (file) => setPreviewFile({ name: file.name, title: file.title, csv: file.csv }) : undefined}
            empty="El paquete aún no contiene archivos."
          />
        </Card>
      ) : (
        <Card>
          <CardBody className="py-10 text-center text-muted">
            Pulsa «Generar paquete de exportación» para construir los 6 archivos con su huella SHA-256 y registrarlos en auditoría.
          </CardBody>
        </Card>
      )}

      <Modal
        open={Boolean(previewFile)}
        onClose={() => setPreviewFile(null)}
        title={previewFile ? `${previewFile.name} · ${previewFile.title}` : ""}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            {previewFile && (
              <Button
                variant="secondary"
                onClick={() => descargarArchivoTexto(previewFile.name, previewFile.csv)}
                disabled={!enlaceVigente}
              >
                <Download size={14} /> Descargar
              </Button>
            )}
            <Button variant="primary" onClick={() => setPreviewFile(null)}>
              Cerrar
            </Button>
          </div>
        }
      >
        <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-surface-alt p-3 font-mono text-[11.5px]">
          {previewFile?.csv}
        </pre>
      </Modal>
    </div>
  );
}
