"use client";

import { useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Badge, Button, DataTable, DetailList, Input, Modal, PageHeader, Select, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { CANAL, FiltroSelect, Tabla, accion, useAlAbrir, useDatos, useOpcionesEtq } from "@/modulos/etq/comunes";

type Impresion = { id: string; printed_at: string; copies: number; net_weight_kg: string | null; price: string | null; channel: string; barcode: string; printer_code: string | null; source: string;
  reprint_of: string | null; reprint_reason: string | null; production_order_ref: string | null; lot_id: string; template_code: string; template_name: string; format: string; lot_code: string;
  sku: string; variant_name: string; printed_by_name: string | null; establishment_name: string | null; original_printed_at: string | null };
type Detalle = Impresion & { payload_hash: string | null; reprints: Impresion[] };

const ORIGEN: Record<string, string> = { ETQ: "Impresión manual", PRO: "Cierre de orden", ALM: "Almacén", POS: "Caja", PRE: "Preparación" };

/** ETQ-03 Historial de impresiones: quién, cuándo, qué lote y cuántas copias; una reimpresión siempre lleva su motivo (RN-ETQ-04). */
export default function Historial() {
  const { local } = useSesion();
  const op = useOpcionesEtq();
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [reimp, setReimp] = useState("");
  const [loteId, setLoteId] = useState("");
  useAlAbrir((p) => { setLoteId(p.get("lot_id") ?? ""); setReimp(p.get("reprints") ?? ""); });
  const lista = useListado<Impresion>("/v1/etq/impresiones", { orden: "-printed_at", filtros: { desde, hasta, reprints: reimp, lot_id: loteId, site: local } });
  const [ver, setVer] = useState<string | null>(null);
  const columnas: Column<Impresion>[] = [
    { key: "printed_at", header: "Fecha", sortable: true, render: (p) => <span className="whitespace-nowrap">{fechaHora(p.printed_at)}</span> },
    { key: "lot_code", header: "Lote", sortable: true, cardTitle: true, render: (p) => <div><p className="font-mono font-semibold">{p.lot_code}</p><p className="text-[12px] text-muted">{p.variant_name}</p></div> },
    { key: "template_code", header: "Plantilla", hideOnMobile: true, render: (p) => <span title={p.template_name}>{p.template_name}</span> },
    { key: "copies", header: "Copias", align: "right", sortable: true, render: (p) => numero(p.copies) },
    { key: "net_weight_kg", header: "Peso y precio", align: "right", hideOnMobile: true, render: (p) => <span>{kg(p.net_weight_kg)}<span className="block text-[12px] text-muted">{soles(p.price)}</span></span> },
    { key: "printed_by_name", header: "Quién", sortable: true, render: (p) => <span>{p.printed_by_name ?? "—"}<span className="block text-[12px] text-muted">{p.establishment_name ?? ""}{p.printer_code ? ` · ${p.printer_code}` : ""}</span></span> },
    { key: "reprint_of", header: "Tipo", render: (p) => p.reprint_of ? <span><Badge tone="warn">Reimpresión</Badge><span className="mt-0.5 block max-w-[220px] text-[12px] text-muted">{p.reprint_reason}</span></span> : <span className="text-[13px]">{ORIGEN[p.source] ?? p.source}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cada impresión queda con su lote, plantilla, peso, precio, impresora y usuario. Para reimprimir, abre la impresión original e indica el motivo." />
      {loteId && <div className="flex items-center gap-2 text-[13px]"><span>Filtrado por un lote.</span><Button size="sm" variant="ghost" onClick={() => setLoteId("")}>Ver todos</Button></div>}
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(p) => setVer(p.id)} search={{ ...lista.tabla.search, placeholder: "Buscar lote, producto, plantilla o usuario…" }} empty="No hay impresiones con estos filtros."
        toolbar={<>
          <div className="w-full sm:w-[150px]"><Input type="date" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} className="!min-h-9 h-9 py-1.5 text-[13px]" /></div>
          <div className="w-full sm:w-[150px]"><Input type="date" aria-label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} className="!min-h-9 h-9 py-1.5 text-[13px]" /></div>
          <FiltroSelect label="Tipo" value={reimp} onChange={setReimp} options={[{ value: "1", label: "Solo reimpresiones" }]} />
        </>} />
      {ver && <Ficha id={ver} puedeReimprimir={!!op?.can.reprint} impresoras={op?.printers ?? []} onClose={() => setVer(null)} onCambio={lista.recargar} />}
    </div>
  );
}

