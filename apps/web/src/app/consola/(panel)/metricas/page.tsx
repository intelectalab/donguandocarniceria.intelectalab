"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, TrendingUp } from "lucide-react";
import { Alert, Badge, Button, Cifra, PageHeader, Select, confirmAction, toast } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fechaHora, soles } from "@/lib/formato";

type Mes = {
  period: string; sin_datos?: boolean; congelado?: boolean; run_no?: number | null; calculado?: string; por?: string | null;
  mrr?: number; clientes_activos?: number; churn_clientes?: number | null; churn_mrr?: number | null; retencion_neta?: number | null; ingreso_promedio?: number | null;
  conversion_prueba?: number | null; uso_por_plan?: Record<string, Record<string, number | null>>; tiempo_de_alta?: number | null; tickets_por_cliente?: number | null;
  primera_respuesta_horas?: Record<string, number | null>; disponibilidad?: { code: string; name: string; pct: number }[]; mrr_en_mora?: number | null;
  resolucion_horas?: number | null; horas_acceso_soporte?: number; cancelaciones?: number; pruebas_terminadas?: number; pruebas_convertidas?: number;
  tickets?: number; facturado?: number; cobrado?: number; clientes_inicio?: number; mrr_inicio?: number;
};
type Datos = { meses: Mes[]; corridas: { period: string; run_no: number; reason: string | null; created_by_name: string; created_at: string }[] };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("es-PE", { maximumFractionDigits: 2 })} %`);
const horas = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("es-PE", { maximumFractionDigits: 1 })} h`);
const PRIORIDAD: Record<string, string> = { URGENT: "Urgente", HIGH: "Alta", NORMAL: "Normal", LOW: "Baja" };
const LIMITE: Record<string, string> = { users: "Usuarios", brands: "Marcas", sites: "Locales" };

