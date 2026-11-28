"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, FileCode2, FileMinus, FilePlus, FileCheck2, Printer, RefreshCw, Repeat, Truck } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, PageHeader, StatusBadge, Tabs, buttonClass, confirmAction, toast, type Column } from "@/components/ui";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { AlComprobante, EstadoSunat, Imprimible, Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { Impreso, useLogo } from "@/modulos/fac/Impreso";
import { CANTIDAD, DOC_ID, ESTADO_PEDIDO, ORIGEN, SUNAT, TIPOS, TONO_TIPO, n, type Envio, type Ficha, type Linea } from "@/modulos/fac/tipos";

/** FAC-04 Detalle del comprobante: cabecera, líneas, IGV, adquirente congelado, pedido, cobros, envíos y respuestas. */
export default function Detalle() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  if (!id) {
    return (
      <div className="space-y-4">
        <PageHeader description="Elige un comprobante de la lista para ver su detalle." />
        <Link href="/m/fac/fac-01" className={buttonClass("secondary")}>Ir a comprobantes</Link>
      </div>
    );
  }
  return <Cargado key={id} id={id} />;
}

type Pestana = "impreso" | "datos" | "envios" | "relacionados";

function Cargado({ id }: { id: string }) {
  const router = useRouter();
  const { can, puede } = useSesion();
  const { datos: f, error, cargando, recargar, poner } = useDatos<Ficha>(`/v1/fac/comprobantes/${id}`);
  const [tab, setTab] = useState<Pestana>("impreso");
  const [formato, setFormato] = useState<"A4" | "80">("A4");
  const [ocupado, setOcupado] = useState("");
  const logo = useLogo(f?.marca?.id, Boolean(f?.marca?.logo && f?.marca?.mostrar_logo));

  if (cargando) return <Vacio>Cargando el comprobante…</Vacio>;
  if (error || !f) return <Alert tone="bad">{error || "No se encontró el comprobante."}</Alert>;
  const d = f.documento;
  const esVenta = d.doc_type === "INVOICE" || d.doc_type === "RECEIPT";
  const vigente = d.status === "ISSUED" && d.sunat_status !== "REJECTED";
  const enviable = d.status === "ISSUED" && (d.sunat_status === "PENDING" || d.sunat_status === "REJECTED") && !d.summary_pending && !d.reissued_by;

  async function correr(que: string, fn: () => Promise<void>) {
    setOcupado(que);
    try {
      await fn();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const reenviar = () => correr("reenviar", async () => {
    const r = await api<Ficha>(`/v1/fac/comprobantes/${d.id}/reenviar`, { method: "POST" });
    poner(r);
    const s = r.documento.sunat_status;
    if (s === "ACCEPTED" || s === "OBSERVED") toast.ok(`${d.full_number} aceptado por SUNAT.`);
    else if (s === "REJECTED") toast.error(`SUNAT rechazó ${d.full_number}: ${r.documento.sunat_message ?? ""}`);
    else toast.info(`Sin respuesta del proveedor: queda en la cola para el próximo intento.`);
  });

  const reemitir = () => correr("reemitir", async () => {
    const ok = await confirmAction({ title: `Reemitir ${d.full_number}`, message: "Se emite un comprobante nuevo con otro número y las mismas líneas; este queda como rechazado y los cobros pasan al nuevo.", confirmLabel: "Reemitir" });
    if (!ok) return;
    const r = await api<{ id: string; full_number: string }>(`/v1/fac/comprobantes/${d.id}/reemitir`, { method: "POST" });
    toast.ok(`Se emitió ${r.full_number}.`);
    router.push(`/m/fac/fac-04?id=${r.id}`);
  });

  const anular = () => correr("anular", async () => {
    const enviado = n(d.send_attempts) > 0 || d.sunat_status !== "PENDING";
    const r = await confirmAction({
      title: `Anular ${d.full_number}`, danger: true, confirmLabel: "Anular",
      message: enviado
        ? `Ya se informó a SUNAT: la baja va en la ${d.doc_type === "RECEIPT" ? "resumen diario (RC)" : "comunicación de baja (RA)"} del día. Si el cliente recibió el producto, emite una nota de crédito.`
        : "Aún no se envió a SUNAT: queda anulado sin baja.",
      reason: { label: "Motivo de la anulación", min: 5 },
    });
    if (!r) return;
    await api(`/v1/fac/comprobantes/${d.id}/anular`, { method: "POST", body: { reason: r.reason } });
    toast.ok(`${d.full_number} anulado.`);
    recargar();
  });

  const bajar = (que: "xml" | "cdr") => correr(que, () => apiDescargar(`/v1/fac/comprobantes/${d.id}/${que}`, `${d.full_number}.xml`));

  function imprimir(fmt: "A4" | "80") {
    setFormato(fmt);
    setTimeout(() => window.print(), 50);
  }

  const totalNC = f.notas.filter((x) => x.doc_type === "CREDIT_NOTE" && x.status === "ISSUED" && x.sunat_status !== "REJECTED").reduce((s, x) => s + n(x.total), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/fac/fac-01")}>Comprobantes</Button>
      </div>

      <Seccion className="print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[19px] font-bold text-ink">{d.full_number}</h1>
              <Badge tone={TONO_TIPO[d.doc_type]}>{f.tipo}</Badge>
              <EstadoSunat sunat={d.sunat_status} status={d.status} revision={d.needs_review} />
            </div>
            <p className="text-[13.5px] text-ink">{d.customer_name}</p>
            <p className="text-[12.5px] text-muted">
              {d.brand_name} · {f.local?.name ?? ""} · {fecha(d.issue_date)} · {ORIGEN[d.source ?? ""] ?? "—"}{d.pos_ticket ? ` ${d.pos_ticket}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[22px] font-bold tabular-nums text-ink">{soles(d.total)}</p>
            <p className="text-[12px] text-muted">IGV {soles(d.igv)} · {d.payment_terms === "CREDIT" ? `crédito, vence ${fecha(d.due_date)}` : "contado"}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" icon={Printer} onClick={() => imprimir("A4")}>Imprimir A4</Button>
          <Button size="sm" icon={Printer} onClick={() => imprimir("80")}>Ticket 80 mm</Button>
          <Button size="sm" icon={FileCode2} loading={ocupado === "xml"} onClick={() => bajar("xml")}>XML</Button>
          {["ACCEPTED", "OBSERVED", "VOIDED"].includes(d.sunat_status) && <Button size="sm" icon={FileCheck2} loading={ocupado === "cdr"} onClick={() => bajar("cdr")}>CDR</Button>}
          {enviable && d.sunat_status === "PENDING" && can("fac.document.resend") && <Button size="sm" variant="primary" icon={RefreshCw} loading={ocupado === "reenviar"} onClick={reenviar}>Reenviar a SUNAT</Button>}
          {d.sunat_status === "REJECTED" && !d.reissued_by && can("fac.document.issue") && puede("FAC", "C") && <Button size="sm" variant="primary" icon={Repeat} loading={ocupado === "reemitir"} onClick={reemitir}>Reemitir</Button>}
          {esVenta && vigente && can("fac.credit_note.issue") && <>
            <Link href={`/m/fac/fac-05?id=${d.id}`} className={buttonClass("secondary", "sm")}><FileMinus size={14} aria-hidden="true" />Nota de crédito</Link>
            <Link href={`/m/fac/fac-06?id=${d.id}`} className={buttonClass("secondary", "sm")}><FilePlus size={14} aria-hidden="true" />Nota de débito</Link>
          </>}
          {esVenta && vigente && d.order_id && can("fac.guide.issue") && !f.guias.some((g) => g.status === "ISSUED") &&
            <Link href={`/m/fac/fac-09?pedido=${d.order_id}`} className={buttonClass("secondary", "sm")}><Truck size={14} aria-hidden="true" />Guía de remisión</Link>}
          {d.status === "ISSUED" && d.sunat_status !== "REJECTED" && can("fac.document.void") && <Button size="sm" variant="danger" icon={Ban} loading={ocupado === "anular"} onClick={anular}>Anular</Button>}
        </div>
      </Seccion>

      <div className="space-y-2 print:hidden">
        {d.sunat_status === "REJECTED" && (
          <Alert tone="bad" title={`SUNAT rechazó el comprobante (${d.sunat_code ?? "—"})`}>
            {d.sunat_message} {f.reemitido_por ? <>Se reemitió como <AlComprobante id={f.reemitido_por.id}>{f.reemitido_por.full_number}</AlComprobante>.</> : "Corrige el dato y reemítelo: el número rechazado no se reutiliza."}
          </Alert>
        )}
        {d.sunat_status === "OBSERVED" && <Alert tone="info" title="Aceptado con observaciones">{d.sunat_message}</Alert>}
        {d.needs_review && d.sunat_status === "PENDING" && <Alert tone="bad" title="Llegó al máximo de intentos">El proveedor no respondió. Revisa la conexión en la cola de envío y reenvíalo a mano.</Alert>}
        {d.sunat_status === "PENDING" && !d.needs_review && !d.summary_pending && n(d.send_attempts) > 0 && d.next_retry_at && (
          <Alert tone="warn">Sin respuesta del proveedor. Próximo intento automático: {fechaHora(d.next_retry_at)} (intento {numero(n(d.send_attempts) + 1)}).</Alert>
        )}
        {d.summary_pending && d.sunat_status === "PENDING" && <Alert tone="info">Esta boleta se informa a SUNAT en el resumen diario. <Link href="/m/fac/fac-08" className="font-medium underline">Ver resúmenes</Link></Alert>}
        {d.status === "VOIDED" && <Alert tone="warn" title="Comprobante anulado">{d.void_reason} · {fechaHora(d.voided_at)}</Alert>}
        {f.reemite_a && <Alert tone="info">Reemite el comprobante rechazado <AlComprobante id={f.reemite_a.id}>{f.reemite_a.full_number}</AlComprobante>.</Alert>}
      </div>

      <div className="print:hidden">
        <Tabs<Pestana> value={tab} onChange={setTab} tabs={[
          { key: "impreso", label: "Representación impresa" }, { key: "datos", label: "Datos y cobros" },
          { key: "envios", label: "Envíos", count: f.envios.length }, { key: "relacionados", label: "Notas y guías", count: f.notas.length + f.guias.length + (f.relacionado ? 1 : 0) },
        ]} />
      </div>

      <div className="print:hidden">
        {tab === "impreso" && (
          <div className="space-y-3">
            <div className="flex gap-1">
              <Button size="sm" variant={formato === "A4" ? "primary" : "secondary"} onClick={() => setFormato("A4")}>A4</Button>
              <Button size="sm" variant={formato === "80" ? "primary" : "secondary"} onClick={() => setFormato("80")}>80 mm</Button>
            </div>
            <div className={formato === "80" ? "rounded-xl border border-line bg-surface py-3" : ""}><Impreso f={f} formato={formato} logo={logo} /></div>
          </div>
        )}
        {tab === "datos" && <Datos f={f} totalNC={totalNC} />}
        {tab === "envios" && <Envios envios={f.envios} />}
        {tab === "relacionados" && <Relacionados f={f} />}
      </div>

      <Imprimible ancho={formato}><Impreso f={f} formato={formato} logo={logo} /></Imprimible>
    </div>
  );
}

function Datos({ f, totalNC }: { f: Ficha; totalNC: number }) {
  const d = f.documento;
  const columnas: Column<Linea>[] = [
    { key: "description", header: "Descripción", cardTitle: true, render: (l) => <div><div>{l.description}</div><div className="text-[12px] text-muted">{[l.sku, l.lot ? `lote ${l.lot}` : null].filter(Boolean).join(" · ") || "—"}</div></div> },
    { key: "qty", header: "Cantidad", align: "right", render: (l) => CANTIDAD(l.qty, l.uom_code) },
    { key: "unit_price", header: "P. unit.", align: "right", render: (l) => soles(l.unit_price) },
    { key: "igv_affectation", header: "IGV", hideOnMobile: true, render: (l) => (l.igv_affectation === "10" ? `Gravado ${soles(l.igv)}` : l.igv_affectation === "20" ? "Exonerado" : "Inafecto") },
    { key: "total", header: "Importe", align: "right", render: (l) => soles(l.total) },
  ];
  const acred = f.acreditado_por_linea ?? {};
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Seccion titulo="Adquirente (congelado al emitir)">
        <DetailList items={[
          { label: "Nombre o razón social", value: d.customer_name },
          { label: "Documento", value: d.customer_doc_type === "NONE" ? "Sin documento" : `${DOC_ID[d.customer_doc_type] ?? d.customer_doc_type} ${d.customer_doc_number ?? ""}` },
          { label: "Dirección", value: d.buyer_address ?? "—" },
        ]} />
      </Seccion>
      <Seccion titulo="Comprobante">
        <DetailList items={[
          { label: "Serie y número", value: d.full_number },
          { label: "Emisión", value: fechaHora(d.issued_at) },
          { label: "Forma de pago", value: d.payment_terms === "CREDIT" ? `Crédito ${d.credit_days ?? ""} días · vence ${fecha(d.due_date)}` : "Contado" },
          { label: "Saldo por cobrar", value: soles(d.balance) },
          { label: "Emitió", value: d.issued_by_name ?? f.seller ?? "—" },
          { label: "Hash", value: <span className="break-all font-mono text-[12px]">{d.xml_hash}</span> },
        ]} />
      </Seccion>
      <Seccion titulo="Líneas" className="lg:col-span-2">
        <DataTable rows={f.lineas} columns={columnas} empty="Sin líneas." />
        <div className="mt-3 ml-auto max-w-xs space-y-1 text-[13.5px]">
          <div className="flex justify-between"><span className="text-muted">Valor de venta</span><span className="tabular-nums">{soles(d.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted">IGV</span><span className="tabular-nums">{soles(d.igv)}</span></div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{soles(d.total)}</span></div>
          {totalNC > 0 && <div className="flex justify-between text-bad"><span>Notas de crédito</span><span className="tabular-nums">−{soles(totalNC)}</span></div>}
          {Object.keys(acred).length > 0 && <p className="text-[12px] text-muted">Hay líneas con devoluciones o notas por ítem.</p>}
        </div>
      </Seccion>
      <Seccion titulo="Pedido">
        {f.pedido ? (
          <DetailList items={[
            { label: "Pedido", value: f.pedido.number },
            { label: "Estado", value: <StatusBadge status={f.pedido.status} labels={ESTADO_PEDIDO} /> },
            { label: "Entrega", value: fecha(f.pedido.delivery_date) },
          ]} />
        ) : <Vacio>Sin pedido: {d.source === "POS" ? "venta del mostrador." : "emisión directa."}</Vacio>}
      </Seccion>
      <Seccion titulo="Cobros aplicados">
        {f.cobros.length ? (
          <ul className="divide-y divide-line text-[13.5px]">
            {f.cobros.map((c) => (
              <li key={c.id + c.amount} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0"><p className="font-medium">{c.number} · {c.medio ?? "—"}</p><p className="text-[12px] text-muted">{fechaHora(c.paid_at)}{c.reference ? ` · ${c.reference}` : ""}</p></div>
                <span className="shrink-0 tabular-nums">{soles(c.amount)}</span>
              </li>
            ))}
          </ul>
        ) : <Vacio>Sin cobros registrados.</Vacio>}
      </Seccion>
    </div>
  );
}

const RESULTADO: Record<string, [string, "ok" | "bad" | "warn" | "info" | "neutral"]> = {
  ACCEPTED: ["Aceptado", "ok"], OBSERVED: ["Observado", "info"], REJECTED: ["Rechazado", "bad"], ERROR: ["Sin respuesta", "warn"], TIMEOUT: ["Sin respuesta", "warn"], SENT: ["Enviado", "info"],
};

function Envios({ envios }: { envios: Envio[] }) {
  const columnas: Column<Envio>[] = [
    { key: "attempt_no", header: "Intento", cardTitle: true, render: (e) => <span className="font-medium">#{Number(e.attempt_no)}{e.manual ? " · manual" : ""}</span> },
    { key: "requested_at", header: "Fecha", render: (e) => fechaHora(e.requested_at) },
    { key: "result", header: "Resultado", render: (e) => <StatusBadge status={e.result} labels={RESULTADO} /> },
    { key: "message", header: "Respuesta", render: (e) => <span className="text-[13px]">{e.response_code ? `${e.response_code} · ` : ""}{e.message}</span> },
    { key: "requested_by_name", header: "Quién", hideOnMobile: true, render: (e) => e.requested_by_name ?? "Automático" },
  ];
  return <DataTable rows={envios} columns={columnas} rowKey={(e) => String(e.attempt_no) + e.requested_at} empty="Aún no se envió." />;
}

function Relacionados({ f }: { f: Ficha }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {f.relacionado && (
        <Seccion titulo="Documento que modifica">
          <p className="text-[13.5px]"><AlComprobante id={f.relacionado.id}>{f.relacionado.full_number}</AlComprobante> · {TIPOS[f.relacionado.doc_type]} · {soles(f.relacionado.total)}</p>
          <p className="mt-1 text-[12.5px] text-muted">Motivo {f.documento.note_reason_code}: {f.motivo} · {f.documento.note_reason}</p>
          {f.almacen_reingreso && <p className="mt-1 text-[12.5px] text-muted">El producto volvió a {f.almacen_reingreso}.</p>}
        </Seccion>
      )}
      <Seccion titulo="Notas de crédito y débito">
        {f.notas.length ? (
          <ul className="divide-y divide-line text-[13.5px]">
            {f.notas.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0"><AlComprobante id={x.id}>{x.full_number}</AlComprobante> <span className="text-muted">· {TIPOS[x.doc_type]} · {x.note_reason_code} {x.note_reason}</span></div>
                <span className="flex items-center gap-2"><StatusBadge status={x.sunat_status} labels={SUNAT} /><span className="tabular-nums">{soles(x.total)}</span></span>
              </li>
            ))}
          </ul>
        ) : <Vacio>Sin notas.</Vacio>}
        {f.disponible_nc !== undefined && ["INVOICE", "RECEIPT"].includes(f.documento.doc_type) && (
          <p className="mt-2 text-[12.5px] text-muted">Disponible para notas de crédito: {soles(f.disponible_nc)}</p>
        )}
      </Seccion>
      <Seccion titulo="Guías de remisión">
        {f.guias.length ? (
          <ul className="divide-y divide-line text-[13.5px]">
            {f.guias.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/m/fac/fac-09?id=${g.id}`} className="font-medium text-primary hover:underline">{g.full_number}</Link>
                <StatusBadge status={g.status === "VOIDED" ? "VOIDED" : g.sunat_status} labels={SUNAT} />
              </li>
            ))}
          </ul>
        ) : <Vacio>Sin guías.</Vacio>}
      </Seccion>
      {f.resumenes.length > 0 && (
        <Seccion titulo="Resumen diario y bajas">
          <ul className="divide-y divide-line text-[13.5px]">
            {f.resumenes.map((r) => (
              <li key={r.id + r.action} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/m/fac/fac-08?id=${r.id}`} className="font-medium text-primary hover:underline">{r.identifier}</Link>
                <span className="text-muted">{r.action === "VOID" ? "Baja" : "Alta"} · {r.status}</span>
              </li>
            ))}
          </ul>
        </Seccion>
      )}
    </div>
  );
}
