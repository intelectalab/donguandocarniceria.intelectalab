"use client";

import { useState } from "react";
import { AlarmClock, CheckCheck, Inbox, Undo2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { FichaAsiento } from "@/modulos/cnt/Asiento";
import { ACCION_ITEM, Barras, CifraLink, FiltroSelect, ITEM, Seccion, accion, nombreMes, opciones, opcionesCuenta, texto, useDatos, useOpcionesCnt, type Num, type OpcionesCnt } from "@/modulos/cnt/comunes";

type Fila = {
  id: string; period: string; source_type: string; reason: string; missing: string[]; status: string; ref_label: string | null; amount: Num; notes: string | null; entry_id: string | null;
  created_at: string; classified_by_name: string | null; assigned_to_name: string | null; entry_number: string | null; age_days: number; reason_label: string; returned_reason: string | null;
};
type Item = Fila & {
  classification: { account_code?: string | null; cost_center_id?: string | null; brand_id?: string | null; note?: string | null; remember?: boolean; action?: string | null } | null;
  approved_by_name: string | null; history: { at: string; user: string; action: string }[]; can: { classify: boolean; approve: boolean; return: boolean };
};
type Cifras = { open: number; classified: number; returned: number; overdue: number };
const CLASIFICA = ["NO_RULE", "MISSING_ACCOUNT", "MISSING_COST_CENTER", "MISSING_BRAND"];

/** CNT-05 Bandeja de la contadora: lo que el motor no pudo asentar solo. La practicante clasifica y la contadora aprueba o devuelve. */
export default function Bandeja() {
  const op = useOpcionesCnt();
  const [estado, setEstado] = useState("OPEN");
  const [motivo, setMotivo] = useState("");
  const [mios, setMios] = useState(false);
  const lista = useListado<Fila>("/v1/cnt/bandeja", { orden: "created_at", filtros: { status: estado, reason: motivo, mine: mios ? 1 : null } });
  const c = useDatos<Cifras>("/v1/cnt/cifras/05");
  const resumen = useDatos<{ by_reason: Record<string, number> }>("/v1/cnt/bandeja?per_page=1");
  const [abierto, setAbierto] = useState<string | null>(null);
  const recargar = () => { lista.recargar(); c.recargar(); resumen.recargar(); };
  const maxDias = op?.params.inbox_max_age_days ?? 3;
  const columnas: Column<Fila>[] = [
    { key: "ref_label", header: "Documento", cardTitle: true, render: (x) => <div className="min-w-[220px]"><p className="font-medium">{texto(x.ref_label) || "Documento"}</p><p className="text-[12px] text-muted">{nombreMes(x.period)}{x.entry_number ? ` · asiento ${x.entry_number}` : ""}</p></div> },
    { key: "reason", header: "Motivo", sortable: true, render: (x) => <span className="text-[13px]">{x.reason_label}{x.missing.length > 1 && <span className="block text-[12px] text-muted">{x.missing.filter((m) => m !== x.reason).map((m) => op?.reasons[m] ?? m).join(" · ")}</span>}</span> },
    { key: "amount", header: "Importe", sortable: true, align: "right", render: (x) => soles(x.amount) },
    { key: "created_at", header: "Antigüedad", sortable: true, render: (x) => <span className={x.age_days > maxDias && x.status !== "APPROVED" ? "font-semibold text-bad" : ""}>{x.age_days === 0 ? "Hoy" : `${x.age_days} días`}</span> },
    { key: "assigned_to_name", header: "Clasificó o tiene", hideOnMobile: true, render: (x) => x.classified_by_name ?? x.assigned_to_name ?? <span className="text-muted">—</span> },
    { key: "status", header: "Estado", sortable: true, render: (x) => <StatusBadge status={x.status} labels={ITEM} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={`Documentos que no pudieron asentarse solos. Cada uno debería resolverse en ${maxDias} días: la practicante clasifica y la contadora aprueba o devuelve con motivo.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Abiertos" valor={c.datos ? numero(c.datos.open) : undefined} icono={Inbox} onClick={() => setEstado("OPEN")} />
        <CifraLink titulo="Clasificados por aprobar" valor={c.datos ? numero(c.datos.classified) : undefined} icono={CheckCheck} tono={c.datos?.classified ? "warn" : undefined} onClick={() => setEstado("CLASSIFIED")} />
        <CifraLink titulo="Devueltos" valor={c.datos ? numero(c.datos.returned) : undefined} icono={Undo2} onClick={() => setEstado("RETURNED")} />
        <CifraLink titulo="Vencidos" valor={c.datos ? numero(c.datos.overdue) : undefined} detalle={`Más de ${maxDias} días`} icono={AlarmClock} tono={c.datos?.overdue ? "bad" : "ok"} onClick={() => setEstado("OPEN")} />
      </div>
      <Seccion titulo="Abiertos por motivo">
        <Barras filas={Object.entries(resumen.datos?.by_reason ?? {}).map(([k, v]) => ({ label: op?.reasons[k] ?? k, value: v }))} formato={(v) => numero(v)} />
      </Seccion>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(x) => setAbierto(x.id)} search={{ ...lista.tabla.search, placeholder: "Buscar documento o nota…" }} empty="La bandeja está vacía con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={(v) => setEstado(v || "OPEN")} options={[{ value: "OPEN", label: "Abiertos" }, ...opciones(Object.fromEntries(Object.entries(ITEM).map(([k, v]) => [k, v[0]]))), { value: "ALL", label: "Todos" }]} />
          <FiltroSelect label="Motivo" value={motivo} onChange={setMotivo} options={opciones(op?.reasons ?? {})} ancho="sm:w-[230px]" />
          <Button size="sm" variant={mios ? "primary" : undefined} onClick={() => setMios(!mios)}>{mios ? "Asignados a mí" : "Solo los asignados a mí"}</Button>
        </>} />
      {abierto && op && <FichaItem id={abierto} op={op} onClose={() => setAbierto(null)} onCambio={recargar} />}
    </div>
  );
}

function FichaItem({ id, op, onClose, onCambio }: { id: string; op: OpcionesCnt; onClose: () => void; onCambio: () => void }) {
  const { datos: it, recargar } = useDatos<Item>(`/v1/cnt/bandeja/${id}`);
  const [verAsiento, setVerAsiento] = useState(false);
  const [f, setF] = useState<{ account_code: string; cost_center_id: string; brand_id: string; note: string; remember: boolean; action: string } | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  if (!it) return <Modal open onClose={onClose} title="Documento" size="lg"><p className="text-muted">Cargando…</p></Modal>;
  const cl = it.classification ?? {};
  const form = f ?? { account_code: cl.account_code ?? "", cost_center_id: cl.cost_center_id ?? "", brand_id: cl.brand_id ?? "", note: cl.note ?? "", remember: !!cl.remember, action: cl.action ?? "" };
  const listo = () => { recargar(); onCambio(); setF(null); };
  const falta = it.missing.length ? it.missing : [it.reason];
  const clasificar = async () => {
    setErrores({});
    try {
      await api(`/v1/cnt/bandeja/${it.id}/clasificar`, { method: "POST", body: { ...form, account_code: form.account_code || null, cost_center_id: form.cost_center_id || null, brand_id: form.brand_id || null, action: form.action || null } });
      toast.ok("Clasificado: queda para la aprobación de la contadora"); listo();
    } catch (e) { const p = erroresDe(e); setErrores(p); if (!Object.keys(p).length) toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={texto(it.ref_label) || "Documento"} description={`${it.reason_label} · ${soles(it.amount)} · ${nombreMes(it.period)}`}
      footer={<>
        {it.entry_id && <Button onClick={() => setVerAsiento(true)}>Ver asiento</Button>}
        {it.can.return && <Button onClick={() => accion({ title: "¿Devolver a la practicante?", confirmLabel: "Devolver", reason: { min: 5, label: "Qué falta corregir" } },
          (m) => api(`/v1/cnt/bandeja/${it.id}/devolver`, { method: "POST", body: { reason: m } }), "Devuelto", listo)}>Devolver</Button>}
        {it.can.classify && <Button variant={it.can.approve ? undefined : "primary"} onClick={clasificar}>Clasificar</Button>}
        {it.can.approve && <Button variant="primary" onClick={() => accion({ title: "¿Aprobar y asentar?", message: "Se aprueba el asiento con la clasificación indicada.", confirmLabel: "Aprobar" },
          () => api(`/v1/cnt/bandeja/${it.id}/aprobar`, { method: "POST", body: {} }), "Aprobado", listo)}>Aprobar</Button>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><StatusBadge status={it.status} labels={ITEM} />{falta.map((m) => <Badge key={m} tone="warn">{op.reasons[m] ?? m}</Badge>)}</div>
        {it.returned_reason && <Alert tone="bad" title="Devuelto por la contadora">{texto(it.returned_reason)}</Alert>}
        {it.notes && <p className="text-[13px] text-muted">{texto(it.notes)}</p>}
        <DetailList items={[
          { label: "Clasificó", value: it.classified_by_name ?? "—" },
          { label: "Aprobó", value: it.approved_by_name ?? "—" },
          { label: "Asignado a", value: op.can.approve ? <Select aria-label="Asignar" value={""} placeholder={it.assigned_to_name ?? "Sin asignar"} onChange={async (e) => {
            try { await api(`/v1/cnt/bandeja/${it.id}/asignar`, { method: "POST", body: { user_id: e.target.value || null } }); toast.ok("Asignado"); listo(); } catch (x) { toast.error(mensajeDe(x)); }
          }} options={op.team.map((u) => ({ value: u.id, label: u.name }))} /> : it.assigned_to_name ?? "—" },
        ]} />
        {(it.can.classify || it.status === "CLASSIFIED") && <div className="grid gap-4 rounded-lg border border-line p-3 sm:grid-cols-2">
          {(falta.some((m) => CLASIFICA.includes(m)) || form.account_code) && <Field label="Cuenta" required={falta.includes("MISSING_ACCOUNT") || it.reason === "NO_RULE"} error={errores.account_code} className="sm:col-span-2">
            <Select value={form.account_code} placeholder="Elegir" disabled={!it.can.classify} onChange={(e) => setF({ ...form, account_code: e.target.value })} options={opcionesCuenta(op)} /></Field>}
          {(falta.includes("MISSING_COST_CENTER") || form.cost_center_id) && <Field label="Centro de costo" required error={errores.cost_center_id}>
            <Select value={form.cost_center_id} placeholder="Elegir" disabled={!it.can.classify} onChange={(e) => setF({ ...form, cost_center_id: e.target.value })} options={op.cost_centers.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>}
          {(falta.includes("MISSING_BRAND") || form.brand_id) && <Field label="Marca" required error={errores.brand_id}>
            <Select value={form.brand_id} placeholder="Elegir" disabled={!it.can.classify} onChange={(e) => setF({ ...form, brand_id: e.target.value })} options={op.brands.map((b) => ({ value: b.id, label: b.name }))} /></Field>}
          {it.reason === "NO_VALID_RECEIPT" && <Field label="Tratamiento" error={errores.action}>
            <Select value={form.action} placeholder="Elegir" disabled={!it.can.classify} onChange={(e) => setF({ ...form, action: e.target.value })} options={opciones(ACCION_ITEM)} /></Field>}
          <Field label="Nota" required={["PO_MISMATCH", "SIRE_DIFF", "NO_VALID_RECEIPT"].includes(it.reason)} error={errores.note} className="sm:col-span-2">
            <Textarea value={texto(form.note)} maxLength={500} disabled={!it.can.classify} onChange={(e) => setF({ ...form, note: e.target.value })} /></Field>
          {it.can.classify && CLASIFICA.includes(it.reason) && <div className="sm:col-span-2"><Checkbox checked={form.remember} onChange={(v) => setF({ ...form, remember: v })} label="Recordar para los próximos documentos de este proveedor o concepto" /></div>}
        </div>}
        {it.history?.length > 0 && <ol className="space-y-1.5 text-[12.5px]">{it.history.map((h, i) => <li key={i}><span className="text-muted">{fechaHora(h.at)} · {h.user}</span> — {texto(h.action)}</li>)}</ol>}
      </div>
      {verAsiento && it.entry_id && <FichaAsiento id={it.entry_id} op={op} onClose={() => setVerAsiento(false)} onCambio={listo} />}
    </Modal>
  );
}
