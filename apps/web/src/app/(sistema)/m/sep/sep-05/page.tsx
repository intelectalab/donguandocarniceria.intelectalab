"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, FileCheck2, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  CardHeader,
  Cifra,
  DataTable,
  Input,
  Modal,
  PageHeader,
  Select,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { BadgeItemSep, BarraProyectoSep, DetalleSep, DocumentoTransferenciaSep, ItemSep, soles, useProyectoSep } from "@/modulos/sep/comun";
import { DetalleItemSep } from "@/modulos/sep/DetalleItemSep";
import { usePaginaLocal } from "@/lib/paginas";

const ACCIONES_STOCK = [
  { value: "TRANSFER", label: "Traspaso con comprobante y guía" },
  { value: "EXPORT_ONLY", label: "Solo exportar" },
  { value: "LEAVE", label: "Dejar en el origen" },
];

function unidadStock(uom: string): string {
  return uom === "KG" ? "kg" : "u";
}

function cantidadStock(cantidad: number | null, uom: string): string {
  const decimales = uom === "KG" ? 3 : 0;
  return `${Number(cantidad ?? 0).toLocaleString("es-PE", { maximumFractionDigits: decimales })} ${unidadStock(uom)}`;
}

function diasParaVencer(fecha: string): number {
  const hoy = new Date();
  const hoyUtc = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const venceUtc = Date.parse(`${fecha}T00:00:00Z`);
  return Math.ceil((venceUtc - hoyUtc) / 86_400_000);
}

