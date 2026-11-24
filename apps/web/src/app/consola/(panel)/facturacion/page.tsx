"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, FileMinus, FilePlus2, Play, Send, Trash2 } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fecha, fechaHora, soles } from "@/lib/formato";

type Comprobante = {
  id: string; tenant_short: string; doc_type: string; doc_type_name: string; number: string | null; status: string; payment_status: string; payment_status_name: string;
  sunat_status: string; sunat_status_name: string; period: string | null; issue_date: string | null; due_date: string | null; vencido: boolean;
  customer_doc_type: string; customer_doc_number: string; customer_name: string; customer_address: string | null; subtotal: number; igv: number; total: number;
  pagado: number; acreditado: number; saldo: number; reason: string | null; created_at: string;
};
type Detalle = Comprobante & {
  lineas: { description: string; quantity: number; unit_price: number; subtotal: number; igv: number; total: number }[];
  cobros: { id: string; gateway_ref: string; amount: number; status: string; origin: string; error: string | null; created_at: string }[];
  notas: { id: string; number: string; total: number; reason: string; issue_date: string }[]; original: string | null;
};
type Corrida = { id: string; period: string; run_no: number; drafts: number; issued: number; charged: number; total: number; notes: string[]; created_by_name: string; created_at: string };
type Serie = { code: string; doc_type_name: string; applies_to: string | null; next_number: number; ultimo: string | null; active: boolean };
type Datos = { data: Comprobante[]; corridas: Corrida[]; series: Serie[]; emisor: string | null };

const PAGO: Record<string, Tone> = { UNPAID: "warn", PAID: "ok", CREDITED: "neutral", NA: "neutral" };
const estadoTexto = (c: Comprobante) => (c.status === "DRAFT" ? "Borrador" : c.doc_type === "CREDIT_NOTE" ? "Emitida" : c.vencido ? "Vencido" : c.payment_status_name);
const estadoTono = (c: Comprobante): Tone => (c.status === "DRAFT" ? "neutral" : c.doc_type === "CREDIT_NOTE" ? "info" : c.vencido ? "bad" : PAGO[c.payment_status]);

