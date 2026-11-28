"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Alert, Button, DataTable, DetailList, FiltroSelect, PageHeader, buttonClass, toast, type Column } from "@/components/ui";
import { apiDescargar, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { rutaPantalla } from "@/lib/modulos";
import { ErrorCarga, FiltroMes, OrigenBadge, Seccion, Semaforo, capital, conFormato, consulta, hoyLima, useDatos, valorDe, type Indicador, type Luz, type Origen } from "@/modulos/tab/comunes";

type Punto = { mes: string; nombre: string; value: number | null; source: Origen; run_no: number | null; meta: number | null; semaforo: Luz };
type Datos = {
  indicador: Indicador; mes: string; nombre_mes: string; nombre_marca: string; nombre_local: string; notas: string[];
  tendencia: Punto[]; corridas: { run_no: number; value: number | null; finished_at: string; reason: string; user: string }[]; meses: { value: string; label: string }[];
  detalle: { columnas: [string, string, string][]; filas: Record<string, string | number | null>[]; total_filas: number; totales: Record<string, number>; nota: string | null } | null;
  puede: { exportar: boolean };
};
type Catalogo = { filas: { code: string; name: string; status: string; modulo_encendido: boolean }[] };

const TONO_BARRA: Record<string, string> = { GREEN: "bg-ok", AMBER: "bg-warn", RED: "bg-bad" };
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

/** TAB-10 Detalle y exportación: de un valor a las filas que lo forman, con los mismos filtros (RN-TAB-02), su tendencia y sus corridas; Excel y PDF (RN-TAB-09). */
export default function Detalle() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const router = useRouter();
  const { marca, local } = useSesion();
  const [kpi, setKpi] = useState(sp.get("kpi") ?? "");
  const [mes, setMes] = useState(sp.get("mes") ?? hoyLima().slice(0, 7));
  const [bajando, setBajando] = useState(false);
  const q = consulta({ mes }, marca, local);
  const { datos: d, error, cargando } = useDatos<Datos>(kpi ? `/v1/tab/indicadores/${kpi}/detalle?${q}` : null);
  const { datos: cat } = useDatos<Catalogo>("/v1/tab/indicadores");
  const opciones = (cat?.filas ?? []).filter((x) => x.status === "ACTIVE" && x.modulo_encendido).map((x) => ({ value: x.code, label: `${x.code} · ${x.name}` }));

  function cambiar(k: string, m: string) {
    setKpi(k);
    setMes(m);
    router.replace(`?${new URLSearchParams({ kpi: k, mes: m })}`, { scroll: false });
  }
  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/tab/indicadores/${kpi}/exportar?${q}`, `indicador-${kpi.toLowerCase()}-${mes}.xlsx`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }

  const x = d?.indicador;
  const det = d?.detalle;
  const columnas: Column<Record<string, string | number | null>>[] = (det?.columnas ?? []).map(([k, t, tipo], i) => ({
    key: k, header: t, cardTitle: i === 0, align: tipo === "texto" || tipo === "fecha" ? "left" : "right",
    render: (f) => conFormato(f[k], tipo),
  }));
  const max = Math.max(1e-9, ...(d?.tendencia ?? []).map((p) => Math.abs(p.value ?? 0)), ...(d?.tendencia ?? []).map((p) => Math.abs(p.meta ?? 0)));
  const otra = x?.drilldown && x.drilldown !== "TAB-10" && /^[A-Z]{3}-\d{2}$/.test(x.drilldown) ? rutaPantalla(x.drilldown.slice(0, 3), x.drilldown) : null;

  return (
    <div className="space-y-4">
      <PageHeader description="De dónde sale un valor: las filas que lo forman, con el mismo mes, marca y local del tablero. Se puede exportar a Excel o imprimir y guardar como PDF."
        actions={<div className="flex flex-wrap gap-2 print:hidden">
          <Button icon={ArrowLeft} onClick={() => router.back()}>Volver</Button>
          {d?.puede.exportar && <Button icon={Download} loading={bajando} onClick={exportar}>Excel</Button>}
          {d && <Button icon={Printer} onClick={() => window.print()}>Imprimir o PDF</Button>}
        </div>} />
      <div className="flex flex-wrap gap-2 print:hidden">
        <FiltroSelect etiqueta="Indicador" value={kpi} onChange={(k) => k && cambiar(k, mes)} options={opciones} vacio="Elige un indicador" ancho={320} />
        <FiltroMes meses={d?.meses ?? []} value={mes} onChange={(m) => cambiar(kpi, m)} />
      </div>
      {!kpi && <Alert tone="info">Elige un indicador, o toca una tarjeta de cualquier tablero para llegar aquí con sus filtros.</Alert>}
      {error && <ErrorCarga error={error} que="" />}
      {kpi && cargando && <p className="text-[13px] text-muted">Buscando el detalle…</p>}
      {d && x && (
        <>
          <Seccion>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">{x.code} · {capital(d.nombre_mes)} · {d.nombre_marca} · {d.nombre_local}</p>
                <h2 className="text-[18px] font-semibold text-ink">{x.name}</h2>
                <p className="mt-1 max-w-3xl text-[13px] text-muted">{x.formula}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-[28px] font-bold tabular-nums">{x.value === null && x.nocalc ? "Sin cálculo" : valorDe(x.value, x.unit, x.decimals)}</p>
                <div className="flex justify-end gap-1.5"><Semaforo luz={x.semaforo} /><OrigenBadge x={x} /></div>
              </div>
            </div>
            <div className="mt-3">
              <DetailList items={[
                { label: "Meta", value: x.meta !== null ? `${valorDe(x.meta, x.unit, x.decimals)} ± ${x.tolerancia} %` : "Sin meta" },
                { label: "Mejor si", value: x.sentido },
                ...(x.numerator !== null && x.denominator !== null ? [{ label: "Numerador / denominador", value: `${conFormato(x.numerator)} / ${conFormato(x.denominator)}` }] : []),
                { label: "Mes anterior", value: valorDe(x.anterior, x.unit, x.decimals) },
              ]} />
            </div>
            {d.notas.map((n) => <p key={n} className="mt-2 text-[12.5px] text-muted">{n}</p>)}
          </Seccion>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Seccion titulo="Últimos 6 meses">
              <figure aria-label={`Tendencia de ${x.name}`}>
                <div className="flex items-end gap-2 border-b border-line" style={{ height: 150 }}>
                  {d.tendencia.map((p) => (
                    <div key={p.mes} className="relative flex h-full flex-1 flex-col items-center justify-end"
                      title={`${capital(p.nombre)}: ${valorDe(p.value, x.unit, x.decimals)}${p.meta !== null ? ` · meta ${valorDe(p.meta, x.unit, x.decimals)}` : ""} · ${p.source === "SNAPSHOT" ? `congelado, corrida ${p.run_no}` : "en vivo"}`}>
                      <span className="mb-1 text-[11px] tabular-nums text-muted">{p.value === null ? "" : valorDe(p.value, x.unit, x.decimals)}</span>
                      <div className={`w-full max-w-10 rounded-t-[4px] ${p.semaforo ? TONO_BARRA[p.semaforo] : "bg-primary"} ${p.source === "SNAPSHOT" ? "" : "opacity-60"}`}
                        style={{ height: p.value === null ? 0 : Math.max(2, (Math.abs(p.value) / max) * 110) }} />
                      {p.meta !== null && <div aria-hidden="true" className="absolute inset-x-0 border-t-2 border-dashed border-ink/40" style={{ bottom: (Math.abs(p.meta) / max) * 110 }} />}
                    </div>))}
                </div>
                <div className="mt-1 flex gap-2">{d.tendencia.map((p) => <span key={p.mes} className="flex-1 text-center text-[11px] text-muted">{MESES[Number(p.mes.slice(5, 7)) - 1]}</span>)}</div>
                <figcaption className="mt-2 text-[12px] text-muted">Color del semáforo de cada mes; la línea punteada es la meta. Más claro: en vivo, aún sin congelar.</figcaption>
              </figure>
            </Seccion>
            <Seccion titulo="Corridas de este mes">
              {d.corridas.length === 0 ? <p className="text-[13px] text-muted">Este mes aún no se congeló: el valor es en vivo.</p> : (
                <ul className="space-y-2 text-[13px]">
                  {d.corridas.map((c, i) => (
                    <li key={c.run_no} className="rounded-lg border border-line p-2">
                      <span className="font-medium">Corrida {c.run_no}{i === d.corridas.length - 1 ? " (vale)" : ""}: {valorDe(c.value, x.unit, x.decimals)}</span>
                      <span className="block text-[12px] text-muted">{fechaHora(c.finished_at)} · {c.user} · {c.reason}</span>
                    </li>))}
                </ul>)}
            </Seccion>
          </div>

          {det ? (
            <Seccion titulo={`Lo que forma el valor (${det.total_filas} filas)`}>
              {det.nota && <p className="mb-2 text-[12.5px] text-muted">{det.nota}</p>}
              {Object.keys(det.totales).length > 0 && (
                <p className="mb-2 flex flex-wrap gap-x-4 text-[13px]">
                  {det.columnas.filter(([k]) => k in det.totales).map(([k, t, tipo]) => <span key={k}><span className="text-muted">{t}:</span> <b className="tabular-nums">{conFormato(det.totales[k], tipo)}</b></span>)}
                </p>)}
              <DataTable rows={det.filas} columns={columnas} rowKey={(f) => JSON.stringify(f)} empty="Sin filas en este mes." />
              {det.total_filas > det.filas.length && <p className="mt-2 text-[12px] text-muted">Se muestran {det.filas.length} de {det.total_filas}; el Excel trae todas.</p>}
            </Seccion>
          ) : (
            <Alert tone="info" title="Este indicador no tiene detalle propio aquí">
              {otra ? <>Su detalle está en su módulo: <Link className={buttonClass("secondary", "sm", "ml-1")} href={otra}>Abrir {x.drilldown}</Link></> : "Se ve en la pantalla de su módulo."}
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
