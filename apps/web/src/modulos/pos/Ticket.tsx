"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Mail, MessageCircle, Printer, RefreshCw } from "lucide-react";
import { Alert, Button, Field, Input, StatusBadge, toast } from "@/components/ui";
import { api, apiImagen, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { SUNAT, n, type Comprobante } from "./tipos";

const CODIGO_TIPO: Record<string, string> = { INVOICE: "01", RECEIPT: "03", CREDIT_NOTE: "07" };

/** Texto del QR de la representación impresa: RUC | tipo | serie | número | IGV | total | fecha | doc. cliente | número | hash. */
function textoQr(c: Comprobante): string {
  const d = c.documento;
  const [serie, numeroDoc] = d.full_number.split("-");
  const tipoDoc = d.customer_doc_type === "RUC" ? "6" : d.customer_doc_type === "DNI" ? "1" : "0";
  return [c.empresa?.ruc ?? "", CODIGO_TIPO[d.doc_type] ?? "", serie, numeroDoc, n(d.igv).toFixed(2), n(d.total).toFixed(2), d.issue_date, tipoDoc, d.customer_doc_number ?? "", d.xml_hash ?? ""].join("|");
}

function Qr({ texto }: { texto: string }) {
  const { d, lado } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(texto);
    q.make();
    const m = q.getModuleCount();
    let p = "";
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) if (q.isDark(y, x)) p += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { d: p, lado: m + 4 };
  }, [texto]);
  return (
    <svg viewBox={`0 0 ${lado} ${lado}`} className="mx-auto size-28" role="img" aria-label="Código QR del comprobante">
      <rect width={lado} height={lado} className="fill-surface" />
      <path d={d} className="fill-ink" />
    </svg>
  );
}

const cant = (q: number, uom: string) => (uom === "KGM" ? `${numero(q, 3)} kg` : `${numero(q)} u`);

/**
 * POS-05 Comprobante: boleta o factura con la serie de la caja y el logo de la marca, en el ancho del
 * ticket térmico de 80 mm. Imprime, envía por WhatsApp o por correo y reintenta el envío al OSE.
 */
