"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Image as Imagen, Undo2 } from "lucide-react";
import { Alert, Button, DetailList, Modal, StatusBadge, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { CONCILIACION, ESTADO_COBRO, ORIGEN_COBRO, Seccion, Vacio, useDatos, type DetalleCobro as Detalle } from "./comunes";

/** Detalle de un cobro (CAJ-03): datos, aplicaciones, voucher, reverso con motivo y enlace a aplicar lo que queda. */
export function DetalleCobro({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio?: () => void }) {
  const router = useRouter();
  const { can, puede } = useSesion();
  const { datos: p, error, recargar } = useDatos<Detalle>(`/v1/caj/cobros/${id}`);
  const [trabajando, setTrabajando] = useState(false);

  async function revertir() {
    if (!p) return;
    const r = await confirmAction({ title: `¿Revertir el cobro ${p.number}?`, message: "Se deshacen sus aplicaciones en los pedidos y comprobantes. Un cobro revertido no se reactiva.",
      confirmLabel: "Revertir", danger: true, reason: { label: "Motivo", min: 5 } });
    if (!r) return;
    setTrabajando(true);
    try {
      await api(`/v1/caj/cobros/${p.id}/revertir`, { method: "POST", body: { reason: r.reason } });
      toast.ok(`Cobro ${p.number} revertido.`);
      recargar();
      onCambio?.();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setTrabajando(false);
    }
  }

  async function voucher() {
    try {
      const r = await api<{ url: string }>(`/v1/caj/cobros/${id}/voucher`);
      window.open(`/api${r.url.replace(/^\/api/, "")}`, "_blank", "noopener");
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const reversible = p && p.status === "CONFIRMED" && !p.pos_shift_id && !p.abono && !p.liquidacion;
  return (
    <Modal open onClose={onClose} title={p ? `Cobro ${p.number}` : "Cobro"} description={p ? `${p.medio_nombre} · ${fechaHora(p.paid_at)}` : undefined} size="lg"
      footer={<>
        {p && reversible && can("caj.payment.reverse") && <Button variant="danger" icon={Undo2} loading={trabajando} onClick={revertir}>Revertir</Button>}
        {p && p.status === "CONFIRMED" && p.sin_aplicar > 0.004 && can("caj.payment.register") && puede("CAJ", "C") && (
          <Button onClick={() => router.push(`/m/caj/caj-04?id=${p.id}`)}>Aplicar {soles(p.sin_aplicar)}</Button>
        )}
        <Button variant="primary" onClick={onClose}>Cerrar</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!p ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} labels={ESTADO_COBRO} />
            <StatusBadge status={p.reconciliation_status} labels={CONCILIACION} />
            <span className="text-[12.5px] text-muted">Origen: {ORIGEN_COBRO[p.origen] ?? p.origen}</span>
          </div>
          {p.status === "REVERSED" && <Alert tone="bad" title={`Revertido por ${p.reversed_by ?? "—"} · ${fechaHora(p.reversed_at)}`}>{p.reversal_reason}</Alert>}
          <DetailList items={[
            { label: "Monto", value: <span className="text-[15px] font-semibold">{soles(p.amount)}</span> },
            { label: "Cliente", value: <>{p.cliente}{p.cliente_doc ? <span className="block text-[12px] text-muted">{p.cliente_doc_type} {p.cliente_doc}</span> : null}</> },
            { label: "Cuenta", value: p.cuenta },
            { label: "Número de operación", value: p.reference ?? "—" },
            ...(p.card_last4 ? [{ label: "Tarjeta", value: `${p.card_brand ?? ""} •••• ${p.card_last4}` }] : []),
            { label: "Marca y local", value: `${p.marca ?? "—"} · ${p.local ?? "—"}` },
            { label: "Cobrado por", value: p.cobrado_por ?? "—" },
            { label: "Comisión estimada", value: Number(p.fee_amount) > 0 ? `${soles(p.fee_amount)} + IGV ${soles(p.fee_igv)}` : "—" },
            ...(p.pos_ticket ? [{ label: "Ticket del mostrador", value: p.pos_ticket }] : []),
            ...(p.abono ? [{ label: "Abono", value: p.abono }] : []),
            ...(p.liquidacion ? [{ label: "Liquidación del repartidor", value: p.liquidacion }] : []),
            ...(p.notes ? [{ label: "Nota", value: p.notes }] : []),
          ]} />
          {p.voucher_file_id && <Button icon={Imagen} onClick={voucher}>Ver foto del voucher</Button>}
          <Seccion titulo="Aplicado a">
            {!p.aplicaciones.length ? <Vacio>Sin aplicar todavía.</Vacio> : (
              <ul className="divide-y divide-line">
                {p.aplicaciones.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                    <span>{a.comprobante ?? "Sin comprobante"}{a.pedido ? <span className="text-muted"> · pedido {a.pedido}</span> : null}</span>
                    <span className="tabular-nums">{soles(a.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap justify-between gap-2 border-t border-line pt-2 text-[13px]">
              <span className="text-muted">Aplicado {soles(p.aplicado)}{p.to_balance ? ` · ${soles(p.to_balance)} a favor del cliente` : ""}</span>
              {p.status === "CONFIRMED" && <span className={p.sin_aplicar > 0.004 ? "text-warn" : "text-ok"}>{p.sin_aplicar > 0.004 ? `Sin aplicar ${soles(p.sin_aplicar)}` : "Todo aplicado"}</span>}
            </div>
          </Seccion>
          {p.status === "CONFIRMED" && !reversible && (
            <p className="text-[12.5px] text-muted">
              {p.pos_shift_id ? "Es un cobro del mostrador: se corrige con una devolución en el Mostrador." : p.abono ? "Está en un abono: no se revierte." : p.liquidacion ? "Ya se liquidó con el repartidor." : ""}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
