"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FilePlus } from "lucide-react";
import { Alert, Button, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { AlComprobante, ElegirComprobante, Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { type Motivos } from "@/modulos/fac/tipos";

/** FAC-06 Nota de débito: contra una factura o boleta, motivo del catálogo 10 (intereses, aumento de valor, penalidades). */
export default function NotaDebito() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader description="Aumenta el valor de una factura o boleta ya emitida: intereses por mora, aumento de valor o penalidades. La nota toma el mismo cliente." />
      {id ? <Formulario key={id} id={id} /> : <ElegirComprobante ruta="/m/fac/fac-06" vacio="No hay facturas ni boletas vigentes con esa búsqueda." />}
    </div>
  );
}

function Formulario({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useSesion();
  const { datos: m, error, cargando } = useDatos<Motivos>(`/v1/fac/comprobantes/${id}/notas`);
  const [codigo, setCodigo] = useState("");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (cargando) return <Vacio>Cargando el comprobante…</Vacio>;
  if (error || !m) return <Alert tone="bad">{error || "No se encontró el comprobante."}</Alert>;
  const d = m.documento;
  const vigente = d.status === "ISSUED" && d.sunat_status !== "REJECTED" && ["INVOICE", "RECEIPT"].includes(d.doc_type);
  const importe = Math.round(Number(monto || 0) * 100) / 100;
  const listo = vigente && codigo && importe > 0 && motivo.trim().length >= 5 && Boolean(m.serie_nd);

  async function emitir() {
    setEnviando(true);
    try {
      const nota = await api<{ id: string; full_number: string }>(`/v1/fac/comprobantes/${id}/nota-debito`, { method: "POST", body: { reason_code: codigo, reason: motivo.trim(), amount: importe } });
      toast.ok(`Se emitió la nota de débito ${nota.full_number}.`);
      router.push(`/m/fac/fac-04?id=${nota.id}`);
    } catch (e) {
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(`/m/fac/fac-04?id=${id}`)}>Volver al comprobante</Button>
      {!vigente && <Alert tone="bad">{d.full_number} está {d.status === "VOIDED" ? "anulado" : "rechazado por SUNAT"}: no admite notas.</Alert>}
      {!can("fac.credit_note.issue") && <Alert tone="warn">Tu rol no emite notas de débito.</Alert>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-4">
          <Seccion titulo="Comprobante que modifica">
            <p className="text-[13.5px]"><AlComprobante id={d.id}>{d.full_number}</AlComprobante> · {m.tipo} · {d.customer_name}</p>
            <p className="text-[12.5px] text-muted">Total {soles(d.total)} · {d.payment_terms === "CREDIT" ? `crédito, saldo ${soles(d.balance)}` : "contado"}</p>
          </Seccion>
          <Seccion titulo="Motivo (catálogo 10)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Motivo">
                <Select value={codigo} onChange={(e) => { setCodigo(e.target.value); if (!motivo) setMotivo(m.cat10[e.target.value] ?? ""); }} placeholder="Elige el motivo"
                  options={Object.entries(m.cat10).map(([value, label]) => ({ value, label: `${value} · ${label}` }))} />
              </Field>
              <Field label="Monto (con IGV)">
                <Input type="number" inputMode="decimal" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} />
              </Field>
            </div>
          </Seccion>
        </div>
        <Seccion titulo="Nota de débito" className="h-fit">
          <div className="space-y-3">
            <p className="text-[13px] text-muted">Serie: <span className="font-semibold text-ink">{m.serie_nd ?? "sin serie vigente"}</span></p>
            {!m.serie_nd && <Alert tone="bad">No hay serie de nota de débito para esta marca y local. Créala en Series (FAC-10).</Alert>}
            <Field label="Sustento" hint="Sale en la nota y en el XML (al menos 5 letras).">
              <Textarea rows={3} value={motivo} maxLength={255} onChange={(e) => setMotivo(e.target.value)} />
            </Field>
            <div className="flex items-baseline justify-between border-t border-line pt-3"><span className="text-muted">Total de la nota</span><span className="text-[20px] font-bold tabular-nums">{soles(importe)}</span></div>
            <Button variant="primary" icon={FilePlus} className="w-full" disabled={!listo || !can("fac.credit_note.issue")} loading={enviando} onClick={emitir}>Emitir nota de débito</Button>
          </div>
        </Seccion>
      </div>
    </div>
  );
}