export function Ticket({ c, onCambio, acciones = true }: { c: Comprobante; onCambio?: (c: Comprobante) => void; acciones?: boolean }) {
  const d = c.documento;
  const [logo, setLogo] = useState<string | null>(null);
  const [correo, setCorreo] = useState(c.cliente?.email ?? "");
  const [celular, setCelular] = useState((c.cliente?.phone ?? "").replace(/\D/g, ""));
  const [enviando, setEnviando] = useState<"" | "correo" | "ose">("");
  const marcaId = c.marca?.id;
  const tieneLogo = Boolean(c.marca?.logo);

  useEffect(() => {
    if (!tieneLogo || !marcaId) return;
    let url: string | null = null;
    let vigente = true;
    apiImagen(`/v1/pos/marcas/${marcaId}/logo`).then((u) => {
      url = u;
      if (vigente) setLogo(u);
    }).catch(() => {});
    return () => { vigente = false; if (url) URL.revokeObjectURL(url); };
  }, [marcaId, tieneLogo]);

  const resumen = [
    `${c.tipo} electrónica ${d.full_number} · ${d.brand_name}`,
    ...c.lineas.map((l) => `${l.description}: ${cant(n(l.qty), l.uom_code)} × ${soles(l.unit_price)} = ${soles(l.total)}`),
    `Total ${soles(d.total)}`,
    c.empresa ? `${c.empresa.razon_social} · RUC ${c.empresa.ruc}` : "",
  ].filter(Boolean).join("\n");
  const numeroWa = celular.length === 9 ? `51${celular}` : celular;
  const enlaceWa = /^\d{11,15}$/.test(numeroWa) ? `https://wa.me/${numeroWa}?text=${encodeURIComponent(resumen)}` : null;

  async function enviarCorreo() {
    setEnviando("correo");
    try {
      await api(`/v1/pos/comprobantes/${d.id}/correo`, { method: "POST", body: { email: correo } });
      toast.ok(`Comprobante enviado a ${correo}.`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando("");
    }
  }

  async function reenviar() {
    setEnviando("ose");
    try {
      const r = await api<Comprobante>(`/v1/pos/comprobantes/${d.id}/reenviar`, { method: "POST" });
      onCambio?.(r);
      toast[r.documento.sunat_status === "ACCEPTED" ? "ok" : "info"](r.documento.sunat_status === "ACCEPTED" ? "El OSE aceptó el comprobante." : "El OSE sigue sin responder: queda en la cola de reintento.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando("");
    }
  }

  const esNota = d.doc_type === "CREDIT_NOTE";
  return (
    <div className="space-y-4">
      <article className="ticket-80 mx-auto break-after-page w-full max-w-[320px] rounded-lg border border-line bg-surface p-4 font-mono text-[11.5px] leading-snug text-ink shadow-card">
        <header className="space-y-1 text-center">
          {logo
            // eslint-disable-next-line @next/next/no-img-element -- logo de la marca servido por la API (URL local del navegador).
            ? <img src={logo} alt={c.marca?.name ?? ""} className="mx-auto max-h-14 max-w-[60%] object-contain" />
            : <div className="text-[15px] font-bold" style={c.marca?.color ? { color: c.marca.color } : undefined}>{c.marca?.name ?? d.brand_name}</div>}
          {c.empresa && <div className="font-semibold">{c.empresa.razon_social}</div>}
          {c.empresa && <div>RUC {c.empresa.ruc}</div>}
          {c.local?.address && <div>{c.local.address}</div>}
          <div className="pt-1 text-[13px] font-bold uppercase">{c.tipo} electrónica</div>
          <div className="text-[13px] font-bold">{d.full_number}</div>
        </header>
        <hr className="my-2 border-dashed border-line" />
        <div className="space-y-0.5">
          <div>Fecha: {fechaHora(d.issued_at)}</div>
          <div>Cliente: {d.customer_name}</div>
          {d.customer_doc_number && <div>{d.customer_doc_type}: {d.customer_doc_number}</div>}
          {d.buyer_address && <div>Dirección: {d.buyer_address}</div>}
          {c.caja && <div>Caja: {c.caja.name}{c.turno ? ` · ${c.turno.number}` : ""}</div>}
          {c.turno && <div>Atendió: {c.turno.cashier_name}</div>}
          {d.pos_ticket && <div>Ticket: {d.pos_ticket}</div>}
          {esNota && c.relacionado && <div>Modifica: {c.relacionado.full_number}</div>}
          {esNota && d.note_reason && <div>Motivo: {d.note_reason}</div>}
        </div>
        <hr className="my-2 border-dashed border-line" />
        <table className="w-full">
          <tbody>
            {c.lineas.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="pb-1">
                  <div>{l.description}</div>
                  <div className="text-muted">{cant(n(l.qty), l.uom_code)} × {numero(l.unit_price, 2)}</div>
                </td>
                <td className="pb-1 text-right whitespace-nowrap">{numero(l.total, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr className="my-2 border-dashed border-line" />
        <div className="space-y-0.5">
          <div className="flex justify-between"><span>Op. gravada</span><span>{soles(d.subtotal)}</span></div>
          <div className="flex justify-between"><span>IGV 18 %</span><span>{soles(d.igv)}</span></div>
          <div className="flex justify-between text-[13px] font-bold"><span>Total</span><span>{soles(d.total)}</span></div>
          {c.cobros.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>{p.medio}{p.reference ? ` · op. ${p.reference}` : ""}{p.card_last4 ? ` · ****${p.card_last4}` : ""}</span>
              <span>{soles(p.cash_given ?? p.amount)}</span>
            </div>
          ))}
          {c.cobros.filter((p) => n(p.change_given) > 0).map((p) => <div key={`v-${p.id}`} className="flex justify-between"><span>Vuelto</span><span>{soles(p.change_given)}</span></div>)}
          {c.saldo_a_favor > 0 && <div className="flex justify-between"><span>Saldo a favor usado</span><span>{soles(c.saldo_a_favor)}</span></div>}
        </div>
        <hr className="my-2 border-dashed border-line" />
        <Qr texto={textoQr(c)} />
        {d.xml_hash && <div className="mt-1 text-center break-all text-muted">Hash: {d.xml_hash}</div>}
        {c.marca?.leyendas && <div className="mt-2 text-center whitespace-pre-line">{c.marca.leyendas}</div>}
        {c.marca?.pie && <div className="mt-2 text-center text-[10.5px] text-muted">{c.marca.pie}</div>}
        {d.sunat_status === "PENDING" && <div className="mt-2 text-center text-[10.5px]">Comprobante en envío al OSE.</div>}
      </article>

      {acciones && (
        <div className="mx-auto max-w-[420px] space-y-3 print:hidden">
          <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px] text-muted">
            Estado SUNAT: <StatusBadge status={d.sunat_status} labels={SUNAT} />
            {d.sunat_status === "PENDING" && <span>· intento {numero(d.send_attempts)}{d.next_retry_at ? `, próximo ${fechaHora(d.next_retry_at)}` : ""}</span>}
          </div>
          {d.needs_review && <Alert tone="bad">El OSE no aceptó el comprobante después de varios intentos: revísalo con administración.</Alert>}
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={Printer} onClick={() => window.print()}>Imprimir ticket</Button>
            {d.sunat_status === "PENDING" && <Button icon={RefreshCw} loading={enviando === "ose"} onClick={reenviar}>Reintentar envío</Button>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-end gap-2">
              <Field label="Celular" className="flex-1"><Input inputMode="tel" value={celular} maxLength={15} onChange={(e) => setCelular(e.target.value.replace(/\D/g, ""))} placeholder="9 dígitos" /></Field>
              {enlaceWa
                ? <a href={enlaceWa} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 text-[13.5px] text-ink hover:bg-surface-2"><MessageCircle size={16} />WhatsApp</a>
                : <Button icon={MessageCircle} disabled>WhatsApp</Button>}
            </div>
            <div className="flex items-end gap-2">
              <Field label="Correo" className="flex-1"><Input type="email" value={correo} maxLength={160} onChange={(e) => setCorreo(e.target.value)} /></Field>
              <Button icon={Mail} loading={enviando === "correo"} disabled={!/^\S+@\S+\.\S+$/.test(correo)} onClick={enviarCorreo}>Enviar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const IMPRESION = `@media print {
  @page { size: 80mm auto; margin: 3mm; }
  body * { visibility: hidden !important; }
  .zona-tickets, .zona-tickets * { visibility: visible !important; }
  .zona-tickets { position: absolute; left: 0; top: 0; width: 74mm; }
  .ticket-80 { max-width: none !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
}`;

/** Los comprobantes de un ticket (uno por marca), listos para imprimir en 80 mm. */
export function Tickets({ lista, onCambio }: { lista: Comprobante[]; onCambio?: (c: Comprobante) => void }) {
  return (
    <div className="zona-tickets space-y-6">
      <style>{IMPRESION}</style>
      {lista.map((c) => <Ticket key={c.documento.id} c={c} onCambio={onCambio} />)}
    </div>
  );
}
