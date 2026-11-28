"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
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
import { BadgeItemSep, BarraProyectoSep, DetalleSep, ItemSep, ParticipacionAlmacenSep, useProyectoSep } from "@/modulos/sep/comun";
import { DetalleItemSep } from "@/modulos/sep/DetalleItemSep";
import { usePaginaLocal } from "@/lib/paginas";

type OpcionAccion = { value: string; label: string };

function accionesPara(tipo: "USER" | "WAREHOUSE", destino: string): OpcionAccion[] {
  if (tipo === "USER") {
    return destino === "OTHER_RUC"
      ? [
        { value: "MOVE_SCOPE", label: "Mantener acceso a la marca" },
        { value: "REMOVE_SCOPE", label: "Quitar esta marca de su alcance" },
      ]
      : [{ value: "REMOVE_SCOPE", label: "Quitar esta marca de su alcance" }];
  }
  return destino === "OTHER_RUC"
    ? [{ value: "SHARE", label: "Mantener compartido" }]
    : [{ value: "LEAVE_ORIGIN", label: "Mantener en la empresa de origen" }];
}

function nombreRol(rol: string | null) {
  const nombres: Record<string, string> = {
    ADMIN_SISTEMA: "Administrador del sistema",
    ADMINISTRACION: "Administración",
    ALMACENERO: "Almacenero",
    CAJERO: "Cajero",
    CONTADORA: "Contadora",
    GERENTE: "Gerente",
    MARKETING: "Marketing",
    SUPERVISORA_VENTAS: "Supervisora de ventas",
    VENDEDORA: "Vendedora",
  };
  return rol ? nombres[rol] ?? rol.toLocaleLowerCase().replace(/_/g, " ") : "—";
}

function BarraParticipacion({ valor }: { valor: number }) {
  const porcentaje = Math.min(100, Math.max(0, valor));
  return (
    <div className="min-w-[130px]">
      <div className="mb-1 text-right text-[12px]">{porcentaje.toFixed(1)}%</div>
      <div
        role="progressbar"
        aria-valuenow={porcentaje}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-surface-alt"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${porcentaje}%` }} />
      </div>
    </div>
  );
}

