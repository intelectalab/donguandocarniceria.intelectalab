"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Banknote, CircleDollarSign, FlaskConical, Hourglass, MessageCircle, Send, Undo2 } from "lucide-react";
import {
  Alert, Badge, Button, Checkbox, Cifra, DataTable, DetailList, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column,
} from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { ESTADOS as ESTADO_PEDIDO } from "@/modulos/ped/tipos";
import { CONCILIACION, Crudo, ESTADO_EVENTO, ESTADO_PAGO, Historial, MEDIO_MP, Seccion, Vacio, cuando, n, useDatos, type Historia, type TiendaCorta } from "@/modulos/web/comunes";

type Nota = { document_id: string; full_number: string; amount: number; status: string; reason: string; emitida: { id: string; full_number: string; total: number } | null };
type Fila = {
  id: string; external_payment_id: string; external_reference: string; store_id: string; tienda: string; status: string; status_detail: string | null; amount: string;
  fee_amount: string | null; fee_igv: string | null; net_amount: string | null; payment_method: string | null; payment_type: string | null; date_created: string;
  date_approved: string | null; money_release_date: string | null; payment_id: string | null; order_ids: string[]; credit_notes: Nota[] | null; customer_notified_at: string | null;
  inbox_id: string | null; cobro: string | null; cobro_status: string | null; conciliacion: string; pedidos: string[];
};
type Resumen = {
  cifras: { aprobado: number; comision: number; pendientes: number; sin_cobro: number; por_conciliar: number; reversos: number };
  tiendas: TiendaCorta[]; detalles: Record<string, string>; puede_simular: boolean; puede_conciliar: boolean;
};
type Detalle = {
  tx: Omit<Fila, "credit_notes"> & {
    installments: number | null; card_last4: string | null; payer_email: string | null; verified_at: string | null; reversed_at: string | null; reverse_result: string | null;
    reverse_error: string | null; expired_at: string | null; history: Historia[]; raw: unknown; credit_notes: Nota[] | null;
  };
  tienda: { id: string; name: string };
  cobro: { id: string; number: string; status: string; amount: string; reconciliation_status: string | null; settlement_batch_id: string | null; reversal_reason: string | null; batch_reference: string | null; batch_status: string | null } | null;
  conciliacion: string;
  pedidos: { id: string; number: string; status: string; estimated_total: string; final_total: string | null; paid_amount: string | null }[];
  bandeja: { id: string; external_order_id: string; status: string; customer_name: string | null } | null;
  eventos: { id: string; status: string; received_at: string }[];
  puede_cobrar: boolean; puede_simular: boolean; puede_nota: boolean;
};

const ESTADOS_FILTRO = [{ value: "PENDIENTES", label: "Pendientes (todas)" }, ...Object.entries(ESTADO_PAGO).map(([value, [label]]) => ({ value, label }))];
const medio = (m: string | null) => MEDIO_MP[m ?? ""] ?? m ?? "—";

