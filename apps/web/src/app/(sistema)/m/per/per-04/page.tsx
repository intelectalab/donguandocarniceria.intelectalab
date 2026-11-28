"use client";

import { useState, type FormEvent } from "react";
import { Moon, Pencil, Plus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { ErrorCarga, Estado, FiltroLocal, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ACTIVO, type Opciones } from "@/modulos/per/tipos";

type Turno = {
  id: string; establishment_id: string; local: string; code: string; name: string; start_time: string; end_time: string; break_minutes: number;
  crosses_midnight: boolean; late_tolerance_minutes: number | null; tolerancia: number; horas: number; status: string; semana: number;
};

/** PER-04 Turnos por local: entrada, salida, refrigerio, tolerancia y si cruza medianoche. */
export default function Turnos() {
  const { datos: op } = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<{ data: Turno[] }>("/v1/per/turnos");
  const [local, setLocal] = useState("");
  const [editar, setEditar] = useState<Turno | "nuevo" | null>(null);
  if (error) return <ErrorCarga error={error} que="Los turnos los define RR. HH." />;
  const gestiona = Boolean(op?.permisos.gestiona);
  const filas = (datos?.data ?? []).filter((t) => !local || t.establishment_id === local);
  const columnas: Column<Turno>[] = [
    { key: "name", header: "Turno", cardTitle: true, render: (t) => <span className="flex flex-col"><span className="font-medium">{t.code} · {t.name}</span><span className="text-[12px] text-muted">{t.local}</span></span> },
    { key: "horario", header: "Horario", render: (t) => <span className="flex items-center gap-1.5 tabular-nums">{t.start_time}–{t.end_time}{t.crosses_midnight && <Badge tone="info"><Moon className="inline h-3 w-3" /> cruza medianoche</Badge>}</span> },
    { key: "break_minutes", header: "Refrigerio", render: (t) => `${t.break_minutes} min` },
    { key: "horas", header: "Horas", align: "right", render: (t) => numero(t.horas, 1) },
    { key: "tolerancia", header: "Tolerancia", render: (t) => <span>{t.tolerancia} min{t.late_tolerance_minutes === null && <span className="text-[12px] text-muted"> (general)</span>}</span> },
    { key: "semana", header: "Esta semana", hideOnMobile: true, align: "right", render: (t) => `${t.semana} turnos` },
    { key: "status", header: "Estado", render: (t) => <Estado s={t.status} labels={ACTIVO} /> },
    ...(gestiona ? [{ key: "acc", header: "", render: (t: Turno) => <Button size="sm" variant="ghost" icon={Pencil} onClick={(e) => { e.stopPropagation(); setEditar(t); }}>Editar</Button> }] : []),
  ];
  return (
    <div className="space-y-4">
      <PageHeader description={`La tardanza se cuenta pasada la tolerancia del turno (si no tiene, la general de ${op?.parametros.tolerancia ?? 10} min). Un turno que cruza la medianoche se cuenta en el día en que empieza.`}
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Turno</Button>} />
      <div className="flex flex-wrap gap-2"><FiltroLocal op={op} value={local} onChange={setLocal} /></div>
      <DataTable rows={filas} columns={columnas} loading={cargando} empty={<Vacio>No hay turnos en este local.</Vacio>} />
      {editar && op && <Formulario op={op} turno={editar === "nuevo" ? null : editar} onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

function Formulario({ op, turno, onClose, onListo }: { op: Opciones; turno: Turno | null; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({
    establishment_id: turno?.establishment_id ?? op.locales[0]?.id ?? "", code: turno?.code ?? "", name: turno?.name ?? "", start_time: turno?.start_time ?? "08:00",
    end_time: turno?.end_time ?? "17:00", break_minutes: String(turno?.break_minutes ?? 60), late_tolerance_minutes: turno?.late_tolerance_minutes === null || !turno ? "" : String(turno.late_tolerance_minutes),
    status: turno?.status ?? "ACTIVE",
  });
  const [cruza, setCruza] = useState(turno?.crosses_midnight ?? false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const sugiere = v.end_time <= v.start_time;
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const body = { ...v, break_minutes: Number(v.break_minutes), late_tolerance_minutes: v.late_tolerance_minutes === "" ? null : Number(v.late_tolerance_minutes), crosses_midnight: cruza };
      await api(turno ? `/v1/per/turnos/${turno.id}` : "/v1/per/turnos", { method: turno ? "PUT" : "POST", body });
      toast.ok(turno ? "Turno actualizado." : "Turno creado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={turno ? `Editar ${turno.code}` : "Nuevo turno"} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-turno" loading={guardando}>Guardar</Button></>}>
      <form id="f-turno" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Local" required><Select value={v.establishment_id} onChange={(e) => pon("establishment_id", e.target.value)} options={op.locales.map((l) => ({ value: l.id, label: l.short }))} /></Field>
        <div className="grid grid-cols-[100px_1fr] gap-3">
          <Field label="Código" required><Input value={v.code} maxLength={12} onChange={(e) => pon("code", e.target.value.toUpperCase())} /></Field>
          <Field label="Nombre" required><Input value={v.name} maxLength={80} onChange={(e) => pon("name", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entrada" required><Input type="time" value={v.start_time} onChange={(e) => pon("start_time", e.target.value)} /></Field>
          <Field label="Salida" required><Input type="time" value={v.end_time} onChange={(e) => pon("end_time", e.target.value)} /></Field>
          <Field label="Refrigerio (min)" required><Input inputMode="numeric" value={v.break_minutes} onChange={(e) => pon("break_minutes", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Tolerancia (min)" hint={`Vacío: la general (${op.parametros.tolerancia} min).`}><Input inputMode="numeric" value={v.late_tolerance_minutes} onChange={(e) => pon("late_tolerance_minutes", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Estado"><Select value={v.status} onChange={(e) => pon("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>
        </div>
        <Checkbox checked={cruza} onChange={setCruza} label="Cruza la medianoche" hint={sugiere && !cruza ? "La salida es antes que la entrada: marca esta opción." : undefined} />
      </form>
    </Modal>
  );
}
