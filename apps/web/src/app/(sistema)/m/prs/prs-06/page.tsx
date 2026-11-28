"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { Alert, Button, Cifra, DataTable, FiltroSelect, PageHeader, buttonClass, confirmAction, toast, type Column } from "@/components/ui";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { fechaHora, porcentaje } from "@/lib/formato";
import { AlDetalle, ErrorCarga, FiltroCorte, FiltroMes, Seccion, Semaforo, TONO_LUZ, hoyLima, mesLargo, s0, useDatos, useOpciones, type Version } from "@/modulos/prs/comunes";

type Fila = { key: string; concept_id: string; code: string; name: string; type: string; dim_value: string | null; dimension: string; budget: number; actual: number; forecast: number;
  diff: number; pct: number | null; fpct: number | null; light: string | null; sin_linea: number };
type Corrida = { run_no: number; frozen_at: string; por: string; reason: string; total: number };
type Datos = { version: Version | null; mes: string; al: string; modo: string; dim: string; meses: string[]; estados: Record<string, { estado: string; nombre: string }>; filas: Fila[];
  kpi: { gasto: { budget: number; actual: number; forecast: number; pct: number | null; diff: number; light: string | null }; ingreso: { budget: number; actual: number; forecast: number; pct: number | null; light: string | null };
    rojos: number; ambar: number; sin_mapeo: number };
  corridas: Record<string, Corrida[]> };

const DIMS = [{ value: "concepto", label: "Por concepto" }, { value: "marca", label: "Por marca" }, { value: "local", label: "Por local" }, { value: "centro", label: "Por centro de costo" }];