/** WEB-06 Pagos de la pasarela: cada transacción de Mercado Pago, su cobro en Caja y su conciliación. */
export default function Pagos() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const inicial = useSearchParams().get("id");
  const [f, setF] = useState({ tienda: "", estado: "", conciliacion: "", desde: "", hasta: "" });
  const [abierto, setAbierto] = useState<string | null>(inicial);
  const [simulando, setSimulando] = useState(false);
  const lista = useListado<Fila>("/v1/web/pagos", { filtros: f });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>(`/v1/web/pagos?per_page=1${qs ? `&${qs}` : ""}`);
  const recargar = () => { lista.recargar(); recargarResumen(); };
  const c = r?.cifras;
  const poner = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  function cerrar() {
    setAbierto(null);
    if (inicial) router.replace("/m/web/web-06");
  }

  const columnas: Column<Fila>[] = [
    { key: "external_payment_id", header: "Transacción", cardTitle: true, render: (t) => (
      <div className="min-w-0"><div className="font-medium">{t.external_payment_id}</div><div className="text-[12px] text-muted">{cuando(t.date_created)} · web #{t.external_reference}</div></div>
    ) },
    { key: "payment_method", header: "Medio", hideOnMobile: true, render: (t) => <span className="text-[13px]">{medio(t.payment_method)}</span> },
    { key: "amount", header: "Monto", align: "right", render: (t) => (
      <div className="text-right"><div className="tabular-nums">{soles(n(t.amount))}</div>
        {t.fee_amount !== null && t.status === "approved" && <div className="text-[11.5px] text-muted">neto {soles(n(t.net_amount))}</div>}</div>
    ) },
    { key: "cobro", header: "Cobro en Caja", render: (t) => t.cobro
      ? <div className="text-[13px]">{t.cobro}{t.pedidos.length ? <div className="text-[12px] text-muted">{t.pedidos.join(", ")}</div> : null}</div>
      : <span className="text-[13px] text-muted">{t.status === "approved" ? "Sin cobro" : "—"}</span> },
    { key: "conciliacion", header: "Conciliación", hideOnMobile: true, render: (t) => <StatusBadge status={t.conciliacion} labels={CONCILIACION} /> },
    { key: "status", header: "Estado", render: (t) => (
      <div className="flex flex-wrap gap-1"><StatusBadge status={t.status} labels={ESTADO_PAGO} />{(t.credit_notes?.length ?? 0) > 0 && <Badge tone="warn">Nota de crédito</Badge>}</div>
    ) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Mercado Pago avisa cada pago; se verifica con su API y, si está aprobado y el monto cuadra, se registra solo el cobro en Caja y se confirma el pedido (RN-WEB-06). La conciliación con la liquidación se hace en Caja."
        actions={<>
          {r?.puede_conciliar && <Link href="/m/caj/caj-12" className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[13.5px] font-medium text-ink hover:bg-surface-2">Conciliar en Caja</Link>}
          {r?.puede_simular && <Button icon={FlaskConical} onClick={() => setSimulando(true)}>Simular pago</Button>}
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Aprobado" icono={CircleDollarSign} destacada valor={c ? soles(c.aprobado) : undefined} detalle={c ? `comisión ${soles(c.comision)}` : undefined} />
        <Cifra titulo="Pendientes" icono={Hourglass} tono={c && c.pendientes > 0 ? "warn" : undefined} valor={c ? numero(c.pendientes) : undefined} detalle="esperando a Mercado Pago" />
        <Cifra titulo="Aprobados sin cobro" icono={AlertTriangle} tono={c && c.sin_cobro > 0 ? "bad" : undefined} valor={c ? numero(c.sin_cobro) : undefined} detalle="regístralo a mano" />
        <Cifra titulo="Por conciliar" icono={Banknote} tono={c && c.por_conciliar > 0 ? "warn" : undefined} valor={c ? numero(c.por_conciliar) : undefined}
          detalle="liberados, ve a Caja" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(t) => setAbierto(t.id)} empty="No hay transacciones con estos filtros."
        search={{ ...lista.tabla.search, placeholder: "Id de Mercado Pago, pedido web, cobro o correo…" }}
        toolbar={<>
          {(r?.tiendas.length ?? 0) > 1 && <FiltroSelect etiqueta="Tienda" todos="todas" value={f.tienda} onChange={poner("tienda")} options={(r?.tiendas ?? []).map((s) => ({ value: s.id, label: s.name }))} ancho={200} />}
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={poner("estado")} options={ESTADOS_FILTRO} ancho={190} />
          <FiltroSelect etiqueta="Conciliación" todos="todas" value={f.conciliacion} onChange={poner("conciliacion")} options={Object.entries(CONCILIACION).map(([value, [label]]) => ({ value, label }))} ancho={210} />
          <FiltroFecha etiqueta="Desde" value={f.desde} onChange={poner("desde")} max={f.hasta || undefined} visible />
          <FiltroFecha etiqueta="Hasta" value={f.hasta} onChange={poner("hasta")} min={f.desde || undefined} visible />
        </>} />
      {abierto && <FichaPago id={abierto} detalles={r?.detalles ?? {}} onClose={cerrar} onCambio={recargar} />}
      {simulando && r && <SimuladorPago tiendas={r.tiendas} onClose={() => setSimulando(false)} onListo={recargar} onAbrir={(id) => { setSimulando(false); setAbierto(id); }} />}
    </div>
  );
}

function FichaPago({ id, detalles, onClose, onCambio }: { id: string; detalles: Record<string, string>; onClose: () => void; onCambio: () => void }) {
  const { datos: d, error, recargar } = useDatos<Detalle>(`/v1/web/pagos/${id}`);
  const [monto, setMonto] = useState("");
  const [trabajando, setTrabajando] = useState("");
  const t = d?.tx;

  async function cobrar(e: FormEvent) {
    e.preventDefault();
    setTrabajando("cobrar");
    try {
      await api(`/v1/web/pagos/${id}/cobro`, { method: "POST", body: { amount: Number(monto || t?.amount) } });
      toast.ok("Cobro registrado en Caja.");
      recargar();
      onCambio();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setTrabajando("");
    }
  }

  async function avisar() {
    setTrabajando("avisar");
    try {
      const r = await api<{ texto: string; enlace: string | null }>(`/v1/web/pagos/${id}/avisar`, { method: "POST" });
      if (r.enlace) window.open(r.enlace, "_blank", "noopener,noreferrer");
      else await navigator.clipboard?.writeText(r.texto);
      toast.ok(r.enlace ? "Se abrió WhatsApp con el mensaje para el cliente." : "Mensaje copiado: el cliente no tiene celular.");
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setTrabajando("");
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t ? `Mercado Pago ${t.external_payment_id}` : "Transacción"}
      description={t ? `${d?.tienda.name} · pedido web #${t.external_reference} · ${cuando(t.date_created)}` : undefined}
      footer={<Button variant="primary" onClick={onClose}>Cerrar</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!d || !t ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} labels={ESTADO_PAGO} />
            {t.status_detail && <span className="text-[13px] text-muted">{detalles[t.status_detail] ?? t.status_detail}</span>}
            <StatusBadge status={d.conciliacion} labels={CONCILIACION} />
          </div>
          {t.status === "rejected" && (
            <Alert tone="bad" title="Pago rechazado">
              El pedido queda en borrador. Avisa al cliente para que pague de nuevo.
              <div className="mt-2"><Button size="sm" icon={MessageCircle} loading={trabajando === "avisar"} onClick={avisar}>Avisar por WhatsApp</Button>
                {t.customer_notified_at && <span className="ml-2 text-[12px]">Avisado {cuando(t.customer_notified_at)}</span>}</div>
            </Alert>
          )}
          {(t.status === "refunded" || t.status === "charged_back") && (
            <Alert tone="bad" title={t.status === "refunded" ? "Reembolsado" : "Contracargo"}>
              {t.reverse_result ?? "Se revirtió el cobro en Caja (RN-WEB-09)."}{t.reverse_error ? ` · ${t.reverse_error}` : ""}
            </Alert>
          )}
          {d.puede_cobrar && (
            <Seccion titulo="Aprobado sin cobro en Caja">
              <p className="mb-2 text-[13px] text-muted">El cobro no se registró solo. Se vuelve a verificar con Mercado Pago y el monto debe ser el aprobado.</p>
              <form onSubmit={cobrar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Monto">
                  <Input type="number" step="0.01" min="0.01" value={monto} placeholder={n(t.amount).toFixed(2)} onChange={(e) => setMonto(e.target.value)} prefix="S/" />
                </Field>
                <Button variant="primary" type="submit" icon={Banknote} loading={trabajando === "cobrar"}>Registrar cobro</Button>
              </form>
            </Seccion>
          )}
          <DetailList items={[
            { label: "Monto", value: soles(n(t.amount)) },
            { label: "Comisión de Mercado Pago", value: t.fee_amount !== null ? `${soles(n(t.fee_amount))} + IGV ${soles(n(t.fee_igv))} · neto ${soles(n(t.net_amount))}` : "—" },
            { label: "Medio", value: `${medio(t.payment_method)}${t.card_last4 ? ` ···· ${t.card_last4}` : ""}${t.installments && t.installments > 1 ? ` · ${t.installments} cuotas` : ""}` },
            { label: "Pagador", value: t.payer_email ?? "—" },
            { label: "Aprobado", value: t.date_approved ? cuando(t.date_approved) : "—" },
            { label: "Liberación del dinero", value: t.money_release_date ? fecha(t.money_release_date) : "—" },
            { label: "Verificado con la API", value: t.verified_at ? cuando(t.verified_at) : "—" },
            { label: "Cobro en Caja", value: d.cobro
              ? <Link className="text-primary underline" href={`/m/caj/caj-03?id=${d.cobro.id}`}>{d.cobro.number} · {soles(n(d.cobro.amount))}{d.cobro.status !== "CONFIRMED" ? " (revertido)" : ""}</Link>
              : "Sin cobro" },
            { label: "Liquidación", value: d.cobro?.batch_reference ? `${d.cobro.batch_reference} · ${d.cobro.batch_status ?? ""}` : "Todavía en ninguna" },
            { label: "Pedido web", value: d.bandeja ? <Link className="text-primary underline" href={`/m/web/web-05?id=${d.bandeja.id}`}>#{d.bandeja.external_order_id} · {d.bandeja.customer_name ?? ""}</Link> : `#${t.external_reference} (no llegó a la bandeja)` },
          ]} />
          <Seccion titulo="Pedidos">
            {!d.pedidos.length ? <Vacio>Ningún pedido asociado.</Vacio> : (
              <ul className="divide-y divide-line">
                {d.pedidos.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <div><Link className="font-medium text-primary underline" href={`/m/ped/ped-03?id=${o.id}`}>{o.number}</Link>
                      <span className="text-muted"> · {soles(n(o.final_total ?? o.estimated_total))} · pagado {soles(n(o.paid_amount))}</span></div>
                    <StatusBadge status={o.status} labels={ESTADO_PEDIDO} />
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          {(t.credit_notes?.length ?? 0) > 0 && (
            <Seccion titulo="Notas de crédito">
              <ul className="divide-y divide-line">
                {t.credit_notes!.map((x) => (
                  <li key={x.document_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <div className="min-w-0"><div className="font-medium">Sobre {x.full_number} · {soles(x.amount)}</div><div className="text-[12px] text-muted">{x.reason}</div></div>
                    {x.emitida ? <Badge tone="ok">Emitida {x.emitida.full_number}</Badge>
                      : d.puede_nota ? <Link className="inline-flex items-center gap-1 text-[13px] font-medium text-primary underline" href={`/m/fac/fac-05?id=${x.document_id}`}><Undo2 size={14} aria-hidden="true" />Emitir en Facturación</Link>
                        : <Badge tone="warn">Preparada, por emitir</Badge>}
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
          <Seccion titulo="Historial"><Historial items={t.history} /></Seccion>
          {d.eventos.length > 0 && (
            <Seccion titulo="Notificaciones recibidas">
              <ul className="space-y-1 text-[13px]">
                {d.eventos.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <Link className="text-primary underline" href={`/m/web/web-07?id=${e.id}`}>{cuando(e.received_at)}</Link>
                    <StatusBadge status={e.status} labels={ESTADO_EVENTO} />
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
          <Crudo titulo="Respuesta de la API de Mercado Pago (JSON)" valor={t.raw} />
        </div>
      )}
    </Modal>
  );
}

type ResultadoPago = { respuestas: { envio: number; http: number; status: string; duplicate: boolean }[]; tx: { id: string; status: string; payment_id: string | null } | null; payment_id: string; resultado: string | null };

function SimuladorPago({ tiendas, onClose, onListo, onAbrir }: { tiendas: TiendaCorta[]; onClose: () => void; onListo: () => void; onAbrir: (id: string) => void }) {
  const [d, setD] = useState({ store_id: tiendas.find((t) => t.status === "TESTING")?.id ?? tiendas[0]?.id ?? "", status: "approved", payment_id: "", external_reference: "", amount: "", method: "visa", firma_valida: true });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [res, setRes] = useState<ResultadoPago | null>(null);
  const reverso = d.status === "refunded" || d.status === "charged_back";

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErrores({});
    setGeneral("");
    try {
      const x = await api<ResultadoPago>("/v1/web/pagos/simular", { method: "POST", body: {
        store_id: d.store_id, status: d.status, payment_id: d.payment_id || null, external_reference: d.external_reference || null,
        amount: d.amount ? Number(d.amount) : null, method: d.method, firma_valida: d.firma_valida,
      } });
      setRes(x);
      setD((v) => ({ ...v, payment_id: x.payment_id }));
      onListo();
    } catch (err) {
      setErrores(erroresDe(err));
      setGeneral(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Simular pago de Mercado Pago" dismissable={!enviando}
      description="Solo con conectores de prueba. El pago queda del lado de Mercado Pago y llega su notificación firmada; se verifica con la API como uno real."
      footer={<><Button onClick={onClose} disabled={enviando}>Cerrar</Button><Button variant="primary" type="submit" form="f-pago" icon={Send} loading={enviando}>Enviar notificación</Button></>}>
      <form id="f-pago" onSubmit={enviar} className="space-y-3">
        {general && <Alert tone="bad">{general}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tienda" required error={errores.store_id}>
            <Select value={d.store_id} onChange={(e) => setD((x) => ({ ...x, store_id: e.target.value }))} options={tiendas.map((t) => ({ value: t.id, label: t.name }))} />
          </Field>
          <Field label="Estado del pago" required error={errores.status}>
            <Select value={d.status} onChange={(e) => setD((x) => ({ ...x, status: e.target.value }))}
              options={["approved", "pending", "in_process", "rejected", "refunded", "charged_back"].map((v) => ({ value: v, label: ESTADO_PAGO[v][0] }))} />
          </Field>
          <Field label="Pedido web (external_reference)" required={!d.payment_id} error={errores.external_reference} hint="El n.º de WooCommerce, por ejemplo 52612.">
            <Input value={d.external_reference} onChange={(e) => setD((x) => ({ ...x, external_reference: e.target.value }))} maxLength={40} />
          </Field>
          <Field label="Monto" required={!d.payment_id} error={errores.amount}>
            <Input type="number" step="0.01" min="0.01" value={d.amount} onChange={(e) => setD((x) => ({ ...x, amount: e.target.value }))} prefix="S/" />
          </Field>
          <Field label="Id del pago" error={errores.payment_id} hint={reverso ? "El id del pago aprobado a revertir." : "Vacío = pago nuevo; con id = cambia el estado de ese pago."} required={reverso}>
            <Input value={d.payment_id} onChange={(e) => setD((x) => ({ ...x, payment_id: e.target.value }))} maxLength={40} />
          </Field>
          <Field label="Medio" error={errores.method}>
            <Select value={d.method} onChange={(e) => setD((x) => ({ ...x, method: e.target.value }))} options={Object.entries(MEDIO_MP).map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        <Checkbox checked={!d.firma_valida} onChange={(v) => setD((x) => ({ ...x, firma_valida: !v }))} label="Mandar con firma inválida (debe rechazarse)" />
        {res && (
          <div className="space-y-1 rounded-lg border border-line p-3 text-[13px]">
            {res.respuestas.map((x) => <div key={x.envio}>Notificación: HTTP {x.http} · {x.status || "—"}</div>)}
            <div>Pago <span className="font-medium">{res.payment_id}</span>{res.tx ? <> · <StatusBadge status={res.tx.status} labels={ESTADO_PAGO} /></> : " · sin transacción"}</div>
            {res.resultado && <div className="text-muted">{res.resultado}</div>}
            {res.tx && <Button size="sm" onClick={() => onAbrir(res.tx!.id)}>Ver la transacción</Button>}
          </div>
        )}
      </form>
    </Modal>
  );
}
