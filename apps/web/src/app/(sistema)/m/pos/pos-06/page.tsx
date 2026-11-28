"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Alert, Button, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { Renglon, Seccion, SinTurno, Vacio } from "@/modulos/pos/Seccion";
import { SALIDAS, n, type Contexto, type Movimiento, type Turno } from "@/modulos/pos/tipos";
import { useContexto } from "@/modulos/pos/useContexto";

/** POS-06 Ingresos y retiros: retiro a caja fuerte, depósito, gasto menor e ingreso de sencillo; sobre el límite, con autorización (RN-POS-09). */
export default function IngresosRetiros() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const { ctx, error, cargando } = useContexto();
  const id = useSearchParams().get("id") ?? "";
  if (cargando) return <Vacio>Cargando el mostrador…</Vacio>;
  if (error || !ctx) return <Alert tone="bad">{error || "No se pudo cargar el mostrador."}</Alert>;
  const turnoId = id || ctx.turno?.id || "";
  return (
    <div className="space-y-4">
      <PageHeader code="POS-06" description={`Todo movimiento de efectivo fuera de una venta queda en el turno. Retiros, depósitos y gastos de más de ${soles(ctx.parametros.retiro_con_autorizacion)} piden la autorización de la supervisora.`} />
      {ctx.puede.aprobar && ctx.abiertos.length > 0 && <ElegirTurno ctx={ctx} actual={turnoId} />}
      {turnoId ? <ConTurno key={turnoId} ctx={ctx} turnoId={turnoId} /> : <SinTurno abrir={ctx.puede.abrir} texto="Los ingresos y retiros se registran en un turno abierto." />}
    </div>
  );
}

function ElegirTurno({ ctx, actual }: { ctx: Contexto; actual: string }) {
  const router = useRouter();
  return (
    <div className="max-w-[420px]">
      <Field label="Turno">
        <Select value={actual} onChange={(e) => router.push(`/m/pos/pos-06${e.target.value ? `?id=${e.target.value}` : ""}`)} placeholder="Elige un turno abierto"
          options={ctx.abiertos.map((a) => ({ value: a.id, label: `${a.number} · ${a.caja} · ${a.cashier_name}` }))} />
      </Field>
    </div>
  );
}

