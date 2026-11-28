"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { apiImagen } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { CANTIDAD, DOC_ID, TIPOS, n, type Ficha } from "./tipos";

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
  "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS",
  "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function hasta999(v: number): string {
  if (v === 0) return "";
  if (v === 100) return "CIEN";
  const c = Math.floor(v / 100);
  const r = v % 100;
  let t = "";
  if (r < 30) t = UNIDADES[r];
  else t = DECENAS[Math.floor(r / 10)] + (r % 10 ? ` Y ${UNIDADES[r % 10]}` : "");
  return [CENTENAS[c], t].filter(Boolean).join(" ");
}

/** Importe en letras como lo pide la representación impresa: «SON: CIENTO VEINTE CON 50/100 SOLES». */
export function enLetras(monto: number): string {
  const entero = Math.floor(Math.abs(monto) + 1e-9);
  const cent = Math.round((Math.abs(monto) - entero) * 100);
  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${hasta999(millones).replace(/UNO$/, "UN")} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${hasta999(miles).replace(/UNO$/, "UN")} MIL`);
  if (resto) partes.push(hasta999(resto));
  const texto = partes.join(" ") || "CERO";
  return `SON: ${texto} CON ${String(cent).padStart(2, "0")}/100 SOLES`;
}

/** Texto del QR (RS 097-2012/SUNAT): RUC | tipo | serie | número | IGV | total | fecha | tipo doc. | número doc. | hash. */
function textoQr(f: Ficha): string {
  const d = f.documento;
  return [f.empresa?.ruc ?? "", f.codigo_sunat ?? "", d.series, String(d.number), n(d.igv).toFixed(2), n(d.total).toFixed(2), d.issue_date, f.doc_id,
    d.customer_doc_number ?? "", d.xml_hash ?? ""].join("|");
}

function Qr({ texto, className }: { texto: string; className: string }) {
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
    <svg viewBox={`0 0 ${lado} ${lado}`} className={className} role="img" aria-label="Código QR del comprobante">
      <rect width={lado} height={lado} className="fill-surface print:fill-white" />
      <path d={d} className="fill-ink print:fill-black" />
    </svg>
  );
}

/** Logo de la marca (si la plantilla lo muestra), pedido con la sesión. */
export function useLogo(marcaId: string | undefined, tiene: boolean) {
  const [logo, setLogo] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!marcaId || !tiene) return;
    let url: string | null = null;
    let vigente = true;
    apiImagen(`/v1/fac/marcas/${marcaId}/logo`).then((u) => {
      url = u;
      if (vigente) setLogo({ id: marcaId, url: u });
    }).catch(() => {});
    return () => { vigente = false; if (url) URL.revokeObjectURL(url); };
  }, [marcaId, tiene]);
  return tiene && logo && logo.id === marcaId ? logo.url : null;
}

function operaciones(f: Ficha) {
  const s = (af: string) => f.lineas.filter((l) => l.igv_affectation === af).reduce((t, l) => t + n(l.subtotal), 0);
  return { gravada: s("10"), exonerada: s("20"), inafecta: s("30") };
}

const TITULO: Record<string, string> = { INVOICE: "FACTURA ELECTRÓNICA", RECEIPT: "BOLETA DE VENTA ELECTRÓNICA", CREDIT_NOTE: "NOTA DE CRÉDITO ELECTRÓNICA", DEBIT_NOTE: "NOTA DE DÉBITO ELECTRÓNICA" };

/**
 * Representación impresa del comprobante (RN-FAC-16): razón social y RUC de la empresa emisora, logo, pie legal y
 * leyendas de la marca, QR y hash. En A4 o en el ancho del ticket térmico de 80 mm.
 */
export function Impreso({ f, formato, logo }: { f: Ficha; formato: "A4" | "80"; logo?: string | null }) {
  const d = f.documento;
  const op = operaciones(f);
  const titulo = TITULO[d.doc_type] ?? TIPOS[d.doc_type];
  const comprador = d.customer_doc_type === "NONE" ? "Sin documento" : `${DOC_ID[d.customer_doc_type] ?? d.customer_doc_type} ${d.customer_doc_number ?? ""}`;
  const color = f.marca?.color ?? undefined;
  const anulado = d.status === "VOIDED";
  const nota = d.doc_type === "CREDIT_NOTE" || d.doc_type === "DEBIT_NOTE";
  const pie = (
    <>
      {f.marca?.leyendas && <p className="font-medium">{f.marca.leyendas}</p>}
      <p>Representación impresa de la {(TIPOS[d.doc_type] ?? "").toLowerCase()} electrónica. Consúltela en www.sunat.gob.pe.</p>
      {f.marca?.pie && <p>{f.marca.pie}</p>}
      <p className="break-all font-mono text-[9.5px]">Hash: {d.xml_hash}</p>
    </>
  );

  if (formato === "80") {
    return (
      <div className="relative mx-auto w-full max-w-[302px] bg-surface p-3 font-mono text-[11px] leading-snug text-ink print:bg-white print:p-0 print:text-black">
        {anulado && <Sello />}
        <div className="text-center">
          {logo && <Logo src={logo} alt={f.marca?.name ?? "Logo"} className="mx-auto mb-1 max-h-14 max-w-[60%] object-contain" />}
          <p className="text-[12px] font-bold">{f.marca?.name ?? d.brand_name}</p>
          <p>{f.empresa?.razon_social}</p>
          <p>RUC {f.empresa?.ruc}</p>
          {f.local?.address && <p>{f.local.address}</p>}
          <p className="mt-1.5 font-bold">{titulo}</p>
          <p className="text-[12px] font-bold">{d.full_number}</p>
        </div>
        <hr className="my-1.5 border-dashed border-line print:border-black" />
        <p>Fecha: {fecha(d.issue_date)}{d.issued_at ? ` ${new Date(d.issued_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" })}` : ""}</p>
        <p>Cliente: {d.customer_name}</p>
        <p>{comprador}</p>
        {d.buyer_address && <p>Dir.: {d.buyer_address}</p>}
        {nota && f.relacionado && <p>Modifica: {f.relacionado.full_number} · {f.motivo ?? d.note_reason_code}</p>}
        <hr className="my-1.5 border-dashed border-line print:border-black" />
        {f.lineas.map((l) => (
          <div key={l.id} className="mb-1">
            <p>{l.description}</p>
            <div className="flex justify-between gap-2"><span>{CANTIDAD(l.qty, l.uom_code)} × {numero(l.unit_price, 2)}</span><span>{numero(l.total, 2)}</span></div>
          </div>
        ))}
        <hr className="my-1.5 border-dashed border-line print:border-black" />
        <Totales f={f} op={op} />
        <p className="mt-1 text-[10px]">{enLetras(n(d.total))}</p>
        <p>Pago: {d.payment_terms === "CREDIT" ? `Crédito, vence ${fecha(d.due_date)}` : "Contado"}</p>
        <Qr texto={textoQr(f)} className="mx-auto my-2 size-28" />
        <div className="space-y-1 text-center text-[10px]">{pie}</div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-[820px] overflow-hidden rounded-lg border border-line bg-surface text-[12px] text-ink print:max-w-none print:rounded-none print:border-0 print:bg-white print:text-black">
      {color && <div className="h-1.5 w-full" style={{ background: color }} aria-hidden="true" />}
      {anulado && <Sello />}
      <div className="space-y-4 p-5 print:p-0 print:pt-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:flex-row">
          <div className="flex min-w-0 items-start gap-3">
            {logo && <Logo src={logo} alt={f.marca?.name ?? "Logo"} className="max-h-16 max-w-[120px] object-contain" />}
            <div className="min-w-0">
              <p className="text-[15px] font-bold">{f.marca?.name ?? d.brand_name}</p>
              <p className="font-medium">{f.empresa?.razon_social}</p>
              {f.empresa?.direccion && <p className="text-muted print:text-black">{f.empresa.direccion}</p>}
              {f.local && <p className="text-muted print:text-black">{f.local.name}{f.local.address ? ` · ${f.local.address}` : ""}</p>}
            </div>
          </div>
          <div className="shrink-0 rounded-lg border-2 px-4 py-3 text-center sm:min-w-[220px] print:min-w-[220px]" style={color ? { borderColor: color } : undefined}>
            <p className="font-semibold">RUC {f.empresa?.ruc}</p>
            <p className="text-[13px] font-bold">{titulo}</p>
            <p className="text-[15px] font-bold">{d.full_number}</p>
          </div>
        </div>

        <div className="grid gap-x-6 gap-y-1 rounded-lg border border-line p-3 sm:grid-cols-2 print:grid-cols-2 print:border-black">
          <Dato label="Adquirente" valor={d.customer_name} />
          <Dato label="Documento" valor={comprador} />
          <Dato label="Dirección" valor={d.buyer_address ?? "—"} />
          <Dato label="Fecha de emisión" valor={fecha(d.issue_date)} />
          <Dato label="Forma de pago" valor={d.payment_terms === "CREDIT" ? `Crédito ${d.credit_days ? `a ${d.credit_days} días` : ""}` : "Contado"} />
          {d.payment_terms === "CREDIT" && <Dato label="Vencimiento" valor={fecha(d.due_date)} />}
          <Dato label="Moneda" valor="Soles (PEN)" />
          {f.pedido && <Dato label="Pedido" valor={f.pedido.number} />}
          {nota && f.relacionado && <Dato label="Documento que modifica" valor={`${TIPOS[f.relacionado.doc_type] ?? ""} ${f.relacionado.full_number}`} />}
          {nota && <Dato label="Motivo" valor={`${d.note_reason_code} · ${f.motivo ?? ""}${d.note_reason && d.note_reason !== f.motivo ? ` · ${d.note_reason}` : ""}`} />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line text-left text-muted print:border-black print:text-black">
                <th className="py-1.5 pr-2 font-semibold">Cant.</th>
                <th className="py-1.5 pr-2 font-semibold">Descripción</th>
                <th className="py-1.5 pr-2 text-right font-semibold">P. unitario</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Valor venta</th>
                <th className="py-1.5 text-right font-semibold">Importe</th>
              </tr>
            </thead>
            <tbody>
              {f.lineas.map((l) => (
                <tr key={l.id} className="border-b border-line/60 align-top print:border-black/40">
                  <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{CANTIDAD(l.qty, l.uom_code)}</td>
                  <td className="py-1.5 pr-2">{l.description}{l.igv_affectation !== "10" && <span className="text-muted print:text-black"> ({l.igv_affectation === "20" ? "exonerado" : "inafecto"})</span>}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{numero(l.unit_price, 2)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{numero(l.subtotal, 2)}</td>
                  <td className="py-1.5 text-right tabular-nums">{numero(l.total, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between print:flex-row">
          <div className="flex min-w-0 items-start gap-3">
            <Qr texto={textoQr(f)} className="size-24 shrink-0" />
            <div className="min-w-0 space-y-1 text-[10.5px] text-muted print:text-black">
              <p className="font-semibold text-ink print:text-black">{enLetras(n(d.total))}</p>
              {pie}
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-[240px] print:w-[240px]"><Totales f={f} op={op} /></div>
        </div>
      </div>
    </div>
  );
}

function Totales({ f, op }: { f: Ficha; op: ReturnType<typeof operaciones> }) {
  const d = f.documento;
  const fila = (t: string, v: number, fuerte = false) => (
    <div className={`flex justify-between gap-3 ${fuerte ? "mt-1 border-t border-line pt-1 text-[13px] font-bold print:border-black" : ""}`}>
      <span>{t}</span><span className="tabular-nums">{soles(v)}</span>
    </div>
  );
  return (
    <div className="space-y-0.5">
      {op.gravada > 0 && fila("Op. gravada", op.gravada)}
      {op.exonerada > 0 && fila("Op. exonerada", op.exonerada)}
      {op.inafecta > 0 && fila("Op. inafecta", op.inafecta)}
      {fila("IGV", n(d.igv))}
      {fila("Total", n(d.total), true)}
    </div>
  );
}

function Logo({ src, alt, className }: { src: string; alt: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- logo de la marca servido por la API (URL local del navegador).
  return <img src={src} alt={alt} className={className} />;
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return <p className="min-w-0"><span className="text-muted print:text-black">{label}: </span><span className="font-medium">{valor}</span></p>;
}

function Sello() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="-rotate-12 rounded-lg border-4 border-bad px-4 py-1 text-[28px] font-black tracking-widest text-bad opacity-30">ANULADO</span>
    </div>
  );
}
