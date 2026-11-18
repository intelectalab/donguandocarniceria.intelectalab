"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, CalendarClock, CheckCircle2, MessageCircle, Pencil, Scale, Undo2, Wallet } from "lucide-react";
import { Alert, Badge, Button, DetailList, Input, Modal, StatusBadge, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BuscarPedido } from "@/modulos/ped/BuscarPedido";
import { FormCancelar, FormReprogramar, FormSaldo } from "@/modulos/ped/Formularios";
import { Seccion, Vacio } from "@/modulos/ped/Seccion";
import { usePedido } from "@/modulos/ped/usePedido";
import {
  ACCION_ESTADO, CANALES, COMPROBANTES, DESCUENTO, ENTREGAS, ESTADOS, PESO, RESPUESTAS, SALDOS, celular, etiqueta, franjaTexto, nombreEstado, type Detalle,
} from "@/modulos/ped/tipos";

const DIRECTOS = ["IN_PREPARATION", "WEIGHED", "READY", "IN_ROUTE", "DELIVERED"];

/** PED-03 Detalle del pedido: datos, productos, pesos, pagos, comprobantes, historial y las acciones según su estado. */
export default function DetallePedido() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  if (!id) {
    return (
      <Seccion titulo="Elige un pedido">
        <BuscarPedido estados={["CONFIRMED", "IN_PREPARATION", "WEIGHED", "READY", "IN_ROUTE", "NOT_DELIVERED", "DELIVERED"]} onElegir={(x) => router.push(`/m/ped/ped-03?id=${x}`)} />
      </Seccion>
    );
  }
  return <Ficha id={id} />;
}

