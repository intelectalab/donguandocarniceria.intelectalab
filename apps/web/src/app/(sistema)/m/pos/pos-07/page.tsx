"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { Alert, Button, Field, Input, PageHeader, Select, StatusBadge, Textarea, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { Conteo, limpiarConteo, sumaConteo } from "@/modulos/pos/Conteo";
import { Renglon, Seccion, SinTurno, Vacio } from "@/modulos/pos/Seccion";
import { TablaConteos } from "@/modulos/pos/TablaConteos";
import { ESTADOS_TURNO, r2, type Contexto, type TurnoDetalle } from "@/modulos/pos/tipos";
import { useContexto } from "@/modulos/pos/useContexto";

const AYUDA: Record<string, string> = { CARD: "Según el cierre (settlement) del POS de tarjeta.", WALLET: "Según los avisos de Yape o Plin del celular de la caja." };

/** POS-07 Cerrar turno: arqueo por medio de pago, efectivo por denominación; diferencia y motivo (RN-POS-07). */
export default function CerrarTurno() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const { ctx, error, cargando } = useContexto();
  const id = useSearchParams().get("id") ?? "";
  if (cargando) return <Vacio>Cargando el mostrador…</Vacio>;
  if (error || !ctx) return <Alert tone="bad">{error || "No se pudo cargar el mostrador."}</Alert>;
  const turnoId = id || ctx.turno?.id || "";
  const ajenos = ctx.abiertos.filter((a) => a.id !== ctx.turno?.id);
  return (
    <div className="space-y-4">
      <PageHeader code="POS-07" description="Cuenta el efectivo por denominación y anota lo que marcan el POS de tarjeta, Yape y Plin. Toda diferencia necesita un motivo; un turno cerrado no se reabre." />
      {ctx.puede.aprobar && ajenos.length > 0 && (
        <div className="max-w-[460px]">
          <Field label="Turno por cerrar" hint="La supervisora puede cerrar un turno que la cajera dejó abierto.">
            <Select value={turnoId} onChange={(e) => router.push(`/m/pos/pos-07${e.target.value ? `?id=${e.target.value}` : ""}`)} placeholder="Elige un turno"
              options={[...(ctx.turno ? [{ value: ctx.turno.id, label: `${ctx.turno.number} · mi turno` }] : []), ...ajenos.map((a) => ({ value: a.id, label: `${a.number} · ${a.caja} · ${a.cashier_name}` }))]} />
          </Field>
        </div>
      )}
      {turnoId ? <Arqueo key={turnoId} ctx={ctx} turnoId={turnoId} /> : <SinTurno abrir={ctx.puede.abrir} texto="No hay un turno tuyo abierto para cerrar." />}
    </div>
  );
}

