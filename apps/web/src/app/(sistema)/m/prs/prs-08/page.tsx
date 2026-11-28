"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BellRing, Save } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, FiltroSelect, PageHeader, buttonClass, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, porcentaje } from "@/lib/formato";
import { AlDetalle, ErrorCarga, FiltroCorte, FiltroMes, Seccion, Semaforo, TONO_LUZ, Vacio, hoyLima, mesLargo, s0, useDatos, useOpciones, type Version } from "@/modulos/prs/comunes";

type Fila = { key: string; concept_id: string; code: string; name: string; type: string; fixed: boolean; dimension: string; sin_linea: boolean; budget: number; actual: number; forecast: number;
  pct_real: number | null; pct: number | null; light: string | null; alerta: boolean };
type Datos = { version: Version | null; mes: string; al: string; estado: string; estado_codigo: string; dias: number; transcurridos: number; metodo: string; umbral: number; filas: Fila[];
  totales: { gasto: { budget: number; actual: number; forecast: number }; ingreso: { budget: number; actual: number; forecast: number } };
  kpi: { gasto_pct: number | null; ingreso_pct: number | null; gasto_light: string | null; ingreso_light: string | null; alertando: number };
  guardadas: { run_id: string; as_of: string; creada: string; total: number | null; lineas: number }[] };

