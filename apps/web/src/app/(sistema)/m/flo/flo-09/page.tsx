"use client";

import { useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { ErrorCarga, Estado, Seccion, Vacio, VerArchivo, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { SEMAFORO, type Opciones } from "@/modulos/flo/tipos";

type Doc = {
  id: string; doc_type: string; tipo: string; number: string; issuer: string | null; license_class: string | null; issued_on: string | null; expires_on: string | null;
  vehicle_id: string | null; employee_id: string | null; file_id: string | null; notes: string | null; duenio: string; semaforo: string; dias: number | null; bloquea: boolean;
};
type Lista = { data: Doc[]; faltan: { vehicle_id: string; vehiculo: string; doc_type: string; tipo: string }[]; sin_licencia: { id: string; name: string; employee_id: string }[];
  resumen: { vencidos: number; por_vencer: number; vigentes: number; bloquean: number } };
type Base = { doc_type: string; vehicle_id?: string; employee_id?: string; number?: string; issuer?: string; license_class?: string };

/** FLO-09 Documentos: SOAT, revisión técnica, tarjeta de propiedad, contrato de alquiler y licencias, con vencimiento, archivo y semáforo (RN-FLO-13). */
export default function Documentos() {
  const { datos: op } = useOpciones();
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [nuevo, setNuevo] = useState<Base | null>(null);
  const q = new URLSearchParams({ ...(tipo ? { tipo } : {}), ...(estado ? { estado } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/flo/documentos?${q}`);
  if (error) return <ErrorCarga error={error} que="Los documentos los llevan el coordinador de delivery y RR. HH." />;
  const gestiona = Boolean(op?.permisos.documentos);
  async function anular(d: Doc) {
    const r = await confirmAction({ title: `Anular ${d.tipo} ${d.number}`, message: "Si reemplazó a otro, el anterior vuelve a quedar vigente.", confirmLabel: "Anular", danger: true, reason: { label: "Motivo", min: 5 } });
    if (!r) return;
    try {
      await api(`/v1/flo/documentos/${d.id}/anular`, { method: "POST", body: { reason: r.reason } });
      toast.ok("Documento anulado.");
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  const avisos = op?.parametros.avisos_documentos ?? [30, 15, 7];
  const r = datos?.resumen;
  const columnas: Column<Doc>[] = [
    { key: "tipo", header: "Documento", cardTitle: true, render: (d) => <span className="flex flex-col"><span className="font-medium">{d.tipo}</span><span className="text-[12px] text-muted">{d.number}{d.license_class ? ` · ${d.license_class}` : ""}</span></span> },
    { key: "duenio", header: "De", render: (d) => d.duenio },
    { key: "issuer", header: "Emisor", hideOnMobile: true, render: (d) => d.issuer ?? "—" },
    { key: "expires_on", header: "Vence", sortable: true, render: (d) => d.expires_on ? <span className="flex flex-col"><span>{fecha(d.expires_on)}</span>{d.dias !== null && <span className={`text-[12px] ${d.dias < 0 ? "text-bad" : d.dias <= 30 ? "text-warn" : "text-muted"}`}>{d.dias < 0 ? `venció hace ${-d.dias} días` : `en ${d.dias} días`}</span>}</span> : "—" },
    { key: "acciones", header: "", render: (d) => (
      <span className="flex flex-wrap justify-end gap-1">
        <VerArchivo id={d.file_id} />
        {gestiona && <Button size="sm" icon={RefreshCw} onClick={(e) => { e.stopPropagation(); setNuevo({ doc_type: d.doc_type, vehicle_id: d.vehicle_id ?? undefined, employee_id: d.employee_id ?? undefined, issuer: d.issuer ?? undefined, license_class: d.license_class ?? undefined, number: d.doc_type === "DRIVER_LICENSE" ? d.number : undefined }); }}>Renovar</Button>}
        {gestiona && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); anular(d); }}>Anular</Button>}
      </span>
    ) },
    { key: "status", header: "Semáforo", render: (d) => <span className="flex flex-col items-end gap-0.5"><Estado s={d.semaforo} labels={SEMAFORO} />{d.bloquea && <span className="text-[11.5px] font-semibold text-bad">no sale</span>}</span> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description={`SOAT, revisión técnica, licencia y contrato de alquiler exigen vencimiento. Se avisa a los ${avisos.join(", ")} días; con SOAT o revisión vencidos el vehículo no sale y con la licencia vencida el conductor no inicia jornada.`}
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setNuevo({ doc_type: "SOAT" })}>Documento</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Vencidos" valor={r ? String(r.vencidos) : undefined} detalle={r ? `${r.bloquean} bloquean una salida` : ""} tono={r?.vencidos ? "bad" : undefined} destacada />
        <Cifra titulo="Por vencer" valor={r ? String(r.por_vencer) : undefined} detalle={`en ${avisos[0]} días o menos`} tono={r?.por_vencer ? "warn" : undefined} />
        <Cifra titulo="Vigentes" valor={r ? String(r.vigentes) : undefined} detalle="al día" />
        <Cifra titulo="Faltan registrar" valor={datos ? String(datos.faltan.length + datos.sin_licencia.length) : undefined} detalle="obligatorios sin cargar" tono={datos && datos.faltan.length + datos.sin_licencia.length ? "bad" : undefined} />
      </div>
      {datos && (datos.faltan.length > 0 || datos.sin_licencia.length > 0) && (
        <Seccion titulo="Falta registrar">
          <ul className="space-y-1.5 text-[13px]">
            {datos.faltan.map((f) => <li key={`${f.vehicle_id}-${f.doc_type}`} className="flex items-center justify-between gap-2"><span>{f.tipo} de {f.vehiculo}</span>{gestiona && <Button size="sm" onClick={() => setNuevo({ doc_type: f.doc_type, vehicle_id: f.vehicle_id })}>Registrar</Button>}</li>)}
            {datos.sin_licencia.map((s) => <li key={s.id} className="flex items-center justify-between gap-2"><span>Licencia de {s.name}</span>{gestiona && <Button size="sm" onClick={() => setNuevo({ doc_type: "DRIVER_LICENSE", employee_id: s.employee_id })}>Registrar</Button>}</li>)}
          </ul>
        </Seccion>
      )}
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Tipo" value={tipo} onChange={setTipo} options={(op?.documentos ?? []).map((d) => ({ value: d.code, label: d.nombre }))} />
        <FiltroSelect etiqueta="Semáforo" value={estado} onChange={setEstado} options={[{ value: "ALERT", label: "Vencidos y por vencer" }, ...Object.entries(SEMAFORO).map(([k, [l]]) => ({ value: k, label: l }))]} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>No hay documentos con estos filtros.</Vacio>} />
      {nuevo && op && <Formulario op={op} base={nuevo} onClose={() => setNuevo(null)} onListo={() => { setNuevo(null); recargar(); }} />}
    </div>
  );
}

function Formulario({ op, base, onClose, onListo }: { op: Opciones; base: Base; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({ doc_type: base.doc_type, vehicle_id: base.vehicle_id ?? "", employee_id: base.employee_id ?? "", number: base.number ?? "", issuer: base.issuer ?? "",
    license_class: base.license_class ?? "", issued_on: "", expires_on: "", notes: "" });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const def = op.documentos.find((d) => d.code === v.doc_type);
  const esLicencia = def?.duenio === "EMPLOYEE";
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("doc_type", v.doc_type);
      if (esLicencia) fd.append("employee_id", v.employee_id); else fd.append("vehicle_id", v.vehicle_id);
      for (const k of ["number", "issuer", "license_class", "issued_on", "expires_on", "notes"] as const) if (v[k]) fd.append(k, v[k]);
      if (archivo) fd.append("archivo", archivo);
      await api("/v1/flo/documentos", { method: "POST", body: fd });
      toast.ok("Documento guardado. Si había uno anterior, quedó reemplazado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  const empleados = [...op.conductores.map((c) => ({ value: c.employee_id ?? "", label: `${c.name} (repartidor)` })).filter((x) => x.value), ...op.empleados.map((x) => ({ value: x.id, label: x.full_name }))]
    .filter((x, i, a) => a.findIndex((y) => y.value === x.value) === i);
  return (
    <Modal open onClose={onClose} title={base.vehicle_id || base.employee_id ? `${def?.nombre ?? "Documento"} nuevo` : "Registrar documento"} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-doc" loading={guardando}>Guardar</Button></>}>
      <form id="f-doc" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Tipo" required><Select value={v.doc_type} onChange={(e) => pon("doc_type", e.target.value)} options={op.documentos.map((d) => ({ value: d.code, label: d.nombre }))} /></Field>
        {esLicencia
          ? <Field label="Conductor" required><Select value={v.employee_id} onChange={(e) => pon("employee_id", e.target.value)} placeholder="Elige" options={empleados} /></Field>
          : <Field label="Vehículo" required><Select value={v.vehicle_id} onChange={(e) => pon("vehicle_id", e.target.value)} placeholder="Elige" options={op.vehiculos.map((x) => ({ value: x.id, label: x.etiqueta }))} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Número" required><Input value={v.number} maxLength={40} onChange={(e) => pon("number", e.target.value.toUpperCase())} /></Field>
          <Field label="Emisor"><Input value={v.issuer} maxLength={120} placeholder={esLicencia ? "MTC" : "Aseguradora, CITV…"} onChange={(e) => pon("issuer", e.target.value)} /></Field>
          {esLicencia && <Field label="Clase y categoría"><Input value={v.license_class} maxLength={20} placeholder="A-IIb, B-IIc…" onChange={(e) => pon("license_class", e.target.value.toUpperCase())} /></Field>}
          <Field label="Emitido el"><Input type="date" value={v.issued_on} onChange={(e) => pon("issued_on", e.target.value)} /></Field>
          <Field label="Vence el" required={def?.vence}><Input type="date" value={v.expires_on} onChange={(e) => pon("expires_on", e.target.value)} /></Field>
        </div>
        <Field label="Archivo (PDF o foto)">
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="block w-full text-[13px] file:mr-3 file:cursor-pointer file:rounded-[9px] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px]" />
        </Field>
        <Field label="Notas"><Textarea value={v.notes} maxLength={1000} onChange={(e) => pon("notes", e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
