"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Download, FileCheck2, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  PageHeader,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import {
  ActaSep,
  BarraProyectoSep,
  BadgeEstadoSep,
  BadgeItemSep,
  DetalleSep,
  DocumentoTransferenciaSep,
  ItemSep,
  soles,
  useProyectoSep,
} from "@/modulos/sep/comun";
import { usePaginaLocal } from "@/lib/paginas";

export default function Sep11ActaSeparacion() {
  const { data, setData, loading, cambiarProyecto } = useProyectoSep();
  const [busy, setBusy] = useState(false);

  async function emitirActa() {
    if (!data) return;
    const yaExiste = Boolean(data.separation.act?.file_id);
    setBusy(true);
    try {
      const res = await api.post<{ act: ActaSep; detail: DetalleSep }>(`/sep/proyectos/${data.separation.id}/acta`, {});
      setData(res.detail);
      toast.ok(yaExiste ? "El PDF del acta fue actualizado." : "El PDF del acta fue generado.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo generar el PDF del acta.");
    } finally {
      setBusy(false);
    }
  }

  async function descargarActa() {
    if (!data?.separation.act?.file_id) return;
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(`/sep/proyectos/${data.separation.id}/acta/enlace`, {});
      window.location.href = res.url;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo obtener el enlace de descarga.");
    } finally {
      setBusy(false);
    }
  }

  const s = data?.separation;
  const act = s?.act;
  const items = data?.items ?? [];
  const stock = items.filter((item) => item.item_type === "STOCK" && item.action === "TRANSFER" && item.status !== "EXCLUDED");
  const receivables = items.filter((item) => item.item_type === "RECEIVABLE" && item.status !== "EXCLUDED");
  const orders = items.filter((item) => item.item_type === "ORDER");
  const series = items.filter((item) => item.item_type === "SERIES_NEW" && item.status !== "EXCLUDED");
  const docs: DocumentoTransferenciaSep[] = act?.transfer_docs ?? s?.transfer_docs ?? [];
  const stockValue = act?.stock_value_pen ?? stock.reduce((total, item) => total + item.qty * (item.unit_cost ?? 0), 0);
  const receivablesValue = act?.receivables_pen ?? receivables.reduce((total, item) => total + (item.amount ?? 0), 0);
  const receivablesKept = s?.receivables_policy === "KEEP_ORIGIN" ? receivablesValue : 0;
  const receivablesAssigned = s?.receivables_policy === "ASSIGN" ? receivablesValue : 0;
  const transferTax = docs.reduce((total, doc) => total + doc.igv, 0);
  const resolvedOrders = orders.filter((item) => item.status === "DONE" || item.status === "EXCLUDED").length;
  const destino = s?.dest_type === "OTHER_RUC"
    ? s.dest_display
    : s?.dest_type === "OTHER_TENANT"
      ? s.dest_tenant_name || s.dest_legal_name || "—"
      : s?.dest_system_name || s?.dest_legal_name || "—";
  const paginaDocs = usePaginaLocal(docs, s?.id ?? "");
  const paginaStock = usePaginaLocal(stock, s?.id ?? "");
  const columnasDocs: Column<DocumentoTransferenciaSep>[] = [
    { key: "full_number", header: "Comprobante de traspaso", cardTitle: true, className: "font-mono font-semibold" },
    { key: "total", header: "Total", align: "right", render: (doc) => <span className="font-semibold">{soles(doc.total)}</span> },
    {
      key: "guide_number",
      header: "Guías de remisión",
      render: (doc) => <span className="font-mono"><FileCheck2 size={13} className="mr-1 inline text-ok" />{doc.guide_number}</span>,
    },
  ];
  const columnasStock: Column<ItemSep>[] = [
    { key: "label", header: "Lote", cardTitle: true, className: "font-medium" },
    { key: "warehouse_name", header: "Almacén" },
    { key: "qty", header: "Enviado", align: "right", render: (item) => `${item.qty.toLocaleString("es-PE", { maximumFractionDigits: 3 })} ${item.uom}` },
    {
      key: "received_qty",
      header: "Recibido",
      align: "right",
      render: (item) => item.received_qty === null ? "—" : `${item.received_qty.toLocaleString("es-PE", { maximumFractionDigits: 3 })} ${item.uom}`,
    },
    { key: "status", header: "Estado", render: (item) => <BadgeItemSep status={item.status} /> },
  ];
  const puedeGenerar = Boolean(s && ["EXECUTING", "COMPLETED", "FAILED"].includes(s.status));

  return (
    <div className="space-y-4">
      <PageHeader
        description="Acta de separación con la fecha de corte, las empresas, los saldos trasladados, el stock traspasado, sus comprobantes y las personas responsables de preparar y aprobar."
        actions={
          <div className="flex items-center gap-2">
            {s && (
              <Button
                variant="secondary"
                onClick={emitirActa}
                disabled={busy || !puedeGenerar}
                title={!puedeGenerar ? "Disponible al iniciar la ejecución de la separación." : undefined}
              >
                <RefreshCw size={14} /> {act?.file_id ? "Actualizar acta PDF" : "Generar acta PDF"}
              </Button>
            )}
            {s && act?.file_id && (
              <Button variant="primary" onClick={descargarActa} disabled={busy}>
                <Download size={14} /> Descargar acta PDF
              </Button>
            )}
            <Link
              href={s ? `/m/sep/sep-12?brand_id=${s.brand_id}` : "/m/sep/sep-12"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white"
            >
              Ver Marcas separadas e historial <ArrowRight size={14} />
            </Link>
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      {!s ? (
        <Card><CardBody className="py-10 text-center text-muted">{loading ? "Cargando acta…" : "No se encontró un proyecto de separación."}</CardBody></Card>
      ) : (
        <Card>
          <CardHeader
            title={`Acta de separación de la marca ${s.brand_name} (${s.brand_code})`}
            subtitle={act?.file_id
              ? `${act.file_name} · Generada el ${act.generated_at} · ${act.size_bytes?.toLocaleString("es-PE") ?? "—"} bytes · Huella SHA-256: ${act.sha256}`
              : act
                ? "Acta registrada; falta generar el documento PDF."
                : "Vista previa del acta"}
          />
          <CardBody className="space-y-4">
            {!act && (
              <Alert tone="info" title="Vista previa">
                El PDF se genera al completar la ejecución. Aquí puedes revisar el resumen que formará parte del documento.
              </Alert>
            )}
            {act && !act.file_id && (
              <Alert tone="warn" title="Documento pendiente">
                Este registro todavía no tiene un PDF descargable. Genera el acta para crear el documento formal.
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <BadgeEstadoSep status={s.status} label={s.status_name} />
              {s.simulation && <Badge tone="info">Simulación · sin efectos operativos</Badge>}
              {act && <Badge tone="ok">{act.act_number}</Badge>}
            </div>

            <p className="text-[13px] leading-6">
              Con fecha de corte {s.cutoff_date}, la marca {s.brand_name} deja de emitir con {s.origin_company_name} (RUC {s.origin_ruc}) y, desde el {s.effective_from},{" "}
              {s.dest_type === "OTHER_RUC"
                ? `emite con ${destino} con las series ${series.map((item) => item.code).filter(Boolean).join(", ") || "pendientes de asignar"}`
                : `pasa a ${s.dest_type_name.toLowerCase()}: ${destino}`}. El histórico anterior al corte se conserva tal como se emitió.
            </p>

            <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface-alt p-4 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold uppercase text-muted">Empresa de origen</div>
                <div className="mt-1 text-[13px] font-semibold">{s.origin_company_name} · RUC {s.origin_ruc}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase text-muted">Destino</div>
                <div className="mt-1 text-[13px] font-semibold">{s.dest_type_name} · {destino}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase text-muted">Fecha de corte</div>
                <div className="mt-1 text-[13px] font-semibold">{s.cutoff_date}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase text-muted">Stock traspasado</div>
                <div className="mt-1 text-[13px] font-semibold">
                  {stock.length} lotes · {stock.reduce((total, item) => total + item.qty, 0).toLocaleString("es-PE", { maximumFractionDigits: 3 })} enviados ·{" "}
                  {stock.reduce((total, item) => total + (item.received_qty ?? 0), 0).toLocaleString("es-PE", { maximumFractionDigits: 3 })} recibidos
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase text-muted">Valor del traspaso</div>
                <div className="mt-1 text-[13px] font-semibold">{soles(stockValue)} · IGV de comprobantes {soles(transferTax)}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase text-muted">Cuentas por cobrar</div>
                <div className="mt-1 text-[13px] font-semibold">
                  Quedan en el origen {soles(receivablesKept)} · cedidas {soles(receivablesAssigned)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase text-muted">Pedidos abiertos</div>
                <div className="mt-1 text-[13px] font-semibold">{orders.length} · {resolvedOrders} resueltos</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase text-muted">Paquete de exportación</div>
                <div className="mt-1 break-all text-[13px] font-semibold">
                  {act?.export_number
                    ? `${act.export_number} · SHA-256 ${act.export_sha256}`
                    : s.export
                      ? `${s.export.export_number} · SHA-256 ${s.export.sha256}`
                      : "No generado"}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[13px] font-semibold">Comprobantes y guías de remisión de transferencia de stock</div>
              <DataTable
                rowKey={(doc) => doc.full_number}
                columns={columnasDocs}
                rows={paginaDocs.filas}
                pagination={paginaDocs.props}
                loading={loading}
                empty="Sin comprobantes de traspaso."
              />
            </div>

            <div className="space-y-2">
              <div className="text-[13px] font-semibold">Stock transferido</div>
              <DataTable
                rowKey={(item) => item.id}
                columns={columnasStock}
                rows={paginaStock.filas}
                pagination={paginaStock.props}
                loading={loading}
                empty="No hay lotes de stock incluidos en el traspaso."
              />
            </div>

            <div className="grid grid-cols-1 gap-5 pt-4 sm:grid-cols-2">
              <div className="border-t border-line pt-2">
                <div className="text-[13px] font-semibold">{act?.prepared_by_name || s.prepared_by_name || "Pendiente"}</div>
                <div className="text-[12px] text-muted">Preparó · {act?.prepared_at || s.prepared_at || "—"}</div>
              </div>
              <div className="border-t border-line pt-2">
                <div className="text-[13px] font-semibold">{act?.approved_by_name || s.approved_by_name || "Pendiente de aprobación"}</div>
                <div className="text-[12px] text-muted">Aprobó · {act?.approved_at || s.approved_at || "—"}</div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