function TablaAccionesSep({
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

export default function Sep08UsuariosYLocales() {
  const { data, setData, loading, cambiarProyecto } = useProyectoSep();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [excluyendo, setExcluyendo] = useState<ItemSep | null>(null);
  const [detalleItem, setDetalleItem] = useState<ItemSep | null>(null);
  const [motivo, setMotivo] = useState("");

  async function actualizarItem(item: ItemSep, cambios: Record<string, string>) {
    setBusyId(item.id);
    try {
      const res = await api.put<{ detail: DetalleSep }>(`/sep/items/${item.id}`, cambios);
      setData(res.detail);
      if (cambios.action) toast.ok("Decisión actualizada.");
      else {
        setExcluyendo(null);
        setMotivo("");
        toast.ok(cambios.status === "EXCLUDED" ? "Elemento excluido del alcance." : "Elemento incluido en el alcance.");
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo actualizar el elemento.");
    } finally {
      setBusyId(null);
    }
  }

  const s = data?.separation;
  const destino = s?.dest_type ?? "";
  const bloqueado = s ? ["APPROVED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"].includes(s.status) : true;
  const usuarios = data?.items_by_type?.USER ?? [];
  const dedicados = data?.items_by_type?.WAREHOUSE ?? [];
  const participacion = data?.warehouse_share ?? [];
  const proyectoId = s?.id ?? "";
  const usuariosExclusivos = usuarios.filter((item) => item.only_brand).length;
  const columnasUsuarios: Column<ItemSep>[] = [
    { key: "role", header: "Rol", render: (item) => nombreRol(item.role) },
    {
      key: "brands_in_scope",
      header: "Marcas en su alcance",
      render: (item) => item.brands_in_scope.length ? item.brands_in_scope.join(", ") : "—",
    },
    {
      key: "only_brand",
      header: "Solo esta marca",
      render: (item) => <Badge tone={item.only_brand ? "warn" : "neutral"}>{item.only_brand ? "Sí" : "No"}</Badge>,
    },
  ];
  const columnasParticipacion: Column<ParticipacionAlmacenSep>[] = [
    { key: "warehouse_name", header: "Almacén", cardTitle: true, className: "font-medium" },
    { key: "establishment_name", header: "Local", render: (row) => row.establishment_name || "Sin local asignado" },
    { key: "brand_lots", header: "Lotes de la marca", align: "right" },
    { key: "share_pct", header: "Participación por valor", render: (row) => <BarraParticipacion valor={row.share_pct} /> },
    {
      key: "decision",
      header: "Decisión",
      render: (row) => {
        const dedicated = dedicados.find((item) => item.warehouse_id === row.warehouse_id);
        return dedicated?.action_name ?? "Compartido: se mantiene";
      },
    },
  ];
  const paginaParticipacion = usePaginaLocal(participacion, `${proyectoId}|warehouse-share`);

  return (
    <div className="space-y-4">
      <PageHeader
        description="Revisa quién tiene acceso a la marca y cómo se distribuye su inventario entre almacenes y locales."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => cambiarProyecto(proyectoId)} disabled={loading}>
              <RefreshCw size={14} /> Actualizar
            </Button>
            {s && (
              <Link
                href={`/m/sep/sep-09?id=${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white"
              >
                Ir a Resumen y aprobación <ArrowRight size={14} />
              </Link>
            )}
          </div>
        }
      />

      <BarraProyectoSep data={data} onSelect={cambiarProyecto} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Cifra titulo="Usuarios con acceso" valor={String(usuarios.length)} detalle={`${usuariosExclusivos} con acceso solo a esta marca`} />
        <Cifra
          titulo="Almacenes con stock de la marca"
          valor={String(participacion.length)}
          detalle={`${dedicados.length} dedicados`}
        />
        <Cifra titulo="Locales" valor={String(data?.establishments?.length ?? 0)} detalle="Locales de la empresa" />
      </div>

      <TablaAccionesSep
        titulo="Usuarios"
        subtitulo="Personal con acceso asignado a la marca"
        proyectoId={proyectoId}
        items={usuarios}
        columnasExtra={columnasUsuarios}
        opciones={accionesPara("USER", destino)}
        bloqueado={bloqueado}
        busyId={busyId}
        loading={loading}
        empty="Ningún usuario tiene acceso asignado a esta marca."
        onCambiar={(item, action) => void actualizarItem(item, { action })}
        onExcluir={(item) => { setExcluyendo(item); setMotivo(item.exclude_reason ?? ""); }}
        onIncluir={(item) => void actualizarItem(item, { status: "PENDING" })}
        onRowClick={setDetalleItem}
      />

      <Card>
        <CardHeader title="Almacenes y locales" subtitle="Participación del inventario de la marca por almacén" />
        <DataTable
          rowKey={(row) => row.warehouse_id}
          columns={columnasParticipacion}
          rows={paginaParticipacion.filas}
          pagination={paginaParticipacion.props}
          loading={loading}
          empty="La marca no tiene stock en almacenes."
        />
      </Card>

      {dedicados.length > 0 && (
        <TablaAccionesSep
          titulo="Almacenes dedicados"
          subtitulo="Almacenes cuyo inventario pertenece íntegramente a esta marca"
          proyectoId={proyectoId}
          items={dedicados}
          columnasExtra={[{ key: "qty", header: "Lotes", align: "right" }]}
          opciones={accionesPara("WAREHOUSE", destino)}
          bloqueado={bloqueado}
          busyId={busyId}
          loading={loading}
          empty="No hay almacenes dedicados."
          onCambiar={(item, action) => void actualizarItem(item, { action })}
          onExcluir={(item) => { setExcluyendo(item); setMotivo(item.exclude_reason ?? ""); }}
          onIncluir={(item) => void actualizarItem(item, { status: "PENDING" })}
          onRowClick={setDetalleItem}
        />
      )}

      {destino === "OTHER_RUC" ? (
        <Alert tone="info" title="Accesos dentro de la misma cuenta">
          Puedes conservar o retirar el acceso de cada persona a esta marca. Los almacenes compartidos permanecen disponibles para las marcas que los utilizan.
        </Alert>
      ) : (
        <Alert tone="info" title="Accesos y almacenes">
          Los accesos a la marca se retiran en la cuenta de origen. Los almacenes dedicados y el stock compartido permanecen en la empresa de origen.
        </Alert>
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
              onClick={() => excluyendo && void actualizarItem(excluyendo, { status: "EXCLUDED", exclude_reason: motivo })}
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
