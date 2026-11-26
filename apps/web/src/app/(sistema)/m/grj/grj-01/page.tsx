"use client";

import { useState } from "react";
import { CalendarClock, FileText, Link2, Radio, Plus } from "lucide-react";
import { Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { CifraLink, MODO, VINCULO, hoyLima, limpio, useDatos, useOpcionesGrj, type OpcionesGrj } from "@/modulos/grj/comunes";

type Vinculo = { id: string; supplier_id: string; supplier_name: string; supplier_doc: string; company_name: string; company_ruc: string; mode: string; valid_from: string; valid_to: string | null;
  farm_tenant_ref: string | null; farm_ruc: string | null; farm_legal_name: string | null; connector_status: string | null; status: string; state: string; last_webhook_at: string | null;
  notes: string | null; created_by_name: string | null; dispatches: number };
type Cifras = { links: number; mode_today: string | null; last_webhook_at: string | null; scheduled: number };

const CONECTOR: Record<string, [string, "ok" | "warn" | "bad" | "neutral"]> = { CONNECTED: ["Conectado", "ok"], OK: ["Conectado", "ok"], PENDING: ["Por conectar", "warn"], ERROR: ["Con error", "bad"], DISCONNECTED: ["Desconectado", "neutral"], FAKE: ["Simulado (sin conector real)", "warn"] };

/** GRJ-01 Vínculo con la granja: proveedor, modo (NTI o factura), vigencia, tenant de la granja, RUC emisor y conector. */
export default function Vinculos() {
  const op = useOpcionesGrj();
  const { datos, recargar } = useDatos<{ data: Vinculo[] }>("/v1/grj/vinculos");
  const c = useDatos<Cifras>("/v1/grj/cifras/01");
  const [nuevo, setNuevo] = useState(false);
  const [terminar, setTerminar] = useState<Vinculo | null>(null);
  const listo = () => { recargar(); c.recargar(); };
  const columnas: Column<Vinculo>[] = [
    { key: "supplier_name", header: "Granja", cardTitle: true, render: (v) => <div className="min-w-[150px]"><p className="font-medium">{v.supplier_name}</p><p className="text-[12px] text-muted">RUC emisor {v.farm_ruc ?? v.supplier_doc}</p></div> },
    { key: "mode", header: "Modo", render: (v) => MODO[v.mode] ?? v.mode },
    { key: "valid_from", header: "Vigencia", render: (v) => `${fecha(v.valid_from)} → ${v.valid_to ? fecha(v.valid_to) : "sin fin"}` },
    { key: "company_name", header: "Empresa", hideOnMobile: true, render: (v) => v.company_name },
    { key: "farm_tenant_ref", header: "Conector", hideOnMobile: true, render: (v) => <div><StatusBadge status={v.connector_status} labels={CONECTOR} /><p className="text-[12px] text-muted">{v.farm_tenant_ref ?? "—"}{v.last_webhook_at ? ` · último envío ${fechaHora(v.last_webhook_at)}` : ""}</p></div> },
    { key: "dispatches", header: "Envíos", align: "right", render: (v) => numero(v.dispatches) },
    { key: "state", header: "Estado", render: (v) => <StatusBadge status={v.state} labels={VINCULO} /> },
    { key: "id", header: "", render: (v) => v.state === "ACTIVE" && !v.valid_to && op?.can.link ? <Button size="sm" onClick={() => setTerminar(v)}>Terminar</Button> : null },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cómo nos llegan los envíos de la granja relacionada: mientras compartimos RUC, con nota de transferencia interna (sin IGV); cuando la granja tenga su propio RUC, con factura. Solo un vínculo vigente por día."
        actions={op?.can.link && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo vínculo</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Documento esperado hoy" valor={c.datos ? (c.datos.mode_today ? (c.datos.mode_today === "NTI" ? "NTI" : "Factura") : "Sin vínculo") : undefined} detalle={c.datos?.mode_today ? MODO[c.datos.mode_today] : undefined} icono={FileText} />
        <CifraLink titulo="Vínculos vigentes" valor={c.datos ? numero(c.datos.links) : undefined} icono={Link2} />
        <CifraLink titulo="Último envío por el conector" valor={c.datos ? (c.datos.last_webhook_at ? fecha(c.datos.last_webhook_at) : "—") : undefined} detalle={c.datos?.last_webhook_at ? fechaHora(c.datos.last_webhook_at) : undefined} icono={Radio} href="/m/grj/grj-03" />
        <CifraLink titulo="Programados" valor={c.datos ? numero(c.datos.scheduled) : undefined} detalle="Empiezan más adelante" icono={CalendarClock} />
      </div>
      <DataTable rows={datos?.data ?? []} rowKey={(v) => v.id} loading={!datos} columns={columnas} empty="No hay vínculos con la granja." />
      {(datos?.data ?? []).filter((v) => v.notes).slice(0, 3).map((v) => <p key={v.id} className="text-[12.5px] text-muted">{v.supplier_name}: {limpio(v.notes)}</p>)}
      {terminar && <TerminarVinculo v={terminar} onClose={() => setTerminar(null)} onGuardado={() => { setTerminar(null); listo(); }} />}
      {nuevo && op && <NuevoVinculo op={op} onClose={() => setNuevo(false)} onGuardado={() => { setNuevo(false); listo(); }} />}
    </div>
  );
}

function NuevoVinculo({ op, onClose, onGuardado }: { op: OpcionesGrj; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ supplier_id: op.farm?.id ?? "", company_id: op.companies[0]?.id ?? "", mode: "NTI", valid_from: hoyLima(), valid_to: "", farm_ruc: "", farm_legal_name: "", farm_tenant_ref: "", notes: "" });
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  return (
    <Dialogo titulo="Nuevo vínculo con la granja" boton="Crear vínculo" onClose={onClose} aviso="No puede haber dos vínculos vigentes el mismo día. Con NTI, la granja debe tener el mismo RUC que la empresa."
      enviar={async () => { await api("/v1/grj/vinculos", { method: "POST", body: { ...f, valid_to: f.valid_to || null, farm_ruc: f.farm_ruc || null, farm_legal_name: f.farm_legal_name || null, farm_tenant_ref: f.farm_tenant_ref || null, notes: f.notes || null } }); toast.ok("Vínculo creado"); onGuardado(); }}>
      {(e) => <>
        <Field label="Granja (proveedor)" required error={e.supplier_id}><Select value={f.supplier_id} placeholder="Elegir" onChange={set("supplier_id")} options={op.farms.map((s) => ({ value: s.id, label: s.trade_name || s.legal_name }))} /></Field>
        <Field label="Empresa que recibe" error={e.company_id}><Select value={f.company_id} onChange={set("company_id")} options={op.companies.map((c) => ({ value: c.id, label: c.legal_name }))} /></Field>
        <Field label="Modo" required error={e.mode}><Select value={f.mode} onChange={set("mode")} options={Object.entries(MODO).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="RUC emisor" error={e.farm_ruc} hint={f.mode === "NTI" ? "El mismo de la empresa" : "El RUC propio de la granja"}><Input value={f.farm_ruc} inputMode="numeric" maxLength={11} onChange={set("farm_ruc")} /></Field>
        <Field label="Desde" required error={e.valid_from}><Input type="date" value={f.valid_from} onChange={set("valid_from")} /></Field>
        <Field label="Hasta" error={e.valid_to}><Input type="date" value={f.valid_to} onChange={set("valid_to")} /></Field>
        <Field label="Identificador del sistema de la granja" error={e.farm_tenant_ref}><Input value={f.farm_tenant_ref} maxLength={80} onChange={set("farm_tenant_ref")} /></Field>
        <Field label="Razón social de la granja" error={e.farm_legal_name}><Input value={f.farm_legal_name} maxLength={200} onChange={set("farm_legal_name")} /></Field>
        <Field label="Notas" error={e.notes} className="sm:col-span-2"><Textarea value={f.notes} maxLength={300} onChange={set("notes")} /></Field>
      </>}
    </Dialogo>
  );
}

function TerminarVinculo({ v, onClose, onGuardado }: { v: Vinculo; onClose: () => void; onGuardado: () => void }) {
  const [hasta, setHasta] = useState(hoyLima());
  return (
    <Dialogo titulo={`Terminar el vínculo con ${v.supplier_name}`} boton="Terminar" onClose={onClose}
      enviar={async () => { await api(`/v1/grj/vinculos/${v.id}/terminar`, { method: "POST", body: { valid_to: hasta } }); toast.ok("Vínculo terminado"); onGuardado(); }} aviso="Para pasar de NTI a factura usa el asistente de cambio a factura: cierra este vínculo y abre el nuevo al día siguiente.">
      {(e) => <Field label="Último día del vínculo" required error={e.valid_to} className="sm:col-span-2"><Input type="date" value={hasta} onChange={(x) => setHasta(x.target.value)} /></Field>}
    </Dialogo>
  );
}
