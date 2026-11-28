"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Cifra,
  DataTable,
  Input,
  Modal,
  PageHeader,
  Select,
  Tabs,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { BadgeItemSep, BarraProyectoSep, DetalleSep, ItemSep, useProyectoSep } from "@/modulos/sep/comun";
import { DetalleItemSep } from "@/modulos/sep/DetalleItemSep";
import { usePaginaLocal } from "@/lib/paginas";
import { CANALES } from "@/modulos/cat/tipos";

type TipoDestinoSep = "OTHER_RUC" | "OTHER_TENANT" | "OTHER_SYSTEM";
type OpcionAccion = { value: string; label: string };

function accionesCatalogo(destino: TipoDestinoSep): OpcionAccion[] {
  const acciones = [
    { value: "MOVE", label: "Mover" },
    { value: "COPY", label: "Copiar" },
    { value: "EXPORT_ONLY", label: "Solo exportar" },
  ];
  return destino === "OTHER_TENANT" ? acciones : acciones.filter((accion) => accion.value !== "COPY");
}

function TablaItemsSep({
  tablaId,
  proyectoId,
  items,
  bloqueado,
  busy,
  loading,
  opcionesAccion,
  onCambiarAccion,
  extraColumns = [],
  onExcluir,
  onIncluir,
  onRowClick,
}: {
  tablaId: string;
  proyectoId: string;
  items: ItemSep[];
  bloqueado: boolean;
  busy: boolean;
  loading: boolean;
  opcionesAccion?: OpcionAccion[];
  onCambiarAccion?: (item: ItemSep, accion: string) => void;
  extraColumns?: Column<ItemSep>[];
  onExcluir: (item: ItemSep) => void;
  onIncluir: (item: ItemSep) => void;
  onRowClick: (item: ItemSep) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const consulta = busqueda.trim().toLocaleLowerCase();
  const filasFiltradas = consulta
    ? items.filter((item) => [
      item.label,
      item.line ?? "",
      item.qty,
      canalesDePrecio(item),
      item.action_name,
      item.status,
    ].join(" ").toLocaleLowerCase().includes(consulta))
    : items;
  const pagina = usePaginaLocal(filasFiltradas, `${proyectoId}|${tablaId}`);
  const columnas: Column<ItemSep>[] = [
    { key: "label", header: "Elemento", cardTitle: true, className: "font-medium" },
    ...extraColumns,
    {
      key: "action_name",
      header: "Acción",
      render: (item) => opcionesAccion ? (
        <Select
          aria-label={`Acción de ${item.label}`}
          className="min-w-[170px]"
          value={item.action}
          disabled={bloqueado || busy || item.status !== "PENDING"}
          onChange={(event) => onCambiarAccion?.(item, event.target.value)}
        >
          {opcionesAccion.map((accion) => (
            <option key={accion.value} value={accion.value}>{accion.label}</option>
          ))}
        </Select>
      ) : <Badge tone="info">{item.action_name}</Badge>,
    },
    { key: "status", header: "Estado", render: (item) => <BadgeItemSep status={item.status} /> },
    {
      key: "acciones",
      header: "Acciones",
      render: (item) => !bloqueado && item.status === "PENDING" ? (
        <Button variant="ghost" size="sm" onClick={() => onExcluir(item)} disabled={busy}>Excluir</Button>
      ) : !bloqueado && item.status === "EXCLUDED" ? (
        <Button variant="ghost" size="sm" onClick={() => onIncluir(item)} disabled={busy}>Incluir</Button>
      ) : "—",
    },
  ];

  return (
    <DataTable
      rowKey={(item) => item.id}
      columns={columnas}
      rows={pagina.filas}
      pagination={pagina.props}
      onRowClick={onRowClick}
      search={{ value: busqueda, onChange: setBusqueda, placeholder: "Buscar...", fullWidth: true }}
      loading={loading}
      empty="Sin registros en esta sección para la marca y destino seleccionados."
    />
  );
}

type PestañaCatalogo = "productos" | "precios" | "series";

function nombreDocumento(item: ItemSep): string {
  const nombres: Record<string, string> = {
    INVOICE: "Factura",
    RECEIPT: "Boleta",
    CREDIT_NOTE: "Nota de crédito",
    DEBIT_NOTE: "Nota de débito",
    DISPATCH_GUIDE: "Guía de remisión",
    CONSIGNMENT_NOTE: "Guía de consignación",
  };
  const tipo = nombres[item.doc_type ?? ""] ?? "Otro documento";
  const aplica = nombres[item.applies_to ?? ""]?.toLowerCase();
  return aplica ? `${tipo} de ${aplica}` : tipo;
}

function canalesDePrecio(item: ItemSep): string {
  const canales = Array.isArray(item.refs?.channels)
    ? item.refs.channels.filter((channel): channel is string => typeof channel === "string")
    : [];
  if (!canales.length) return "Todos los canales";
  return canales.map((channel) => CANALES.find((item) => item.value === channel)?.label ?? "Otro canal").join(", ");
}

export default function Sep04CatalogoYSeries() {
  const { data, setData, loading, cambiarProyecto } = useProyectoSep();
  const [excluyendo, setExcluyendo] = useState<ItemSep | null>(null);
  const [detalleItem, setDetalleItem] = useState<ItemSep | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pestaña, setPestaña] = useState<PestañaCatalogo>("productos");

  async function actualizarItem(it: ItemSep, cambios: Record<string, unknown>, mensaje: string) {
    setBusy(true);
    try {
      const res = await api.put<{ detail: DetalleSep }>(`/sep/items/${it.id}`, cambios);
      setData(res.detail);
      setExcluyendo(null);
      setReason("");
      toast.ok(mensaje);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo actualizar el alcance.");
    } finally {
      setBusy(false);
    }
  }

  async function cambiarEstadoItem(it: ItemSep, status: "PENDING" | "EXCLUDED", exclude_reason?: string) {
    await actualizarItem(it, { status, exclude_reason }, `Ítem ${it.label} actualizado.`);
  }

  function cambiarAccionItem(it: ItemSep, accion: string) {
    void actualizarItem(it, { action: accion }, "Acción actualizada.");
  }

  const s = data?.separation;
  const bloqueado = s ? ["APPROVED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"].includes(s.status) : true;
  const seriesNew = data?.items_by_type?.SERIES_NEW ?? [];
  const seriesOrigin = data?.items_by_type?.SERIES_ORIGIN ?? [];
  const productos = data?.items_by_type?.PRODUCT ?? [];
  const listas = data?.items_by_type?.PRICE_LIST ?? [];
  const proyectoId = s?.id ?? "";
  const presentaciones = productos.reduce((total, item) => total + item.qty, 0);
  const precios = listas.reduce((total, item) => total + item.qty, 0);
  const seriesQueCierran = seriesOrigin.filter((item) => item.action === "CLOSE");

  const columnasProductos: Column<ItemSep>[] = [
    { key: "qty", header: "Presentaciones", align: "right" },
    { key: "line", header: "Línea", render: (item) => item.line || "—" },
  ];
  const columnasPrecios: Column<ItemSep>[] = [
    { key: "qty", header: "Precios", align: "right" },
    { key: "channels", header: "Canales", render: canalesDePrecio },
  ];
  const columnasSeriesNuevas: Column<ItemSep>[] = [
    {
      key: "code",
      header: "Serie",
      render: (item) => (
        <Input
          aria-label={`Código de serie para ${item.label}`}
          className="w-24 font-mono"
          defaultValue={item.code ?? ""}
          maxLength={4}
          disabled={bloqueado || busy || item.status !== "PENDING"}
          onBlur={(event) => {
            const code = event.currentTarget.value.trim().toUpperCase();
            if (code && code !== item.code) void actualizarItem(item, { code }, "Código de serie actualizado.");
          }}
        />
      ),
    },
    { key: "document_type", header: "Tipo de comprobante", render: nombreDocumento },
    { key: "valid_from", header: "Vigente desde", render: () => s?.effective_from ?? "—" },
  ];
  const columnasSeriesOrigen: Column<ItemSep>[] = [
    {
      key: "last_number",
      header: "Último número emitido",
      align: "right",
      render: (item) => String(Math.max(0, item.qty)),
    },
    {
      key: "origin_action",
      header: "Al corte",
      render: (item) => (
        <Select
          value={item.action}
          disabled={bloqueado || busy || item.status !== "PENDING"}
          onChange={(event) => void actualizarItem(item, { action: event.target.value }, "Decisión de serie actualizada.")}
        >
          <option value="CLOSE">Cerrar al corte</option>
          <option value="KEEP">Mantener para comprobantes anteriores</option>
        </Select>
      ),
    },
    { key: "note", header: "Nota", render: (item) => item.note || "—" },
  ];

  function prepararExclusion(item: ItemSep) {
    setExcluyendo(item);
    setReason(item.exclude_reason || "");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        description="Revisa los productos y sus presentaciones, las listas de precios y las series que se crearán o cerrarán con la separación."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => cambiarProyecto(s?.id || "")} disabled={loading}>
              <RefreshCw size={14} /> Actualizar
            </Button>
            {s && (
              <Link
                href={`/m/sep/sep-05?id=${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white"
              >
                Ir a Stock y almacenes <ArrowRight size={14} />
              </Link>
            )}
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Cifra titulo="Productos" valor={String(productos.length)} detalle={`${presentaciones} presentaciones`} />
        <Cifra titulo="Listas de precio" valor={String(listas.length)} detalle={`${precios} precios`} />
        <Cifra
          titulo="Series nuevas"
          valor={String(seriesNew.length)}
          detalle={seriesNew.map((item) => item.code).filter(Boolean).join(", ") || "No aplica"}
        />
        <Cifra
          titulo="Series que se cierran"
          valor={String(seriesQueCierran.length)}
          detalle={seriesQueCierran.map((item) => item.code).filter(Boolean).join(", ") || "—"}
        />
      </div>

      <Tabs
        value={pestaña}
        onChange={setPestaña}
        tabs={[
          { key: "productos", label: "Productos", count: productos.length },
          { key: "precios", label: "Listas de precio", count: listas.length },
          { key: "series", label: "Series", count: seriesNew.length + seriesOrigin.length },
        ]}
      />

      {pestaña === "productos" && (
        <TablaItemsSep
          tablaId="productos"
          proyectoId={proyectoId}
          items={productos}
          bloqueado={bloqueado}
          busy={busy}
          loading={loading}
          opcionesAccion={s ? accionesCatalogo(s.dest_type) : undefined}
          onCambiarAccion={cambiarAccionItem}
          extraColumns={columnasProductos}
          onExcluir={prepararExclusion}
          onIncluir={(item) => cambiarEstadoItem(item, "PENDING")}
          onRowClick={setDetalleItem}
        />
      )}

      {pestaña === "precios" && (
        <TablaItemsSep
          tablaId="precios"
          proyectoId={proyectoId}
          items={listas}
          bloqueado={bloqueado}
          busy={busy}
          loading={loading}
          opcionesAccion={s ? accionesCatalogo(s.dest_type) : undefined}
          onCambiarAccion={cambiarAccionItem}
          extraColumns={columnasPrecios}
          onExcluir={prepararExclusion}
          onIncluir={(item) => cambiarEstadoItem(item, "PENDING")}
          onRowClick={setDetalleItem}
        />
      )}

      {pestaña === "series" && (
        <div className="space-y-4">
          {s?.dest_type === "OTHER_RUC" && (
            <TablaItemsSep
              tablaId="series-nuevas"
              proyectoId={proyectoId}
              items={seriesNew}
              bloqueado={bloqueado}
              busy={busy}
              loading={loading}
              extraColumns={columnasSeriesNuevas}
              onExcluir={prepararExclusion}
              onIncluir={(item) => cambiarEstadoItem(item, "PENDING")}
              onRowClick={setDetalleItem}
            />
          )}
          <TablaItemsSep
            tablaId="series-origen"
            proyectoId={proyectoId}
            items={seriesOrigin}
            bloqueado={bloqueado}
            busy={busy}
            loading={loading}
            extraColumns={columnasSeriesOrigen}
            onExcluir={prepararExclusion}
            onIncluir={(item) => cambiarEstadoItem(item, "PENDING")}
            onRowClick={setDetalleItem}
          />
        </div>
      )}

      <Modal
        open={Boolean(excluyendo)}
        onClose={() => setExcluyendo(null)}
        title={`Excluir del alcance: ${excluyendo?.label ?? ""}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExcluyendo(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => excluyendo && cambiarEstadoItem(excluyendo, "EXCLUDED", reason)}
              disabled={busy || reason.trim().length < 3}
            >
              Confirmar exclusión
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            Para excluir un elemento del alcance de la separación es obligatorio dejar registrado el motivo.
          </p>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo de exclusión (mínimo 3 caracteres)"
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(detalleItem)}
        onClose={() => setDetalleItem(null)}
        title={detalleItem?.label ?? "Detalle del elemento"}
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
