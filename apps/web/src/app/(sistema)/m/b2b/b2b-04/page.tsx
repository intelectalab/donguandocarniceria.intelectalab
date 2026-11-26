"use client";

import { useState } from "react";
import { Check, CheckCircle2, HandCoins, X } from "lucide-react";
import { Badge, Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { FiltroSelect, Panel, Sub, accion, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { ESTADO_EXCEPCION, TIPO_EXCEPCION, type Opciones } from "@/modulos/b2b/tipos";

type Exc = { id: string; customer_id: string; customer_name: string; order_id: string; order_number: string; order_status: string; delivery_date: string; kind: string;
  order_amount: string; exceeded_amount: string; reason: string; requested_by: string; requested_name: string; requested_at: string; state: string; decided_name: string | null;
  decided_at: string | null; decision_note: string | null; valid_until: string | null };
type Retenido = { id: string; number: string; customer_name: string; delivery_date: string; amount: number; ok: boolean; message: string | null; exceeded: number | null; missing: string[] };

/** B2B-04 Excepciones de crédito: pedidos retenidos por límite o mora, la solicitud con motivo y la aprobación de otra persona. */
export default function Excepciones() {
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [estado, setEstado] = useState("");
  const r = useDatos<{ data: Exc[]; held_orders: Retenido[] }>(`/v1/b2b/excepciones${qs({ status: estado })}`);
  const pide = Boolean(op?.can["b2b.exception.request"]);
  const aprueba = Boolean(op?.can["b2b.exception.approve"]);

  const confirmar = (orderId: string, numero: string) => accion({ title: `¿Confirmar el pedido ${numero}?`, message: "Pasa a preparación con la condición de crédito actual.", confirmLabel: "Confirmar" },
    () => api(`/v1/b2b/pedidos/${orderId}/confirmar`, { method: "POST" }), "Pedido confirmado", r.recargar);
  const decidir = (x: Exc, si: boolean) => accion({ title: si ? `¿Aprobar la excepción de ${x.order_number}?` : `¿Rechazar la excepción de ${x.order_number}?`,
    message: si ? `Vale ${op?.params.exception_hours ?? 48} horas y solo para este pedido.` : "El pedido sigue retenido.", confirmLabel: si ? "Aprobar" : "Rechazar", danger: !si, reason: { min: 5, optional: si, label: "Nota" } },
  (m) => api(`/v1/b2b/excepciones/${x.id}/decidir`, { method: "POST", body: { approve: si, note: m } }), si ? "Excepción aprobada" : "Excepción rechazada", r.recargar);

  const columnas: Column<Exc>[] = [
    { key: "order_number", header: "Pedido", cardTitle: true, render: (x) => <div><p className="font-mono font-semibold">{x.order_number}</p><Sub>{x.customer_name} · entrega {fecha(x.delivery_date)}</Sub></div> },
    { key: "kind", header: "Motivo", render: (x) => <div><Badge tone="warn">{TIPO_EXCEPCION[x.kind] ?? x.kind}</Badge><Sub>{x.reason}</Sub></div> },
    { key: "order_amount", header: "Monto", align: "right", render: (x) => <div>{soles(x.order_amount)}{Number(x.exceeded_amount) > 0 && <Sub>excede {soles(x.exceeded_amount)}</Sub>}</div> },
    { key: "requested_name", header: "Pidió", hideOnMobile: true, render: (x) => <div>{x.requested_name}<Sub>{fechaHora(x.requested_at)}</Sub></div> },
    { key: "state", header: "Estado", render: (x) => <div><StatusBadge status={x.state} labels={ESTADO_EXCEPCION} />{x.decided_name && <Sub>{x.decided_name}{x.decision_note ? ` · ${x.decision_note}` : ""}</Sub>}
      {x.state === "APPROVED" && x.valid_until && <Sub>vale hasta {fechaHora(x.valid_until)}</Sub>}</div> },
    { key: "acc", header: "", render: (x) => <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
      {aprueba && x.state === "PENDING" && x.requested_by !== op?.me && <><Button size="sm" icon={Check} onClick={() => decidir(x, true)}>Aprobar</Button><Button size="sm" variant="ghost" icon={X} onClick={() => decidir(x, false)}>Rechazar</Button></>}
      {x.state === "PENDING" && x.requested_by === op?.me && <Sub>Lo aprueba otra persona</Sub>}
      {x.state === "APPROVED" && x.order_status === "DRAFT" && <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => confirmar(x.order_id, x.order_number)}>Confirmar pedido</Button>}
    </div> },
  ];

  const retenidos = r.datos?.held_orders ?? [];
  return (
    <div className="space-y-5">
      <PageHeader description={`Un pedido a crédito que no cabe en el disponible o con deuda vencida queda retenido. Se pide una excepción con motivo; la aprueba otra persona y vale ${op?.params.exception_hours ?? 48} horas.`} />
      {retenidos.length > 0 && <Panel titulo={`Pedidos a crédito por confirmar (${retenidos.length})`}>
        <ul className="divide-y divide-line text-[13.5px]">{retenidos.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div><p className="font-medium"><span className="font-mono">{o.number}</span> · {o.customer_name}</p>
            <Sub>{soles(o.amount)} · entrega {fecha(o.delivery_date)}{o.ok ? " · cabe en el crédito" : ` · ${o.message}`}{o.missing.length ? ` · falta ${o.missing.join(", ")}` : ""}</Sub></div>
          {o.ok ? <Button size="sm" variant="primary" icon={CheckCircle2} disabled={o.missing.length > 0} onClick={() => confirmar(o.id, o.number)}>Confirmar</Button>
            : pide && <Button size="sm" icon={HandCoins} onClick={() => accion({ title: `¿Pedir excepción para ${o.number}?`, message: o.message ?? undefined, confirmLabel: "Pedir excepción", reason: { min: 10 } },
              (m) => api("/v1/b2b/excepciones", { method: "POST", body: { order_id: o.id, reason: m } }), "Excepción pedida: avisamos a quien aprueba", r.recargar)}>Pedir excepción</Button>}
        </li>)}</ul>
      </Panel>}
      <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay excepciones."
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_EXCEPCION)} />} />
    </div>
  );
}
