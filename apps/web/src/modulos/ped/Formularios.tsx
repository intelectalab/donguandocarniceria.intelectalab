"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { SALDOS, franjaTexto, hoyLima, nombreEstado, sumarDias, type Detalle, type FranjaDisponible, type Motivo } from "./tipos";

/** PED-09: cancelar (o registrar no entrega si está en ruta) con motivo del catálogo y nota cuando el motivo la exige (RN-PED-13). */
export function FormCancelar({ d, onListo }: { d: Detalle; onListo: (r: Detalle) => void }) {
  const o = d.pedido;
  const noEntrega = o.status === "IN_ROUTE";
  const { can } = useSesion();
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [codigo, setCodigo] = useState("");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Motivo[]>(`/v1/ped/motivos?para=${noEntrega ? "NOT_DELIVERED" : "CANCEL"}`).then(setMotivos).catch(() => {});
  }, [noEntrega]);

  const m = motivos.find((x) => x.code === codigo);
  const puede = noEntrega ? d.siguientes.includes("NOT_DELIVERED") : d.siguientes.includes("CANCELLED");
  const sinPermiso = !noEntrega && o.status !== "DRAFT" && !can("ped.order.cancel");

  async function enviar() {
    setEnviando(true);
    setError("");
    try {
      const r = await api<Detalle>(`/v1/ped/pedidos/${o.id}/${noEntrega ? "no-entregado" : "cancelar"}`, { method: "POST", body: { reason_code: codigo, note: nota || null } });
      toast.ok(noEntrega ? "No entrega registrada" : "Pedido cancelado: se liberaron sus reservas");
      onListo(r);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  if (!puede) return <Alert tone="info">Un pedido {nombreEstado(o.status).toLowerCase()} no se cancela ni se marca como no entregado.</Alert>;
  return (
    <div className="space-y-4">
      {sinPermiso && <Alert tone="warn">Cancelar un pedido confirmado lo hace la supervisora (permiso ped.order.cancel).</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}
      <Field label={noEntrega ? "Motivo de la no entrega" : "Motivo de la cancelación"} required>
        <Select value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Elige el motivo" options={motivos.map((x) => ({ value: x.code, label: x.name }))} />
      </Field>
      <Field label="Nota" required={Boolean(m?.requires_note)} hint={m?.requires_note ? "Este motivo exige explicar qué pasó." : "Opcional."}>
        <Textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={255} />
      </Field>
      {!noEntrega && o.status !== "DRAFT" && <p className="text-[12.5px] text-muted">Al cancelar se liberan las reservas de stock del pedido.</p>}
      <Button variant="danger" loading={enviando} disabled={!codigo || (m?.requires_note && nota.trim() === "") || sinPermiso} onClick={enviar}>
        {noEntrega ? "Registrar no entrega" : "Cancelar pedido"}
      </Button>
    </div>
  );
}

/** PED-08: nueva fecha y franja con motivo; muestra cuántas veces se reprogramó (RN-PED-14). */
export function FormReprogramar({ d, onListo }: { d: Detalle; onListo: (r: Detalle) => void }) {
  const o = d.pedido;
  const [dia, setDia] = useState(() => sumarDias(o.delivery_date && o.delivery_date >= hoyLima() ? o.delivery_date : hoyLima(), 1));
  const [franjas, setFranjas] = useState<FranjaDisponible[]>([]);
  const [franja, setFranja] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    api<FranjaDisponible[]>(`/v1/ped/franjas/disponibles?establishment_id=${o.establishment_id}&fecha=${dia}${o.zone_id ? `&zone_id=${o.zone_id}` : ""}`)
      .then((f) => vigente && setFranjas(f)).catch(() => vigente && setFranjas([]));
    return () => { vigente = false; };
  }, [dia, o.establishment_id, o.zone_id]);

  const puede = ["CONFIRMED", "NOT_DELIVERED"].includes(o.status);
  const alTope = o.reschedule_count >= d.max_reprogramaciones;

  async function enviar() {
    setEnviando(true);
    setError("");
    try {
      const r = await api<Detalle>(`/v1/ped/pedidos/${o.id}/reprogramar`, { method: "POST", body: { delivery_date: dia, slot_id: franja, reason: motivo } });
      toast.ok("Pedido reprogramado");
      onListo(r);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  if (!puede) return <Alert tone="info">Se reprograma un pedido confirmado o no entregado. Este está {nombreEstado(o.status).toLowerCase()}.</Alert>;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">
        Entrega actual: <b className="text-ink">{fecha(o.delivery_date)} {franjaTexto(o.slot_from, o.slot_to)}</b>. Reprogramado {o.reschedule_count} de {d.max_reprogramaciones} veces.
      </p>
      {alTope && <Alert tone="warn">Ya llegó al máximo de reprogramaciones: la siguiente la hace la supervisora.</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}
      <Field label="Nueva fecha" required>
        <Input type="date" value={dia} min={hoyLima()} onChange={(e) => { setDia(e.target.value); setFranja(""); }} />
      </Field>
      <Field label="Franja" required>
        <div className="grid gap-2 sm:grid-cols-2">
          {franjas.length === 0 && <p className="text-[13px] text-muted">No hay franjas para ese día.</p>}
          {franjas.map((f) => (
            <button key={f.id} type="button" onClick={() => setFranja(f.id)} disabled={f.paso_corte}
              className={`cursor-pointer rounded-[9px] border px-3 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${franja === f.id ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2"}`}>
              <span className="block font-medium text-ink">{f.slot_from}–{f.slot_to}</span>
              <span className={`block text-[12px] ${f.llena ? "text-bad" : "text-muted"}`}>{f.ocupados} de {f.capacity}{f.llena ? " · llena" : ""}{f.paso_corte ? " · pasó el corte" : ` · corte ${f.cutoff}`}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Motivo" required>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={255} placeholder="Cliente ausente, pide otro día…" />
      </Field>
      <Button variant="primary" loading={enviando} disabled={!franja || motivo.trim() === ""} onClick={enviar}>Reprogramar</Button>
    </div>
  );
}

/** PED-12: qué hacer con la diferencia entre lo pagado y el total (RN-PED-19), y cerrar (RN-PED-15). */
export function FormSaldo({ d, onListo, maxCondonar }: { d: Detalle; onListo: (r: Detalle) => void; maxCondonar?: number }) {
  const o = d.pedido;
  const s = d.saldo;
  const { can } = useSesion();
  const [modo, setModo] = useState("");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const opciones = s.tipo === "A_FAVOR"
    ? [{ value: "CUSTOMER_CREDIT", label: "Saldo a favor para su próxima compra" }, ...(can("caj.balance.refund") ? [{ value: "REFUND", label: "Devolución" }] : [])]
    : [{ value: "COLLECT_ON_DELIVERY", label: "Cobro contra entrega" }, { value: "PAYMENT_LINK", label: "Enlace de pago" },
      ...(can("ped.balance.waive") && Math.abs(s.diferencia) <= (maxCondonar ?? 1) ? [{ value: "WAIVE", label: "Condonar (saldo pequeño)" }] : [])];

  async function enviar(ruta: string, body?: unknown, texto = "Listo") {
    setEnviando(true);
    setError("");
    try {
      const r = await api<Detalle>(`/v1/ped/pedidos/${o.id}/${ruta}`, { method: "POST", body });
      toast.ok(texto);
      onListo(r);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Dato titulo={o.final_total ? "Total final" : "Total estimado"} valor={soles(s.total)} />
        <Dato titulo="Pagado" valor={soles(s.pagado)} />
        <Dato titulo={s.tipo === "A_FAVOR" ? "A favor del cliente" : s.tipo === "POR_COBRAR" ? "Falta cobrar" : "Diferencia"} valor={soles(Math.abs(s.diferencia))}
          tono={s.tipo === "CUADRA" ? "text-ok" : s.tipo === "A_FAVOR" ? "text-info" : "text-bad"} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {o.balance_mode && (
        <Alert tone="ok" title={SALDOS[o.balance_mode] ?? o.balance_mode}>
          Decidido por {o.balance_decided_by_name} · {soles(o.balance_amount)}{o.balance_note ? ` · ${o.balance_note}` : ""}
        </Alert>
      )}
      {s.tipo !== "CUADRA" && o.status !== "CLOSED" && (
        <>
          <Field label="Qué se hace con el saldo" required>
            <Select value={modo} onChange={(e) => setModo(e.target.value)} placeholder="Elige" options={opciones.filter((x) => x.value !== o.balance_mode)} />
          </Field>
          <Field label="Nota"><Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={255} /></Field>
          <Button loading={enviando} disabled={!modo} onClick={() => enviar("saldo", { mode: modo, note: nota || null }, "Saldo registrado")}>Registrar decisión</Button>
        </>
      )}
      {d.siguientes.includes("CLOSED") && (
        <div className="border-t border-line pt-4">
          <Button variant="primary" loading={enviando} disabled={s.tipo !== "CUADRA" && !o.balance_mode} onClick={() => enviar("cerrar", undefined, "Pedido cerrado")}>Cerrar pedido</Button>
          {s.tipo !== "CUADRA" && !o.balance_mode && <p className="mt-2 text-[12.5px] text-muted">Para cerrar, primero decide el saldo (RN-PED-15).</p>}
        </div>
      )}
    </div>
  );
}

function Dato({ titulo, valor, tono = "text-ink" }: { titulo: string; valor: string; tono?: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface-2 px-2 py-2.5">
      <div className="text-[11.5px] text-muted">{titulo}</div>
      <div className={`text-[15px] font-semibold ${tono}`}>{valor}</div>
    </div>
  );
}