function Ficha({ id, puedeReimprimir, impresoras, onClose, onCambio }: { id: string; puedeReimprimir: boolean; impresoras: { code: string; name: string }[]; onClose: () => void; onCambio: () => void }) {
  const { datos: p, recargar } = useDatos<Detalle>(`/v1/etq/impresiones/${id}`);
  const [impresora, setImpresora] = useState("");
  const reimprimir = () => p && accion({ title: `¿Reimprimir ${p.copies} etiqueta(s) del lote ${p.lot_code}?`, message: "Sale la misma etiqueta con el mismo peso y precio. El motivo queda en el historial.",
    confirmLabel: "Reimprimir", reason: { label: "Motivo de la reimpresión", min: 5 } },
  (motivo) => api(`/v1/etq/impresiones/${p.reprint_of ?? p.id}/reimprimir`, { method: "POST", body: { reprint_reason: motivo, copies: p.copies, printer_code: impresora || p.printer_code } }),
  "Reimpresión enviada", () => { recargar(); onCambio(); });
  return (
    <Modal open onClose={onClose} size="lg" title={p ? `Impresión del lote ${p.lot_code}` : "Impresión"}
      footer={p && puedeReimprimir ? <><Button variant="ghost" onClick={onClose}>Cerrar</Button><Button variant="primary" icon={RotateCcw} onClick={reimprimir}>Reimprimir</Button></> : undefined}>
      {p && <div className="space-y-4">
        <DetailList items={[
          { label: "Fecha", value: fechaHora(p.printed_at) }, { label: "Quién", value: p.printed_by_name ?? "—" },
          { label: "Lote", value: <Link href={`/m/etq/etq-04?lot=${p.lot_id}`} className="font-mono text-primary hover:underline">{p.lot_code}</Link> }, { label: "Producto", value: `${p.variant_name} (${p.sku})` },
          { label: "Plantilla", value: `${p.template_name} · ${p.format}` }, { label: "Copias", value: numero(p.copies) },
          { label: "Peso neto", value: kg(p.net_weight_kg) }, { label: "Precio", value: soles(p.price) },
          { label: "Canal", value: CANAL[p.channel] ?? p.channel }, { label: "Impresora", value: p.printer_code ?? "—" },
          { label: "Código de barras", value: <span className="font-mono">{p.barcode}</span> }, { label: "Origen", value: ORIGEN[p.source] ?? p.source },
          ...(p.reprint_of ? [{ label: "Reimpresión de", value: fechaHora(p.original_printed_at) }, { label: "Motivo", value: p.reprint_reason ?? "—" }] : []),
        ]} />
        {puedeReimprimir && <div className="max-w-xs"><Select aria-label="Impresora" value={impresora} placeholder="Misma impresora" options={impresoras.map((i) => ({ value: i.code, label: `${i.code} · ${i.name}` }))} onChange={(e) => setImpresora(e.target.value)} /></div>}
        {p.reprints.length > 0 && <div><p className="mb-2 text-[13px] font-medium">Reimpresiones</p>
          <Tabla cabeza={["Fecha", "Copias", "Quién", "Motivo"]} filas={p.reprints.map((r) => [fechaHora(r.printed_at), r.copies, r.printed_by_name ?? "—", r.reprint_reason ?? "—"])} /></div>}
      </div>}
    </Modal>
  );
}
