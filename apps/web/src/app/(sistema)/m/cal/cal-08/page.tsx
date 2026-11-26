"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { FiltroSelect, Seccion, accion, opcionesDe, opcionesEt, useAlAbrir, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { ESTADO_ACCION, ESTADO_NC, GRAVEDAD, ORIGEN_NC, TIPO_ACCION, type Opciones } from "@/modulos/cal/tipos";

type Fila = { id: string; number: string; source: string; severity: string; description: string; status: string; detected_at: string; due_date: string | null; establishment_name: string | null;
  lot_code: string | null; supplier_name: string | null; equipment_code: string | null; responsible_name: string | null; actions: number; pending_actions: number; overdue: boolean };
type Accion = { id: string; action_type: string; description: string; due_date: string | null; status: string; done_at: string | null; evidence_url: string | null; responsible_name: string | null };
type Detalle = Fila & { root_cause: string | null; lot_status: string | null; detected_by_name: string | null; order_number: string | null; claim_number: string | null; closing_notes: string | null;
  responsible_user_id: string | null; actions: Accion[] } & { actions: Accion[] };

/** CAL-08 No conformidades: origen, gravedad, causa raíz y acciones; una crítica retiene el lote; se cierra con todas las acciones verificadas (RN-CAL-05, RN-CAL-06). */
export default function NoConformidades() {
  const { local, puede } = useSesion();
  const op = useOpcionesCal();
  const [estado, setEstado] = useState("");
  const [grav, setGrav] = useState("");
  const lista = useListado<Fila>("/v1/cal/no-conformidades", { orden: "-detected_at", filtros: { status: estado, severity: grav, site: local } });
  const [ver, setVer] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  useAlAbrir((p) => setVer(p.get("id")));
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Número", sortable: true, render: (n) => <span className="font-mono font-semibold whitespace-nowrap">{n.number}</span> },
    { key: "description", header: "Descripción", cardTitle: true, render: (n) => <div className="min-w-[220px]"><p className="line-clamp-2">{n.description}</p><p className="text-[12px] text-muted">{ORIGEN_NC[n.source]}{n.lot_code ? ` · lote ${n.lot_code}` : ""}{n.supplier_name ? ` · ${n.supplier_name}` : ""}{n.equipment_code ? ` · ${n.equipment_code}` : ""}</p></div> },
    { key: "severity", header: "Gravedad", render: (n) => <StatusBadge status={n.severity} labels={GRAVEDAD} /> },
    { key: "detected_at", header: "Detectada", sortable: true, render: (n) => fecha(n.detected_at) },
    { key: "due_date", header: "Plazo", render: (n) => <span className={n.overdue ? "font-medium text-bad" : ""}>{fecha(n.due_date)}</span> },
    { key: "responsible_name", header: "Responsable", hideOnMobile: true, render: (n) => n.responsible_name ?? "—" },
    { key: "actions", header: "Acciones", align: "right", render: (n) => n.actions ? `${n.actions - n.pending_actions}/${n.actions}` : "—" },
    { key: "status", header: "Estado", render: (n) => <StatusBadge status={n.status} labels={ESTADO_NC} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Una no conformidad crítica retiene el lote afectado. Se cierra cuando todas sus acciones están verificadas, con la causa raíz y la verificación de eficacia."
        actions={op?.can.record && puede("CAL", "C") && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Nueva no conformidad</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(n) => setVer(n.id)} search={{ ...lista.tabla.search, placeholder: "Buscar número, descripción, lote o responsable…" }}
        toolbar={<><FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesEt(ESTADO_NC)} /><FiltroSelect label="Gravedad" value={grav} onChange={setGrav} options={opcionesEt(GRAVEDAD)} /></>} />
      {nueva && op && <NuevaNC op={op} onClose={() => setNueva(false)} onCreada={(id) => { setNueva(false); lista.recargar(); setVer(id); }} />}
      {ver && op && <FichaNC id={ver} op={op} onClose={() => setVer(null)} onCambio={lista.recargar} />}
    </div>
  );
}

