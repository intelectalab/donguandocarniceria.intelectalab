"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Cifra,
  DataTable,
  Input,
  Modal,
  PageHeader,
  Select,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { Tabs } from "@/components/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { BadgeItemSep, BarraProyectoSep, ClienteMarcaSep, DetalleSep, ItemSep, soles, useProyectoSep } from "@/modulos/sep/comun";
import { DetalleItemSep } from "@/modulos/sep/DetalleItemSep";
import { usePaginaLocal } from "@/lib/paginas";
import { CuentasPorCobrarSep } from "@/modulos/sep/CuentasPorCobrarSep";

type Pestana = "clientes" | "pedidos" | "cobranza";

const ACCIONES_PEDIDO_OTRO_DESTINO = [
  { value: "CANCEL_NOTIFY", label: "Cancelar y registrar aviso al cliente" },
  { value: "EXPORT", label: "Solo exportar" },
];

function fechaCorta(fecha: string | null): string {
  if (!fecha) return "—";
  const [year, month, day] = fecha.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function estadoPedido(estado: string | null): string {
  switch (estado) {
    case "CONFIRMED": return "Confirmado";
    case "IN_PREPARATION": return "En preparación";
    case "WEIGHED": return "Pesado";
    case "READY": return "Listo";
    case "IN_ROUTE": return "En reparto";
    case "DELIVERED": return "Entregado";
    case "CANCELLED": return "Cancelado";
    case "CLOSED": return "Cerrado";
    default: return "—";
  }
}

export default function Sep06ClientesPedidosYSaldos() {
  const { data, setData, loading, cambiarProyecto } = useProyectoSep();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("clientes");
  const [buscarCliente, setBuscarCliente] = useState("");
  const [buscarPedido, setBuscarPedido] = useState("");
  const [filtroConsentimiento, setFiltroConsentimiento] = useState("");
  const [excluyendo, setExcluyendo] = useState<ItemSep | null>(null);
  const [detalleItem, setDetalleItem] = useState<ItemSep | null>(null);
  const [motivo, setMotivo] = useState("");

  async function cambiarAccion(it: ItemSep, action: string) {
    setBusyId(it.id);
    try {
      const res = await api.put<{ detail: DetalleSep }>(`/sep/items/${it.id}`, { action });
      setData(res.detail);
      toast.ok("Acción actualizada.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo actualizar.");
    } finally {
      setBusyId(null);
    }
  }

  async function cambiarEstado(it: ItemSep, status: "PENDING" | "EXCLUDED", exclude_reason?: string) {
    setBusyId(it.id);
    try {
      const res = await api.put<{ detail: DetalleSep }>(`/sep/items/${it.id}`, { status, exclude_reason });
      setData(res.detail);
      setExcluyendo(null);
      setMotivo("");
      toast.ok(status === "EXCLUDED" ? "Elemento excluido del alcance." : "Elemento incluido en el alcance.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo actualizar el elemento.");
    } finally {
      setBusyId(null);
    }
  }

  const s = data?.separation;
  const bloqueado = s ? ["APPROVED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"].includes(s.status) : true;
  const esOtroRuc = s?.dest_type === "OTHER_RUC";
  const clientes: ClienteMarcaSep[] = data?.customers?.all ?? [];
  const clientesItem = data?.items_by_type?.CUSTOMERS?.[0];
  const pedidos = data?.items_by_type?.ORDER ?? [];
  const cuentas = data?.items_by_type?.RECEIVABLE ?? [];
  const consultaPedido = buscarPedido.trim().toLocaleLowerCase();
  const pedidosFiltrados = pedidos.filter((item) => !consultaPedido || [
    item.label,
    item.delivery_date ?? "",
    item.amount ?? "",
    estadoPedido(item.order_status),
    item.action_name,
  ].join(" ").toLocaleLowerCase().includes(consultaPedido));
  const paginaPedidos = usePaginaLocal(pedidosFiltrados, s?.id ?? "");
  const totalPedidosPen = pedidos.reduce((acc, item) => acc + (item.amount ?? 0), 0);
  const saldoCuentas = cuentas.reduce((acc, item) => acc + (item.amount ?? 0), 0);
  const pedidosResueltos = pedidos.filter((item) => ["DONE", "EXCLUDED"].includes(item.status)).length;
  const porcentajeResuelto = pedidos.length ? Math.round((pedidosResueltos * 1000) / pedidos.length) / 10 : null;
  const consulta = buscarCliente.trim().toLocaleLowerCase();
  const clientesFiltrados = clientes.filter((cliente) => {
    if (filtroConsentimiento === "yes" && !cliente.has_consent) return false;
    if (filtroConsentimiento === "no" && cliente.has_consent) return false;
    return !consulta || [
      cliente.trade_name ?? "",
      cliente.full_name,
      cliente.doc_type ?? "",
      cliente.doc_number ?? "",
      cliente.phone ?? "",
      fechaCorta(cliente.last_order_at),
    ].join(" ").toLocaleLowerCase().includes(consulta);
  });
  const paginaClientes = usePaginaLocal(clientesFiltrados, s?.id ?? "", 12);
  const totalPorCobrar = cuentas.length;

  const columnasClientes: Column<ClienteMarcaSep>[] = [
    { key: "full_name", header: "Cliente", cardTitle: true, className: "font-medium", render: (cliente) => cliente.trade_name || cliente.full_name },
    { key: "doc_number", header: "Documento", render: (cliente) => `${cliente.doc_type ?? ""} ${cliente.doc_number ?? ""}`.trim() || "—" },
    { key: "phone", header: "Celular", render: (cliente) => cliente.phone || "—" },
    { key: "last_order_at", header: "Última compra", render: (cliente) => fechaCorta(cliente.last_order_at) },
    {
      key: "has_consent",
      header: "Consentimiento",
      render: (cliente) => <Badge tone={cliente.has_consent ? "ok" : "warn"}>{cliente.has_consent ? "Sí" : "No"}</Badge>,
    },
    {
      key: "export",
      header: "Exportar",
      render: (cliente) => esOtroRuc
        ? "No (compartido)"
        : clientesItem?.status !== "EXCLUDED" && clientesItem?.action === "EXPORT" && cliente.has_consent
          ? "Sí"
          : "No",
    },
  ];

  const columnasPedidos: Column<ItemSep>[] = [
    { key: "label", header: "Pedido y cliente", cardTitle: true, className: "font-medium" },
    { key: "delivery_date", header: "Entrega", render: (item) => fechaCorta(item.delivery_date) },
    { key: "amount", header: "Importe", align: "right", render: (item) => soles(item.amount) },
    { key: "order_status", header: "Estado del pedido", render: (item) => estadoPedido(item.order_status) },
    {
      key: "action",
      header: "Decisión",
      render: (item) => !bloqueado ? (
        <Select
          value={item.action}
          aria-label={`Decisión para ${item.label}`}
          disabled={busyId === item.id || item.status === "EXCLUDED"}
          onChange={(event) => void cambiarAccion(item, event.target.value)}
        >
          {esOtroRuc ? (
            <option value="KEEP">Mantener y facturar con la nueva empresa</option>
          ) : ACCIONES_PEDIDO_OTRO_DESTINO.map((accion) => (
            <option key={accion.value} value={accion.value}>{accion.label}</option>
          ))}
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
        <Button variant="ghost" size="sm" onClick={() => void cambiarEstado(item, "PENDING")} disabled={busyId === item.id}>
          Incluir
        </Button>
      ) : "—",
    },
  ];

  const tabs: { key: Pestana; label: string; count: number }[] = [
    { key: "clientes", label: "Clientes", count: clientes.length },
    { key: "pedidos", label: "Pedidos abiertos", count: pedidos.length },
    { key: "cobranza", label: "Cuentas por cobrar", count: cuentas.length },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        description="Clientes de la marca, pedidos confirmados sin despachar y cuentas por cobrar: revisa su continuidad, cancelación o cesión de cobranza."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => cambiarProyecto(s?.id || "")} disabled={loading}>
              <RefreshCw size={14} /> Actualizar
            </Button>
            {s && (
              <Link
                href={`/m/sep/sep-07?id=${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white"
              >
                Ir a Canales <ArrowRight size={14} />
              </Link>
            )}
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <Cifra titulo="Clientes de la marca" valor={String(clientes.length)} detalle={`Últimos ${data?.customers?.months ?? 24} meses · desde ${fechaCorta(data?.customers?.from ?? null)}`} />
        <Cifra titulo="Con consentimiento" valor={String(data?.customers?.with_consent_count ?? 0)} detalle={esOtroRuc ? "Compartidos en la misma cuenta" : "Elegibles para exportación"} />
        <Cifra titulo="Pedidos abiertos" valor={String(pedidos.length)} detalle={soles(totalPedidosPen)} />
        <Cifra
          titulo="Pedidos resueltos"
          valor={porcentajeResuelto == null ? "—" : `${porcentajeResuelto.toLocaleString("es-PE", { maximumFractionDigits: 1 })}%`}
          detalle="Completados o excluidos · meta 100 %"
          tono={porcentajeResuelto == null ? undefined : porcentajeResuelto < 100 ? "warn" : "ok"}
        />
        <Cifra titulo="Por cobrar al corte" valor={soles(saldoCuentas)} detalle={`${totalPorCobrar} comprobantes`} />
      </div>

      <Tabs tabs={tabs} value={pestana} onChange={setPestana} />

      {pestana === "clientes" && (
        <div className="space-y-3">
          <Alert tone="info" title="Privacidad y consentimiento">
            {esOtroRuc
              ? "La cartera se comparte dentro de la misma cuenta empresarial; no se copian datos de clientes."
              : `Solo se exportan los clientes con consentimiento comercial vigente entre ${fechaCorta(data?.customers?.from ?? null)} y ${fechaCorta(s?.cutoff_date ?? null)}. Los demás permanecen fuera del paquete.`}
          </Alert>
          {clientesItem && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
              <span className="text-[13px] font-semibold">Acción sobre la cartera:</span>
              {!bloqueado ? (
                <Select
                  value={clientesItem.action}
                  aria-label="Acción sobre los clientes"
                  disabled={busyId === clientesItem.id}
                  onChange={(event) => void cambiarAccion(clientesItem, event.target.value)}
                  className="max-w-sm"
                >
                  {esOtroRuc
                    ? <option value="SHARED">Compartidos (no se copian)</option>
                    : <option value="EXPORT">Exportar con consentimiento</option>}
                </Select>
              ) : <Badge tone="info">{clientesItem.action_name}</Badge>}
              <BadgeItemSep status={clientesItem.status} />
            </div>
          )}
          <DataTable
            rowKey={(cliente) => cliente.id}
            columns={columnasClientes}
            rows={paginaClientes.filas}
            pagination={paginaClientes.props}
            search={{ value: buscarCliente, onChange: setBuscarCliente, placeholder: "Buscar cliente...", fullWidth: true }}
            toolbar={
              <Select
                aria-label="Filtrar por consentimiento"
                value={filtroConsentimiento}
                onChange={(event) => setFiltroConsentimiento(event.target.value)}
              >
                <option value="">Todos los consentimientos</option>
                <option value="yes">Con consentimiento</option>
                <option value="no">Sin consentimiento</option>
              </Select>
            }
            loading={loading}
            empty="No hay clientes con compras recientes vinculadas a esta marca."
          />
        </div>
      )}

      {pestana === "pedidos" && (
        <div className="space-y-3">
          <Alert tone="info" title="Pedidos confirmados sin despachar">
            {esOtroRuc
              ? `Los pedidos se mantienen para facturarse con ${s?.dest_display ?? "la empresa destino"}.`
              : "Puedes cancelar el pedido y registrar el aviso para el cliente, o incluir sus datos en el paquete sin cancelar la operación."}
          </Alert>
          <DataTable
            rowKey={(item) => item.id}
            columns={columnasPedidos}
            rows={paginaPedidos.filas}
            pagination={paginaPedidos.props}
            onRowClick={setDetalleItem}
            search={{ value: buscarPedido, onChange: setBuscarPedido, placeholder: "Buscar pedido...", fullWidth: true }}
            loading={loading}
            empty="No hay pedidos confirmados pendientes de despacho."
          />
        </div>
      )}

      {pestana === "cobranza" && (
        <CuentasPorCobrarSep
          data={data}
          setData={setData}
          loading={loading}
          busyId={busyId}
          onRowClick={setDetalleItem}
          onExclude={(item) => { setExcluyendo(item); setMotivo(item.exclude_reason ?? ""); }}
          onInclude={(item) => void cambiarEstado(item, "PENDING")}
        />
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
              onClick={() => excluyendo && void cambiarEstado(excluyendo, "EXCLUDED", motivo)}
              disabled={busyId === excluyendo?.id || motivo.trim().length < 3}
            >
              Confirmar exclusión
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-muted">Indica el motivo de exclusión para dejarlo registrado en la separación.</p>
          <Input value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Motivo de exclusión (mínimo 3 caracteres)" />
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
