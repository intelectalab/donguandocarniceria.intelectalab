"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, FiltroSelect, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { ErrorCarga, Estado, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ACCIONES, ESTADO_SUP, ORIGENES, SEVERIDAD, hora, type Opciones } from "@/modulos/per/tipos";

type Caso = {
  id: string; employee_id: string; trabajador: string; supervisor: string | null; source: string; origen: string; severity: string; summary: string;
  action: string | null; accion: string | null; action_note: string | null; registro: string | null; action_at: string | null; status: string; raised_at: string; puede_registrar: boolean;
};
type Lista = { data: Caso[]; resumen: { abiertas: number; graves: number; cerradas_mes: number; retenidos: number } };

/** PER-13 Supervisión: alertas de control (CRM, TEL, FLO, asistencia) del trabajador y su supervisor, con la acción tomada; una vez atendida no se edita (RN-PER-16). */
export default function Supervision() {
  const { datos: op } = useOpciones();
  const [estado, setEstado] = useState("OPEN");
  const [origen, setOrigen] = useState("");
  const q = new URLSearchParams({ ...(estado ? { estado } : {}), ...(origen ? { origen } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/per/supervision?${q}`);
  const [caso, setCaso] = useState<Caso | null>(null);
  const [nueva, setNueva] = useState(false);
  if (error) return <ErrorCarga error={error} que="La supervisión la llevan los supervisores y RR. HH." />;
  const r = datos?.resumen;
  const columnas: Column<Caso>[] = [
    { key: "trabajador", header: "Trabajador", cardTitle: true, render: (c) => <span className="flex flex-col"><span className="font-medium">{c.trabajador}</span><span className="text-[12px] text-muted">{c.supervisor ? `Supervisa ${c.supervisor}` : "Sin supervisor"}</span></span> },
    { key: "origen", header: "Origen", render: (c) => <span className="flex flex-col"><span>{c.origen}</span><span className="text-[12px] text-muted">{fecha(c.raised_at)} {hora(c.raised_at)}</span></span> },
    { key: "summary", header: "Qué pasó", render: (c) => <span className="line-clamp-3 text-[12.5px]">{c.summary}</span> },
    { key: "severity", header: "Gravedad", render: (c) => <Estado s={c.severity} labels={SEVERIDAD} /> },
    { key: "accion", header: "Acción", hideOnMobile: true, render: (c) => c.accion ? <span className="flex flex-col text-[12.5px]"><span>{c.accion}</span><span className="text-muted">{c.registro} · {fecha(c.action_at)}</span></span> : "—" },
    { key: "status", header: "Estado", render: (c) => <Estado s={c.status} labels={ESTADO_SUP} /> },
    { key: "acc", header: "", render: (c) => c.status === "OPEN" && c.puede_registrar && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setCaso(c); }}>Registrar acción</Button> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Llegan aquí las alertas de control de CRM, las llamadas observadas, las alertas y multas de la flota y las observaciones de asistencia, cada una con el trabajador y su supervisor. Mientras haya alertas graves abiertas, la comisión de la persona queda retenida."
        actions={(op?.permisos.supervision || op?.permisos.aprueba_asistencia) && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Observación</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Por atender" valor={r ? String(r.abiertas) : undefined} tono={r?.abiertas ? "warn" : undefined} destacada />
        <Cifra titulo="Graves abiertas" valor={r ? String(r.graves) : undefined} tono={r?.graves ? "bad" : undefined} />
        <Cifra titulo="Atendidas este mes" valor={r ? String(r.cerradas_mes) : undefined} />
        <Cifra titulo="Pagos retenidos" valor={r ? String(r.retenidos) : undefined} detalle="por alertas graves" tono={r?.retenidos ? "bad" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={Object.entries(ESTADO_SUP).map(([value, [label]]) => ({ value, label }))} />
        <FiltroSelect etiqueta="Origen" value={origen} onChange={setOrigen} ancho={200} options={Object.entries(ORIGENES).map(([value, label]) => ({ value, label }))} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>Sin casos con estos filtros.</Vacio>} />
      {caso && <Registrar caso={caso} onClose={() => setCaso(null)} onListo={() => { setCaso(null); recargar(); }} />}
      {nueva && op && <Nueva op={op} onClose={() => setNueva(false)} onListo={() => { setNueva(false); recargar(); }} />}
    </div>
  );
}

function Registrar({ caso, onClose, onListo }: { caso: Caso; onClose: () => void; onListo: () => void }) {
  const [accion, setAccion] = useState("OBSERVATION");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(`/v1/per/supervision/${caso.id}/accion`, { method: "POST", body: { action: accion, note: nota || null } });
      toast.ok("Acción registrada. El caso queda cerrado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Acción sobre ${caso.trabajador}`} description={caso.summary} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-sup" loading={guardando}>Registrar</Button></>}>
      <form id="f-sup" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Alert tone="info">Una vez registrada, la acción no se edita. «Sin acción» descarta la alerta de control.</Alert>
        <Field label="Acción tomada" required><Select value={accion} onChange={(e) => setAccion(e.target.value)} options={Object.entries(ACCIONES).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Detalle" required={accion !== "NO_ACTION"}><Textarea rows={4} value={nota} maxLength={2000} onChange={(e) => setNota(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function Nueva({ op, onClose, onListo }: { op: Opciones; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({ employee_id: "", source: "ATTENDANCE", severity: "MEDIUM", summary: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api("/v1/per/supervision", { method: "POST", body: v });
      toast.ok("Observación registrada.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Nueva observación" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-obs" loading={guardando}>Registrar</Button></>}>
      <form id="f-obs" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Trabajador" required><Select value={v.employee_id} onChange={(e) => pon("employee_id", e.target.value)} placeholder="Elige" options={op.trabajadores.filter((t) => t.id !== op.yo).map((t) => ({ value: t.id, label: t.full_name }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Origen"><Select value={v.source} onChange={(e) => pon("source", e.target.value)} options={[{ value: "ATTENDANCE", label: "Asistencia" }, { value: "OTHER", label: "Otro" }]} /></Field>
          <Field label="Gravedad"><Select value={v.severity} onChange={(e) => pon("severity", e.target.value)} options={Object.entries(SEVERIDAD).map(([value, [label]]) => ({ value, label }))} /></Field>
        </div>
        <Field label="Qué pasó" required><Textarea rows={4} value={v.summary} maxLength={1000} onChange={(e) => pon("summary", e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
