"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Printer, X } from "lucide-react";
import { Alert, Button, DetailList, Field, Input, PageHeader, Select, StatusBadge, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BuscarLote, CANAL, ESTADO_LOTE, Seccion, VistaEtiqueta, useAlAbrir, useOpcionesEtq, type Lote, type Num } from "@/modulos/etq/comunes";

type Previa = { text: string; format: string; width_mm: number; height_mm: number; includes_qr: boolean; net_weight_kg: Num; price_per_kg: Num; price: Num; barcode: string; qr_url: string | null;
  lot: { id: string; code: string; qc_status: string; expiry_date: string | null }; variant: { sku: string; name: string; sale_mode: string; nominal_weight_kg: Num; product_name: string; brand_name: string };
  block: { code: string; msg: string } | null };
type Elegido = Pick<Lote, "code"> & Partial<Lote>;

const PESA = ["KG", "UNIT_VARIABLE_WEIGHT"];

/** ETQ-02 Impresión de etiquetas: lote, plantilla, peso real, copias e impresora; un lote retenido, retirado o sin registro sanitario vigente no se etiqueta (RN-ETQ-01, RN-ETQ-02). */
export default function Imprimir() {
  const { local, puede } = useSesion();
  const op = useOpcionesEtq();
  const [lote, setLote] = useState<Elegido | null>(null);
  const [f, setF] = useState({ template_id: "", net_weight_kg: "", copies: "1", printer_code: "", channel: "COUNTER" });
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"previa" | "imprimir" | null>(null);
  useAlAbrir((p) => { const c = p.get("lot"); if (c) setLote({ code: c }); });
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setPrevia(null); };
  const plantillas = (op?.templates ?? []).map((t) => ({ value: t.id, label: `${t.name} · ${t.width_mm}×${t.height_mm}` }));
  const impresoras = (op?.printers ?? []).filter((i) => !local || i.establishment_id === local).map((i) => ({ value: i.code, label: `${i.code} · ${i.name}` }));
  const pesa = !lote?.sale_mode || PESA.includes(lote.sale_mode) || PESA.includes(previa?.variant.sale_mode ?? "");
  const cuerpo = () => ({ lot_id: lote?.id ?? null, lot_code: lote?.id ? null : lote?.code, template_id: f.template_id || null, net_weight_kg: f.net_weight_kg ? Number(f.net_weight_kg) : null,
    copies: Number(f.copies) || 1, printer_code: f.printer_code || null, channel: f.channel, establishment_id: local || null });
  const verPrevia = async () => {
    setOcupado("previa"); setError(null);
    try { setPrevia(await api<Previa>("/v1/etq/previa", { method: "POST", body: cuerpo() })); } catch (e) { setPrevia(null); setError(mensajeDe(e)); } finally { setOcupado(null); }
  };
  const imprimir = async () => {
    setOcupado("imprimir"); setError(null);
    try {
      await api("/v1/etq/impresiones", { method: "POST", body: { ...cuerpo(), source: "ETQ" } });
      toast.ok(`${f.copies} etiqueta(s) enviadas a ${f.printer_code || "la impresora"}`);
      setF((x) => ({ ...x, net_weight_kg: "" })); setPrevia(null);
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(null); }
  };
  const puedeImprimir = op?.can.print && puede("ETQ", "C");
  return (
    <div className="space-y-5">
      <PageHeader description="Elige el lote y la plantilla, pesa si el producto se vende por peso y revisa la vista previa antes de imprimir. El precio sale de la lista del canal." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Seccion titulo="Datos de la etiqueta">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lote" required className="sm:col-span-2">
              {lote ? <div className="flex items-center justify-between gap-2 rounded-[9px] border border-line px-3 py-2">
                <span className="min-w-0"><span className="block font-mono font-semibold">{lote.code}</span>{lote.variant_name && <span className="block truncate text-[12px] text-muted">{lote.variant_name} · vence {fecha(lote.expiry_date ?? null)}</span>}</span>
                <span className="flex items-center gap-2">{lote.qc_status && <StatusBadge status={lote.qc_status} labels={ESTADO_LOTE} />}
                  <Button size="sm" variant="ghost" icon={X} aria-label="Cambiar lote" onClick={() => { setLote(null); setPrevia(null); }} /></span>
              </div> : <BuscarLote autoFocus onElegir={(l) => { setLote(l); setPrevia(null); setError(null); }} />}
            </Field>
            <Field label="Plantilla" required className="sm:col-span-2"><Select value={f.template_id} placeholder="Elegir" options={plantillas} onChange={(e) => set("template_id", e.target.value)} /></Field>
            {pesa && <Field label="Peso neto" required={lote?.sale_mode ? PESA.includes(lote.sale_mode) : false} hint="Lo que marca la balanza">
              <Input type="number" inputMode="decimal" step="0.001" min="0" value={f.net_weight_kg} suffix="kg" onChange={(e) => set("net_weight_kg", e.target.value)} /></Field>}
            <Field label="Copias"><Input type="number" inputMode="numeric" min="1" max="500" value={f.copies} onChange={(e) => set("copies", e.target.value)} /></Field>
            <Field label="Impresora"><Select value={f.printer_code} placeholder="La del local" options={impresoras} onChange={(e) => set("printer_code", e.target.value)} /></Field>
            <Field label="Canal" hint="Define la lista de precios"><Select value={f.channel} options={(op?.channels ?? ["COUNTER"]).map((c) => ({ value: c, label: CANAL[c] ?? c }))} onChange={(e) => set("channel", e.target.value)} /></Field>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button icon={Eye} disabled={!lote || !f.template_id} loading={ocupado === "previa"} onClick={verPrevia}>Vista previa</Button>
            {puedeImprimir && <Button variant="primary" icon={Printer} disabled={!previa || !!previa.block} loading={ocupado === "imprimir"} onClick={imprimir}>Imprimir</Button>}
          </div>
        </Seccion>
        <Seccion titulo="Vista previa">
          {error && <Alert tone="bad">{error}</Alert>}
          {!previa && !error && <p className="text-[13px] text-muted">Elige el lote y la plantilla y pulsa «Vista previa».</p>}
          {previa && <div className="space-y-4">
            {previa.block && <Alert tone="bad" title="Este lote no se etiqueta">{previa.block.msg} {previa.block.code === "RN-ETQ-02" ? <Link href="/m/cal/cal-10" className="underline">Ver registros sanitarios</Link> : null}</Alert>}
            <VistaEtiqueta texto={previa.text} ancho={previa.width_mm} alto={previa.height_mm} qr={previa.includes_qr ? previa.qr_url : null} />
            <DetailList items={[
              { label: "Producto", value: `${previa.variant.product_name} · ${previa.variant.name}` }, { label: "Peso neto", value: kg(previa.net_weight_kg) },
              { label: "Precio por kg", value: previa.price_per_kg ? soles(previa.price_per_kg) : "—" }, { label: "Total", value: soles(previa.price) },
              { label: "Código de barras", value: <span className="font-mono">{previa.barcode}</span> },
              { label: "QR", value: previa.qr_url ? <Link href={`/l/${previa.qr_url.split("/").pop()}`} target="_blank" className="text-primary hover:underline">Ver página pública</Link> : "Sin QR" },
            ]} />
          </div>}
        </Seccion>
      </div>
    </div>
  );
}
