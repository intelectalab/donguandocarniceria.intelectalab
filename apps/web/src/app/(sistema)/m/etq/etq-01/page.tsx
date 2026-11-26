"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { CAMPO, FORMATO, FiltroSelect, VistaEtiqueta, olvidarOpcionesEtq, useDatos, useOpcionesEtq, type Opciones } from "@/modulos/etq/comunes";
import { ESTADO_PLANTILLA, opcionesDe } from "@/modulos/pro/tipos";

type Plantilla = { id: string; code: string; name: string; format: string; width_mm: number; height_mm: number; includes_qr: boolean; status: string; brand_id: string; brand_name: string;
  prints: number; last_print: string | null; body?: string; missing?: string[] };

const EJEMPLO: Record<string, string> = {
  product: "Chorizo parrillero · 500 g", brand: "Don Guando", net_weight: "0,500 kg", lot: "CH-2026-0017", production_date: "29/09/2026", expiry_date: "20/10/2026",
  sanitary_registry: "DIGESA-PE-00000", qr: "", price: "S/ 18,00", price_per_kg: "S/ 36,00 / kg", storage: "Mantener refrigerado de 0 °C a 4 °C", allergens: "",
  barcode: "7750000000000", sku: "M3-CHO-500", origin: "", establishment: "Local 1",
};
const llenar = (cuerpo: string) => cuerpo.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => EJEMPLO[k] ?? "");

/** ETQ-01 Plantillas de etiqueta: una por marca y formato, con los campos obligatorios por ley (RN-ETQ-03) y vista previa. */
export default function Plantillas() {
  const op = useOpcionesEtq();
  const [marca, setMarca] = useState("");
  const [estado, setEstado] = useState("");
  const lista = useListado<Plantilla>("/v1/etq/plantillas", { orden: "name", filtros: { brand_id: marca, status: estado } });
  const [editar, setEditar] = useState<string | null | undefined>(undefined);
  const columnas: Column<Plantilla>[] = [
    { key: "name", header: "Plantilla", sortable: true, cardTitle: true, render: (p) => <div><p className="font-medium">{p.name}</p><p className="font-mono text-[12px] text-muted">{p.code}</p></div> },
    { key: "brand_name", header: "Marca", render: (p) => p.brand_name },
    { key: "format", header: "Formato", render: (p) => <span>{FORMATO[p.format] ?? p.format}<span className="block text-[12px] text-muted">{p.width_mm} × {p.height_mm} mm</span></span> },
    { key: "includes_qr", header: "QR", hideOnMobile: true, render: (p) => (p.includes_qr ? "Sí" : "No") },
    { key: "prints", header: "Impresiones", align: "right", hideOnMobile: true, render: (p) => <span>{numero(p.prints)}<span className="block text-[12px] text-muted">{p.last_print ? fechaHora(p.last_print) : "—"}</span></span> },
    { key: "status", header: "Estado", render: (p) => <StatusBadge status={p.status} labels={ESTADO_PLANTILLA} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="El cuerpo usa campos entre llaves, como {{lot}} o {{expiry_date}}. Una plantilla activa debe llevar producto, marca, peso, lote, fechas, registro sanitario y conservación."
        actions={op?.can.manage_templates && <Button variant="primary" icon={Plus} onClick={() => setEditar(null)}>Nueva plantilla</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(p) => setEditar(p.id)} empty="No hay plantillas."
        toolbar={<>{op && <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={op.brands.map((b) => ({ value: b.id, label: b.name }))} />}
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_PLANTILLA)} /></>} />
      {editar !== undefined && op && <Editor id={editar} op={op} onClose={() => setEditar(undefined)} onGuardado={() => { setEditar(undefined); olvidarOpcionesEtq(); lista.recargar(); }} />}
    </div>
  );
}

