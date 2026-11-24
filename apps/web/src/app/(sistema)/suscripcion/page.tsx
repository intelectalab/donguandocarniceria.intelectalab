"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CreditCard, Printer, RotateCcw, XCircle } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { PasarelaPrueba, type TarjetaTokenizada } from "@/components/suscripcion/PasarelaPrueba";
import { CambiarPlan, Complementos } from "@/components/suscripcion/CambiarPlan";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";

type Uso = { clave: string; nombre: string; usado: number; limite: number | null };
type Medio = { brand: string; last4: string; exp_month: number; exp_year: number; auto_pay: boolean; billing_email: string | null };
type Resumen = {
  sin_suscripcion: boolean; status: string; status_name: string; efecto: string; plan_name: string; plan_version: number | null; plan_description: string | null;
  price_pen: number | null; discount_pct: number; cuota: number | null; igv_rate: number; started_at: string; trial_ends_at: string | null; proximo_cobro: string | null;
  cancel_at_period_end: boolean; cancel_effective_on: string | null; conservacion_hasta: string | null; uso: Uso[]; pedidos_mes: number;
  deuda: { total: number; comprobantes: number; vence: string | null; dias: number }; medio_pago: Medio | null;
  historial: { period: string; users: number; brands: number; sites: number; users_limit: number | null; brands_limit: number | null; sites_limit: number | null }[];
  puede: { facturas: boolean; pagar: boolean; cancelar: boolean; cambiar: boolean }; encuesta: Record<string, string>;
};
type Comprobante = {
  id: string; doc_type: string; doc_type_name: string; number: string; payment_status: string; payment_status_name: string; sunat_status_name: string;
  period: string | null; period_start: string | null; period_end: string | null; issue_date: string; due_date: string | null; vencido: boolean;
  customer_doc_type: string; customer_doc_number: string; customer_name: string; customer_address: string | null; subtotal: number; igv: number; total: number; saldo: number;
  reason: string | null; lineas: { description: string; subtotal: number; igv: number; total: number }[]; cobros: { amount: number; status: string; error: string | null; created_at: string }[];
  notas: { number: string; total: number; reason: string }[]; original: string | null; emisor?: { ruc: string; nombre: string };
};

const TONO_ESTADO: Record<string, Tone> = { TRIAL: "info", ACTIVE: "ok", PAST_DUE: "warn", READ_ONLY: "bad", SUSPENDED: "bad", CANCELLED: "neutral" };
type Tab = "resumen" | "planes" | "complementos" | "comprobantes" | "pago" | "cancelar";

/** Mi suscripción: plan, uso, comprobantes de GestionCarnica, tarjeta y cancelación. */
export default function MiSuscripcion() {
  return <Suspense><Contenido /></Suspense>;
}

function Contenido() {
  const sesion = useSesion();
  const router = useRouter();
  const pedida = useSearchParams().get("tab") as Tab | null;
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    api<Resumen>("/v1/suscripcion").then((x) => { setR(x); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => cargar(), [cargar]);
  const cambiar = () => { cargar(); sesion.recargar(); };

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!r) return <p className="text-muted">Cargando…</p>;
  if (r.sin_suscripcion) return <Alert tone="info" title="Tu empresa opera sin suscripción">No tiene plan, límites ni cobros de GestionCarnica.</Alert>;

  const cambia = r.status !== "CANCELLED";
  const tabs = [{ key: "resumen" as Tab, label: "Plan y uso" }, ...(cambia ? [{ key: "planes" as Tab, label: "Cambiar de plan" }, { key: "complementos" as Tab, label: "Complementos" }] : []), ...(r.puede.facturas ? [{ key: "comprobantes" as Tab, label: "Comprobantes", count: r.deuda.comprobantes || undefined }] : []),
    ...(r.puede.pagar ? [{ key: "pago" as Tab, label: "Medio de pago" }] : []), ...(r.puede.cancelar ? [{ key: "cancelar" as Tab, label: "Cancelar" }] : [])];
  const tab = tabs.some((t) => t.key === pedida) ? pedida! : "resumen";
  const ir = (t: Tab) => router.replace(`/suscripcion?tab=${t}`, { scroll: false });

  return (
    <div className="grid gap-5">
      <PageHeader description="Tu plan de GestionCarnica, lo que usas de él, tus comprobantes y tu medio de pago." />
      <Tabs value={tab} onChange={ir} tabs={tabs} />
      {tab === "resumen" && <PlanYUso r={r} onPagar={() => ir("comprobantes")} />}
      {tab === "planes" && <CambiarPlan puede={r.puede.cambiar} onCambio={cambiar} />}
      {tab === "complementos" && <Complementos puede={r.puede.cambiar} onCambio={cambiar} />}
      {tab === "comprobantes" && <Comprobantes puedePagar={r.puede.pagar} tieneTarjeta={Boolean(r.medio_pago)} onCambio={cambiar} />}
      {tab === "pago" && <MedioDePago medio={r.medio_pago} onCambio={cambiar} />}
      {tab === "cancelar" && <Cancelar r={r} onCambio={cambiar} />}
    </div>
  );
}

