"use client";

import { useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { ErrorCarga, FiltroLocal, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { DIAS_CORTOS, hoyLima, sumarDias, type Opciones } from "@/modulos/per/tipos";

type Celda = { fecha: string; id: string | null; shift_id: string | null; codigo: string | null; status: string | null; horario: string | null; horas_extra: number; permiso: string | null; nota: string | null };
type Fila = { employee_id: string; trabajador: string; puesto: string | null; dias: Celda[]; horas: number };
type Semana = { lunes: string; dias: { fecha: string; feriado: boolean }[]; filas: Fila[]; cobertura: number[] };

function lunesDe(f: string): string {
  const d = new Date(`${f}T12:00:00-05:00`).getUTCDay();
  return sumarDias(f, -((d + 6) % 7));
}

function estilo(c: Celda): string {
  if (c.permiso) return "bg-info-soft text-info";
  if (c.status === "REST") return "bg-surface-2 text-muted";
  if (c.status === "SWAPPED") return "bg-primary-soft text-primary";
  if (c.status === "PLANNED") return "bg-ok-soft text-ok";
  return "text-muted";
}

/** PER-05 Programación de turnos: semana por local y trabajador, con descansos, cambios de turno, feriados y horas extra autorizadas. */
export default function Programacion() {
  const { datos: op } = useOpciones();
  const [local, setLocal] = useState("");
  const [lunes, setLunes] = useState(lunesDe(hoyLima()));
  const [celda, setCelda] = useState<{ fila: Fila; c: Celda } | null>(null);
  const [copiando, setCopiando] = useState(false);
  const loc = local || op?.locales[0]?.id || "";
  const { datos, error, cargando, recargar } = useDatos<Semana>(loc ? `/v1/per/programacion?local=${loc}&lunes=${lunes}` : null);
  if (error) return <ErrorCarga error={error} que="La programación la hacen RR. HH. y los supervisores." />;
  const edita = Boolean(op?.permisos.aprueba_asistencia || op?.permisos.gestiona);
  async function copiar() {
    setCopiando(true);
    try {
      const r = await api<{ copiados?: number }>("/v1/per/programacion/copiar", { method: "POST", body: { local: loc, lunes } });
      toast.ok(r.copiados !== undefined ? `${r.copiados} turnos copiados de la semana anterior.` : "Semana copiada.");
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setCopiando(false);
    }
  }
  const hoy = hoyLima();
  return (
    <div className="space-y-4">
      <PageHeader description="Toca un día para asignar turno, descanso o quitarlo. Si cambias el turno ya programado queda como cambio de turno. Las horas extra se autorizan aquí antes del día; las no autorizadas no se pagan (RN-PER-08)."
        actions={edita && <Button icon={Copy} loading={copiando} onClick={copiar}>Copiar semana anterior</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <FiltroLocal op={op} value={loc} onChange={setLocal} todos={false} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="Semana anterior" onClick={() => setLunes(sumarDias(lunes, -7))} />
          <span className="min-w-[170px] text-center text-[13px] font-medium">{fecha(lunes)} – {fecha(sumarDias(lunes, 6))}</span>
          <Button size="sm" variant="ghost" icon={ChevronRight} aria-label="Semana siguiente" onClick={() => setLunes(sumarDias(lunes, 7))} />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setLunes(lunesDe(hoy))}>Esta semana</Button>
      </div>
      <Seccion>
        {cargando && <Vacio>Cargando…</Vacio>}
        {datos && !datos.filas.length && <Vacio>No hay personal asignado a este local.</Vacio>}
        {datos && datos.filas.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[760px] border-separate border-spacing-1 text-[12.5px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface text-left font-semibold text-muted">Trabajador</th>
                  {datos.dias.map((d, i) => (
                    <th key={d.fecha} className={`text-center font-semibold ${d.fecha === hoy ? "text-primary" : "text-muted"}`}>
                      {DIAS_CORTOS[i]} {d.fecha.slice(8)}{d.feriado && <span className="block text-[11px] font-normal text-warn">feriado</span>}
                    </th>
                  ))}
                  <th className="text-right font-semibold text-muted">Horas</th>
                </tr>
              </thead>
              <tbody>
                {datos.filas.map((f) => (
                  <tr key={f.employee_id}>
                    <td className="sticky left-0 z-10 max-w-[170px] bg-surface pr-2"><span className="block truncate font-medium">{f.trabajador}</span><span className="block truncate text-[11.5px] text-muted">{f.puesto}</span></td>
                    {f.dias.map((c) => (
                      <td key={c.fecha} className="p-0">
                        <button type="button" disabled={!edita} onClick={() => setCelda({ fila: f, c })} title={c.nota ?? undefined}
                          className={`flex h-12 w-full flex-col items-center justify-center rounded-md border border-line ${estilo(c)} ${edita ? "hover:border-primary" : "cursor-default"}`}>
                          <span className="font-semibold">{c.permiso ? c.permiso.split(" ")[0] : c.status === "REST" ? "Desc." : c.codigo ?? "—"}</span>
                          {c.horario && !c.permiso && <span className="text-[10.5px] tabular-nums">{c.horario}</span>}
                          {c.horas_extra > 0 && <span className="text-[10.5px] font-semibold">+{c.horas_extra} min</span>}
                        </button>
                      </td>
                    ))}
                    <td className="text-right tabular-nums">{f.horas}</td>
                  </tr>
                ))}
                <tr>
                  <td className="sticky left-0 bg-surface text-[12px] font-semibold text-muted">Cobertura</td>
                  {datos.cobertura.map((n, i) => <td key={i} className="text-center font-semibold">{n}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Badge tone="ok">Turno</Badge><Badge tone="primary">Cambio de turno</Badge><Badge tone="neutral">Descanso</Badge><Badge tone="info">Permiso o vacaciones</Badge>
        </div>
      </Seccion>
      {celda && op && <Editar op={op} local={loc} {...celda} onClose={() => setCelda(null)} onListo={() => { setCelda(null); recargar(); }} />}
    </div>
  );
}

function Editar({ op, local, fila, c, onClose, onListo }: { op: Opciones; local: string; fila: Fila; c: Celda; onClose: () => void; onListo: () => void }) {
  const turnos = op.turnos.filter((t) => t.establishment_id === local);
  const [estado, setEstado] = useState(c.status === "REST" ? "REST" : c.status && c.status !== "CANCELLED" ? "PLANNED" : "PLANNED");
  const [turno, setTurno] = useState(c.shift_id ?? turnos[0]?.id ?? "");
  const [extra, setExtra] = useState(String(c.horas_extra || ""));
  const [nota, setNota] = useState(c.nota ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api("/v1/per/programacion", { method: "POST", body: { employee_id: fila.employee_id, work_date: c.fecha, status: estado, shift_id: estado === "PLANNED" ? turno : null,
        overtime_authorized_minutes: estado === "PLANNED" && extra ? Number(extra) : 0, note: nota || null } });
      toast.ok("Programación guardada.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`${fila.trabajador} · ${fecha(c.fecha)}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-prog" loading={guardando}>Guardar</Button></>}>
      <form id="f-prog" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        {c.permiso && <Alert tone="info">Tiene {c.permiso.toLowerCase()} aprobado este día.</Alert>}
        <Field label="Qué hace ese día"><Select value={estado} onChange={(e) => setEstado(e.target.value)} options={[{ value: "PLANNED", label: "Trabaja" }, { value: "REST", label: "Descanso" }, { value: "CANCELLED", label: "Sin turno" }]} /></Field>
        {estado === "PLANNED" && (
          <>
            <Field label="Turno" required><Select value={turno} onChange={(e) => setTurno(e.target.value)} options={turnos.map((t) => ({ value: t.id, label: `${t.code} · ${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}` }))} /></Field>
            <Field label="Horas extra autorizadas (min)" hint="Solo se pagan las autorizadas."><Input inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value.replace(/\D/g, ""))} /></Field>
          </>
        )}
        <Field label="Nota"><Textarea value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