/** Facturación del SaaS: corrida mensual, comprobantes de Intelectalab (borrador y emitidos), notas de crédito y series. */
export default function Facturacion() {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["billing.manage"]);
  const [tab, setTab] = useState<"comprobantes" | "corridas" | "series">("comprobantes");
  const [f, setF] = useState({ status: "", payment_status: "", period: "" });
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState(false);

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiConsola<Datos>(`/facturacion?${q}`).then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f]);
  useEffect(() => cargar(), [cargar]);

  async function corrida() {
    const periodo = new Date().toISOString().slice(0, 7);
    const ok = await confirmAction({ title: `¿Hacer la corrida de cobro de ${periodo}?`, confirmLabel: "Hacer la corrida",
      message: datos?.emisor ? "Arma los comprobantes que falten, los emite con las series de Intelectalab y cobra a quienes tienen cobro automático."
        : "Sin RUC emisor solo arma los comprobantes en borrador: no se emiten ni se cobran." });
    if (!ok) return;
    setCorriendo(true);
    try {
      const r = await apiConsola<Corrida>("/facturacion/corridas", { method: "POST", body: { period: periodo } });
      toast.ok(`Corrida ${r.run_no}: ${r.issued} emitidos, ${r.drafts} en borrador, ${r.charged} cobrados`);
      setTab("corridas");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCorriendo(false);
    }
  }

  const columnas: Column<Comprobante>[] = [
    { key: "number", header: "Comprobante", cardTitle: true, render: (c) => (
      <div><p className="font-semibold text-ink">{c.number ?? `${c.doc_type_name} en borrador`}</p><p className="text-[12.5px] text-muted">{c.doc_type_name}{c.period ? ` · ${c.period}` : ""}</p></div>
    ) },
    { key: "customer_name", header: "Cliente", render: (c) => <div><p>{c.tenant_short}</p><p className="text-[12.5px] text-muted">{c.customer_doc_type} {c.customer_doc_number}</p></div> },
    { key: "total", header: "Total", align: "right", render: (c) => <div><p className="font-semibold">{soles(c.total)}</p>{c.saldo > 0 && c.status === "ISSUED" && c.saldo < c.total && <p className="text-[12px] text-muted">Saldo {soles(c.saldo)}</p>}</div> },
    { key: "status", header: "Estado", render: (c) => (
      <div className="grid gap-0.5"><Badge tone={estadoTono(c)} dot>{estadoTexto(c)}</Badge>
        {c.status === "ISSUED" && <span className="text-[12px] text-muted">{c.sunat_status_name}</span>}</div>
    ) },
    { key: "due_date", header: "Emitido y vence", hideOnMobile: true, render: (c) => (c.issue_date ? <div className="text-[12.5px]"><p>{fecha(c.issue_date)}</p>{c.due_date && <p className="text-muted">Vence {fecha(c.due_date)}</p>}</div> : "—") },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="La corrida de cada mes arma un comprobante por suscripción activa, con deuda o en solo lectura. Se emite con las series de Intelectalab (factura con RUC, boleta con DNI); emitido no cambia y se corrige con nota de crédito."
        actions={puede ? <Button variant="primary" icon={Play} loading={corriendo} onClick={corrida}>Corrida del mes</Button> : undefined} />
      {datos && !datos.emisor && (
        <Alert tone="warn" title="Falta el RUC emisor de Intelectalab">Mientras no se registre en Parámetros de plataforma («RUC con el que factura Intelectalab»), los comprobantes quedan en borrador: no se emiten ni se cobran.</Alert>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "comprobantes", label: "Comprobantes", count: datos?.data.filter((c) => c.status === "DRAFT").length },
        { key: "corridas", label: "Corridas" }, { key: "series", label: "Series" },
      ]} />
      {tab === "comprobantes" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
            <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Borradores y emitidos"
              options={[{ value: "DRAFT", label: "Borradores" }, { value: "ISSUED", label: "Emitidos" }]} />
            <Select aria-label="Pago" value={f.payment_status} onChange={(e) => setF({ ...f, payment_status: e.target.value })} placeholder="Todo estado de pago"
              options={[{ value: "UNPAID", label: "Por cobrar" }, { value: "PAID", label: "Pagados" }, { value: "CREDITED", label: "Anulados con nota" }]} />
            <Input aria-label="Período" type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} />
          </div>
          <DataTable columns={columnas} rows={datos?.data ?? []} loading={!datos && !error} error={error} onRetry={cargar} onRowClick={(c) => setAbierto(c.id)}
            empty="No hay comprobantes con estos filtros." />
        </>
      )}
      {tab === "corridas" && (
        <div className="grid gap-2">
          {(datos?.corridas ?? []).length === 0 && <p className="text-[13px] text-muted">Todavía no hay corridas.</p>}
          {(datos?.corridas ?? []).map((r) => (
            <div key={r.id} className="grid gap-1 rounded-xl border border-line bg-surface p-3.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{r.period} · corrida {r.run_no}</span>
                <Badge tone="ok">{r.issued} emitidos</Badge>{r.drafts > 0 && <Badge tone="warn">{r.drafts} en borrador</Badge>}<Badge tone="info">{r.charged} cobrados</Badge>
                <span className="text-muted">{soles(r.total)} · {r.created_by_name} · {fechaHora(r.created_at)}</span>
              </div>
              {r.notes.map((n, i) => <p key={i} className="text-muted">· {n}</p>)}
            </div>
          ))}
        </div>
      )}
      {tab === "series" && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(datos?.series ?? []).map((s) => (
            <div key={s.code} className="rounded-xl border border-line bg-surface p-3.5 text-[13px]">
              <p className="text-[15px] font-semibold text-ink">{s.code}</p>
              <p className="text-muted">{s.doc_type_name}{s.applies_to ? (s.applies_to === "INVOICE" ? " de factura" : " de boleta") : ""}</p>
              <p className="mt-1 text-ink">Último: {s.ultimo ?? "ninguno"}</p>
            </div>
          ))}
        </div>
      )}
      {abierto && <DetalleComprobante key={abierto} id={abierto} puede={puede} emisor={Boolean(datos?.emisor)} onClose={() => setAbierto(null)} onCambio={cargar} />}
    </div>
  );
}

