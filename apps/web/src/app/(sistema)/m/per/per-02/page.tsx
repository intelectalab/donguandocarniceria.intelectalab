"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Users } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, DetailList, Field, FiltroSelect, Input, Modal, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { ErrorCarga, Estado, OCULTO, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ACTIVO, AREAS, hoyLima, sumarDias, type Opciones } from "@/modulos/per/tipos";

type Fila = {
  id: string; full_name: string; doc_number: string | null; puesto: string | null; area: string | null; area_nombre: string | null; establishment_id: string | null; local: string | null;
  centros: string; n_centros: number; supervisor: string | null; usuario: string | null; rol: string | null; status: string; sin_asignacion: boolean; hire_date: string | null;
};
type Lista = { data: Fila[]; ve_sueldos: boolean; resumen: { activos: number; sin_asignacion: number; varios_centros: number; sin_usuario: number; por_local: Record<string, number> } };
type Asig = {
  id: string; position_id: string; puesto: string; establishment_id: string; local: string; cost_center_id: string; centro: string; supervisor_employee_id: string | null;
  supervisor: string | null; allocation_pct: number; is_primary: boolean; valid_from: string; valid_to: string | null; reemplazada: boolean;
};
type Ficha = {
  id: string; full_name: string; status: string; hire_date: string | null; doc_type: string | null; doc_number: string | null; phone: string | null; email: string | null;
  usuario: { email: string; role: string } | null; puesto: string | null; area: string; local: string | null; supervisor: string | null;
  asignaciones: Asig[]; programadas: Asig[]; historial: Asig[];
  condicion: { forma: string; pay_scheme: string; fuente: string; remuneracion: number | null; desde: string; external_ref: string | null } | null;
  ve_sueldos: boolean; puede_gestionar: boolean;
  asistencia_mes: { trabajados: number; tardanzas: number; min_tardanza: number; faltas: number; horas_extra: number };
  comisiones_mes: { neta: number | null; bonos: number | null; entregas: number }; alertas_graves: number;
};

/** PER-02 Ficha del trabajador: puesto, local principal, centros de costo con %, usuario, supervisor y estado. */
export default function FichaTrabajador() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  return id ? <Detalle id={id} volver={() => router.push("/m/per/per-02")} /> : <Listado abrir={(x) => router.push(`/m/per/per-02?id=${x}`)} />;
}