function PlanYUso({ r, onPagar }: { r: Resumen; onPagar: () => void }) {
  return (
    <div className="grid gap-5">
      {r.deuda.total > 0 && (
        <Alert tone={r.deuda.dias > 0 ? "bad" : "warn"} title={r.deuda.dias > 0 ? `Tienes un pago vencido hace ${r.deuda.dias} día(s)` : "Tienes un comprobante por pagar"}>
          Debes {soles(r.deuda.total)}{r.deuda.vence ? `; vence el ${fecha(r.deuda.vence)}` : ""}. {r.puede.pagar && <button type="button" onClick={onPagar} className="cursor-pointer font-semibold underline">Pagar ahora</button>}
        </Alert>
      )}
      {r.cancel_at_period_end && r.cancel_effective_on && <Alert tone="warn" title="Pediste cancelar tu suscripción">Se cancela el {fecha(r.cancel_effective_on)}. Hasta entonces sigues operando normal.</Alert>}
      {r.conservacion_hasta && <Alert tone="info" title="Suscripción cancelada">Puedes consultar y exportar tus datos hasta el {fecha(r.conservacion_hasta)}.</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[18px] font-semibold text-ink">Plan {r.plan_name}</p>
            <Badge tone={TONO_ESTADO[r.status] ?? "neutral"} dot>{r.status_name}</Badge>
          </div>
          {r.plan_description && <p className="text-[13.5px] text-muted">{r.plan_description}</p>}
          <p className="text-[13.5px] text-ink">{r.efecto}</p>
          <dl className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2">
            <div><dt className="text-muted">Cuota mensual</dt><dd className="font-semibold text-ink">{r.cuota !== null ? `${soles(r.cuota)} + IGV` : "Por definir"}{r.discount_pct > 0 ? ` (descuento ${r.discount_pct} %)` : ""}</dd></div>
            <div><dt className="text-muted">{r.status === "TRIAL" ? "Fin de la prueba" : "Próximo cobro"}</dt><dd className="text-ink">{r.status === "TRIAL" ? (r.trial_ends_at ? fecha(r.trial_ends_at) : "—") : r.proximo_cobro ? fecha(r.proximo_cobro) : "—"}</dd></div>
            <div><dt className="text-muted">Cliente desde</dt><dd className="text-ink">{fecha(r.started_at)}</dd></div>
            <div><dt className="text-muted">Tarjeta</dt><dd className="text-ink">{r.medio_pago ? `${r.medio_pago.brand} ···· ${r.medio_pago.last4}${r.medio_pago.auto_pay ? " · cobro automático" : ""}` : "Sin registrar"}</dd></div>
          </dl>
        </div>
        <div className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="font-semibold text-ink">Uso del plan</p>
          {r.uso.map((u) => {
            const pct = u.limite ? Math.min(100, Math.round((u.usado / u.limite) * 100)) : 0;
            return (
              <div key={u.clave} className="grid gap-1 text-[13px]">
                <div className="flex justify-between"><span className="text-ink">{u.nombre}</span><span className="text-muted">{u.usado}{u.limite !== null ? ` de ${u.limite} · ${pct} %` : " · sin límite"}</span></div>
                {u.limite !== null && (
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={u.nombre}>
                    <div className={`h-full rounded-full ${pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ok"}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[12.5px] text-muted">Pedidos de este mes: {r.pedidos_mes}. Al llegar a un límite, la alta se rechaza hasta cambiar de plan o contratar más.</p>
        </div>
      </div>
      {r.historial.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <p className="px-4 pt-3 font-semibold text-ink">Uso de los últimos 12 meses</p>
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead className="text-[11.5px] text-muted uppercase"><tr className="border-b border-line">
              <th className="px-4 py-2">Mes</th><th className="px-4 py-2 text-right">Usuarios</th><th className="px-4 py-2 text-right">Marcas</th><th className="px-4 py-2 text-right">Locales</th></tr></thead>
            <tbody>{r.historial.map((h) => (
              <tr key={h.period} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{h.period}</td>
                {(["users", "brands", "sites"] as const).map((k) => {
                  const lim = h[`${k}_limit` as const];
                  return <td key={k} className={`px-4 py-2 text-right ${lim !== null && h[k] >= lim ? "font-semibold text-warn" : ""}`}>{h[k]}{lim !== null ? ` de ${lim}` : ""}</td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Comprobantes({ puedePagar, tieneTarjeta, onCambio }: { puedePagar: boolean; tieneTarjeta: boolean; onCambio: () => void }) {
  const [lista, setLista] = useState<Comprobante[] | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const cargar = useCallback(() => {
    api<{ data: Comprobante[] }>("/v1/suscripcion/comprobantes").then((x) => { setLista(x.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => cargar(), [cargar]);

  const columnas: Column<Comprobante>[] = [
    { key: "number", header: "Comprobante", cardTitle: true, render: (c) => <div><p className="font-semibold text-ink">{c.number}</p><p className="text-[12.5px] text-muted">{c.doc_type_name}{c.period ? ` · ${c.period}` : ""}</p></div> },
    { key: "total", header: "Importe", align: "right", render: (c) => soles(c.total) },
    { key: "payment_status", header: "Pago", render: (c) => c.doc_type === "CREDIT_NOTE" ? <Badge tone="info">Nota de crédito</Badge>
      : <Badge tone={c.payment_status === "PAID" ? "ok" : c.vencido ? "bad" : c.payment_status === "UNPAID" ? "warn" : "neutral"} dot>{c.vencido ? "Vencido" : c.payment_status_name}</Badge> },
    { key: "due_date", header: "Emitido y vence", hideOnMobile: true, render: (c) => <div className="text-[12.5px]"><p>{fecha(c.issue_date)}</p>{c.due_date && <p className="text-muted">Vence {fecha(c.due_date)}</p>}</div> },
    { key: "sunat", header: "SUNAT", hideOnMobile: true, render: (c) => <span className="text-[12.5px] text-muted">{c.sunat_status_name}</span> },
  ];

  return (
    <>
      <DataTable columns={columnas} rows={lista ?? []} loading={!lista && !error} error={error} onRetry={cargar} onRowClick={(c) => setAbierto(c.id)}
        empty="Todavía no hay comprobantes de GestionCarnica." />
      {abierto && <DetalleComprobante key={abierto} id={abierto} puedePagar={puedePagar} tieneTarjeta={tieneTarjeta} onClose={() => setAbierto(null)}
        onPagado={() => { cargar(); onCambio(); }} />}
    </>
  );
}

function DetalleComprobante({ id, puedePagar, tieneTarjeta, onClose, onPagado }: { id: string; puedePagar: boolean; tieneTarjeta: boolean; onClose: () => void; onPagado: () => void }) {
  const [c, setC] = useState<Comprobante | null>(null);
  const [pagando, setPagando] = useState(false);
  useEffect(() => {
    api<Comprobante>(`/v1/suscripcion/comprobantes/${id}`).then(setC).catch((e) => toast.error(mensajeDe(e)));
  }, [id]);

  async function pagar() {
    if (!c || !(await confirmAction({ title: `¿Pagar ${soles(c.saldo)} con tu tarjeta?`, confirmLabel: "Pagar" }))) return;
    setPagando(true);
    try {
      const r = await api<{ status: string; error: string | null; comprobante: Comprobante }>(`/v1/suscripcion/comprobantes/${id}/pagar`, { method: "POST" });
      setC(r.comprobante);
      if (r.status === "APPROVED") toast.ok("Pago aprobado. ¡Gracias!");
      else toast.error(r.error ?? "La pasarela no aprobó el pago");
      onPagado();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setPagando(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={c ? `${c.doc_type_name} ${c.number}` : "Comprobante"}>
      {!c ? <p className="text-muted">Cargando…</p> : (
        <div className="grid gap-4 text-[13.5px]">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-muted">Emitido por</dt><dd className="text-ink">{c.emisor?.nombre} · RUC {c.emisor?.ruc}</dd></div>
            <div><dt className="text-muted">Para</dt><dd className="text-ink">{c.customer_name} · {c.customer_doc_type} {c.customer_doc_number}</dd></div>
            <div><dt className="text-muted">Emitido</dt><dd className="text-ink">{fecha(c.issue_date)}</dd></div>
            <div><dt className="text-muted">Vence</dt><dd className={c.vencido ? "font-semibold text-bad" : "text-ink"}>{c.due_date ? fecha(c.due_date) : "—"}</dd></div>
          </dl>
          <table className="w-full text-left text-[13px]">
            <tbody>{c.lineas.map((l, i) => <tr key={i} className="border-b border-line"><td className="py-1.5 pr-2">{l.description}</td><td className="text-right">{soles(l.subtotal)}</td></tr>)}</tbody>
            <tfoot>
              <tr><td className="pt-2 text-muted">Subtotal</td><td className="pt-2 text-right">{soles(c.subtotal)}</td></tr>
              <tr><td className="text-muted">IGV</td><td className="text-right">{soles(c.igv)}</td></tr>
              <tr className="font-semibold"><td>Total</td><td className="text-right">{soles(c.total)}</td></tr>
            </tfoot>
          </table>
          {c.cobros.length > 0 && <div className="grid gap-1">{c.cobros.map((p, i) => (
            <p key={i} className="text-[12.5px]"><Badge tone={p.status === "APPROVED" ? "ok" : p.status === "DECLINED" ? "bad" : "neutral"}>{p.status === "APPROVED" ? "Pago aprobado" : p.status === "DECLINED" ? "Pago rechazado" : "Esperando"}</Badge>{" "}
              {soles(p.amount)} · {fechaHora(p.created_at)}{p.error ? ` · ${p.error}` : ""}</p>))}</div>}
          <p className="text-[12.5px] text-muted">SUNAT: {c.sunat_status_name}. El XML estará disponible cuando GestionCarnica envíe sus comprobantes al OSE.</p>
          <div className="flex flex-wrap gap-2">
            {c.doc_type !== "CREDIT_NOTE" && c.saldo > 0 && puedePagar && (tieneTarjeta
              ? <Button variant="primary" icon={CreditCard} loading={pagando} onClick={pagar}>Pagar {soles(c.saldo)}</Button>
              : <span className="text-[13px] text-muted">Registra una tarjeta en «Medio de pago» para pagarlo.</span>)}
            <Button icon={Printer} onClick={() => imprimir(c)}>Imprimir o guardar en PDF</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Representación impresa del comprobante en una ventana aparte (Imprimir → Guardar como PDF). */
function imprimir(c: Comprobante) {
  const esc = (t: string | null | undefined) => (t ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const filas = c.lineas.map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${soles(l.subtotal)}</td><td class="n">${soles(l.igv)}</td><td class="n">${soles(l.total)}</td></tr>`).join("");
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return toast.error("El navegador bloqueó la ventana: permite las ventanas emergentes.");
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(c.number)}</title><style>
    body{font-family:Arial,sans-serif;color:#222;margin:32px;font-size:13px} h1{font-size:18px;margin:0} .caja{border:1px solid #333;padding:10px 14px;text-align:center;float:right}
    table{width:100%;border-collapse:collapse;margin-top:18px} th,td{border-bottom:1px solid #ccc;padding:6px;text-align:left} .n{text-align:right} .t td{font-weight:bold;border:0}
    .muted{color:#666} @media print{button{display:none}}</style></head><body>
    <div class="caja"><b>RUC ${esc(c.emisor?.ruc)}</b><br>${esc(c.doc_type_name).toUpperCase()} ELECTRÓNICA<br><b>${esc(c.number)}</b></div>
    <h1>${esc(c.emisor?.nombre)}</h1><p class="muted">GestionCarnica · Intelectalab</p><br style="clear:both">
    <p><b>Cliente:</b> ${esc(c.customer_name)}<br><b>${esc(c.customer_doc_type)}:</b> ${esc(c.customer_doc_number)}<br>${c.customer_address ? `<b>Dirección:</b> ${esc(c.customer_address)}<br>` : ""}
    <b>Emisión:</b> ${fecha(c.issue_date)}${c.due_date ? ` · <b>Vence:</b> ${fecha(c.due_date)}` : ""}${c.original ? `<br><b>Modifica a:</b> ${esc(c.original)} · ${esc(c.reason)}` : ""}</p>
    <table><thead><tr><th>Descripción</th><th class="n">Valor</th><th class="n">IGV</th><th class="n">Importe</th></tr></thead><tbody>${filas}</tbody>
    <tfoot><tr class="t"><td class="n" colspan="3">Total</td><td class="n">${soles(c.total)}</td></tr></tfoot></table>
    <p class="muted">Representación impresa. Estado ante SUNAT: ${esc(c.sunat_status_name)}.</p><button onclick="print()">Imprimir</button></body></html>`);
  w.document.close();
}

function MedioDePago({ medio, onCambio }: { medio: Medio | null; onCambio: () => void }) {
  const [cambiar, setCambiar] = useState(!medio);
  const [guardando, setGuardando] = useState(false);
  const [pref, setPref] = useState({ auto_pay: medio?.auto_pay ?? true, billing_email: medio?.billing_email ?? "" });
  const [errores, setErrores] = useState<Record<string, string>>({});

  async function guardar(t: TarjetaTokenizada, extra: { auto_pay: boolean; billing_email: string }) {
    setGuardando(true);
    try {
      await api("/v1/suscripcion/medio-de-pago", { method: "PUT", body: { ...t, ...extra, billing_email: extra.billing_email || null } });
      toast.ok("Tarjeta guardada");
      setCambiar(false);
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPref(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/v1/suscripcion/medio-de-pago/preferencias", { method: "PUT", body: { ...pref, billing_email: pref.billing_email || null } });
      toast.ok("Preferencias guardadas");
      setErrores({});
      onCambio();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    }
  }

  return (
    <div className="grid max-w-xl gap-4">
      {medio && (
        <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="flex items-center gap-2 font-semibold text-ink"><CreditCard size={18} aria-hidden="true" />{medio.brand} ···· {medio.last4}</p>
          <p className="text-[13px] text-muted">Vence {String(medio.exp_month).padStart(2, "0")}/{medio.exp_year}</p>
          <form onSubmit={guardarPref} className="grid gap-3">
            <Checkbox checked={pref.auto_pay} onChange={(v) => setPref({ ...pref, auto_pay: v })} label="Cobrar automáticamente cada mes" />
            <Field label="Correo para los comprobantes" error={errores.billing_email}><Input type="email" value={pref.billing_email} onChange={(e) => setPref({ ...pref, billing_email: e.target.value })} /></Field>
            <div className="flex gap-2"><Button type="submit">Guardar preferencias</Button>{!cambiar && <Button variant="ghost" onClick={() => setCambiar(true)}>Cambiar tarjeta</Button>}</div>
          </form>
        </div>
      )}
      {cambiar && <PasarelaPrueba correo={medio?.billing_email} guardando={guardando} onTokenizada={guardar} />}
    </div>
  );
}

function Cancelar({ r, onCambio }: { r: Resumen; onCambio: () => void }) {
  const [f, setF] = useState({ survey: "", reason: "", exported: false });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<string | null>(null);

  if (r.status === "CANCELLED") return <Alert tone="info">La suscripción ya está cancelada{r.conservacion_hasta ? `: tus datos se conservan hasta el ${fecha(r.conservacion_hasta)}` : ""}.</Alert>;

  async function deshacer() {
    try {
      await api("/v1/suscripcion/cancelar/deshacer", { method: "POST" });
      toast.ok("Sigues con GestionCarnica");
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  if (r.cancel_at_period_end) {
    return (
      <div className="grid max-w-xl gap-3">
        <Alert tone="warn" title={`Tu suscripción se cancela el ${fecha(r.cancel_effective_on)}`}>Hasta entonces sigues operando normal. Después tus datos quedan en solo lectura para consultarlos y exportarlos.</Alert>
        <Button icon={RotateCcw} className="justify-self-start" onClick={deshacer}>No cancelar, quiero seguir</Button>
      </div>
    );
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!(await confirmAction({ title: "¿Cancelar tu suscripción?", confirmLabel: "Cancelar suscripción", danger: true,
      message: "Se cancela al terminar el período pagado. Puedes deshacerlo antes de esa fecha." }))) return;
    setEnviando(true);
    try {
      const x = await api<Resumen>("/v1/suscripcion/cancelar", { method: "POST", body: f });
      setListo(x.cancel_effective_on);
      onCambio();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  if (listo) return <Alert tone="info" title="Cancelación registrada">Tu suscripción se cancela el {fecha(listo)}.</Alert>;
  return (
    <form onSubmit={enviar} className="grid max-w-xl gap-4">
      <Alert tone="info">Al cancelar sigues operando hasta el fin del período pagado. Luego tus datos quedan en solo lectura y puedes exportarlos durante 90 días; después se borran.</Alert>
      <Field label="¿Por qué te vas?" required error={errores.survey}>
        <Select value={f.survey} onChange={(e) => setF({ ...f, survey: e.target.value })} placeholder="Elige una opción" options={Object.entries(r.encuesta).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field label="Cuéntanos un poco más" required error={errores.reason}><Textarea rows={3} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <Checkbox checked={f.exported} onChange={(v) => setF({ ...f, exported: v })} label="Sé que puedo exportar mis clientes, pedidos y comprobantes desde cada pantalla con «Exportar»." />
      {errores.exported && <p className="text-[12.5px] text-bad">{errores.exported}</p>}
      <Button type="submit" variant="ghost" icon={XCircle} loading={enviando} className="justify-self-start text-bad">Cancelar mi suscripción</Button>
    </form>
  );
}