function Ficha({ id }: { id: string }) {
  const router = useRouter();
  const { puede, can } = useSesion();
  const { detalle: d, error, cargando, reemplazar } = usePedido(id);
  const [modal, setModal] = useState<"" | "cancelar" | "reprogramar" | "saldo">("");
  const [ocupado, setOcupado] = useState("");
  const [pesos, setPesos] = useState<Record<string, string>>({});

  if (cargando) return <Vacio>Cargando el pedido…</Vacio>;
  if (error || !d) return <Alert tone="bad">{error || "No se encontró el pedido."}</Alert>;
  const o = d.pedido;
  const editar = puede("PED", "E");

  async function accion(clave: string, ruta: string, body?: unknown, ok?: string) {
    setOcupado(clave);
    try {
      const r = await api<Detalle & { sin_stock?: boolean }>(`/v1/ped/pedidos/${o.id}/${ruta}`, { method: "POST", body });
      reemplazar(r);
      toast.ok(ok ?? "Listo");
      if (r.sin_stock) toast.info("Se confirmó sin stock suficiente: quedó marcado para reponer.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  async function aBorrador() {
    const r = await confirmAction({ title: `¿Volver ${o.number} a borrador?`, message: "Se liberan sus reservas y se puede editar de nuevo.", confirmLabel: "Volver a borrador", reason: { label: "Motivo (opcional)", optional: true } });
    if (r) await accion("borrador", "borrador", { reason: r.reason || null }, "El pedido volvió a borrador");
  }

  async function guardarPesos() {
    const lista = Object.entries(pesos).filter(([, v]) => Number(v) > 0).map(([line_id, v]) => ({ line_id, weighed_kg: Number(v) }));
    if (!lista.length) return;
    await accion("pesos", "pesos", { pesos: lista, fuente: "MANUAL" }, "Pesos guardados");
    setPesos({});
  }

  const lineasKg = d.lineas.filter((l) => l.price_basis === "KG");
  const pesando = ["IN_PREPARATION", "WEIGHED"].includes(o.status) && editar && lineasKg.length > 0;
  const siguientes = d.siguientes.filter((s) => DIRECTOS.includes(s));
  const puedeCancelar = editar && (d.siguientes.includes("CANCELLED") || d.siguientes.includes("NOT_DELIVERED"));
  const total = o.final_total ?? o.estimated_total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => router.push("/m/ped/ped-01")} className="cursor-pointer rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Volver a pedidos">
              <ArrowLeft size={17} />
            </button>
            <span className="text-[17px] font-semibold text-ink">{o.number}</span>
            <StatusBadge status={o.status} labels={ESTADOS} />
            {o.needs_stock && <Badge tone="warn">Sin stock al confirmar</Badge>}
            {o.weight_diff_status !== "NONE" && <StatusBadge status={o.weight_diff_status} labels={PESO} />}
            {o.discount_status === "PENDING_APPROVAL" && <Badge tone="warn">Descuento por aprobar</Badge>}
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            {d.marca?.name} · {etiqueta(CANALES, o.channel)} · {d.local} · creado {fechaHora(o.created_at)}{d.vendedora ? ` · ${d.vendedora}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[19px] font-semibold text-ink">{soles(total)}</div>
          <div className="text-[12px] text-muted">{o.final_total ? "total final" : "total estimado"}</div>
        </div>
      </div>

      {editar && (
        <div className="flex flex-wrap gap-2">
          {o.status === "DRAFT" && <>
            <Button icon={Pencil} onClick={() => router.push(`/m/ped/ped-02?id=${o.id}`)}>Editar borrador</Button>
            {can("ped.order.confirm") && <Button variant="primary" icon={CheckCircle2} loading={ocupado === "confirmar"} onClick={() => accion("confirmar", "confirmar", undefined, "Pedido confirmado")}>Confirmar</Button>}
          </>}
          {siguientes.map((s) => (
            <Button key={s} variant="primary" loading={ocupado === s} onClick={() => accion(s, "estado", { to: s }, `Pedido ${nombreEstado(s).toLowerCase()}`)}>{ACCION_ESTADO[s] ?? nombreEstado(s)}</Button>
          ))}
          {o.status !== "DRAFT" && o.status !== "CANCELLED" && <Button icon={MessageCircle} onClick={() => router.push(`/m/ped/ped-05?id=${o.id}`)}>Mensaje al cliente</Button>}
          {["CONFIRMED", "NOT_DELIVERED"].includes(o.status) && can("ped.order.reschedule") && <Button icon={CalendarClock} onClick={() => setModal("reprogramar")}>Reprogramar</Button>}
          {o.status === "CONFIRMED" && <Button icon={Undo2} loading={ocupado === "borrador"} onClick={aBorrador}>Volver a borrador</Button>}
          {["NOTICE_REQUIRED", "NOTICE_SENT"].includes(o.weight_diff_status) && <Button icon={Scale} onClick={() => router.push(`/m/ped/ped-07?id=${o.id}`)}>Diferencia de peso</Button>}
          {(d.saldo.tipo !== "CUADRA" || d.siguientes.includes("CLOSED")) && !["DRAFT", "CANCELLED"].includes(o.status) && <Button icon={Wallet} onClick={() => setModal("saldo")}>{d.siguientes.includes("CLOSED") ? "Saldo y cierre" : "Saldo"}</Button>}
          {puedeCancelar && <Button variant="danger" icon={Ban} onClick={() => setModal("cancelar")}>{o.status === "IN_ROUTE" ? "No entregado" : "Cancelar"}</Button>}
        </div>
      )}

      {o.status === "DRAFT" && d.faltan.length > 0 && (
        <Alert tone="warn" title="Para confirmar falta:">
          <ul className="list-disc pl-4">{d.faltan.map((f) => <li key={f.codigo}>{f.texto}</li>)}</ul>
        </Alert>
      )}
      {o.status === "CANCELLED" && <Alert tone="bad" title={`Cancelado ${fechaHora(o.cancelled_at)}`}>{o.cancel_reason}{o.cancel_note ? ` · ${o.cancel_note}` : ""}</Alert>}
      {o.weight_diff_status === "NOTICE_REQUIRED" && <Alert tone="bad">El peso real se pasó de la tolerancia: avisa al cliente antes de marcarlo listo.</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Cliente">
          <DetailList items={[
            { label: "Cliente", value: d.cliente ? (d.cliente.trade_name || d.cliente.full_name) : "—" },
            { label: "Celular", value: celular(o.contact_phone || d.cliente?.phone) },
            { label: "Documento", value: d.cliente?.doc_number ? `${d.cliente.doc_type} ${d.cliente.doc_number}` : "—" },
            { label: "Comprobante", value: etiqueta(COMPROBANTES, o.requested_doc_type) },
            { label: "Confirmó el cliente", value: o.customer_confirmed_at ? `${fechaHora(o.customer_confirmed_at)} · ${etiqueta(CANALES, o.confirmation_channel)}` : "Aún no" },
            { label: "Forma de pago", value: d.forma_pago?.name ?? "—" },
          ]} />
        </Seccion>
        <Seccion titulo="Entrega">
          <DetailList items={[
            { label: "Tipo", value: etiqueta(ENTREGAS, o.fulfillment) },
            { label: "Fecha y franja", value: o.delivery_date ? `${fecha(o.delivery_date)} ${franjaTexto(o.slot_from, o.slot_to)}` : "—" },
            ...(d.direccion ? [{ label: "Dirección", value: `${d.direccion.address_line}, ${d.direccion.district}${d.direccion.reference ? ` (Ref.: ${d.direccion.reference})` : ""}` }] : []),
            ...(d.zona ? [{ label: "Zona", value: d.zona.name }] : []),
            ...(d.recojo ? [{ label: "Recojo en", value: d.recojo }] : []),
            ...(o.fulfillment === "PROVINCE_SHIPPING" ? [
              { label: "Agencia", value: d.agencia ?? "—" }, { label: "Destino", value: o.province_destination ?? "—" },
              { label: "Guía / seguimiento", value: `${o.dispatch_guide_number ?? "—"} / ${o.tracking_number ?? "—"}` },
            ] : []),
            { label: "Reprogramado", value: `${o.reschedule_count} de ${d.max_reprogramaciones} veces` },
            ...(o.notes ? [{ label: "Notas de preparación", value: o.notes }] : []),
          ]} />
        </Seccion>
      </div>

      <Seccion titulo="Productos" acciones={pesando && <Button size="sm" variant="primary" icon={Scale} loading={ocupado === "pesos"} disabled={!Object.values(pesos).some((v) => Number(v) > 0)} onClick={guardarPesos}>Guardar pesos</Button>}>
        {pesando && <p className="mb-3 text-[12.5px] text-muted">Escribe el peso real de cada producto por kg. Cuando todos tienen peso, el pedido pasa a «Pesado».</p>}
        <ul className="divide-y divide-line">
          {d.lineas.map((l) => {
            const pl = d.peso?.lineas.find((x) => x.line_id === l.id);
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-ink">{numero(l.qty, 3)} {l.price_basis === "KG" && l.sale_mode === "KG" ? "kg" : "×"} {l.name}</div>
                  <div className="text-[12px] text-muted">
                    <span className="font-mono">{l.sku}</span> · {soles(l.unit_price)}{l.price_basis === "KG" ? " /kg" : " c/u"}
                    {l.corte ? ` · ${l.corte}` : ""}{l.cut_notes ? ` · ${l.cut_notes}` : ""}
                    {l.price_basis === "KG" && ` · estimado ${kg(l.est_weight_kg)}`}
                    {l.weighed_kg && ` · real ${kg(l.weighed_kg)}`}
                    {pl?.diferencia_pct != null && <span className={pl.excede ? "text-bad" : ""}> ({pl.diferencia_pct > 0 ? "+" : ""}{porcentaje(pl.diferencia_pct, 1)})</span>}
                  </div>
                </div>
                {pesando && l.price_basis === "KG" && (
                  <div className="w-[120px]">
                    <Input type="number" inputMode="decimal" step="0.001" min="0" aria-label={`Peso real de ${l.name}`} placeholder={l.weighed_kg ?? "kg"}
                      value={pesos[l.id] ?? ""} onChange={(e) => setPesos({ ...pesos, [l.id]: e.target.value })} className="!h-9 text-right" />
                  </div>
                )}
                <div className="text-right text-[13.5px]">
                  <div className="text-ink">{soles(l.final_amount ?? l.est_amount)}</div>
                  {l.final_amount && Number(l.final_amount) !== Number(l.est_amount) && <div className="text-[11.5px] text-muted line-through">{soles(l.est_amount)}</div>}
                </div>
              </li>
            );
          })}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-[13px]">
          <Fila t="Subtotal" v={soles(d.subtotal)} />
          {Number(o.discount_total) > 0 && <Fila t={`Descuento (${DESCUENTO[o.discount_status]?.[0] ?? o.discount_status})`} v={`−${soles(o.discount_total)}`} />}
          {o.fulfillment === "DELIVERY" && <Fila t="Delivery" v={Number(o.delivery_fee) > 0 ? soles(o.delivery_fee) : "Gratis"} />}
          <Fila t="Total estimado" v={soles(o.estimated_total)} fuerte={!o.final_total} />
          {o.final_total && <Fila t="Total final (peso real)" v={soles(o.final_total)} fuerte />}
          <Fila t="Pagado" v={soles(o.paid_amount)} />
          {d.saldo.tipo !== "CUADRA" && <Fila t={d.saldo.tipo === "A_FAVOR" ? "A favor del cliente" : "Falta cobrar"} v={soles(Math.abs(d.saldo.diferencia))} />}
          {o.balance_mode && <Fila t="Saldo decidido" v={`${SALDOS[o.balance_mode] ?? o.balance_mode} · ${soles(o.balance_amount)}`} />}
        </dl>
      </Seccion>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Pagos y comprobantes">
          {d.pagos.length === 0 && d.comprobantes.length === 0 && d.guias.length === 0 ? <Vacio>Aún no hay pagos ni comprobantes.</Vacio> : (
            <ul className="space-y-1.5 text-[13px]">
              {d.pagos.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>Pago {p.number} · {p.forma ?? ""} · {fechaHora(p.paid_at)}</span><span>{soles(p.amount)}</span></li>)}
              {d.comprobantes.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.doc_type === "INVOICE" ? "Factura" : "Boleta"} {c.full_number} · {fecha(c.issue_date)}</span><span>{soles(c.total)}</span></li>)}
              {d.guias.map((g) => <li key={g.id}>Guía {g.full_number} · {g.status}</li>)}
            </ul>
          )}
        </Seccion>
        <Seccion titulo="Historial">
          <ol className="space-y-2 text-[13px]">
            {d.historial.map((h) => (
              <li key={h.id}>
                <span className="text-ink">{nombreEstado(h.from_status)} → <b>{nombreEstado(h.to_status)}</b></span>
                <span className="block text-[12px] text-muted">{fechaHora(h.changed_at)} · {h.changed_by_name}{h.reason ? ` · ${h.reason}` : ""}</span>
              </li>
            ))}
            {d.reprogramaciones.map((r) => (
              <li key={r.id}>
                <span className="text-ink">Reprogramado a <b>{fecha(r.new_date)} {r.new_slot_from?.slice(0, 5)}</b></span>
                <span className="block text-[12px] text-muted">{fechaHora(r.at)} · {r.rescheduled_by_name} · {r.reason}</span>
              </li>
            ))}
          </ol>
        </Seccion>
      </div>

      {(d.avisos.length > 0 || d.descuentos.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {d.avisos.length > 0 && (
            <Seccion titulo="Avisos de peso">
              <ul className="space-y-2 text-[13px]">
                {d.avisos.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{a.channel === "WHATSAPP" ? "WhatsApp" : "Teléfono"} · {fechaHora(a.sent_at)} · {soles(a.estimated_total)} → {soles(a.final_total)}</span>
                    <StatusBadge status={a.customer_response} labels={RESPUESTAS} />
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
          {d.descuentos.length > 0 && (
            <Seccion titulo="Descuentos pedidos">
              <ul className="space-y-2 text-[13px]">
                {d.descuentos.map((x) => (
                  <li key={x.id}>
                    <span className="text-ink">{Number(x.requested_pct) > 0 ? porcentaje(x.requested_pct, 1) : soles(x.requested_amount)} · {x.reason}</span>
                    <span className="block text-[12px] text-muted">
                      Pidió {x.requested_by_name} · {fechaHora(x.requested_at)} · {x.status === "PENDING" ? "pendiente" : `${x.status === "APPROVED" ? "aprobó" : "rechazó"} ${x.decided_by_name}${x.decision_note ? `: ${x.decision_note}` : ""}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
        </div>
      )}

      <Modal open={modal === "cancelar"} onClose={() => setModal("")} title={o.status === "IN_ROUTE" ? "Registrar no entrega" : `Cancelar ${o.number}`}>
        <FormCancelar d={d} onListo={(r) => { reemplazar(r); setModal(""); }} />
      </Modal>
      <Modal open={modal === "reprogramar"} onClose={() => setModal("")} title={`Reprogramar ${o.number}`}>
        <FormReprogramar d={d} onListo={(r) => { reemplazar(r); setModal(""); }} />
      </Modal>
      <Modal open={modal === "saldo"} onClose={() => setModal("")} title={`Saldo de ${o.number}`}>
        <FormSaldo d={d} onListo={(r) => { reemplazar(r); if (r.pedido.status === "CLOSED") setModal(""); }} />
      </Modal>
    </div>
  );
}

function Fila({ t, v, fuerte }: { t: string; v: string; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${fuerte ? "font-semibold text-ink" : "text-muted"}`}>
      <dt>{t}</dt><dd className="text-ink">{v}</dd>
    </div>
  );
}