function DetalleComprobante({ id, puede, emisor, onClose, onCambio }: { id: string; puede: boolean; emisor: boolean; onClose: () => void; onCambio: () => void }) {
  const [c, setC] = useState<Detalle | null>(null);
  const [nota, setNota] = useState<{ amount: string; reason: string } | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const cargar = useCallback(() => {
    apiConsola<Detalle>(`/facturacion/${id}`).then(setC).catch((e) => toast.error(mensajeDe(e)));
  }, [id]);
  useEffect(() => cargar(), [cargar]);

  async function accion(ruta: string, aviso: string, metodo: "POST" | "DELETE" = "POST", body?: object) {
    setEnviando(true);
    try {
      await apiConsola(`/facturacion/${id}${ruta}`, { method: metodo, body });
      toast.ok(aviso);
      onCambio();
      if (metodo === "DELETE") onClose();
      else cargar();
      return true;
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
      return false;
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={c ? (c.number ?? `${c.doc_type_name} en borrador`) : "Comprobante"}
      description={c ? <span className="inline-flex flex-wrap items-center gap-2"><Badge tone={estadoTono(c)} dot>{estadoTexto(c)}</Badge>
        {c.status === "ISSUED" && <span>{c.sunat_status_name}</span>}{c.original && <span>de {c.original}</span>}</span> : undefined}>
      {!c ? <p className="text-muted">Cargando…</p> : (
        <div className="grid gap-5 text-[13.5px]">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-muted">Cliente</dt><dd className="text-ink">{c.customer_name}<br />{c.customer_doc_type} {c.customer_doc_number}</dd></div>
            <div><dt className="text-muted">Período</dt><dd className="text-ink">{c.period ?? "—"}</dd></div>
            <div><dt className="text-muted">Emitido</dt><dd className="text-ink">{c.issue_date ? fecha(c.issue_date) : "—"}</dd></div>
            <div><dt className="text-muted">Vence</dt><dd className={c.vencido ? "font-semibold text-bad" : "text-ink"}>{c.due_date ? fecha(c.due_date) : "—"}</dd></div>
            {c.reason && <div className="sm:col-span-2"><dt className="text-muted">Motivo</dt><dd className="text-ink">{c.reason}</dd></div>}
          </dl>
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11.5px] text-muted uppercase"><tr><th className="py-1">Detalle</th><th className="py-1 text-right">Subtotal</th><th className="py-1 text-right">IGV</th><th className="py-1 text-right">Total</th></tr></thead>
            <tbody>{c.lineas.map((l, i) => <tr key={i} className="border-t border-line"><td className="py-1.5 pr-2">{l.description}</td><td className="text-right">{soles(l.subtotal)}</td><td className="text-right">{soles(l.igv)}</td><td className="text-right">{soles(l.total)}</td></tr>)}</tbody>
            <tfoot><tr className="border-t border-line font-semibold"><td className="py-1.5">Total</td><td className="text-right">{soles(c.subtotal)}</td><td className="text-right">{soles(c.igv)}</td><td className="text-right">{soles(c.total)}</td></tr></tfoot>
          </table>
          {c.doc_type !== "CREDIT_NOTE" && c.status === "ISSUED" && (
            <div className="flex flex-wrap gap-2"><Badge>Cobrado {soles(c.pagado)}</Badge><Badge>Notas de crédito {soles(c.acreditado)}</Badge><Badge tone={c.saldo > 0 ? "warn" : "ok"}>Saldo {soles(c.saldo)}</Badge></div>
          )}
          {puede && (
            <div className="flex flex-wrap gap-2">
              {c.status === "DRAFT" && <Button variant="primary" icon={Send} disabled={!emisor || enviando} onClick={() => accion("/emitir", "Comprobante emitido")}>Emitir</Button>}
              {c.status === "DRAFT" && <Button variant="ghost" icon={Trash2} disabled={enviando} onClick={async () => {
                if (await confirmAction({ title: "¿Borrar este borrador?", confirmLabel: "Borrar", danger: true })) accion("", "Borrador borrado", "DELETE");
              }}>Borrar borrador</Button>}
              {c.status === "ISSUED" && c.doc_type !== "CREDIT_NOTE" && c.saldo > 0 && <Button icon={CreditCard} disabled={enviando} onClick={() => accion("/cobrar", "Cobro enviado a la pasarela")}>Cobrar ahora</Button>}
              {c.status === "ISSUED" && c.doc_type !== "CREDIT_NOTE" && c.acreditado < c.total && <Button variant="ghost" icon={FileMinus} onClick={() => setNota({ amount: "", reason: "" })}>Nota de crédito</Button>}
            </div>
          )}
          {nota && (
            <form className="grid gap-3 rounded-xl border border-line p-3.5" onSubmit={async (e) => {
              e.preventDefault();
              if (await accion("/nota-credito", "Nota de crédito emitida", "POST", { amount: Number(nota.amount), reason: nota.reason })) setNota(null);
            }}>
              <p className="flex items-center gap-2 font-semibold text-ink"><FilePlus2 size={15} aria-hidden="true" />Nota de crédito (monto con IGV)</p>
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <Field label="Monto" error={errores.amount}><Input type="number" step="0.01" min={0.01} max={c.total - c.acreditado} value={nota.amount} onChange={(e) => setNota({ ...nota, amount: e.target.value })} /></Field>
                <Field label="Motivo" error={errores.reason}><Input value={nota.reason} maxLength={300} onChange={(e) => setNota({ ...nota, reason: e.target.value })} /></Field>
              </div>
              <div className="flex gap-2"><Button type="submit" variant="primary" loading={enviando}>Emitir nota</Button><Button onClick={() => setNota(null)}>Cancelar</Button></div>
            </form>
          )}
          {c.cobros.length > 0 && (
            <div className="grid gap-1.5">
              <p className="font-semibold text-ink">Cobros</p>
              {c.cobros.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px]">
                  <Badge tone={p.status === "APPROVED" ? "ok" : p.status === "DECLINED" ? "bad" : "neutral"}>{p.status === "APPROVED" ? "Aprobado" : p.status === "DECLINED" ? "Rechazado" : "Esperando"}</Badge>
                  <span>{soles(p.amount)}</span><span className="text-muted">{fechaHora(p.created_at)} · ref. {p.gateway_ref}</span>{p.error && <span className="text-bad">{p.error}</span>}
                </div>
              ))}
            </div>
          )}
          {c.notas.length > 0 && (
            <div className="grid gap-1.5"><p className="font-semibold text-ink">Notas de crédito</p>
              {c.notas.map((n) => <p key={n.id} className="text-[12.5px]">{n.number} · {soles(n.total)} · {n.reason}</p>)}</div>
          )}
        </div>
      )}
    </Modal>
  );
}
