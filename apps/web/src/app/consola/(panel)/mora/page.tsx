"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellRing, CalendarClock, CreditCard, Eye, Lock, Play, Wallet } from "lucide-react";
import { Badge, Button, Cifra, DataTable, Field, Input, Modal, PageHeader, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { usePagina, type Pagina } from "@/lib/paginas";
import { apiConsola } from "@/lib/consola";
import { fecha, fechaHora, soles } from "@/lib/formato";

type Fila = {
  subscription_id: string; tenant_short: string; plan_code: string; status: string; status_name: string; deuda: number; comprobantes: number; factura_numero: string | null; vence: string; dias: number;
  proximo_reintento: string | null; pasa_a_solo_lectura: string | null; pasa_a_suspension: string | null; grace_until: string | null; medio_pago: string | null;
  acciones: { kind: string; until: string | null; reason: string | null; actor_name: string; at: string }[];
};

const TONO: Record<string, Tone> = { ACTIVE: "ok", PAST_DUE: "warn", READ_ONLY: "bad", SUSPENDED: "bad", TRIAL: "info" };
const ACCION: Record<string, string> = { REMINDER: "Recordatorio", EXTENSION: "Prórroga", RETRY: "Reintento" };
type Cifras = { en_mora: number; deuda_vencida: number; solo_lectura: number; suspendidas: number };
type Resumen = Record<string, number>;
type Corrida = { actor_name: string; reason: string | null; resumen: Resumen; at: string };
type Respuesta = Pagina<Fila> & { cifras: Cifras; ultima_corrida: Corrida | null };
const RESUMEN: [string, string][] = [["pruebas", "Pruebas vencidas"], ["con_deuda", "Pasaron a con deuda"], ["reintentos", "Reintentos de cobro"],
  ["solo_lectura", "Pasaron a solo lectura"], ["suspendidas", "Suspendidas"], ["canceladas", "Cancelaciones aplicadas"], ["cambios_de_plan", "Cambios de plan aplicados"]];
const plan = (c: string) => c.charAt(0) + c.slice(1).toLowerCase();

function ResumenCorrida({ r }: { r: Resumen }) {
  const hechos = RESUMEN.filter(([k]) => (r[k] ?? 0) > 0);
  if (!hechos.length) return <p className="text-[13px] text-muted">Sin cambios: nadie pasó de estado ni tocaba reintento.</p>;
  return <ul className="grid gap-0.5 text-[13px] text-ink">{hechos.map(([k, n]) => <li key={k}>{n}: <b>{r[k]}</b></li>)}</ul>;
}

/** Mora: empresas que deben, cuántos días, el próximo reintento y cuándo pasan a solo lectura o a suspensión. */
export default function Mora() {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["billing.manage"]);
  const [filas, setFilas] = useState<Respuesta | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [resultado, setResultado] = useState<Resumen | null>(null);
  const pag = usePagina();
  const [error, setError] = useState("");
  const [prorroga, setProrroga] = useState<Fila | null>(null);

  const cargar = useCallback(() => {
    apiConsola<Respuesta>(`/mora?${pag.qs}`).then((r) => { setFilas(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [pag.qs]);
  useEffect(() => cargar(), [cargar]);

  async function accion(f: Fila, ruta: "recordatorio" | "cobrar") {
    try {
      const r = await apiConsola<{ status?: string } | undefined>(`/mora/${f.subscription_id}/${ruta}`, { method: "POST" });
      toast.ok(ruta === "recordatorio" ? "Recordatorio enviado a la empresa" : r?.status === "APPROVED" ? "Cobro aprobado: la empresa vuelve a operar" : "El cobro fue rechazado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function procesar() {
    if (!(await confirmAction({ title: "¿Ejecutar el proceso de mora ahora?", confirmLabel: "Ejecutar",
      message: "Hace los reintentos de cobro que tocan hoy y pasa a con deuda, solo lectura o suspendida a las empresas que corresponda. Es lo mismo que corre solo cada mañana." }))) return;
    setCorriendo(true);
    try {
      setResultado(await apiConsola<Resumen>("/mora/proceso", { method: "POST" }));
      toast.ok("Proceso de mora ejecutado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCorriendo(false);
    }
  }

  const c = filas?.cifras;
  const u = filas?.ultima_corrida;
  const columnas: Column<Fila>[] = [
    { key: "tenant_short", header: "Empresa", cardTitle: true, render: (f) => <div><p className="font-semibold text-ink">{f.tenant_short}</p><p className="text-[12.5px] text-muted">{f.medio_pago ?? "Sin medio de pago"}</p></div> },
    { key: "plan_code", header: "Plan", hideOnMobile: true, render: (f) => plan(f.plan_code) },
    { key: "status", header: "Estado", render: (f) => <Badge tone={TONO[f.status] ?? "neutral"} dot>{f.status_name}</Badge> },
    { key: "factura_numero", header: "Comprobante", render: (f) => (
      <div><p className="font-mono text-[12.5px]">{f.factura_numero ?? "—"}</p>{f.comprobantes > 1 && <p className="text-[12px] text-muted">y {f.comprobantes - 1} más</p>}</div>
    ) },
    { key: "deuda", header: "Deuda", align: "right", render: (f) => <span className="font-semibold">{soles(f.deuda)}</span> },
    { key: "dias", header: "Días de mora", align: "right", render: (f) => (
      <div><p className="font-semibold">{f.dias}</p><p className="text-[12px] text-muted">{f.dias > 0 ? `venció ${fecha(f.vence)}` : `vence ${fecha(f.vence)}`}</p></div>
    ) },
    { key: "proximo_reintento", header: "Próximo reintento", hideOnMobile: true, render: (f) => (f.proximo_reintento ? fecha(f.proximo_reintento) : <span className="text-muted">Sin reintentos</span>) },
    { key: "proximo", header: "Paso previsto", hideOnMobile: true, render: (f) => (
      <div className="grid gap-0.5 text-[12.5px]">
        {f.grace_until && <span>Prórroga hasta {fecha(f.grace_until)}</span>}
        {f.pasa_a_solo_lectura && <span className="text-warn">Solo lectura el {fecha(f.pasa_a_solo_lectura)}</span>}
        {f.pasa_a_suspension && <span className="text-bad">Suspensión el {fecha(f.pasa_a_suspension)}</span>}
        {f.status === "SUSPENDED" && <span className="text-bad">Suspendida</span>}
        {f.acciones[0] && <span className="text-muted">Último: {ACCION[f.acciones[0].kind]} · {fechaHora(f.acciones[0].at)}</span>}
      </div>
    ) },
    ...(puede ? [{ key: "acciones", header: "", align: "right" as const, render: (f: Fila) => (
      <div className="flex flex-wrap justify-end gap-1.5">
        {f.medio_pago && <Button size="sm" variant="primary" icon={CreditCard} onClick={() => accion(f, "cobrar")}>Cobrar</Button>}
        <Button size="sm" variant="ghost" icon={BellRing} onClick={() => accion(f, "recordatorio")}>Recordar</Button>
        <Button size="sm" variant="ghost" icon={CalendarClock} onClick={() => setProrroga(f)}>Prórroga</Button>
      </div>
    ) }] : []),
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Un comprobante vencido deja a la empresa con deuda (sigue operando). Se reintenta el cobro a los 1, 3 y 5 días; a los 7 días pasa a solo lectura y 15 días después, a suspendida. El pago confirmado la devuelve a activa en el momento. Una prórroga pospone esos pasos." />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="En mora" valor={String(c.en_mora)} tono={c.en_mora ? "warn" : "ok"} icono={AlertTriangle} />
          <Cifra titulo="Deuda vencida" valor={soles(c.deuda_vencida)} icono={Wallet} destacada />
          <Cifra titulo="En solo lectura" valor={String(c.solo_lectura)} tono={c.solo_lectura ? "bad" : undefined} icono={Eye} />
          <Cifra titulo="Suspendidas" valor={String(c.suspendidas)} tono={c.suspendidas ? "bad" : undefined} icono={Lock} />
        </div>
      )}
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="grid gap-2">
          <h2 className="text-[14.5px] font-semibold text-ink">Proceso diario de mora</h2>
          <p className="text-[13px] text-muted">Corre solo todos los días a las 6:20 (hora de Lima): hace los reintentos de cobro que tocan y cambia el estado de las empresas que deben. Se puede ejecutar a mano para hoy, por ejemplo después de corregir un pago.</p>
          {resultado ? (
            <div className="grid gap-1 rounded-lg bg-surface-2 p-3"><p className="text-[12.5px] font-semibold text-ink">Resultado de esta ejecución</p><ResumenCorrida r={resultado} /></div>
          ) : u ? (
            <div className="grid gap-1 rounded-lg bg-surface-2 p-3">
              <p className="text-[12.5px] text-muted">Última ejecución: <b className="text-ink">{fechaHora(u.at)}</b> · {u.actor_name}</p>
              <ResumenCorrida r={u.resumen} />
            </div>
          ) : <p className="text-[13px] text-muted">Todavía no se ejecutó.</p>}
        </div>
        {puede && <Button variant="primary" icon={Play} loading={corriendo} onClick={procesar}>Ejecutar reintentos y cambios de estado</Button>}
      </section>
      <DataTable columns={columnas} rows={filas?.data ?? []} rowKey={(f) => f.subscription_id} loading={!filas && !error} error={error} onRetry={cargar} pagination={pag.props(filas)}
        empty="Ninguna empresa debe comprobantes." />
      {prorroga && <Prorroga f={prorroga} onClose={() => setProrroga(null)} onListo={() => { setProrroga(null); cargar(); }} />}
    </div>
  );
}

function Prorroga({ f, onClose, onListo }: { f: Fila; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ until: "", reason: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await apiConsola(`/mora/${f.subscription_id}/prorroga`, { method: "POST", body: d });
      toast.ok("Prórroga registrada");
      onListo();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} placement="center" title={`Prórroga para ${f.tenant_short}`}
      description="Pospone el paso a solo lectura o a suspensión hasta esa fecha. No cambia el estado actual."
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-prorroga" loading={guardando}>Dar prórroga</Button></>}>
      <form id="f-prorroga" onSubmit={guardar} className="grid gap-4">
        <Field label="Hasta" required error={errores.until}><Input type="date" value={d.until} onChange={(e) => setD({ ...d, until: e.target.value })} /></Field>
        <Field label="Motivo" required error={errores.reason}><Input value={d.reason} maxLength={300} onChange={(e) => setD({ ...d, reason: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}