/** Métricas del negocio: MRR, clientes, churn, retención, conversión, mora, soporte y disponibilidad, por mes. */
export default function Metricas() {
  const yo = useUsuarioConsola();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [congelando, setCongelando] = useState(false);

  const cargar = useCallback(() => {
    apiConsola<Datos>("/metricas").then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => cargar(), [cargar]);

  const meses = useMemo(() => datos?.meses ?? [], [datos]);
  const m = meses.find((x) => x.period === periodo) ?? meses[meses.length - 1];
  const actual = meses[meses.length - 1]?.period;

  async function congelar() {
    if (!m) return;
    const c = await confirmAction({ title: `¿Congelar las métricas de ${nombreMes(m.period)}?`, confirmLabel: "Congelar",
      message: m.congelado ? "Ya está congelado: se guarda otra corrida y la anterior queda en el historial." : "Quedan guardadas tal como están hoy.",
      reason: m.congelado ? { min: 5, label: "Por qué lo recalculas" } : undefined });
    if (!c) return;
    setCongelando(true);
    try {
      await apiConsola("/metricas/congelar", { method: "POST", body: { period: m.period, reason: c.reason || null } });
      toast.ok("Métricas congeladas");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCongelando(false);
    }
  }

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!datos || !m) return <p className="text-muted">Calculando…</p>;
  const conDatos = meses.filter((x) => !x.sin_datos);
  const maximo = Math.max(1, ...conDatos.map((x) => x.mrr ?? 0));

  return (
    <div className="grid gap-5">
      <PageHeader description="El mes en curso se calcula en vivo; un mes cerrado se congela el día 1 y queda guardado. Si se recalcula, se guarda otra corrida. Las empresas sin suscripción (el piloto) no cuentan como clientes. Montos sin IGV." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56"><Select aria-label="Mes" value={m.period} onChange={(e) => setPeriodo(e.target.value)}
          options={[...meses].reverse().map((x) => ({ value: x.period, label: `${nombreMes(x.period)}${x.congelado ? " · congelado" : x.sin_datos ? " · sin datos" : x.period === actual ? " · en curso" : ""}` }))} /></div>
        {m.congelado ? <Badge tone="info"><Lock size={12} aria-hidden="true" /> Congelado · corrida {m.run_no} · {m.por} · {fechaHora(m.calculado)}</Badge>
          : !m.sin_datos && <Badge>En vivo · {fechaHora(m.calculado)}</Badge>}
        {yo.puede["metrics.freeze"] && m.period !== actual && <Button size="sm" icon={Lock} loading={congelando} onClick={congelar}>{m.congelado ? "Recalcular y congelar" : "Congelar"}</Button>}
      </div>

      {m.sin_datos ? <Alert tone="info">Este mes no tiene métricas congeladas. Se pueden calcular y congelar ahora.</Alert> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="MRR" valor={soles(m.mrr)} detalle={`Al inicio del mes: ${soles(m.mrr_inicio)}`} icono={TrendingUp} destacada />
            <Cifra titulo="Clientes activos" valor={String(m.clientes_activos ?? 0)} detalle={`${m.clientes_inicio ?? 0} al inicio del mes`} />
            <Cifra titulo="Churn de clientes" valor={pct(m.churn_clientes)} detalle={`${m.cancelaciones ?? 0} cancelación(es)`} tono={(m.churn_clientes ?? 0) > 5 ? "bad" : undefined} />
            <Cifra titulo="Churn de MRR" valor={pct(m.churn_mrr)} tono={(m.churn_mrr ?? 0) > 5 ? "bad" : undefined} />
            <Cifra titulo="Retención neta" valor={pct(m.retencion_neta)} tono={m.retencion_neta !== null && m.retencion_neta !== undefined ? (m.retencion_neta >= 100 ? "ok" : "warn") : undefined} />
            <Cifra titulo="Ingreso promedio" valor={m.ingreso_promedio !== null && m.ingreso_promedio !== undefined ? soles(m.ingreso_promedio) : "—"} detalle="por cliente al mes" />
            <Cifra titulo="Prueba a pago" valor={pct(m.conversion_prueba)} detalle={`${m.pruebas_convertidas ?? 0} de ${m.pruebas_terminadas ?? 0} pruebas terminadas`} />
            <Cifra titulo="MRR en mora" valor={pct(m.mrr_en_mora)} tono={(m.mrr_en_mora ?? 0) > 0 ? "warn" : undefined} />
          </div>

          <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="font-semibold text-ink">MRR de los últimos 12 meses</p>
            <div className="flex h-44 items-end gap-1.5" role="img" aria-label="MRR por mes de los últimos 12 meses">
              {meses.map((x) => (
                <div key={x.period} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1">
                  {!x.sin_datos && (
                    <>
                      <span className="pointer-events-none absolute -top-1 z-10 hidden -translate-y-full rounded-md bg-ink px-2 py-1 text-[11.5px] whitespace-nowrap text-bg group-hover:block">
                        {nombreMes(x.period)}: {soles(x.mrr)} · {x.clientes_activos} cliente(s)
                      </span>
                      <div className={`w-full max-w-10 rounded-t-[4px] ${x.period === m.period ? "bg-primary" : "bg-primary/45"}`} style={{ height: `${Math.max(2, ((x.mrr ?? 0) / maximo) * 100)}%` }} />
                    </>
                  )}
                  <span className="text-[10.5px] text-muted">{MESES[Number(x.period.slice(5, 7)) - 1]}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="grid content-start gap-2 rounded-xl border border-line bg-surface p-4 shadow-card text-[13px]">
              <p className="font-semibold text-ink">Soporte</p>
              <p>Tickets del mes: <b>{m.tickets ?? 0}</b> · por cliente: <b>{m.tickets_por_cliente ?? "—"}</b></p>
              <p className="text-muted">Primera respuesta (mediana):</p>
              <ul className="grid gap-0.5">{Object.entries(m.primera_respuesta_horas ?? {}).map(([k, v]) => <li key={k} className="flex justify-between"><span>{PRIORIDAD[k]}</span><span>{horas(v)}</span></li>)}</ul>
              <p>Resolución (mediana): <b>{horas(m.resolucion_horas)}</b></p>
              <p>Horas de acceso de soporte: <b>{horas(m.horas_acceso_soporte)}</b></p>
            </section>
            <section className="grid content-start gap-2 rounded-xl border border-line bg-surface p-4 shadow-card text-[13px]">
              <p className="font-semibold text-ink">Disponibilidad de componentes</p>
              {(m.disponibilidad ?? []).length === 0 ? <p className="text-muted">Sin lecturas en el mes.</p>
                : <ul className="grid gap-0.5">{m.disponibilidad!.map((d) => <li key={d.code} className="flex justify-between"><span>{d.name}</span><span className={d.pct < 99 ? "text-warn" : ""}>{pct(d.pct)}</span></li>)}</ul>}
            </section>
            <section className="grid content-start gap-2 rounded-xl border border-line bg-surface p-4 shadow-card text-[13px]">
              <p className="font-semibold text-ink">Uso por plan (promedio de usado / límite)</p>
              {Object.keys(m.uso_por_plan ?? {}).length === 0 ? <p className="text-muted">Sin clientes activos.</p> : Object.entries(m.uso_por_plan!).map(([plan, u]) => (
                <p key={plan}><b>{plan.charAt(0) + plan.slice(1).toLowerCase()}</b>: {Object.entries(u).map(([k, v]) => `${LIMITE[k]} ${pct(v)}`).join(" · ")}</p>
              ))}
              <p className="mt-2 font-semibold text-ink">Facturación del mes</p>
              <p>Facturado: <b>{soles(m.facturado)}</b> · Cobrado: <b>{soles(m.cobrado)}</b></p>
              <p className="text-muted">Tiempo de alta: aún sin datos (falta el primer comprobante aceptado de cada empresa).</p>
            </section>
          </div>
        </>
      )}

      <section className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="text-[11.5px] text-muted uppercase"><tr className="border-b border-line">
            <th className="px-3 py-2">Mes</th><th className="px-3 py-2 text-right">MRR</th><th className="px-3 py-2 text-right">Clientes</th><th className="px-3 py-2 text-right">Churn</th>
            <th className="px-3 py-2 text-right">Retención neta</th><th className="px-3 py-2 text-right">Mora</th><th className="px-3 py-2">Estado</th></tr></thead>
          <tbody>{[...meses].reverse().map((x) => (
            <tr key={x.period} className="border-b border-line last:border-0">
              <td className="px-3 py-2">{nombreMes(x.period)}</td>
              <td className="px-3 py-2 text-right">{x.sin_datos ? "—" : soles(x.mrr)}</td>
              <td className="px-3 py-2 text-right">{x.sin_datos ? "—" : x.clientes_activos}</td>
              <td className="px-3 py-2 text-right">{x.sin_datos ? "—" : pct(x.churn_clientes)}</td>
              <td className="px-3 py-2 text-right">{x.sin_datos ? "—" : pct(x.retencion_neta)}</td>
              <td className="px-3 py-2 text-right">{x.sin_datos ? "—" : pct(x.mrr_en_mora)}</td>
              <td className="px-3 py-2 text-muted">{x.congelado ? `Congelado (corrida ${x.run_no})` : x.sin_datos ? "Sin datos" : "En curso"}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
