"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { FiltroSelect, Tabla, qs, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import type { Opciones } from "@/modulos/cal/tipos";

type Registro = { id: string; authority: string; registration_type: string; number: string; issued_on: string; expires_on: string; file_url: string | null; status: string; notes: string | null };
type Producto = { id: string; code: string; name: string; sanitary_authority: string | null; sanitary_registry: string | null; sanitary_registry_expires: string | null; brand_name: string | null;
  light: { code: string; label: string; tone: Tone; days: number | null }; registrations: Registro[] };
const TIPO_REG: Record<string, string> = { SANITARY_REGISTRY: "Registro sanitario", SANITARY_AUTHORIZATION: "Autorización sanitaria", HEALTH_CERTIFICATE: "Certificado sanitario" };

/** CAL-10 Historial de registros sanitarios: DIGESA o SENASA por producto, con su vencimiento; un producto DIGESA sin registro vigente no se libera ni se etiqueta (RN-CAL-10). */
export default function Sanitarios() {
  const op = useOpcionesCal();
  const [q, setQ] = useState("");
  const [luz, setLuz] = useState("");
  const { datos, error, recargar } = useDatos<{ data: Producto[]; can_manage: boolean }>(`/v1/cal/sanitarios${qs({ q, light: luz })}`);
  const [nuevo, setNuevo] = useState<string | null | undefined>(undefined);
  const [hist, setHist] = useState<Producto | null>(null);
  const columnas: Column<Producto>[] = [
    { key: "name", header: "Producto", cardTitle: true, render: (p) => <div><p className="font-medium">{p.name}</p><p className="text-[12px] text-muted">{p.code} · {p.brand_name ?? ""}</p></div> },
    { key: "sanitary_authority", header: "Autoridad", render: (p) => p.sanitary_authority ?? "—" },
    { key: "sanitary_registry", header: "Registro vigente", render: (p) => <span className="font-mono text-[12.5px]">{p.sanitary_registry ?? "—"}</span> },
    { key: "sanitary_registry_expires", header: "Vence", render: (p) => fecha(p.sanitary_registry_expires) },
    { key: "light", header: "Estado", render: (p) => <Badge tone={p.light.tone}>{p.light.label}</Badge> },
    { key: "acc", header: "", render: (p) => <span className="flex gap-1">
      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setHist(p); }}>Historial ({p.registrations.length})</Button>
      {datos?.can_manage && <Button size="sm" onClick={(e) => { e.stopPropagation(); setNuevo(p.id); }}>Renovar</Button>}
    </span> },
  ];
  const vencidos = (datos?.data ?? []).filter((p) => ["EXPIRED", "MISSING"].includes(p.light.code)).length;
  return (
    <div className="space-y-5">
      <PageHeader description="Al registrar uno nuevo, el anterior queda como reemplazado y el producto toma el número y la fecha del nuevo. Se avisa antes del vencimiento."
        actions={datos?.can_manage && <Button variant="primary" icon={Plus} onClick={() => setNuevo(null)}>Registrar</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {vencidos > 0 && <Alert tone="bad">{vencidos} producto(s) sin registro vigente: sus lotes no se liberan ni se etiquetan hasta renovarlo.</Alert>}
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={!datos && !error} search={{ value: q, onChange: setQ, placeholder: "Buscar producto o número…" }} empty="No hay productos con autoridad sanitaria."
        toolbar={<FiltroSelect label="Estado" value={luz} onChange={setLuz} options={[{ value: "EXPIRED", label: "Vencidos" }, { value: "MISSING", label: "Sin registro" }, { value: "RED", label: "Vencen en 30 días" }, { value: "AMBER", label: "Por vencer" }, { value: "OK", label: "Vigentes" }]} />} />
      {nuevo !== undefined && op && <FormRegistro productoId={nuevo} op={op} onClose={() => setNuevo(undefined)} onGuardado={() => { setNuevo(undefined); recargar(); }} />}
      {hist && <Modal open onClose={() => setHist(null)} size="lg" title={`Registros de ${hist.name}`}>
        <Tabla cabeza={["Número", "Tipo", "Emitido", "Vence", "Estado", "Archivo"]} filas={hist.registrations.map((r) => [<span key="n" className="font-mono">{r.number}</span>, TIPO_REG[r.registration_type] ?? r.registration_type,
          fecha(r.issued_on), fecha(r.expires_on), r.status === "ACTIVE" ? <Badge key="s" tone="ok">Vigente</Badge> : <Badge key="s">Reemplazado</Badge>, r.file_url ?? "—"])} vacio="Sin registros." />
      </Modal>}
    </div>
  );
}

function FormRegistro({ productoId, op, onClose, onGuardado }: { productoId: string | null; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ product_id: productoId ?? "", authority: "DIGESA", registration_type: "SANITARY_REGISTRY", number: "", issued_on: "", expires_on: "", file_url: "", notes: "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo="Registro sanitario" boton="Registrar" onClose={onClose} aviso="El registro anterior del producto queda como reemplazado."
      enviar={async () => { await api("/v1/cal/sanitarios", { method: "POST", body: { ...f, file_url: f.file_url || null, notes: f.notes || null } }); toast.ok("Registro guardado"); onGuardado(); }}>
      {(err) => <>
        <Field label="Producto" required error={err.product_id} className="sm:col-span-2"><Select value={f.product_id} searchable placeholder="Elegir" options={op.products.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} onChange={(e) => set("product_id", e.target.value)} /></Field>
        <Field label="Autoridad" required error={err.authority}><Select value={f.authority} options={[{ value: "DIGESA", label: "DIGESA" }, { value: "SENASA", label: "SENASA" }]} onChange={(e) => set("authority", e.target.value)} /></Field>
        <Field label="Tipo" error={err.registration_type}><Select value={f.registration_type} options={Object.entries(TIPO_REG).map(([value, label]) => ({ value, label }))} onChange={(e) => set("registration_type", e.target.value)} /></Field>
        <Field label="Número" required error={err.number} className="sm:col-span-2"><Input value={f.number} onChange={(e) => set("number", e.target.value)} /></Field>
        <Field label="Emitido" required error={err.issued_on}><Input type="date" value={f.issued_on} onChange={(e) => set("issued_on", e.target.value)} /></Field>
        <Field label="Vence" required error={err.expires_on}><Input type="date" value={f.expires_on} onChange={(e) => set("expires_on", e.target.value)} /></Field>
        <Field label="Archivo" error={err.file_url} className="sm:col-span-2" hint="Ruta del PDF del registro"><Input value={f.file_url} placeholder="registros/…pdf" onChange={(e) => set("file_url", e.target.value)} /></Field>
        <Field label="Notas" error={err.notes} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}