function Editor({ id, op, onClose, onGuardado }: { id: string | null; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const { datos } = useDatos<Plantilla>(id ? `/v1/etq/plantillas/${id}` : null);
  if (id && !datos) return <Modal open onClose={onClose} title="Plantilla"><p className="text-[13px] text-muted">Cargando…</p></Modal>;
  return <Formulario p={datos ?? null} op={op} onClose={onClose} onGuardado={onGuardado} />;
}

function Formulario({ p, op, onClose, onGuardado }: { p: Plantilla | null; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ code: p?.code ?? "", name: p?.name ?? "", brand_id: p?.brand_id ?? op.brands[0]?.id ?? "", format: p?.format ?? "ZPL", width_mm: String(p?.width_mm ?? 100),
    height_mm: String(p?.height_mm ?? 50), body: p?.body ?? op.required_fields.map((c) => `${CAMPO[c] ?? c}: {{${c}}}`).join("\n"), includes_qr: p?.includes_qr ?? true, status: p?.status ?? "DRAFT" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const usados = new Set([...f.body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
  const faltan = op.required_fields.filter((c) => !usados.has(c));
  const editable = op.can.manage_templates;
  const guardar = async () => {
    setGuardando(true); setErr({});
    try {
      const body = { ...f, width_mm: Number(f.width_mm), height_mm: Number(f.height_mm) };
      await api(p ? `/v1/etq/plantillas/${p.id}` : "/v1/etq/plantillas", { method: p ? "PUT" : "POST", body });
      toast.ok("Plantilla guardada"); onGuardado();
    } catch (e) { setErr(erroresDe(e)); toast.error(mensajeDe(e)); } finally { setGuardando(false); }
  };
  return (
    <Modal open onClose={onClose} size="xl" title={p ? p.name : "Nueva plantilla"}
      footer={editable ? <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={guardar}>Guardar</Button></> : undefined}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre" required error={err.name} className="sm:col-span-2"><Input value={f.name} disabled={!editable} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Código" required error={err.code}><Input value={f.code} disabled={!editable} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
          <Field label="Marca" required error={err.brand_id}><Select value={f.brand_id} disabled={!editable} options={op.brands.map((b) => ({ value: b.id, label: b.name }))} onChange={(e) => set("brand_id", e.target.value)} /></Field>
          <Field label="Formato" error={err.format}><Select value={f.format} disabled={!editable} options={Object.entries(FORMATO).map(([value, label]) => ({ value, label }))} onChange={(e) => set("format", e.target.value)} /></Field>
          <Field label="Estado" error={err.status}><Select value={f.status} disabled={!editable} options={opcionesDe(ESTADO_PLANTILLA)} onChange={(e) => set("status", e.target.value)} /></Field>
          <Field label="Ancho" error={err.width_mm}><Input type="number" inputMode="numeric" value={f.width_mm} disabled={!editable} suffix="mm" onChange={(e) => set("width_mm", e.target.value)} /></Field>
          <Field label="Alto" error={err.height_mm}><Input type="number" inputMode="numeric" value={f.height_mm} disabled={!editable} suffix="mm" onChange={(e) => set("height_mm", e.target.value)} /></Field>
          <div className="sm:col-span-2"><Checkbox checked={f.includes_qr} disabled={!editable} onChange={(v) => set("includes_qr", v)} label="Incluye QR de trazabilidad" hint="Lleva a la página pública del lote" /></div>
          <Field label="Cuerpo" required error={err.body} className="sm:col-span-2"><Textarea rows={10} value={f.body} disabled={!editable} className="font-mono text-[12.5px]" onChange={(e) => set("body", e.target.value)} /></Field>
          <div className="flex flex-wrap gap-1 sm:col-span-2">
            {op.fields.map((c) => <button key={c} type="button" disabled={!editable} title={CAMPO[c]} onClick={() => set("body", `${f.body}${f.body.endsWith("\n") || !f.body ? "" : "\n"}{{${c}}}`)}
              className="rounded-md border border-line px-2 py-0.5 font-mono text-[11.5px] hover:bg-surface-2 disabled:opacity-50">{`{{${c}}}`}</button>)}
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-[13px] font-medium">Vista previa con datos de ejemplo</p>
          <VistaEtiqueta texto={llenar(f.body)} ancho={Number(f.width_mm) || 100} alto={Number(f.height_mm) || 50} qr={f.includes_qr ? "qr" : null} />
          {faltan.length > 0
            ? <Alert tone={f.status === "ACTIVE" ? "bad" : "warn"} title="Faltan campos obligatorios">{faltan.map((c) => CAMPO[c] ?? c).join(", ")}. Sin ellos la plantilla no se puede activar.</Alert>
            : <Alert tone="ok">La plantilla tiene todos los campos obligatorios.</Alert>}
          <div className="flex flex-wrap gap-1">{[...usados].filter((c) => !op.fields.includes(c)).map((c) => <Badge key={c} tone="bad">Campo desconocido: {c}</Badge>)}</div>
        </div>
      </div>
    </Modal>
  );
}