function ConTurno({ ctx, turnoId }: { ctx: Contexto; turnoId: string }) {
  const [datos, setDatos] = useState<{ turno: Turno; movimientos: Movimiento[] } | null>(null);
  const [error, setError] = useState("");
  const [tipo, setTipo] = useState("CASH_OUT");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    let vigente = true;
    api<{ turno: Turno; movimientos: Movimiento[] }>(`/v1/pos/turnos/${turnoId}/movimientos`)
      .then((r) => vigente && setDatos(r))
      .catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [turnoId]);
  useEffect(() => cargar(), [cargar]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!datos) return <Vacio>Cargando el turno…</Vacio>;
  const t = datos.turno;
  const abierto = t.status === "OPEN";
  const limite = ctx.parametros.retiro_con_autorizacion;
  const pideAutorizacion = SALIDAS.includes(tipo) && Number(monto) > limite && !ctx.puede.autorizar_retiro;
  const esSalida = tipo !== "CASH_IN";
  const supera = esSalida && Number(monto) > t.esperado.efectivo + 0.005;

  async function guardar() {
    setGuardando(true);
    try {
      const body: Record<string, unknown> = { movement_type: tipo, amount: Number(monto), reason: motivo.trim() };
      if (pideAutorizacion) Object.assign(body, { authorizer_email: correo.trim(), authorizer_password: clave });
      const r = await api<{ movimiento: Movimiento; turno: Turno }>(`/v1/pos/turnos/${turnoId}/movimientos`, { method: "POST", body });
      toast.ok(`${ctx.movimientos[tipo]} de ${soles(r.movimiento.amount)} registrado.`);
      setMonto(""); setMotivo(""); setClave(""); setCorreo("");
      setDatos((d) => (d ? { turno: r.turno, movimientos: [r.movimiento, ...d.movimientos] } : d));
    } catch (e) {
      toast.error(mensajeDe(e));
      setClave("");
    } finally {
      setGuardando(false);
    }
  }

  const listo = Number(monto) > 0 && motivo.trim().length >= 3 && (!pideAutorizacion || (correo.trim() && clave)) && !supera;
  const tipos = Object.entries(ctx.movimientos).filter(([k]) => k !== "REFUND");

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Seccion titulo={`Turno ${t.number} · ${t.caja.name}`}>
        <p className="mb-3 text-[12.5px] text-muted">{t.cashier_name} · abierto {fechaHora(t.opened_at)}</p>
        <Renglon label="Fondo inicial" valor={soles(t.esperado.fondo)} />
        <Renglon label="Cobros en efectivo" valor={soles(t.esperado.cobros_efectivo)} />
        <Renglon label="Ingresos de sencillo" valor={`+ ${soles(t.esperado.ingresos)}`} />
        <Renglon label="Retiros a caja fuerte" valor={`− ${soles(t.esperado.retiros)}`} />
        <Renglon label="Depósitos" valor={`− ${soles(t.esperado.depositos)}`} />
        <Renglon label="Gastos menores" valor={`− ${soles(t.esperado.gastos)}`} />
        <Renglon label="Devoluciones en efectivo" valor={`− ${soles(t.esperado.devoluciones)}`} />
        <Renglon label="Efectivo esperado en caja" valor={soles(t.esperado.efectivo)} fuerte />
      </Seccion>

      <Seccion titulo="Nuevo movimiento">
        {!abierto ? <Alert tone="info">El turno está cerrado: ya no recibe movimientos.</Alert> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {tipos.map(([k, v]) => (
                <button key={k} type="button" onClick={() => setTipo(k)}
                  className={`flex h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-left text-[13px] font-medium ${tipo === k ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
                  {k === "CASH_IN" ? <ArrowDownCircle size={17} className="shrink-0 text-ok" /> : <ArrowUpCircle size={17} className="shrink-0 text-bad" />}{v}
                </button>
              ))}
            </div>
            <Field label="Monto" required error={supera ? `En caja hay ${soles(t.esperado.efectivo)} esperados.` : undefined}>
              <Input prefix="S/" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
            <Field label="Motivo" required hint="Ej.: retiro a caja fuerte por exceso de efectivo, compra de bolsas.">
              <Textarea rows={2} maxLength={255} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </Field>
            {pideAutorizacion && (
              <div className="space-y-2 rounded-xl border border-warn/40 bg-warn-soft p-3">
                <p className="text-[13px] text-ink">Más de {soles(limite)}: la supervisora autoriza con su correo y contraseña (no la cajera).</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Correo de quien autoriza"><Input type="email" autoComplete="off" value={correo} onChange={(e) => setCorreo(e.target.value)} /></Field>
                  <Field label="Contraseña"><Input type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} /></Field>
                </div>
              </div>
            )}
            <div className="flex justify-end"><Button variant="primary" loading={guardando} disabled={!listo} onClick={guardar}>Registrar</Button></div>
          </div>
        )}
      </Seccion>

      <Seccion titulo="Movimientos del turno" className="lg:col-span-2">
        {datos.movimientos.length === 0 ? <Vacio>Sin movimientos todavía.</Vacio> : (
          <ul className="divide-y divide-line">
            {datos.movimientos.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[13.5px]">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{ctx.movimientos[m.movement_type] ?? m.movement_type}</div>
                  <div className="text-[12px] text-muted">{fechaHora(m.moved_at)} · {m.user_name} · {m.reason}{m.authorized_by_name ? ` · autorizó ${m.authorized_by_name}` : ""}</div>
                </div>
                <span className={`shrink-0 font-semibold tabular-nums ${m.movement_type === "CASH_IN" ? "text-ok" : "text-bad"}`}>
                  {m.movement_type === "CASH_IN" ? "+" : "−"} {soles(n(m.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  );
}