/** PRS-06 Real frente a presupuesto: presupuesto, real, diferencia, % de ejecución y semáforo por concepto y dimensión, del mes o acumulado (RN-PRS-06 y 07). */
export default function RealFrentePresupuesto() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const router = useRouter();
  const { datos: op } = useOpciones();
  const hoy = hoyLima();
  const [mes, setMes] = useState(sp.get("mes") ?? hoy.slice(0, 7));
  const [al, setAl] = useState(sp.get("al") ?? hoy);
  const [modo, setModo] = useState(sp.get("modo") ?? "MES");
  const [dim, setDim] = useState(sp.get("dim") ?? "concepto");
  const [luz, setLuz] = useState("");
  const [bajando, setBajando] = useState(false);
  const q = new URLSearchParams({ mes, al, modo, dim });
  const { datos, error, cargando, recargar } = useDatos<Datos>(`/v1/prs/ejecucion?${q}`);
  if (error) return <ErrorCarga error={error} que="La ejecución del presupuesto la ven Gerencia, Administración, la Contadora y Auditoría." />;
  const k = datos?.kpi;
  const filas = (datos?.filas ?? []).filter((x) => !luz || x.light === luz);
  const cerrados = Object.entries(datos?.corridas ?? {});
  const puedeRecalcular = Boolean(op?.puede.conceptos || op?.puede.aprobar);

  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/prs/ejecucion/exportar?${q}`, `presupuesto-ejecucion-${mes}.xlsx`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }
  async function recalcular(m: string) {
    const r = await confirmAction({ title: `¿Recalcular el real de ${mesLargo(m)}?`, message: "Se congela una corrida nueva con el real de hoy; la anterior queda guardada (RN-PRS-09).",
      confirmLabel: "Recalcular", reason: { label: "Motivo", min: 10 } });
    if (!r) return;
    try {
      const x = await api<{ run_no: number; total: number }>("/v1/prs/real/recalcular", { method: "POST", body: { mes: m.slice(0, 7), motivo: r.reason } });
      toast.ok(`Corrida ${x.run_no} congelada (${s0(x.total)})`);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Fila>[] = [
    { key: "name", header: "Concepto", cardTitle: true, render: (x) => (
      <span className="flex flex-col">
        <AlDetalle concepto={x.concept_id} mes={mes} al={al} modo={modo} dim={dim} valor={x.dim_value}>{x.name}</AlDetalle>
        <span className="text-[12px] text-muted">{x.code}{dim !== "concepto" ? ` · ${x.dimension}` : ""}{x.type === "INCOME" ? " · ingreso" : ""}</span>
      </span>) },
    { key: "budget", header: "Presupuesto", align: "right", render: (x) => s0(x.budget) },
    { key: "actual", header: "Real", align: "right", render: (x) => <span>{s0(x.actual)}{x.sin_linea > 0.5 && <span className="block text-[11px] text-muted">{s0(x.sin_linea)} sin línea</span>}</span> },
    { key: "diff", header: "Diferencia", align: "right", render: (x) => <span className={x.type === "INCOME" ? (x.diff < 0 ? "text-bad" : "text-ok") : x.diff > 0 ? "text-bad" : "text-ok"}>{x.diff > 0 ? "+" : ""}{s0(x.diff)}</span> },
    { key: "pct", header: "% ejecución", align: "right", render: (x) => (x.pct === null ? "—" : porcentaje(x.pct, 1)) },
    { key: "forecast", header: "Proyección", align: "right", hideOnMobile: true, render: (x) => s0(x.forecast) },
    { key: "status", header: "Semáforo", render: (x) => <Semaforo luz={x.light} pct={x.fpct} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Presupuesto, real, diferencia, % de ejecución y semáforo por concepto y dimensión. El real sale de ventas (FAC), gastos aprobados (GAS) y personal (PER), sin IGV. En el mes en curso el semáforo usa la proyección."
        actions={<>
          <Link className={buttonClass("secondary")} href={`/m/prs/prs-08?mes=${mes}&al=${al}`}>Proyección de cierre</Link>
          <Button icon={Download} loading={bajando} onClick={exportar}>Exportar</Button>
        </>} />
      <div className="flex flex-wrap gap-2">
        <FiltroMes value={mes} onChange={(m) => { setMes(m); router.replace(`/m/prs/prs-06?mes=${m}`); }} />
        <FiltroCorte value={al} onChange={setAl} />
        <FiltroSelect etiqueta="Período" value={modo} onChange={(x) => setModo(x || "MES")} options={[{ value: "MES", label: "Solo el mes" }, { value: "ACUMULADO", label: "Acumulado del año" }]} vacio="Solo el mes" />
        <FiltroSelect etiqueta="Ver" value={dim} onChange={(x) => setDim(x || "concepto")} options={DIMS} vacio="Por concepto" ancho={190} />
        <FiltroSelect etiqueta="Semáforo" value={luz} onChange={setLuz} options={[{ value: "GREEN", label: "Verde" }, { value: "AMBER", label: "Ámbar" }, { value: "RED", label: "Rojo" }]} />
      </div>
      {datos && !datos.version && <Alert tone="warn">El año {mes.slice(0, 4)} no tiene versión aprobada: solo se ve el real.</Alert>}
      {datos && (
        <p className="text-[12.5px] text-muted">
          {datos.version ? `${datos.version.etiqueta} · ${datos.version.name}` : "Sin presupuesto"} · {modo === "ACUMULADO" ? `acumulado a ${mesLargo(datos.mes)}` : mesLargo(datos.mes)}
          {" · "}{Object.values(datos.estados).slice(-1).map((e) => e.nombre.toLowerCase())}
        </p>)}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Gasto real" valor={k ? s0(k.gasto.actual) : undefined} detalle={k ? `de ${s0(k.gasto.budget)} · KPI-PRS-01 ${k.gasto.pct !== null ? porcentaje(k.gasto.pct, 1) : "—"}` : ""} destacada />
        <Cifra titulo="Desviación de gasto" valor={k ? `${k.gasto.diff > 0 ? "+" : ""}${s0(k.gasto.diff)}` : undefined} detalle={k ? `Proyección ${s0(k.gasto.forecast)}` : ""} tono={k?.gasto.light ? TONO_LUZ[k.gasto.light] : undefined} />
        <Cifra titulo="Ingresos reales" valor={k ? s0(k.ingreso.actual) : undefined} detalle={k ? `de ${s0(k.ingreso.budget)} · ${k.ingreso.pct !== null ? porcentaje(k.ingreso.pct, 1) : "—"}` : ""} tono={k?.ingreso.light ? TONO_LUZ[k.ingreso.light] : undefined} />
        <Link href="/m/prs/prs-10" className="block"><Cifra titulo="Conceptos en rojo" valor={k ? String(k.rojos) : undefined} detalle={k ? `${k.ambar} en ámbar` : ""} tono={k?.rojos ? "bad" : "ok"} /></Link>
      </div>
      {k && k.sin_mapeo > 0.5 && <Alert tone="warn" title={`${s0(k.sin_mapeo)} de real sin concepto`}>Hay gastos o costos cuya categoría no está mapeada a ningún concepto. Mapéalos en <Link className="underline" href="/m/prs/prs-02">Conceptos presupuestales</Link>.</Alert>}
      <DataTable rows={filas} columns={columnas} rowKey={(x) => x.key} loading={cargando}
        onRowClick={(x) => router.push(`/m/prs/prs-07?${new URLSearchParams({ concepto: x.concept_id, mes, al, modo, ...(dim !== "concepto" ? { dim } : {}), ...(x.dim_value ? { valor: x.dim_value } : {}) })}`)}
        empty="Sin datos para este mes." />
      {cerrados.length > 0 && (
        <Seccion titulo="Meses cerrados: real congelado (RN-PRS-09)">
          <div className="space-y-3">
            {cerrados.map(([m, cs]) => (
              <div key={m} className="rounded-lg border border-line p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{mesLargo(m)} · {cs.length} corrida(s)</span>
                  {puedeRecalcular && <Button size="sm" icon={RefreshCw} onClick={() => recalcular(m)}>Recalcular</Button>}
                </div>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {cs.map((c) => <li key={c.run_no}>Corrida {c.run_no}{c.run_no === cs.length ? " (vale)" : ""} · {fechaHora(c.frozen_at)} · {c.por} · {s0(c.total)} · {c.reason}</li>)}
                </ul>
              </div>))}
          </div>
        </Seccion>)}
    </div>
  );
}
