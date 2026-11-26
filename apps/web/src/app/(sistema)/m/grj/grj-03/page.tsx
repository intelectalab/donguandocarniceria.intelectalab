"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertOctagon, Copy, PackageOpen, Scale, Truck, Upload } from "lucide-react";
import { Badge, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, kg, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { CifraLink, DOC_GRANJA, ENVIO, FiltroSelect, limpio, useDatos, useOpcionesGrj, type Num } from "@/modulos/grj/comunes";

type Fila = { id: string; farm_document_type: string; farm_document_number: string; dispatched_at: string; expected_doc_type: string; total_sent_kg: Num; total_value: Num; status: string;
  error_message: string | null; source: string; arrived_at: string; received_at: string | null; duplicates_received: number; was_disputed: boolean; receipt_number: string | null;
  document_label: string | null; line_count: number; received_kg: Num };
type Cifras = { pending: number; disputed: number; errors: number; month: number; month_kg: Num; duplicates: number };

/** GRJ-03 Envíos de la granja: lo que llega por el conector o por carga manual, con el documento, los kg y el valor enviados. */
export default function Envios() {
  const router = useRouter();
  const op = useOpcionesGrj();
  const [estado, setEstado] = useState("");
  const [origen, setOrigen] = useState("");
  const lista = useListado<Fila>("/v1/grj/envios", { orden: "-dispatched_at", filtros: { status: estado, source: origen } });
  const c = useDatos<Cifras>("/v1/grj/cifras/03");
  const [manual, setManual] = useState(false);
  const columnas: Column<Fila>[] = [
    { key: "farm_document_number", header: "Documento", sortable: true, cardTitle: true, render: (f) => <div><p className="font-mono font-semibold">{f.farm_document_number}</p><p className="text-[12px] text-muted">{DOC_GRANJA[f.farm_document_type] ?? f.farm_document_type}{f.farm_document_type !== f.expected_doc_type ? ` · se esperaba ${DOC_GRANJA[f.expected_doc_type] ?? f.expected_doc_type}` : ""}</p></div> },
    { key: "dispatched_at", header: "Despachado", sortable: true, render: (f) => fechaHora(f.dispatched_at) },
    { key: "total_sent_kg", header: "Kg enviados", sortable: true, align: "right", render: (f) => <span>{kg(f.total_sent_kg)}{f.received_at && <span className="block text-[12px] text-muted">recibidos {kg(f.received_kg)}</span>}</span> },
    { key: "total_value", header: "Valor", align: "right", render: (f) => soles(f.total_value) },
    { key: "source", header: "Llegó por", hideOnMobile: true, render: (f) => <span>{f.source === "WEBHOOK" ? "Conector" : "Carga manual"}{f.duplicates_received > 0 && <Badge tone="neutral">{f.duplicates_received} repetido(s)</Badge>}</span> },
    { key: "document_label", header: "Comprobante y recepción", hideOnMobile: true, render: (f) => <span className="text-[12.5px]">{f.document_label ?? "—"}{f.receipt_number && <span className="block text-muted">{f.receipt_number}</span>}</span> },
    { key: "status", header: "Estado", render: (f) => <div><StatusBadge status={f.status} labels={ENVIO} />{f.error_message && <p className="max-w-[260px] text-[12px] text-bad">{limpio(f.error_message)}</p>}</div> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cada envío de la granja llega una sola vez aunque el conector lo repita. Al llegar se crea su comprobante (NTI sin IGV o factura) y queda por recibir en el almacén; si un ítem no está mapeado, queda detenido."
        actions={op?.can.receive && <Button variant="primary" icon={Upload} onClick={() => setManual(true)}>Cargar envío a mano</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Por recibir" valor={c.datos ? numero(c.datos.pending) : undefined} icono={PackageOpen} onClick={() => setEstado("RECEIVED_PENDING")} />
        <CifraLink titulo="En disputa" valor={c.datos ? numero(c.datos.disputed) : undefined} icono={Scale} tono={c.datos?.disputed ? "bad" : "ok"} onClick={() => setEstado("DISPUTED")} />
        <CifraLink titulo="Con error" valor={c.datos ? numero(c.datos.errors) : undefined} detalle="Ítem sin mapear u otro problema" icono={AlertOctagon} tono={c.datos?.errors ? "bad" : "ok"} onClick={() => setEstado("ERROR")} />
        <CifraLink titulo="Envíos del mes" valor={c.datos ? numero(c.datos.month) : undefined} detalle={c.datos ? `${kg(c.datos.month_kg)} · ${c.datos.duplicates} repetidos ignorados` : undefined} icono={c.datos?.duplicates ? Copy : Truck} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(f) => router.push(`/m/grj/grj-04?envio=${f.id}`)} search={{ ...lista.tabla.search, placeholder: "Buscar número de documento…" }} empty="No hay envíos con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={Object.entries(ENVIO).map(([value, v]) => ({ value, label: v[0] }))} />
          <FiltroSelect label="Llegó por" value={origen} onChange={setOrigen} options={[{ value: "WEBHOOK", label: "Conector" }, { value: "MANUAL", label: "Carga manual" }]} />
        </>} />
      {manual && <CargaManual onClose={() => setManual(false)} onGuardado={(id) => { setManual(false); lista.recargar(); c.recargar(); router.push(`/m/grj/grj-04?envio=${id}`); }} />}
    </div>
  );
}

function CargaManual({ onClose, onGuardado }: { onClose: () => void; onGuardado: (id: string) => void }) {
  const [f, setF] = useState({ document_type: "NTI", document_number: "", dispatched_at: "", lineas: "" });
  return (
    <Dialogo titulo="Cargar un envío de la granja" boton="Cargar envío" onClose={onClose}
      aviso="Úsalo si el conector falla. Escribe una línea por ítem: código | nombre | lote | unidades | kg | precio por kg. Si el documento ya llegó, no se duplica."
      enviar={async () => {
        const lines = f.lineas.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((c) => c[0]).map(([item_code, item_name, lot_code, qty, weight_kg, unit_price]) => ({
          item_code, item_name: item_name || null, lot_code: lot_code || null, qty: qty ? Number(qty.replace(",", ".")) : null, weight_kg: Number((weight_kg ?? "").replace(",", ".")), unit_price: unit_price ? Number(unit_price.replace(",", ".")) : null }));
        const r = await api<{ duplicate: boolean; dispatch: { id: string } }>("/v1/grj/envios", { method: "POST", body: { document_type: f.document_type, document_number: f.document_number, dispatched_at: f.dispatched_at, source: "MANUAL", lines } });
        toast.ok(r.duplicate ? "Ese envío ya estaba registrado" : "Envío cargado"); onGuardado(r.dispatch.id);
      }}>
      {(e) => <>
        <Field label="Documento" required error={e.document_type}><Select value={f.document_type} onChange={(x) => setF({ ...f, document_type: x.target.value })} options={[{ value: "NTI", label: "NTI" }, { value: "INVOICE", label: "Factura" }]} /></Field>
        <Field label="Número" required error={e.document_number} hint="Por ejemplo NI01-000245"><Input value={f.document_number} maxLength={30} onChange={(x) => setF({ ...f, document_number: x.target.value.toUpperCase() })} /></Field>
        <Field label="Despachado" required error={e.dispatched_at} className="sm:col-span-2"><Input type="datetime-local" value={f.dispatched_at} onChange={(x) => setF({ ...f, dispatched_at: x.target.value })} /></Field>
        <Field label="Líneas" required error={e.lines ?? e["lines.0.weight_kg"] ?? e["lines.0.item_code"]} className="sm:col-span-2">
          <Textarea rows={4} value={f.lineas} placeholder="GR-CUY-CAN | Cuy en canal | GDG-L2640 | 400 | 300 | 24" onChange={(x) => setF({ ...f, lineas: x.target.value })} />
        </Field>
      </>}
    </Dialogo>
  );
}
