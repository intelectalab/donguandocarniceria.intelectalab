"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, CalendarClock, CreditCard } from "lucide-react";
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, toast, type Column, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fecha, fechaHora, soles } from "@/lib/formato";

type Fila = {
  subscription_id: string; tenant_short: string; plan_code: string; status: string; status_name: string; deuda: number; comprobantes: number; vence: string; dias: number;
  proximo_reintento: string | null; pasa_a_solo_lectura: string | null; pasa_a_suspension: string | null; grace_until: string | null; medio_pago: string | null;
  acciones: { kind: string; until: string | null; reason: string | null; actor_name: string; at: string }[];
};

const TONO: Record<string, Tone> = { ACTIVE: "ok", PAST_DUE: "warn", READ_ONLY: "bad", SUSPENDED: "bad", TRIAL: "info" };
const ACCION: Record<string, string> = { REMINDER: "Recordatorio", EXTENSION: "Prórroga", RETRY: "Reintento" };

/** Mora: empresas que deben, cuántos días, el próximo reintento y cuándo pasan a solo lectura o a suspensión. */
export default function Mora() {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["billing.manage"]);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState("");
  const [prorroga, setProrroga] = useState<Fila | null>(null);

  const cargar = useCallback(() => {
    apiConsola<{ data: Fila[] }>("/mora").then((r) => { setFilas(r.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
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

  const columnas: Column<Fila>[] = [
    { key: "tenant_short", header: "Empresa", cardTitle: true, render: (f) => <div><p className="font-semibold text-ink">{f.tenant_short}</p><p className="text-[12.5px] text-muted">Plan {f.plan_code.toLowerCase()} · {f.medio_pago ?? "sin medio de pago"}</p></div> },
    { key: "deuda", header: "Debe", align: "right", render: (f) => <div><p className="font-semibold">{soles(f.deuda)}</p><p className="text-[12px] text-muted">{f.comprobantes} comprobante(s)</p></div> },
    { key: "dias", header: "Mora", render: (f) => (
      <div className="grid gap-0.5"><Badge tone={TONO[f.status] ?? "neutral"} dot>{f.status_name}</Badge>
        <span className="text-[12px] text-muted">{f.dias > 0 ? `${f.dias} día(s) · venció ${fecha(f.vence)}` : `Vence ${fecha(f.vence)}`}</span></div>
    ) },
    { key: "proximo", header: "Lo que sigue", hideOnMobile: true, render: (f) => (
      <div className="grid gap-0.5 text-[12.5px]">
        {f.proximo_reintento && <span>Reintento: {fecha(f.proximo_reintento)}</span>}
        {f.pasa_a_solo_lectura && <span className="text-warn">Solo lectura: {fecha(f.pasa_a_solo_lectura)}</span>}
        {f.pasa_a_suspension && <span className="text-bad">Suspensión: {fecha(f.pasa_a_suspension)}</span>}
        {f.grace_until && <span className="text-muted">Prórroga hasta {fecha(f.grace_until)}</span>}
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
      <DataTable columns={columnas} rows={filas ?? []} rowKey={(f) => f.subscription_id} loading={!filas && !error} error={error} onRetry={cargar}
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