function Listado({ abrir }: { abrir: (id: string) => void }) {
  const { datos: op } = useOpciones();
  const { datos, error, cargando } = useDatos<Lista>("/v1/per/trabajadores");
  const [buscar, setBuscar] = useState("");
  const [local, setLocal] = useState("");
  const [area, setArea] = useState("");
  if (error) return <ErrorCarga error={error} que="Las fichas del personal las ve RR. HH.; cada persona ve la suya." />;
  const t = buscar.trim().toLowerCase();
  const filas = (datos?.data ?? []).filter((f) => (!local || f.establishment_id === local) && (!area || f.area === area)
    && (!t || f.full_name.toLowerCase().includes(t) || (f.doc_number ?? "").includes(t) || (f.puesto ?? "").toLowerCase().includes(t)));
  const r = datos?.resumen;
  const columnas: Column<Fila>[] = [
    { key: "full_name", header: "Trabajador", cardTitle: true, render: (f) => <span className="flex flex-col"><span className="font-medium">{f.full_name}</span><span className="text-[12px] text-muted">{f.doc_number ?? ""}</span></span> },
    { key: "puesto", header: "Puesto", render: (f) => f.sin_asignacion ? <Badge tone="bad">Sin asignación</Badge> : <span className="flex flex-col"><span>{f.puesto}</span><span className="text-[12px] text-muted">{f.area_nombre}</span></span> },
    { key: "local", header: "Local", render: (f) => f.local ?? "—" },
    { key: "centros", header: "Centros de costo", hideOnMobile: true, render: (f) => <span className="text-[12.5px]">{f.centros || "—"}</span> },
    { key: "supervisor", header: "Supervisor", hideOnMobile: true, render: (f) => f.supervisor ?? "—" },
    { key: "usuario", header: "Usuario", hideOnMobile: true, render: (f) => f.usuario ? <span className="flex flex-col"><span className="text-[12.5px]">{f.usuario}</span><span className="text-[12px] text-muted">{op?.roles.find((x) => x.code === f.rol)?.name ?? f.rol}</span></span> : <span className="text-muted">Sin usuario</span> },
    { key: "status", header: "Estado", render: (f) => <Estado s={f.status} labels={ACTIVO} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Amplía al trabajador del maestro: puesto, local, centros de costo con su porcentaje, supervisor y usuario. Los datos personales y sueldos solo los ve RR. HH. (Ley 29733)." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Activos" valor={r ? String(r.activos) : undefined} detalle={r ? Object.entries(r.por_local).map(([k, v]) => `${k}: ${v}`).join(" · ") : ""} icono={Users} destacada />
        <Cifra titulo="Sin asignación" valor={r ? String(r.sin_asignacion) : undefined} detalle="sin puesto ni centro de costo" tono={r?.sin_asignacion ? "bad" : undefined} />
        <Cifra titulo="En varios centros" valor={r ? String(r.varios_centros) : undefined} detalle="costo repartido por %" />
        <Cifra titulo="Sin usuario" valor={r ? String(r.sin_usuario) : undefined} detalle="no marcan desde la app" tono={r?.sin_usuario ? "warn" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Local" value={local} onChange={setLocal} options={(op?.locales ?? []).map((l) => ({ value: l.id, label: l.short }))} />
        <FiltroSelect etiqueta="Área" value={area} onChange={setArea} todos="todas" options={Object.entries(AREAS).map(([value, label]) => ({ value, label }))} />
      </div>
      <DataTable rows={filas} columns={columnas} loading={cargando} onRowClick={(f) => abrir(f.id)} search={{ value: buscar, onChange: setBuscar, placeholder: "Nombre, DNI o puesto" }}
        empty={<Vacio>No hay trabajadores con estos filtros.</Vacio>} />
    </div>
  );
}

function Detalle({ id, volver }: { id: string; volver: () => void }) {
  const { datos: op } = useOpciones();
  const { datos: f, error, recargar } = useDatos<Ficha>(`/v1/per/trabajadores/${id}`);
  const [asignar, setAsignar] = useState(false);
  if (error) return <div className="space-y-3"><Button icon={ArrowLeft} variant="ghost" onClick={volver}>Volver</Button><ErrorCarga error={error} que="Solo ves tu propia ficha y la de tu equipo." /></div>;
  if (!f) return <p className="text-[13px] text-muted">Cargando…</p>;
  const a = f.asistencia_mes;
  const asig = (x: Asig) => (
    <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-line py-2 last:border-0">
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{x.puesto} · {x.local} {x.is_primary && <Badge tone="primary">Principal</Badge>}</span>
        <span className="text-[12.5px] text-muted">{x.centro}{x.supervisor ? ` · supervisa ${x.supervisor}` : ""}</span>
        <span className="text-[12px] text-muted">Desde {fecha(x.valid_from)}{x.valid_to ? ` hasta ${fecha(x.valid_to)}` : ""}{x.reemplazada ? " · reemplazada" : ""}</span>
      </span>
      <span className="text-[15px] font-semibold tabular-nums">{numero(x.allocation_pct)} %</span>
    </li>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button icon={ArrowLeft} variant="ghost" onClick={volver}>Trabajadores</Button>
        {f.puede_gestionar && <Button variant="primary" onClick={() => setAsignar(true)}>Cambiar asignación</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[18px] font-semibold text-ink">{f.full_name}</h1>
        <Estado s={f.status} labels={ACTIVO} />
        {f.alertas_graves > 0 && <Badge tone="bad">{f.alertas_graves} alerta(s) grave(s) abierta(s)</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Días trabajados del mes" valor={String(a.trabajados)} detalle={`${a.faltas} falta(s)`} tono={a.faltas ? "warn" : undefined} />
        <Cifra titulo="Tardanzas" valor={String(a.tardanzas)} detalle={`${a.min_tardanza} min en el mes`} tono={a.tardanzas ? "warn" : undefined} />
        <Cifra titulo="Horas extra" valor={numero(a.horas_extra, 1)} detalle="autorizadas" />
        <Cifra titulo="Comisión y bonos del mes" valor={f.comisiones_mes.neta === null ? OCULTO : soles((f.comisiones_mes.neta ?? 0) + (f.comisiones_mes.bonos ?? 0))}
          detalle={f.comisiones_mes.entregas ? `${f.comisiones_mes.entregas} entregas` : "período abierto"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Datos">
          <DetailList items={[
            { label: "Documento", value: f.doc_number ? `${f.doc_type ?? "DNI"} ${f.doc_number}` : OCULTO },
            { label: "Ingreso", value: fecha(f.hire_date) },
            { label: "Puesto", value: `${f.puesto ?? "—"} · ${f.area}` },
            { label: "Local principal", value: f.local ?? "—" },
            { label: "Supervisor", value: f.supervisor ?? "—" },
            { label: "Teléfono", value: f.phone ?? (f.ve_sueldos ? "—" : OCULTO) },
            { label: "Correo", value: f.email ?? (f.ve_sueldos ? "—" : OCULTO) },
            { label: "Usuario del sistema", value: f.usuario ? `${f.usuario.email} · ${op?.roles.find((r) => r.code === f.usuario?.role)?.name ?? f.usuario.role}` : "Sin usuario" },
          ]} />
        </Seccion>
        <Seccion titulo="Condición de pago">
          {f.condicion ? (
            <DetailList items={[
              { label: "Forma", value: f.condicion.forma },
              { label: "Remuneración mensual", value: f.condicion.remuneracion === null ? OCULTO : soles(f.condicion.remuneracion) },
              { label: "Fuente de planilla", value: f.condicion.fuente },
              { label: "Código externo", value: f.condicion.external_ref ?? (f.ve_sueldos ? "—" : OCULTO) },
              { label: "Vigente desde", value: fecha(f.condicion.desde) },
            ]} />
          ) : <Vacio>Sin condición de pago vigente.</Vacio>}
        </Seccion>
      </div>
      <Seccion titulo="Asignaciones vigentes (centros de costo)">
        {f.asignaciones.length ? <ul className="text-[13.5px]">{f.asignaciones.map(asig)}</ul> : <Alert tone="bad">Sin asignación vigente: su costo no se reparte a ningún centro (RN-PER-01).</Alert>}
      </Seccion>
      {f.programadas.length > 0 && <Seccion titulo="Asignaciones programadas"><ul className="text-[13.5px]">{f.programadas.map(asig)}</ul></Seccion>}
      {f.historial.length > 0 && <Seccion titulo="Historial"><ul className="text-[13.5px]">{f.historial.map(asig)}</ul></Seccion>}
      {asignar && op && <Asignar op={op} f={f} onClose={() => setAsignar(false)} onListo={() => { setAsignar(false); recargar(); }} />}
    </div>
  );
}

type FilaA = { position_id: string; establishment_id: string; cost_center_id: string; supervisor_employee_id: string; allocation_pct: string; is_primary: boolean };

function Asignar({ op, f, onClose, onListo }: { op: Opciones; f: Ficha; onClose: () => void; onListo: () => void }) {
  const base = f.programadas.length ? f.programadas : f.asignaciones;
  const [desde, setDesde] = useState(sumarDias(hoyLima(), 1));
  const [filas, setFilas] = useState<FilaA[]>(base.length ? base.map((a) => ({ position_id: a.position_id, establishment_id: a.establishment_id, cost_center_id: a.cost_center_id,
    supervisor_employee_id: a.supervisor_employee_id ?? "", allocation_pct: String(a.allocation_pct), is_primary: a.is_primary }))
    : [{ position_id: "", establishment_id: "", cost_center_id: "", supervisor_employee_id: "", allocation_pct: "100", is_primary: true }]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const suma = filas.reduce((s, x) => s + Number(x.allocation_pct || 0), 0);
  const pon = (i: number, k: keyof FilaA, v: string | boolean) => setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, [k]: v } : k === "is_primary" && v ? { ...x, is_primary: false } : x)));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(`/v1/per/trabajadores/${f.id}/asignaciones`, { method: "POST", body: { valid_from: desde, filas: filas.map((x) => ({ ...x, supervisor_employee_id: x.supervisor_employee_id || null, allocation_pct: Number(x.allocation_pct) })) } });
      toast.ok("Asignación guardada. La anterior queda cerrada el día previo.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="xl" title={`Asignación de ${f.full_name}`} description="Los porcentajes deben sumar 100 % y solo una fila es la principal (RN-PER-01)." dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-asig" loading={guardando}>Guardar</Button></>}>
      <form id="f-asig" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Vigente desde" required className="max-w-[200px]"><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
        {filas.map((x, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_0.8fr_1.3fr_1.2fr_80px_auto]">
            <Field label="Puesto"><Select value={x.position_id} onChange={(e) => pon(i, "position_id", e.target.value)} placeholder="Elige" options={op.puestos.map((p) => ({ value: p.id, label: p.name }))} /></Field>
            <Field label="Local"><Select value={x.establishment_id} onChange={(e) => pon(i, "establishment_id", e.target.value)} placeholder="Elige" options={op.locales.map((l) => ({ value: l.id, label: l.short }))} /></Field>
            <Field label="Centro de costo"><Select value={x.cost_center_id} onChange={(e) => pon(i, "cost_center_id", e.target.value)} placeholder="Elige" options={op.centros.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>
            <Field label="Supervisor"><Select value={x.supervisor_employee_id} onChange={(e) => pon(i, "supervisor_employee_id", e.target.value)} placeholder="Sin supervisor" options={op.supervisores.filter((s) => s.id !== f.id).map((s) => ({ value: s.id, label: s.full_name }))} /></Field>
            <Field label="%"><Input inputMode="decimal" value={x.allocation_pct} onChange={(e) => pon(i, "allocation_pct", e.target.value.replace(",", "."))} /></Field>
            <div className="flex items-end gap-2 pb-1">
              <Checkbox checked={x.is_primary} onChange={(v) => pon(i, "is_primary", v)} label="Principal" />
              {filas.length > 1 && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Quitar fila" onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))} />}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" icon={Plus} onClick={() => setFilas((fs) => [...fs, { ...fs[0], cost_center_id: "", allocation_pct: String(Math.max(0, 100 - suma)), is_primary: false }])}>Otro centro de costo</Button>
          <span className={`text-[13px] font-semibold ${Math.abs(suma - 100) < 0.01 ? "text-ok" : "text-bad"}`}>Suma: {numero(suma, 2)} %</span>
        </div>
      </form>
    </Modal>
  );
}
