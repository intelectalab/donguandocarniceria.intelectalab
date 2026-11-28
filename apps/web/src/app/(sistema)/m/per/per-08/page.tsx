"use client";

import { useState, type FormEvent } from "react";
import { CalendarPlus, Hand, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroFecha, Input, Modal, PageHeader, Select, Tabs, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { ErrorCarga, Estado, FiltroLocal, FiltroMes, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ESTADO_DIA, ESTADO_PERMISO, MARCAS, PERMISOS, hora, hoyLima, inicioMes, minutos, sumarDias, type Opciones } from "@/modulos/per/tipos";

type Dia = {
  id: string; employee_id: string; trabajador: string; turno: string | null; puesto: string | null; work_date: string; first_in: string | null; last_out: string | null;
  worked_minutes: number; late_minutes: number; overtime_minutes: number; unauthorized_minutes: number; status: string; justification: string | null; justification_approved: boolean;
};
type Marca = { id: string; employee_id: string; trabajador: string; tipo: string; marked_at: string; method: string; distance_m: number | null; is_valid: boolean; invalid_reason: string | null; manual_reason: string | null; synced_late: boolean; aprobo: string | null };
type Diaria = { fecha: string; feriado: boolean; resumen: { presentes: number; tardanzas: number; min_tardanza: number; faltas: number; permisos: number; horas_extra: number; no_autorizado: number; invalidas: number }; dias: Dia[]; marcas: Marca[] };
type Mes = { data: { employee_id: string; trabajador: string; trabajados: number; programados: number; asistencia_pct: number | null; tardanzas: number; min_tardanza: number; faltas: number; permisos: number; horas_extra: number; no_autorizado: number }[] };
type Permiso = { id: string; employee_id: string; trabajador: string; leave_type: string; tipo: string; date_from: string; date_to: string; days: number; reason: string; status: string; aprobo: string | null; decision_note: string | null; puede_decidir: boolean };

/** PER-08 Asistencia diaria: consolidado por día con tardanza, horas extra y faltas; justificaciones, marcación manual y permisos (RN-PER-05, 07 y 08). */
export default function Asistencia() {
  const [vista, setVista] = useState<"dia" | "mes" | "permisos">("dia");
  const { datos: op } = useOpciones();
  return (
    <div className="space-y-4">
      <PageHeader description="Cada día se arma con las marcaciones válidas y el turno programado. La tardanza se cuenta pasada la tolerancia; las horas extra solo cuentan si se autorizaron. Justificar o marcar a mano lo hace una persona distinta del trabajador." />
      <Tabs tabs={[{ key: "dia", label: "Día" }, { key: "mes", label: "Resumen del mes" }, { key: "permisos", label: "Permisos y vacaciones" }]} value={vista} onChange={setVista} />
      {vista === "dia" && <PorDia op={op} />}
      {vista === "mes" && <PorMes />}
      {vista === "permisos" && <Permisos op={op} />}
    </div>
  );
}

function PorDia({ op }: { op: Opciones | null }) {
  const [dia, setDia] = useState(hoyLima());
  const [local, setLocal] = useState("");
  const [estado, setEstado] = useState("");
  const [manual, setManual] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const { datos, error, cargando, recargar } = useDatos<Diaria>(`/v1/per/asistencia?fecha=${dia}${local ? `&local=${local}` : ""}`);
  if (error) return <ErrorCarga error={error} que="La asistencia la revisan RR. HH. y los supervisores." />;
  const aprueba = Boolean(op?.permisos.aprueba_asistencia);
  const r = datos?.resumen;
  async function justificar(d: Dia) {
    const x = await confirmAction({ title: `Justificar ${d.status === "LATE" ? "tardanza" : "falta"} de ${d.trabajador}`, message: "Queda justificada y aprobada por ti; no se descuenta.", confirmLabel: "Justificar", reason: { label: "Motivo", min: 10 } });
    if (!x) return;
    try {
      await api(`/v1/per/asistencia/${d.id}/justificar`, { method: "POST", body: { text: x.reason } });
      toast.ok("Justificación aprobada.");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  async function consolidar() {
    setProcesando(true);
    try {
      const x = await api<{ consolidados: number }>("/v1/per/asistencia/consolidar", { method: "POST", body: { fecha: dia } });
      toast.ok(`${x.consolidados} días recalculados.`);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }
  const dias = (datos?.dias ?? []).filter((d) => !estado || d.status === estado);
  const columnas: Column<Dia>[] = [
    { key: "trabajador", header: "Trabajador", cardTitle: true, render: (d) => <span className="flex flex-col"><span className="font-medium">{d.trabajador}</span><span className="text-[12px] text-muted">{d.turno ?? "sin turno"}</span></span> },
    { key: "first_in", header: "Entrada", render: (d) => hora(d.first_in) },
    { key: "last_out", header: "Salida", render: (d) => hora(d.last_out) },
    { key: "worked_minutes", header: "Trabajado", align: "right", render: (d) => minutos(d.worked_minutes) },
    { key: "late_minutes", header: "Tardanza", align: "right", render: (d) => d.late_minutes ? <span className="text-warn">{minutos(d.late_minutes)}</span> : "—" },
    { key: "overtime_minutes", header: "Extra", align: "right", hideOnMobile: true, render: (d) => <span className="flex flex-col items-end">{minutos(d.overtime_minutes)}{d.unauthorized_minutes > 0 && <span className="text-[11.5px] text-muted">{minutos(d.unauthorized_minutes)} sin autorizar</span>}</span> },
    { key: "status", header: "Estado", render: (d) => <span className="flex flex-col items-end gap-0.5"><Estado s={d.status} labels={ESTADO_DIA} />{d.justification_approved && <span className="text-[11.5px] text-ok">justificada</span>}</span> },
    ...(aprueba ? [{ key: "acc", header: "", render: (d: Dia) => ["LATE", "ABSENT"].includes(d.status) && !d.justification_approved && <Button size="sm" onClick={(e) => { e.stopPropagation(); justificar(d); }}>Justificar</Button> }] : []),
  ];
  const invalidas = (datos?.marcas ?? []).filter((m) => !m.is_valid || m.method === "MANUAL" || m.synced_late);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FiltroFecha etiqueta="Día" value={dia} max={hoyLima()} onChange={(v) => v && setDia(v)} />
        <Button size="sm" variant="ghost" onClick={() => setDia(sumarDias(dia, -1))}>Día anterior</Button>
        <FiltroLocal op={op} value={local} onChange={setLocal} />
        <span className="flex-1" />
        {aprueba && <Button size="sm" icon={Hand} onClick={() => setManual(true)}>Marcación manual</Button>}
        {aprueba && <Button size="sm" icon={RefreshCw} loading={procesando} onClick={consolidar}>Recalcular el día</Button>}
      </div>
      {datos?.feriado && <Alert tone="info">Feriado: quien trabaja se paga como horas extra si se autorizó.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Asistieron" valor={r ? String(r.presentes) : undefined} destacada />
        <Cifra titulo="Tardanzas" valor={r ? String(r.tardanzas) : undefined} detalle={r ? `${r.min_tardanza} min en total` : ""} tono={r?.tardanzas ? "warn" : undefined} />
        <Cifra titulo="Faltas" valor={r ? String(r.faltas) : undefined} detalle={r ? `${r.permisos} con permiso` : ""} tono={r?.faltas ? "bad" : undefined} />
        <Cifra titulo="Marcaciones inválidas" valor={r ? String(r.invalidas) : undefined} detalle={r ? `${numero(r.horas_extra, 1)} h extra autorizadas` : ""} tono={r?.invalidas ? "bad" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect2 value={estado} onChange={setEstado} />
      </div>
      <DataTable rows={dias} columns={columnas} loading={cargando} empty={<Vacio>Sin días registrados con estos filtros.</Vacio>} />
      {invalidas.length > 0 && (
        <Seccion titulo="Marcaciones a revisar">
          <ul className="space-y-2 text-[13px]">
            {invalidas.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-2 last:border-0">
                <span className="min-w-0"><span className="font-medium">{m.trabajador}</span> · {m.tipo} {hora(m.marked_at)}
                  <span className="block text-[12px] text-muted">{m.invalid_reason ?? (m.method === "MANUAL" ? `Manual: ${m.manual_reason ?? ""}${m.aprobo ? ` · registró ${m.aprobo}` : ""}` : "Enviada sin conexión")}</span>
                </span>
                {!m.is_valid ? <Badge tone="bad">inválida</Badge> : m.method === "MANUAL" ? <Badge tone="info">manual</Badge> : <Badge tone="warn">sin conexión</Badge>}
              </li>
            ))}
          </ul>
        </Seccion>
      )}
      {manual && op && <Manual op={op} dia={dia} onClose={() => setManual(false)} onListo={() => { setManual(false); recargar(); }} />}
    </div>
  );
}

function FiltroSelect2({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="w-full sm:w-[180px]">
      <Select aria-label="Estado" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Estado: todos" options={Object.entries(ESTADO_DIA).filter(([k]) => !["PENDING", "INCOMPLETE"].includes(k)).map(([value, [label]]) => ({ value, label }))} />
    </div>
  );
}

function Manual({ op, dia, onClose, onListo }: { op: Opciones; dia: string; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({ employee_id: "", establishment_id: op.locales[0]?.id ?? "", mark_type: "IN", hora: "08:00", manual_reason: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api("/v1/per/marcaciones", { method: "POST", body: { method: "MANUAL", employee_id: v.employee_id, establishment_id: v.establishment_id, mark_type: v.mark_type,
        marked_at: `${dia}T${v.hora}:00-05:00`, manual_reason: v.manual_reason } });
      toast.ok("Marcación manual registrada y aprobada por ti.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Marcación manual · ${fecha(dia)}`} description="Para cuando el celular o el QR fallaron. Queda con tu nombre como quien la aprueba; no puedes marcarte a ti mismo (RN-PER-05)." dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-manual" loading={guardando}>Registrar</Button></>}>
      <form id="f-manual" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Trabajador" required><Select value={v.employee_id} onChange={(e) => pon("employee_id", e.target.value)} placeholder="Elige" options={op.trabajadores.filter((t) => t.id !== op.yo).map((t) => ({ value: t.id, label: t.full_name }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Local" required><Select value={v.establishment_id} onChange={(e) => pon("establishment_id", e.target.value)} options={op.locales.map((l) => ({ value: l.id, label: l.short }))} /></Field>
          <Field label="Tipo" required><Select value={v.mark_type} onChange={(e) => pon("mark_type", e.target.value)} options={Object.entries(MARCAS).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Hora" required><Input type="time" value={v.hora} onChange={(e) => pon("hora", e.target.value)} /></Field>
        </div>
        <Field label="Motivo" required hint="Al menos 10 letras."><Textarea value={v.manual_reason} maxLength={500} onChange={(e) => pon("manual_reason", e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function PorMes() {
  const [mes, setMes] = useState(inicioMes(hoyLima()));
  const { datos, error, cargando } = useDatos<Mes>(`/v1/per/asistencia/mes?mes=${mes}`);
  if (error) return <ErrorCarga error={error} que="El resumen del mes lo ven RR. HH. y los supervisores." />;
  type F = Mes["data"][number];
  const columnas: Column<F>[] = [
    { key: "trabajador", header: "Trabajador", cardTitle: true, render: (f) => <span className="font-medium">{f.trabajador}</span> },
    { key: "trabajados", header: "Días", align: "right", render: (f) => `${f.trabajados} de ${f.programados}` },
    { key: "asistencia_pct", header: "Asistencia", align: "right", render: (f) => f.asistencia_pct === null ? "—" : <span className={f.asistencia_pct < 95 ? "text-warn" : ""}>{numero(f.asistencia_pct, 1)} %</span> },
    { key: "tardanzas", header: "Tardanzas", align: "right", render: (f) => f.tardanzas ? `${f.tardanzas} (${f.min_tardanza} min)` : "—" },
    { key: "faltas", header: "Faltas", align: "right", render: (f) => f.faltas ? <span className="text-bad">{f.faltas}</span> : "—" },
    { key: "permisos", header: "Permisos", align: "right", hideOnMobile: true, render: (f) => f.permisos || "—" },
    { key: "horas_extra", header: "H. extra", align: "right", hideOnMobile: true, render: (f) => f.horas_extra ? numero(f.horas_extra, 1) : "—" },
    { key: "no_autorizado", header: "Sin autorizar", align: "right", hideOnMobile: true, render: (f) => minutos(f.no_autorizado) },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2"><FiltroMes value={mes} onChange={setMes} /></div>
      <DataTable rows={datos?.data ?? []} rowKey={(f) => f.employee_id} columns={columnas} loading={cargando} empty={<Vacio>Sin asistencia en el mes.</Vacio>} />
    </div>
  );
}

function Permisos({ op }: { op: Opciones | null }) {
  const { datos, error, cargando, recargar } = useDatos<{ data: Permiso[] }>("/v1/per/permisos");
  const [pedir, setPedir] = useState(false);
  if (error) return <ErrorCarga error={error} que="Los permisos los aprueban RR. HH. y los supervisores." />;
  async function decidir(p: Permiso, aprobar: boolean) {
    const x = await confirmAction({ title: `${aprobar ? "Aprobar" : "Rechazar"} ${p.tipo.toLowerCase()} de ${p.trabajador}`, message: `${fecha(p.date_from)} a ${fecha(p.date_to)} (${p.days} días).`,
      confirmLabel: aprobar ? "Aprobar" : "Rechazar", danger: !aprobar, reason: { label: "Nota", optional: aprobar, min: aprobar ? 0 : 5 } });
    if (!x) return;
    try {
      await api(`/v1/per/permisos/${p.id}/decidir`, { method: "POST", body: { aprobar, note: x.reason || null } });
      toast.ok(aprobar ? "Aprobado: esos días no cuentan como falta." : "Rechazado.");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  const columnas: Column<Permiso>[] = [
    { key: "trabajador", header: "Trabajador", cardTitle: true, render: (p) => <span className="font-medium">{p.trabajador}</span> },
    { key: "tipo", header: "Tipo", render: (p) => p.tipo },
    { key: "date_from", header: "Fechas", render: (p) => <span className="flex flex-col"><span>{fecha(p.date_from)} – {fecha(p.date_to)}</span><span className="text-[12px] text-muted">{p.days} días</span></span> },
    { key: "reason", header: "Motivo", hideOnMobile: true, render: (p) => <span className="text-[12.5px]">{p.reason}{p.decision_note ? <span className="block text-muted">Nota: {p.decision_note}</span> : null}</span> },
    { key: "status", header: "Estado", render: (p) => <span className="flex flex-col items-end gap-0.5"><Estado s={p.status} labels={ESTADO_PERMISO} />{p.aprobo && <span className="text-[11.5px] text-muted">{p.aprobo}</span>}</span> },
    { key: "acc", header: "", render: (p) => p.status === "REQUESTED" && p.puede_decidir && (
      <span className="flex justify-end gap-1">
        <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); decidir(p, true); }}>Aprobar</Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); decidir(p, false); }}>Rechazar</Button>
      </span>
    ) },
  ];
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" icon={CalendarPlus} onClick={() => setPedir(true)}>Pedir permiso</Button></div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>Sin permisos ni vacaciones registrados.</Vacio>} />
      {pedir && op && <Pedir op={op} onClose={() => setPedir(false)} onListo={() => { setPedir(false); recargar(); }} />}
    </div>
  );
}

function Pedir({ op, onClose, onListo }: { op: Opciones; onClose: () => void; onListo: () => void }) {
  const hoy = hoyLima();
  const [v, setV] = useState({ employee_id: op.yo ?? "", leave_type: "PERMISSION", date_from: sumarDias(hoy, 1), date_to: sumarDias(hoy, 1), reason: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const otros = op.permisos.gestiona || op.permisos.aprueba_asistencia;
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api("/v1/per/permisos", { method: "POST", body: { ...v, employee_id: v.employee_id || null } });
      toast.ok("Solicitud enviada a tu supervisor y RR. HH.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Pedir permiso o vacaciones" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-permiso" loading={guardando}>Enviar</Button></>}>
      <form id="f-permiso" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        {otros && <Field label="Trabajador"><Select value={v.employee_id} onChange={(e) => pon("employee_id", e.target.value)} placeholder="Yo" options={op.trabajadores.map((t) => ({ value: t.id, label: t.full_name }))} /></Field>}
        <Field label="Tipo" required><Select value={v.leave_type} onChange={(e) => pon("leave_type", e.target.value)} options={Object.entries(PERMISOS).map(([value, label]) => ({ value, label }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde" required><Input type="date" value={v.date_from} onChange={(e) => pon("date_from", e.target.value)} /></Field>
          <Field label="Hasta" required><Input type="date" value={v.date_to} min={v.date_from} onChange={(e) => pon("date_to", e.target.value)} /></Field>
        </div>
        <Field label="Motivo" required><Textarea value={v.reason} maxLength={500} onChange={(e) => pon("reason", e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