function Arqueo({ ctx, turnoId }: { ctx: Contexto; turnoId: string }) {
  const router = useRouter();
  const [t, setT] = useState<TurnoDetalle | null>(null);
  const [error, setError] = useState("");
  const [denoms, setDenoms] = useState<Record<string, number>>({});
  const [otros, setOtros] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    let vigente = true;
    api<TurnoDetalle>(`/v1/pos/turnos/${turnoId}`).then((r) => vigente && setT(r)).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [turnoId]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!t) return <Vacio>Cargando el turno…</Vacio>;

  if (t.status !== "OPEN") {
    return (
      <Seccion titulo={`Turno ${t.number} cerrado`} acciones={<StatusBadge status={t.status} labels={ESTADOS_TURNO} />}>
        <p className="mb-3 text-[13px] text-muted">Cerró {t.closed_by_name ?? t.cashier_name} el {fechaHora(t.closed_at)}.{t.difference_reason ? ` Motivo: ${t.difference_reason}.` : ""}</p>
        <TablaConteos t={t} />
        {t.over_limit && <div className="mt-3"><Alert tone="warn">La diferencia pasa el límite de {soles(ctx.parametros.diferencia_con_aviso)}: se avisó a la supervisora.</Alert></div>}
        <div className="mt-4 flex flex-wrap gap-2">
          {t.status === "CLOSED" && ctx.puede.aprobar && <Button variant="primary" onClick={() => router.push(`/m/pos/pos-08?id=${t.id}`)}>Revisar y aprobar</Button>}
          {ctx.puede.abrir && <Button onClick={() => router.push("/m/pos/pos-01")}>Abrir otro turno</Button>}
        </div>
      </Seccion>
    );
  }

  const efectivo = sumaConteo(denoms);
  const filas = t.esperado.por_medio.map((m) => {
    const contado = m.code === "CASH" ? efectivo : otros[m.code] === undefined || otros[m.code] === "" ? null : Number(otros[m.code]);
    return { ...m, contado, diferencia: contado === null ? null : r2(contado - m.esperado) };
  });
  const faltan = filas.filter((f) => f.contado === null && f.code !== "CASH");
  const conDiferencia = filas.filter((f) => f.diferencia !== null && Math.abs(f.diferencia) >= 0.005);
  const total = r2(conDiferencia.reduce((s, f) => s + (f.diferencia ?? 0), 0));
  const listo = faltan.length === 0 && (conDiferencia.length === 0 || motivo.trim().length >= 3);

  async function cerrar() {
    const ok = await confirmAction({ title: `¿Cerrar el turno ${t!.number}?`, message: "Un turno cerrado no se reabre ni se cambia su arqueo.", confirmLabel: "Cerrar turno" });
    if (!ok) return;
    setCerrando(true);
    try {
      const counts = Object.fromEntries(filas.filter((f) => f.code !== "CASH").map((f) => [f.code, f.contado ?? 0]));
      const r = await api<TurnoDetalle>(`/v1/pos/turnos/${turnoId}/cerrar`, { method: "POST", body: { cash_denoms: limpiarConteo(denoms), counts, reason: motivo.trim() || null } });
      toast.ok(`Turno ${r.number} cerrado.`);
      setT({ ...t!, ...r });
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCerrando(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Seccion titulo="Efectivo contado">
        <Conteo denominaciones={ctx.denominaciones} valor={denoms} onChange={setDenoms} />
      </Seccion>
      <div className="space-y-4">
        <Seccion titulo={`Turno ${t.number} · ${t.caja.name}`}>
          <p className="mb-2 text-[12.5px] text-muted">{t.cashier_name} · abierto {fechaHora(t.opened_at)} · {t.tickets} ticket(s) · {soles(t.ventas)} vendidos</p>
          <div className="space-y-3">
            {filas.map((f) => (
              <div key={f.code} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2 text-[13.5px]">
                  <span className="font-semibold text-ink">{f.name}</span>
                  <span className="text-muted">esperado <b className="text-ink tabular-nums">{soles(f.esperado)}</b></span>
                </div>
                {f.code === "CASH" ? (
                  <p className="mt-1 text-[12px] text-muted">Fondo {soles(t.esperado.fondo)} + cobros {soles(t.esperado.cobros_efectivo)} + ingresos {soles(t.esperado.ingresos)} − salidas {soles(t.esperado.retiros + t.esperado.depositos + t.esperado.gastos + t.esperado.devoluciones)}. Contado: <b>{soles(efectivo)}</b></p>
                ) : (
                  <div className="mt-2">
                    <Field label="Contado" hint={AYUDA[f.kind]}>
                      <Input prefix="S/" inputMode="decimal" value={otros[f.code] ?? ""} onChange={(e) => setOtros((o) => ({ ...o, [f.code]: e.target.value.replace(/[^\d.]/g, "") }))} />
                    </Field>
                  </div>
                )}
                {f.diferencia !== null && (
                  <div className={`mt-1 text-right text-[13px] font-medium tabular-nums ${Math.abs(f.diferencia) < 0.005 ? "text-ok" : "text-bad"}`}>
                    {Math.abs(f.diferencia) < 0.005 ? "Cuadra" : `Diferencia ${f.diferencia > 0 ? "+" : "−"}${soles(Math.abs(f.diferencia))}`}
                  </div>
                )}
              </div>
            ))}
          </div>
          {t.esperado.saldo_a_favor > 0 && <p className="mt-2 text-[12px] text-muted">Saldo a favor usado en el turno: {soles(t.esperado.saldo_a_favor)} (no se cuenta: no es dinero en caja).</p>}
        </Seccion>
        <Seccion>
          <Renglon label="Diferencia total" valor={`${total > 0 ? "+" : total < 0 ? "−" : ""}${soles(Math.abs(total))}`} fuerte tono={Math.abs(total) < 0.005 ? "ok" : "bad"} />
          {Math.abs(total) > ctx.parametros.diferencia_con_aviso && <p className="mt-1 text-[12px] text-warn">Pasa de {soles(ctx.parametros.diferencia_con_aviso)}: se avisará a la supervisora al cerrar.</p>}
          {conDiferencia.length > 0 && (
            <div className="mt-3">
              <Field label="Motivo de la diferencia" required><Textarea rows={2} maxLength={255} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
            </div>
          )}
          {faltan.length > 0 && <p className="mt-2 text-[12.5px] text-muted">Falta contar: {faltan.map((f) => f.name).join(", ")} (escribe 0 si no hubo).</p>}
          <div className="mt-3 flex justify-end"><Button variant="primary" icon={Lock} loading={cerrando} disabled={!listo} onClick={cerrar}>Cerrar turno</Button></div>
        </Seccion>
      </div>
    </div>
  );
}