function NuevaNC({ op, onClose, onCreada }: { op: Opciones; onClose: () => void; onCreada: (id: string) => void }) {
  const [f, setF] = useState({ source: "PROCESS", severity: "MINOR", description: "", establishment_id: op.establishments[0]?.id ?? "", lot_code: "", supplier_id: "", equipment_id: "", responsible_user_id: "", due_date: "" });
  const lotes = useDatos<{ data: { id: string; code: string; product_name: string }[] }>("/v1/etq/lotes?per_page=200").datos?.data ?? [];
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo="Nueva no conformidad" boton="Registrar" onClose={onClose} aviso={f.severity === "CRITICAL" ? "Una no conformidad crítica retiene el lote al momento." : undefined}
      enviar={async () => {
        const r = await api<{ id: string; number: string }>("/v1/cal/no-conformidades", { method: "POST", body: { source: f.source, severity: f.severity, description: f.description, establishment_id: f.establishment_id || null,
          lot_id: f.lot_code || null, supplier_id: f.supplier_id || null, equipment_id: f.equipment_id || null, responsible_user_id: f.responsible_user_id || null, due_date: f.due_date || null } });
        toast.ok(`${r.number} registrada`); onCreada(r.id);
      }}>
      {(err) => <>
        <Field label="Origen" required error={err.source}><Select value={f.source} options={opcionesDe(ORIGEN_NC)} onChange={(e) => set("source", e.target.value)} /></Field>
        <Field label="Gravedad" required error={err.severity}><Select value={f.severity} options={opcionesEt(GRAVEDAD)} onChange={(e) => set("severity", e.target.value)} /></Field>
        <Field label="Descripción" required error={err.description} className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Local" error={err.establishment_id}><Select value={f.establishment_id} options={op.establishments.map((e) => ({ value: e.id, label: e.short ?? e.name }))} onChange={(e) => set("establishment_id", e.target.value)} /></Field>
        <Field label="Lote" error={err.lot_id}><Select value={f.lot_code} searchable placeholder="Ninguno" options={lotes.map((l) => ({ value: l.id, label: `${l.code} · ${l.product_name}` }))} onChange={(e) => set("lot_code", e.target.value)} /></Field>
        <Field label="Proveedor" error={err.supplier_id}><Select value={f.supplier_id} searchable placeholder="Ninguno" options={op.suppliers.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => set("supplier_id", e.target.value)} /></Field>
        <Field label="Equipo" error={err.equipment_id}><Select value={f.equipment_id} searchable placeholder="Ninguno" options={op.equipment.map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))} onChange={(e) => set("equipment_id", e.target.value)} /></Field>
        <Field label="Responsable" error={err.responsible_user_id}><Select value={f.responsible_user_id} searchable placeholder="Calidad" options={op.users.map((u) => ({ value: u.id, label: u.name }))} onChange={(e) => set("responsible_user_id", e.target.value)} /></Field>
        <Field label="Plazo" error={err.due_date}><Input type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}

