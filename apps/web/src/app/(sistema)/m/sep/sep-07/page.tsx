"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
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
import { BadgeItemSep, BarraProyectoSep, DetalleSep, ItemSep, useProyectoSep } from "@/modulos/sep/comun";
import { DetalleItemSep } from "@/modulos/sep/DetalleItemSep";
import { usePaginaLocal } from "@/lib/paginas";

type OpcionAccion = { value: string; label: string };

const ETIQUETAS_CANAL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
  TIKTOK: "TikTok",
};

const ETIQUETAS_PLATAFORMA: Record<string, string> = {
  GOOGLE: "Google Ads",
  META: "Meta Ads",
  TIKTOK: "TikTok Ads",
};

function nombreEstadoOrigen(estado: string | null) {
  const nombres: Record<string, string> = {
    ACTIVE: "Activo",
    PAUSED: "Pausado",
    DISCONNECTED: "Desconectado",
    DISABLED: "Desactivada",
    PENDING: "Pendiente",
    TESTING: "En pruebas",
    MIGRATED: "Migrado",
    INACTIVE: "Inactivo",
  };
  return estado ? nombres[estado] ?? estado.toLocaleLowerCase().replace(/_/g, " ") : "No disponible";
}

function tonoEstadoOrigen(estado: string | null): "ok" | "warn" | "bad" | "neutral" {
  if (estado === "ACTIVE") return "ok";
  if (estado === "PAUSED" || estado === "PENDING" || estado === "TESTING") return "warn";
  if (estado === "DISCONNECTED" || estado === "DISABLED") return "neutral";
  return "neutral";
}

function accionesPara(tipo: string, destino: string): OpcionAccion[] {
  if (tipo === "CHANNEL") {
    if (destino === "OTHER_RUC") return [{ value: "KEEP_INBOX", label: "Seguir en la bandeja con sus conversaciones" }];
    if (destino === "OTHER_TENANT") return [{ value: "MIGRATE", label: "Migrar a la cuenta destino con el proveedor oficial" }];
    return [{ value: "DISCONNECT", label: "Desconectar y exportar el historial" }];
  }

  if (destino === "OTHER_RUC") {
    return [
      { value: "REASSIGN", label: "Reasignar a la empresa nueva" },
      { value: "DISCONNECT", label: "Desconectar" },
    ];
  }
  return [{ value: "DISCONNECT", label: "Desconectar" }];
}

function TablaSeccionSep({
  titulo,
  subtitulo,
  proyectoId,
  items,
  columnasExtra,
  opciones,
  bloqueado,
  busyId,
  loading,
  empty,
  onCambiar,
  onExcluir,
  onIncluir,
  onRowClick,
}: {
  titulo: string;
  subtitulo: string;
  proyectoId: string;
  items: ItemSep[];
  columnasExtra: Column<ItemSep>[];
  opciones: OpcionAccion[];
  bloqueado: boolean;
  busyId: string | null;
  loading: boolean;
  empty: string;
  onCambiar: (item: ItemSep, action: string) => void;
  onExcluir: (item: ItemSep) => void;
  onIncluir: (item: ItemSep) => void;
  onRowClick: (item: ItemSep) => void;
}) {
  const pagina = usePaginaLocal(items, `${proyectoId}|${titulo}`);
  const columnas: Column<ItemSep>[] = [
    { key: "label", header: "Elemento", cardTitle: true, className: "font-medium" },
    ...columnasExtra,
    {
      key: "action",
      header: "Acción",
      render: (item) => !bloqueado && item.status === "PENDING" ? (
        <Select
          value={item.action}
          aria-label={`Acción para ${item.label}`}
          disabled={busyId === item.id}
          onChange={(event) => onCambiar(item, event.target.value)}
        >
          {opciones.map((opcion) => (
            <option key={opcion.value} value={opcion.value}>{opcion.label}</option>
          ))}
        </Select>
      ) : <Badge tone="info">{item.action_name}</Badge>,
    },
    { key: "status", header: "Estado", render: (item) => <BadgeItemSep status={item.status} /> },
    {
      key: "actions",
      header: "Acciones",
      render: (item) => !bloqueado && item.status === "PENDING" ? (
        <Button variant="ghost" size="sm" onClick={() => onExcluir(item)} disabled={busyId === item.id}>
          Excluir
        </Button>
      ) : !bloqueado && item.status === "EXCLUDED" ? (
        <Button variant="ghost" size="sm" onClick={() => onIncluir(item)} disabled={busyId === item.id}>
          Incluir
        </Button>
      ) : "—",
    },
  ];

  return (
    <Card>
      <CardHeader title={titulo} subtitle={subtitulo} />
      <DataTable
        rowKey={(item) => item.id}
        columns={columnas}
        rows={pagina.filas}
        pagination={pagina.props}
        loading={loading}
        onRowClick={onRowClick}
        empty={empty}
      />
    </Card>
  );
}