export default function Sep05StockYAlmacenes() {
  const router = useRouter();
  const { data, setData, loading, cambiarProyecto } = useProyectoSep();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [filtroAlmacen, setFiltroAlmacen] = useState("");
  const [filtroAccion, setFiltroAccion] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [excluyendo, setExcluyendo] = useState<ItemSep | null>(null);
  const [detalleItem, setDetalleItem] = useState<ItemSep | null>(null);
  const [motivo, setMotivo] = useState("");

  async function actualizarStock(it: ItemSep, cambios: {
    action?: string;
    qty?: number;
    status?: "PENDING" | "EXCLUDED";
    exclude_reason?: string;
  }) {
    setBusyId(it.id);
    try {
      const res = await api.put<{ detail: DetalleSep }>(`/sep/items/${it.id}`, cambios);
      setData(res.detail);
      setExcluyendo(null);
      setMotivo("");
      toast.ok("Lote actualizado.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo actualizar el lote.");
    } finally {
      setBusyId(null);
    }
  }

  const s = data?.separation;
  const bloqueado = s ? ["APPROVED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"].includes(s.status) : true;
  const stock = data?.items_by_type?.STOCK ?? [];
  const transferDocs: DocumentoTransferenciaSep[] = s?.transfer_docs ?? [];
  const almacenes = [...new Map(stock.filter((item) => item.warehouse_id).map((item) => [
    item.warehouse_id as string,
    item.warehouse_name || item.warehouse_code || "Almacén",
  ])).entries()];
  const consulta = buscar.trim().toLocaleLowerCase();
  const stockFiltrado = stock.filter((item) => {
    if (filtroAlmacen && item.warehouse_id !== filtroAlmacen) return false;
    if (filtroAccion && item.action !== filtroAccion) return false;
    if (filtroEstado && item.status !== filtroEstado) return false;
    return !consulta || [
      item.variant_name ?? "",
      item.label,
      item.lot_code ?? "",
      item.warehouse_name ?? "",
      item.warehouse_code ?? "",
      item.expiry_date ?? "",
      item.note ?? "",
      item.action_name,
      item.status,
    ].join(" ").toLocaleLowerCase().includes(consulta);
  });
  const paginaStock = usePaginaLocal(stockFiltrado, s?.id ?? "", 20);
  const paginaDocs = usePaginaLocal(transferDocs, s?.id ?? "");
  const aTransferir = stock.filter((i) => i.action === "TRANSFER" && i.status !== "EXCLUDED");
  const valorTransferir = aTransferir.reduce((acc, i) => acc + i.qty * (i.unit_cost ?? 0), 0);
  const unidadesTransferir = aTransferir.filter((item) => item.uom !== "KG").reduce((total, item) => total + item.qty, 0);
  const kilosTransferir = aTransferir.filter((item) => item.uom === "KG").reduce((total, item) => total + item.qty, 0);
  const diferenciaCantidad = stock
    .filter((item) => item.action === "TRANSFER" && item.status === "DONE")
    .reduce((total, item) => total + Math.abs(item.qty - (item.received_qty ?? 0)), 0);
  const diferenciaTono = diferenciaCantidad > 0.0005 ? "bad" : "ok";
  const columnasDocumentos: Column<DocumentoTransferenciaSep>[] = [
    { key: "full_number", header: "Factura", cardTitle: true, className: "font-mono font-semibold" },
    {
      key: "guide_number",
      header: "Guías (motivo 01)",
      render: (doc) => <span className="font-mono"><FileCheck2 size={13} className="mr-1 inline text-ok" />{doc.guide_number}</span>,
    },
    { key: "total", header: "Total", align: "right", render: (doc) => <span className="font-semibold">{soles(doc.total)}</span> },
    { key: "issue_date", header: "Emitido" },
  ];
  const columnasStock: Column<ItemSep>[] = [
    {
      key: "label",
      header: "Producto y lote",
      cardTitle: true,
      render: (item) => (
        <div className="min-w-[170px]">
          <div className="font-medium">{item.variant_name || item.label}</div>
          <div className="font-mono text-[11px] text-muted">{item.lot_code || "Sin lote"}</div>
          {item.note && <div className="text-[11px] text-warn">{item.note}</div>}
        </div>
      ),
    },
    { key: "warehouse_name", header: "Almacén", render: (item) => item.warehouse_name || item.warehouse_code || "—" },
    {
      key: "expiry_date",
      header: "Vence",
      render: (item) => {
        if (!item.expiry_date) return "—";
        const dias = diasParaVencer(item.expiry_date);
        return (
          <span>
            {item.expiry_date}
            {dias <= 10 && <Badge tone={dias <= 0 ? "bad" : "warn"}>{dias} d</Badge>}
          </span>
        );
      },
    },
    {
      key: "qty_at_cutoff",
      header: "Kardex al corte",
      align: "right",
      render: (item) => cantidadStock(item.qty_at_cutoff ?? item.qty, item.uom),
    },
    {
      key: "qty_available",
      header: "Disponible hoy",
      align: "right",
      render: (item) => item.qty_available == null ? "—" : cantidadStock(item.qty_available, item.uom),
    },
    {
      key: "qty",
      header: "Cantidad",
      align: "right",
      render: (item) => {
        return !bloqueado && item.status !== "EXCLUDED" && item.action !== "LEAVE" ? (
          <Input
            key={`${item.id}|${item.qty}`}
            type="number"
            step={item.uom === "KG" ? "0.001" : "1"}
            min="0"
            defaultValue={String(item.qty)}
            disabled={busyId === item.id}
            className="w-24 text-right font-mono"
            onBlur={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val !== item.qty) void actualizarStock(item, { qty: val });
            }}
          />
        ) : cantidadStock(item.qty, item.uom);
      },
    },
    { key: "value", header: "Valor", align: "right", render: (item) => soles(item.qty * (item.unit_cost ?? 0)) },
    {
      key: "received_qty",
      header: "Recibido",
      align: "right",
      render: (item) => item.received_qty == null ? "—" : (
        <span className={Math.abs(item.received_qty - item.qty) > 0.0005 ? "font-bold text-bad" : ""}>
          {cantidadStock(item.received_qty, item.uom)}
        </span>
      ),
    },
    {
      key: "action",
      header: "Acción",
      render: (item) => !bloqueado ? (
        <Select
          value={item.action}
          aria-label={`Acción para ${item.label}`}
          disabled={busyId === item.id || item.status === "EXCLUDED"}
          onChange={(e) => void actualizarStock(item, { action: e.target.value })}
        >
          {ACCIONES_STOCK.map((accion) => <option key={accion.value} value={accion.value}>{accion.label}</option>)}
        </Select>
      ) : <Badge tone="info">{item.action_name}</Badge>,
    },
    { key: "status", header: "Estado", render: (item) => <BadgeItemSep status={item.status} /> },
    {
      key: "actions",
      header: "Acciones",
      render: (item) => !bloqueado && item.status === "PENDING" ? (
        <Button variant="ghost" size="sm" onClick={() => { setExcluyendo(item); setMotivo(item.exclude_reason ?? ""); }} disabled={busyId === item.id}>
          Excluir
        </Button>
      ) : !bloqueado && item.status === "EXCLUDED" ? (
        <Button variant="ghost" size="sm" onClick={() => void actualizarStock(item, { status: "PENDING" })} disabled={busyId === item.id}>
          Incluir
        </Button>
      ) : "—",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        description="Revisa el saldo de cada lote a la fecha de corte, lo disponible hoy y define si se transfiere, se exporta o permanece en la empresa de origen."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => cambiarProyecto(s?.id || "")} disabled={loading}>
              <RefreshCw size={14} /> Actualizar
            </Button>
            {s && (
              <Link
                href={`/m/sep/sep-06?id=${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white"
              >
                Ir a Clientes y pedidos <ArrowRight size={14} />
              </Link>
            )}
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Cifra titulo="Lotes de la marca" valor={String(stock.length)} detalle={`${almacenes.length} almacenes`} />
        <Cifra
          titulo="A traspasar"
          valor={`${unidadesTransferir.toLocaleString("es-PE", { maximumFractionDigits: 0 })} u · ${kilosTransferir.toLocaleString("es-PE", { maximumFractionDigits: 3 })} kg`}
          detalle={`${aTransferir.length} lotes`}
        />
        <Cifra titulo="Valor al costo promedio" valor={soles(valorTransferir)} detalle={`Factura ${soles(valorTransferir * 1.18)} con IGV`} />
        <Cifra
          titulo="Diferencia"
          valor={diferenciaCantidad.toLocaleString("es-PE", { maximumFractionDigits: 3 })}
          detalle="Enviado − recibido · meta cero"
          tono={diferenciaTono}
        />
      </div>

      {s?.dest_type === "OTHER_RUC" && (
        <Alert tone="info" title="Sustento tributario y contable del traspaso">
          El stock que pasa a una empresa con otro RUC se factura al costo promedio más IGV y se respalda con una guía de remisión motivo 01 (venta).
        </Alert>
      )}

      <DataTable
        rowKey={(item) => item.id}
        columns={columnasStock}
        rows={paginaStock.filas}
        pagination={paginaStock.props}
        onRowClick={setDetalleItem}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar...", fullWidth: true }}
        toolbar={
          <>
            <Select aria-label="Filtrar por almacén" value={filtroAlmacen} onChange={(e) => setFiltroAlmacen(e.target.value)}>
              <option value="">Todos los almacenes</option>
              {almacenes.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            </Select>
            <Select aria-label="Filtrar por acción" value={filtroAccion} onChange={(e) => setFiltroAccion(e.target.value)}>
              <option value="">Todas las acciones</option>
              {ACCIONES_STOCK.map((accion) => <option key={accion.value} value={accion.value}>{accion.label}</option>)}
            </Select>
            <Select aria-label="Filtrar por estado" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
              <option value="">Todos los estados</option>
              {[
                ["PENDING", "Pendiente"],
                ["DONE", "Ejecutado"],
                ["FAILED", "Con error"],
                ["EXCLUDED", "Excluido"],
              ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </>
        }
        loading={loading}
        empty="La marca no tiene stock."
      />

      {transferDocs.length > 0 && (
        <div className="space-y-2">
          <CardHeader title="Comprobantes y guías del traspaso" />
          <DataTable
            rowKey={(doc) => doc.full_number}
            columns={columnasDocumentos}
            rows={paginaDocs.filas}
            pagination={paginaDocs.props}
            loading={loading}
            onRowClick={(doc) => doc.document_id && router.push(`/m/fac/fac-04?id=${doc.document_id}`)}
            empty="Aún no se han emitido comprobantes de transferencia."
          />
        </div>
      )}

      <Modal
        open={Boolean(excluyendo)}
        onClose={() => setExcluyendo(null)}
        title={`Excluir del alcance: ${excluyendo?.label ?? ""}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExcluyendo(null)}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={() => excluyendo && void actualizarStock(excluyendo, { status: "EXCLUDED", exclude_reason: motivo })}
              disabled={busyId === excluyendo?.id || motivo.trim().length < 3}
            >
              Confirmar exclusión
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-muted">Indica el motivo de exclusión para dejarlo registrado en la separación.</p>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo de exclusión (mínimo 3 caracteres)"
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(detalleItem)}
        onClose={() => setDetalleItem(null)}
        title={detalleItem?.label ?? "Detalle del lote"}
        description={detalleItem?.item_type_name}
        size="md"
        placement="right"
        footer={<Button variant="secondary" onClick={() => setDetalleItem(null)}>Cerrar</Button>}
      >
        {detalleItem && <DetalleItemSep item={detalleItem} />}
      </Modal>
    </div>
  );
}
