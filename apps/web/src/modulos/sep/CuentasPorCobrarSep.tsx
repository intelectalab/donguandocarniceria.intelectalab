"use client";

import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Field,
  Select,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { BadgeItemSep, DetalleSep, ItemSep, soles } from "@/modulos/sep/comun";
import { usePaginaLocal } from "@/lib/paginas";

export function CuentasPorCobrarSep({
  data,
  setData,
  loading,
  busyId,
  onRowClick,
  onExclude,
  onInclude,
}: {
  data: DetalleSep | null;
  setData: (data: DetalleSep) => void;
  loading: boolean;
  busyId: string | null;
  onRowClick: (item: ItemSep) => void;
  onExclude: (item: ItemSep) => void;
  onInclude: (item: ItemSep) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [buscar, setBuscar] = useState("");
  const s = data?.separation;
  const bloqueado = s ? ["APPROVED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"].includes(s.status) : true;
  const cxc = data?.items_by_type?.RECEIVABLE ?? [];
  const consulta = buscar.trim().toLocaleLowerCase();
  const cxcFiltradas = cxc.filter((item) => !consulta || [
    item.label,
    item.due_date ?? "",
    item.amount ?? "",
    item.action_name,
  ].join(" ").toLocaleLowerCase().includes(consulta));
  const pagina = usePaginaLocal(cxcFiltradas, s?.id ?? "");
  const politicaLabel = s?.receivables_policy === "ASSIGN"
    ? "Cesión a la empresa destino"
    : "Cobro en la empresa origen";

  async function cambiarPolitica(policy: string) {
    if (!data) return;
    setBusy(true);
    try {
      setData(await api.put<DetalleSep>(`/sep/proyectos/${data.separation.id}/politica-cxc`, { policy }));
      toast.ok("Política de cuentas por cobrar actualizada.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo cambiar la política.");
    } finally {
      setBusy(false);
    }
  }

  async function cambiarItem(item: ItemSep, action: string) {
    setBusy(true);
    try {
      const response = await api.put<{ detail: DetalleSep }>(`/sep/items/${item.id}`, { action });
      setData(response.detail);
      toast.ok("Decisión de cobro actualizada.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo actualizar la decisión.");
    } finally {
      setBusy(false);
    }
  }

  const columnas: Column<ItemSep>[] = [
    { key: "label", header: "Comprobante y cliente", cardTitle: true, className: "font-medium" },
    { key: "due_date", header: "Vencimiento", render: (item) => item.due_date || "—" },
    { key: "amount", header: "Saldo pendiente", align: "right", render: (item) => <span className="font-semibold">{soles(item.amount)}</span> },
    {
      key: "action",
      header: "Decisión",
      render: (item) => !bloqueado ? (
        <Select
          value={item.action}
          disabled={busy || busyId === item.id || item.status === "EXCLUDED"}
          onChange={(event) => cambiarItem(item, event.target.value)}
        >
          <option value="KEEP_ORIGIN">Cobrar en empresa origen</option>
          <option value="ASSIGN">Ceder a empresa destino</option>
        </Select>
      ) : <Badge tone="info">{item.action_name}</Badge>,
    },
    { key: "status", header: "Estado", render: (item) => <BadgeItemSep status={item.status} /> },
    {
      key: "actions",
      header: "Acciones",
      render: (item) => !bloqueado && item.status === "PENDING" ? (
        <Button variant="ghost" size="sm" onClick={() => onExclude(item)} disabled={busy || busyId === item.id}>
          Excluir
        </Button>
      ) : !bloqueado && item.status === "EXCLUDED" ? (
        <Button variant="ghost" size="sm" onClick={() => onInclude(item)} disabled={busy || busyId === item.id}>
          Incluir
        </Button>
      ) : "—",
    },
  ];

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Comprobantes emitidos antes de la fecha de corte">
        Por defecto, se terminan de cobrar en la empresa que emitió el comprobante. También puedes acordar la cesión de cobranza a la empresa destino. Política actual: {politicaLabel}.
      </Alert>

      <Card>
        <CardBody>
          <div className="max-w-xl">
            <Field label="Política general para las cuentas por cobrar al corte">
              <Select
                value={s?.receivables_policy ?? "KEEP_ORIGIN"}
                disabled={bloqueado || busy}
                onChange={(event) => cambiarPolitica(event.target.value)}
              >
                <option value="KEEP_ORIGIN">Cobrar en la empresa origen</option>
                <option value="ASSIGN">Ceder la cobranza a la empresa destino</option>
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Comprobantes con saldo pendiente" subtitle="Detalle de cuentas por cobrar de la marca a la fecha de corte" />
        <DataTable
          rowKey={(item) => item.id}
          columns={columnas}
          rows={pagina.filas}
          pagination={pagina.props}
          onRowClick={onRowClick}
          search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar comprobante...", fullWidth: true }}
          loading={loading}
          empty="No hay comprobantes con saldo pendiente para esta marca."
        />
      </Card>
    </div>
  );
}