/** PRS-08 Proyección de cierre: real a la fecha + lo que falta del mes (fijos al presupuesto, variables al ritmo diario) y las líneas que pasarían el umbral (RN-PRS-08 y 10). */
export default function ProyeccionDeCierre() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const { datos: op } = useOpciones();
  const hoy = hoyLima();
  const [mes, setMes] = useState(sp.get("mes") ?? hoy.slice(0, 7));
  const [al, setAl] = useState(sp.get("al") ?? hoy);
  const [solo, setSolo] = useState("");
  const [ocupado, setOcupado] = useState("");
  const { datos, error, cargando, recargar } = useDatos<Datos>(`/v1/prs/proyeccion?${new URLSearchParams({ mes, al })}`);
  if (error) return <ErrorCarga error={error} que="La proyección de cierre la ven Gerencia, Administración, la Contadora y Auditoría." />;
  const d = datos;
  const puede = Boolean(op?.puede.ver_todo);
  const filas = (d?.filas ?? []).filter((x) => (solo === "ALERTA" ? x.alerta : solo === "GASTO" ? x.type !== "INCOME" : solo === "INGRESO" ? x.type === "INCOME" : true));
  const mesCerrado = d && ["CLOSED", "COMPLETE"].includes(d.estado_codigo);

  async function accion(tipo: "guardar" | "alertas") {
    if (!d?.version) return;
    const ok = await confirmAction(tipo === "guardar"
      ? { title: "¿Guardar esta proyección?", message: `Queda guardada la proyección de ${mesLargo(d.mes)} al ${fecha(d.al)} para compararla después.`, confirmLabel: "Guardar" }
      : { title: "¿Generar las alertas?", message: `Se avisa al responsable de cada centro de costo cuya proyección pase el ${d.umbral} % del presupuesto. Las que ya volvieron al rango quedan resueltas.`, confirmLabel: "Generar alertas" });
    if (!ok) return;
    setOcupado(tipo);
    try {
      const body = { version: d.version.id, mes: d.mes.slice(0, 7), al: d.al };
      if (tipo === "guardar") {
        const r = await api<{ lineas: number }>("/v1/prs/proyeccion/guardar", { method: "POST", body });
        toast.ok(`Proyección guardada (${r.lineas} líneas)`);
      } else {
        const r = await api<{ activas: number; resueltas: number }>("/v1/prs/alertas/generar", { method: "POST", body });
        toast.ok(`${r.activas} alerta(s) activa(s)${r.resueltas ? `, ${r.resueltas} resuelta(s)` : ""}`);
      }
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const columnas: Column<Fila>[] = [
    { key: "name", header: "Concepto", cardTitle: true, render: (x) => (
      <span className="flex flex-col">
        <AlDetalle concepto={x.concept_id} mes={mes} al={al}>{x.name}</AlDetalle>
        <span className="text-[12px] text-muted">{x.dimension}{x.fixed ? " · fijo" : ""}{x.sin_linea ? " · sin línea" : ""}</span>
      </span>) },
    { key: "budget", header: "Presupuesto", align: "right", render: (x) => s0(x.budget) },
    { key: "actual", header: "Real a la fecha", align: "right", render: (x) => <span>{s0(x.actual)}{x.pct_real !== null && <span className="block text-[11px] text-muted">{porcentaje(x.pct_real, 1)}</span>}</span> },
    { key: "forecast", header: "Proyección al cierre", align: "right", render: (x) => <span className="font-medium">{s0(x.forecast)}</span> },
    { key: "status", header: "Semáforo", render: (x) => <span className="flex flex-wrap items-center gap-1"><Semaforo luz={x.light} pct={x.pct} />{x.alerta && <Badge tone="bad">Alerta</Badge>}</span> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Real a la fecha más lo que falta del mes: los conceptos fijos se completan con su presupuesto y los variables al ritmo diario. Si la proyección pasa el umbral, se genera la alerta."
        actions={<>
          <Link className={buttonClass("secondary")} href={`/m/prs/prs-06?mes=${mes}&al=${al}`}>Real frente a presupuesto</Link>
          {puede && <Button icon={Save} loading={ocupado === "guardar"} disabled={!d?.version || Boolean(ocupado)} onClick={() => accion("guardar")}>Guardar proyección</Button>}
          {puede && <Button variant="primary" icon={BellRing} loading={ocupado === "alertas"} disabled={!d?.version || Boolean(ocupado)} onClick={() => accion("alertas")}>Generar alertas</Button>}
        </>} />
      <div className="flex flex-wrap gap-2">
        <FiltroMes value={mes} onChange={setMes} />
        <FiltroCorte value={al} onChange={setAl} />
        <FiltroSelect etiqueta="Ver" value={solo} onChange={setSolo} vacio="Todo" options={[{ value: "ALERTA", label: "Solo las que alertan" }, { value: "GASTO", label: "Solo gastos y costos" }, { value: "INGRESO", label: "Solo ingresos" }]} ancho={200} />
      </div>
      {d && !d.version && <Alert tone="warn">El año {mes.slice(0, 4)} no tiene versión aprobada: no hay contra qué proyectar.</Alert>}
      {d && (
        <p className="text-[12.5px] text-muted">
          {d.version ? `${d.version.etiqueta} · ` : ""}{mesLargo(d.mes)} · {d.estado.toLowerCase()} · día {d.transcurridos} de {d.dias} · umbral de alerta {d.umbral} %
        </p>)}
      {mesCerrado && <Alert tone="info">El mes ya terminó: la proyección es igual al real.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Gasto proyectado" valor={d ? s0(d.totales.gasto.forecast) : undefined} detalle={d ? `de ${s0(d.totales.gasto.budget)} · ${d.kpi.gasto_pct !== null ? porcentaje(d.kpi.gasto_pct, 1) : "—"}` : ""}
          tono={d?.kpi.gasto_light ? TONO_LUZ[d.kpi.gasto_light] : undefined} destacada />
        <Cifra titulo="Gasto real a la fecha" valor={d ? s0(d.totales.gasto.actual) : undefined} />
        <Cifra titulo="Ingreso proyectado" valor={d ? s0(d.totales.ingreso.forecast) : undefined} detalle={d ? `de ${s0(d.totales.ingreso.budget)} · ${d.kpi.ingreso_pct !== null ? porcentaje(d.kpi.ingreso_pct, 1) : "—"}` : ""}
          tono={d?.kpi.ingreso_light ? TONO_LUZ[d.kpi.ingreso_light] : undefined} />
        <Link href={`/m/prs/prs-10?mes=${mes}`} className="block"><Cifra titulo="Líneas que alertan" valor={d ? String(d.kpi.alertando) : undefined} detalle="Ver alertas" tono={d?.kpi.alertando ? "bad" : "ok"} /></Link>
      </div>
      <DataTable rows={filas} columns={columnas} rowKey={(x) => x.key} loading={cargando} empty="Sin líneas para este mes." />
      <Seccion titulo="Proyecciones guardadas de este mes">
        {d && d.guardadas.length === 0 && <Vacio>Todavía no se guardó ninguna.</Vacio>}
        <ul className="space-y-1 text-[13px]">
          {d?.guardadas.map((g) => <li key={g.run_id} className="flex flex-wrap justify-between gap-2"><span>Al {fecha(g.as_of)} · guardada el {fechaHora(g.creada)} · {g.lineas} líneas</span><span className="font-medium">{s0(g.total)}</span></li>)}
        </ul>
      </Seccion>
    </div>
  );
}