function FichaNC({ id, op, onClose, onCambio }: { id: string; op: Opciones; onClose: () => void; onCambio: () => void }) {
  const { puede } = useSesion();
  const { datos: n, recargar } = useDatos<Detalle>(`/v1/cal/no-conformidades/${id}`);
  const [nuevaAccion, setNuevaAccion] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [cierre, setCierre] = useState({ root_cause: "", closing_notes: "", effectiveness_verified: true });
  const [error, setError] = useState("");
  const cambio = () => { recargar(); onCambio(); };
  const abierta = n && n.status !== "CLOSED";
  return (
    <Modal open onClose={onClose} size="lg" title={n ? `${n.number} · ${ORIGEN_NC[n.source]}` : "No conformidad"}
      footer={abierta && <>
        {op.can.record && <Button onClick={() => setNuevaAccion(true)}>Agregar acción</Button>}
        {op.can.close && puede("CAL", "E") && <Button variant="primary" onClick={() => { setCierre({ ...cierre, root_cause: n?.root_cause ?? "" }); setCerrando(true); }}>Cerrar</Button>}
      </>}>
      {n && <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><StatusBadge status={n.severity} labels={GRAVEDAD} /><StatusBadge status={n.status} labels={ESTADO_NC} />{n.overdue && <Badge tone="bad">Vencida</Badge>}</div>
        <p className="text-[14px]">{n.description}</p>
        <DetailList items={[
          { label: "Detectada", value: `${fechaHora(n.detected_at)}${n.detected_by_name ? ` · ${n.detected_by_name}` : ""}` }, { label: "Plazo", value: fecha(n.due_date) },
          { label: "Responsable", value: n.responsible_name }, { label: "Local", value: n.establishment_name },
          { label: "Lote", value: n.lot_code ? `${n.lot_code}${n.lot_status ? ` (${n.lot_status === "BLOCKED" ? "retenido" : n.lot_status === "RELEASED" ? "liberado" : n.lot_status.toLowerCase()})` : ""}` : "—" },
          { label: "Reclamo u orden", value: n.claim_number ?? n.order_number ?? "—" }, { label: "Causa raíz", value: n.root_cause ?? "—" },
          ...(n.closing_notes ? [{ label: "Cierre", value: n.closing_notes }] : []),
        ]} />
        <Seccion titulo="Acciones">
          {n.actions.length ? <ul className="divide-y divide-line text-[13px]">{n.actions.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1"><b>{TIPO_ACCION[a.action_type]}</b> · {a.description}<span className="block text-[12px] text-muted">{a.responsible_name ?? "—"} · plazo {fecha(a.due_date)}{a.evidence_url ? ` · ${a.evidence_url}` : ""}</span></span>
            <StatusBadge status={a.status} labels={ESTADO_ACCION} />
            {a.status === "PENDING" && op.can.record && <Button size="sm" onClick={() => accion({ title: "¿Acción hecha?", confirmLabel: "Marcar hecha", reason: { label: "Evidencia", min: 3 } }, (m) => api(`/v1/cal/acciones/${a.id}/estado`, { method: "POST", body: { status: "DONE", evidence_url: m } }), "Acción hecha", cambio)}>Hecha</Button>}
            {a.status === "DONE" && op.can.close && <Button size="sm" variant="primary" onClick={() => accion({ title: "¿Verificar la acción?", confirmLabel: "Verificar" }, () => api(`/v1/cal/acciones/${a.id}/estado`, { method: "POST", body: { status: "VERIFIED" } }), "Acción verificada", cambio)}>Verificar</Button>}
          </li>)}</ul> : <p className="text-[13px] text-muted">Sin acciones todavía.</p>}
        </Seccion>
        {cerrando && <Seccion titulo="Cerrar la no conformidad">
          <div className="grid gap-3">
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Causa raíz" required><Input value={cierre.root_cause} onChange={(e) => setCierre({ ...cierre, root_cause: e.target.value })} /></Field>
            <Field label="Notas de cierre"><Textarea rows={2} value={cierre.closing_notes} onChange={(e) => setCierre({ ...cierre, closing_notes: e.target.value })} /></Field>
            <Checkbox checked={cierre.effectiveness_verified} onChange={(v) => setCierre({ ...cierre, effectiveness_verified: v })} label="Se verificó la eficacia de las acciones" />
            <div><Button variant="primary" onClick={async () => { setError(""); try { await api(`/v1/cal/no-conformidades/${id}/cerrar`, { method: "POST", body: cierre }); toast.ok(`${n.number} cerrada`); setCerrando(false); cambio(); } catch (e) { setError(mensajeDe(e)); } }}>Confirmar cierre</Button></div>
          </div>
        </Seccion>}
      </div>}
      {nuevaAccion && <Dialogo titulo="Nueva acción" boton="Agregar" onClose={() => setNuevaAccion(false)}
        enviar={async () => {
          const d = new FormData(document.getElementById("f-dialogo") as HTMLFormElement);
          await api(`/v1/cal/no-conformidades/${id}/acciones`, { method: "POST", body: { action_type: d.get("t"), description: d.get("d"), responsible_user_id: d.get("r") || null, due_date: d.get("p") || null } });
          toast.ok("Acción agregada"); setNuevaAccion(false); cambio();
        }}>
        {(err) => <>
          <Field label="Tipo" required error={err.action_type}><select name="t" defaultValue="CORRECTIVE" className="h-10 rounded-[9px] border border-line bg-surface px-3 text-[13.5px]">{Object.entries(TIPO_ACCION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Plazo" error={err.due_date}><Input name="p" type="date" /></Field>
          <Field label="Descripción" required error={err.description} className="sm:col-span-2"><Textarea name="d" rows={2} /></Field>
          <Field label="Responsable" error={err.responsible_user_id} className="sm:col-span-2"><select name="r" defaultValue="" className="h-10 rounded-[9px] border border-line bg-surface px-3 text-[13.5px]"><option value="">El de la no conformidad</option>{op.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        </>}
      </Dialogo>}
    </Modal>
  );
}
