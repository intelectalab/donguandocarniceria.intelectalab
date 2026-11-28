"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Checkbox, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, toast, type Column } from "@/components/ui";
import { ApiError, api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { ErrorCarga, Estado, OCULTO, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { FORMAS, FUENTES, VIGENCIA, hoyLima, inicioMes, type Opciones } from "@/modulos/per/tipos";

type Cond = {
  id: string; employee_id: string; trabajador: string; pay_scheme: string; forma: string; monto: number | null; payroll_source: string; fuente: string;
  external_ref: string | null; valid_from: string; valid_to: string | null; estado: string;
};
type Lista = { data: Cond[]; resumen: { vigentes: number; mensuales: number; variables: number; planilla_mensual: number | null; fuente_defecto: string }; ve_sueldos: boolean };

const UNIDAD: Record<string, string> = { MONTHLY: "al mes", DAILY: "por día", HOURLY: "por hora" };

/** PER-03 Condiciones de pago: sueldo, jornal o tarifa por hora con vigencia y fuente de planilla (RN-PER-02: sin traslapes). */
export default function Condiciones() {
  const { datos: op } = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<Lista>("/v1/per/condiciones");
  const [vigencia, setVigencia] = useState("CURRENT");
  const [forma, setForma] = useState("");
  const [nueva, setNueva] = useState<string | null>(null);
  if (error) return <ErrorCarga error={error} que="Las condiciones de pago las ve RR. HH. y Administración." />;
  const gestiona = Boolean(op?.permisos.gestiona);
  const filas = (datos?.data ?? []).filter((c) => (!vigencia || c.estado === vigencia) && (!forma || c.pay_scheme === forma));
  const r = datos?.resumen;
  const columnas: Column<Cond>[] = [
    { key: "trabajador", header: "Trabajador", cardTitle: true, render: (c) => <span className="font-medium">{c.trabajador}</span> },
    { key: "forma", header: "Forma", render: (c) => c.forma },
    { key: "monto", header: "Monto", align: "right", render: (c) => c.monto === null ? OCULTO : <span className="flex flex-col items-end"><span className="tabular-nums">{soles(c.monto)}</span><span className="text-[12px] text-muted">{UNIDAD[c.pay_scheme]}</span></span> },
    { key: "fuente", header: "Fuente de planilla", hideOnMobile: true, render: (c) => <span className="flex flex-col"><span>{c.fuente}</span><span className="text-[12px] text-muted">{c.external_ref ?? ""}</span></span> },
    { key: "valid_from", header: "Vigencia", render: (c) => `${fecha(c.valid_from)}${c.valid_to ? ` – ${fecha(c.valid_to)}` : " en adelante"}` },
    { key: "estado", header: "Estado", render: (c) => <Estado s={c.estado} labels={VIGENCIA} /> },
    ...(gestiona ? [{ key: "acc", header: "", render: (c: Cond) => c.estado !== "PAST" && <Button size="sm" onClick={(e) => { e.stopPropagation(); setNueva(c.employee_id); }}>Nueva condición</Button> }] : []),
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Cada trabajador tiene una sola condición de pago vigente en cada fecha. Para un aumento se registra una nueva con su fecha de inicio y se cierra la anterior. Los jornales y tarifas por hora se pagan con la asistencia en Pagos al personal."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setNueva("")}>Condición</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Planilla mensual" valor={r ? (r.planilla_mensual === null ? OCULTO : soles(r.planilla_mensual)) : undefined} detalle="remuneraciones vigentes" destacada />
        <Cifra titulo="Condiciones vigentes" valor={r ? String(r.vigentes) : undefined} />
        <Cifra titulo="Sueldo mensual" valor={r ? String(r.mensuales) : undefined} detalle="personas" />
        <Cifra titulo="Jornal o por hora" valor={r ? String(r.variables) : undefined} detalle="se pagan por asistencia" />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Vigencia" value={vigencia} onChange={setVigencia} todos="todas" options={Object.entries(VIGENCIA).map(([value, [label]]) => ({ value, label }))} />
        <FiltroSelect etiqueta="Forma" value={forma} onChange={setForma} todos="todas" options={Object.entries(FORMAS).map(([value, label]) => ({ value, label }))} />
      </div>
      <DataTable rows={filas} columns={columnas} loading={cargando} empty={<Vacio>No hay condiciones con estos filtros.</Vacio>} />
      {nueva !== null && op && <Formulario op={op} empleado={nueva} fuente={r?.fuente_defecto ?? "AYNI_HR"} onClose={() => setNueva(null)} onListo={() => { setNueva(null); recargar(); }} />}
    </div>
  );
}

function Formulario({ op, empleado, fuente, onClose, onListo }: { op: Opciones; empleado: string; fuente: string; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({ employee_id: empleado, pay_scheme: "MONTHLY", monto: "", payroll_source: fuente, external_ref: "", valid_from: inicioMes(hoyLima()) });
  const [cerrar, setCerrar] = useState(false);
  const [traslape, setTraslape] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const campo = v.pay_scheme === "MONTHLY" ? "monthly_amount" : v.pay_scheme === "DAILY" ? "daily_rate" : "hourly_rate";
      await api("/v1/per/condiciones", { method: "POST", body: { employee_id: v.employee_id, pay_scheme: v.pay_scheme, [campo]: Number(v.monto), payroll_source: v.payroll_source,
        external_ref: v.external_ref || null, valid_from: v.valid_from, close_previous: cerrar } });
      toast.ok("Condición de pago registrada.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
      if (x instanceof ApiError && x.code === "RN-PER-02") setTraslape(true);
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Nueva condición de pago" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-cond" loading={guardando}>Guardar</Button></>}>
      <form id="f-cond" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Trabajador" required><Select value={v.employee_id} onChange={(e) => pon("employee_id", e.target.value)} placeholder="Elige" options={op.trabajadores.map((t) => ({ value: t.id, label: t.full_name }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Forma de pago" required><Select value={v.pay_scheme} onChange={(e) => pon("pay_scheme", e.target.value)} options={Object.entries(FORMAS).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label={`Monto ${UNIDAD[v.pay_scheme]} (S/)`} required><Input inputMode="decimal" value={v.monto} onChange={(e) => pon("monto", e.target.value.replace(",", "."))} /></Field>
          <Field label="Fuente de planilla"><Select value={v.payroll_source} onChange={(e) => pon("payroll_source", e.target.value)} options={Object.entries(FUENTES).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Código en Ayni HR o del contador"><Input value={v.external_ref} maxLength={40} onChange={(e) => pon("external_ref", e.target.value)} /></Field>
          <Field label="Vigente desde" required><Input type="date" value={v.valid_from} onChange={(e) => pon("valid_from", e.target.value)} /></Field>
        </div>
        {(traslape || cerrar) && <Checkbox checked={cerrar} onChange={setCerrar} label="Cerrar la condición anterior el día previo" hint="Así no se traslapan (RN-PER-02)." />}
      </form>
    </Modal>
  );
}