export default function Sep07Canales() {
  const { data, setData, loading, cambiarProyecto } = useProyectoSep();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [excluyendo, setExcluyendo] = useState<ItemSep | null>(null);
  const [detalleItem, setDetalleItem] = useState<ItemSep | null>(null);
  const [motivo, setMotivo] = useState("");

  async function cambiarAccion(item: ItemSep, action: string) {
    setBusyId(item.id);
    try {
      const res = await api.put<{ detail: DetalleSep }>(`/sep/items/${item.id}`, { action });
      setData(res.detail);
      toast.ok("Decisión actualizada.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo actualizar.");
    } finally {
      setBusyId(null);
    }
  }

  async function cambiarEstado(item: ItemSep, status: "PENDING" | "EXCLUDED", excludeReason?: string) {
    setBusyId(item.id);
    try {
      const res = await api.put<{ detail: DetalleSep }>(`/sep/items/${item.id}`, {
        status,
        exclude_reason: excludeReason,
      });
      setData(res.detail);
      setExcluyendo(null);
      setMotivo("");
      toast.ok(status === "EXCLUDED" ? "Elemento excluido del alcance." : "Elemento incluido en el alcance.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo actualizar el elemento.");
    } finally {
      setBusyId(null);
    }
  }

  const s = data?.separation;
  const bloqueado = s ? ["APPROVED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"].includes(s.status) : true;
  const destino = s?.dest_type ?? "";
  const canales = data?.items_by_type?.CHANNEL ?? [];
  const tiendas = data?.items_by_type?.WEB_STORE ?? [];
  const anuncios = data?.items_by_type?.AD_ACCOUNT ?? [];
  const cajas = data?.items_by_type?.CASH_ACCOUNT ?? [];
  const whatsapp = canales.filter((item) => item.kind?.toUpperCase() === "WHATSAPP");
  const otrosCanales = canales.length - whatsapp.length;
  const proyectoId = s?.id ?? "";

  const columnasCanal: Column<ItemSep>[] = [
    {
      key: "kind",
      header: "Tipo",
      render: (item) => ETIQUETAS_CANAL[item.kind?.toUpperCase() ?? ""] ?? "Otro canal",
    },
    {
      key: "qty",
      header: "Conversaciones",
      align: "right",
      render: (item) => Number(item.qty ?? 0).toLocaleString("es-PE"),
    },
    {
      key: "source_status",
      header: "Estado del canal",
      render: (item) => <Badge tone={tonoEstadoOrigen(item.source_status)}>{nombreEstadoOrigen(item.source_status)}</Badge>,
    },
  ];
  const columnasTienda: Column<ItemSep>[] = [
    { key: "qty", header: "Productos publicados", align: "right", render: (item) => Number(item.qty ?? 0).toLocaleString("es-PE") },
  ];
  const columnasAnuncios: Column<ItemSep>[] = [
    {
      key: "platform",
      header: "Plataforma",
      render: (item) => ETIQUETAS_PLATAFORMA[item.platform?.toUpperCase() ?? ""] ?? "Otra plataforma",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        description="Números de WhatsApp, otros canales de atención, tienda web, cuentas de anuncios y medios de cobro asociados a la marca."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => cambiarProyecto(s?.id || "")} disabled={loading}>
              <RefreshCw size={14} /> Actualizar
            </Button>
            {s && (
              <Link
                href={`/m/sep/sep-08?id=${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white"
              >
                Ir a Usuarios y locales <ArrowRight size={14} />
              </Link>
            )}
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra
          titulo="Números de WhatsApp"
          valor={String(whatsapp.length)}
          detalle={`${whatsapp.reduce((total, item) => total + (item.qty ?? 0), 0).toLocaleString("es-PE")} conversaciones`}
        />
        <Cifra titulo="Otros canales" valor={String(otrosCanales)} />
        <Cifra titulo="Tienda web" valor={tiendas[0]?.action_name ?? "Sin tienda"} />
        <Cifra titulo="Cuentas de anuncios" valor={String(anuncios.length)} />
      </div>

      {s?.dest_type === "OTHER_RUC" && (
        <Alert tone="info" title="Canales de atención">
            Los números permanecen en la bandeja con sus conversaciones; solo cambia la empresa que factura.
        </Alert>
      )}
      {s?.dest_type === "OTHER_TENANT" && (
        <Alert tone="info" title="Migración de canales">
            La migración de números a otra cuenta de WhatsApp Business se coordina con el proveedor oficial.
        </Alert>
      )}
      {s?.dest_type === "OTHER_SYSTEM" && (
        <Alert tone="info" title="Canales del sistema actual">
            Los números se desconectan del sistema actual y su historial se incluye en el paquete de exportación.
        </Alert>
      )}

      <TablaSeccionSep
        titulo="Mensajería"
        subtitulo="Canales conectados a la bandeja de atención"
        proyectoId={proyectoId}
        items={canales}
        columnasExtra={columnasCanal}
        opciones={accionesPara("CHANNEL", destino)}
        bloqueado={bloqueado}
        busyId={busyId}
        loading={loading}
        empty="La marca no tiene canales de mensajería registrados."
        onCambiar={cambiarAccion}
        onExcluir={(item) => { setExcluyendo(item); setMotivo(item.exclude_reason ?? ""); }}
        onIncluir={(item) => void cambiarEstado(item, "PENDING")}
        onRowClick={setDetalleItem}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TablaSeccionSep
          titulo="Tienda web"
          subtitulo="Tienda y productos publicados de la marca"
          proyectoId={proyectoId}
          items={tiendas}
          columnasExtra={columnasTienda}
          opciones={accionesPara("WEB_STORE", destino)}
          bloqueado={bloqueado}
          busyId={busyId}
          loading={loading}
          empty="La marca no tiene tienda ni productos publicados."
          onCambiar={cambiarAccion}
          onExcluir={(item) => { setExcluyendo(item); setMotivo(item.exclude_reason ?? ""); }}
          onIncluir={(item) => void cambiarEstado(item, "PENDING")}
          onRowClick={setDetalleItem}
        />
        <TablaSeccionSep
          titulo="Cuentas de anuncios"
          subtitulo="Cuentas publicitarias asignadas a la marca"
          proyectoId={proyectoId}
          items={anuncios}
          columnasExtra={columnasAnuncios}
          opciones={accionesPara("AD_ACCOUNT", destino)}
          bloqueado={bloqueado}
          busyId={busyId}
          loading={loading}
          empty="La marca no tiene cuentas de anuncios propias."
          onCambiar={cambiarAccion}
          onExcluir={(item) => { setExcluyendo(item); setMotivo(item.exclude_reason ?? ""); }}
          onIncluir={(item) => void cambiarEstado(item, "PENDING")}
          onRowClick={setDetalleItem}
        />
      </div>

      {cajas.length ? (
        <TablaSeccionSep
          titulo="Cajas y pasarelas"
          subtitulo="Medios de cobro asociados a la marca"
          proyectoId={proyectoId}
          items={cajas}
          columnasExtra={[]}
          opciones={accionesPara("CASH_ACCOUNT", destino)}
          bloqueado={bloqueado}
          busyId={busyId}
          loading={loading}
          empty="No hay cajas ni pasarelas asociadas."
          onCambiar={cambiarAccion}
          onExcluir={(item) => { setExcluyendo(item); setMotivo(item.exclude_reason ?? ""); }}
          onIncluir={(item) => void cambiarEstado(item, "PENDING")}
          onRowClick={setDetalleItem}
        />
      ) : (
        <Card>
          <CardHeader title="Cajas y pasarelas" subtitle="Medios de cobro asociados a la marca" />
          <CardBody className="text-[13px] text-muted">
            Las cajas, cuentas bancarias, billeteras digitales y terminales de pago se comparten entre marcas y no se trasladan. Los cobros posteriores de comprobantes anteriores al corte se registran en la empresa de origen.
          </CardBody>
        </Card>
      )}

      <Alert tone="info" title="Tienda web y cuentas de anuncios">
          La tienda web y las cuentas de anuncios pueden reasignarse a la nueva empresa o desconectarse. Los gastos de anuncios anteriores a la fecha de corte permanecen en la empresa de origen.
      </Alert>

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
