"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Alert, Button, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, toast, type Column } from "@/components/ui";
import { apiDescargar, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { Seccion, SinPermiso, Vacio, useDatos, useOpciones, usePermisosGas } from "@/modulos/gas/comunes";
import { inicioDeMes, hoyLima } from "@/modulos/gas/tipos";

type Fila = { clave: string; total: number; gastos: number; sin_valido: number; pct: number };
type Datos = {
  por: string; desde: string; hasta: string; filas: Fila[]; por_mes: { mes: string; total: number }[];
  kpi: {
    total: number; gastos: number; sin_valido: number; sin_valido_pct: number; mediana_horas: { nivel: number; nombre: string; horas: number; gastos: number }[];
    pendientes: number; pendientes_monto: number; caja_chica_dias: number | null;
  };
};

const POR = [
  { value: "categoria", label: "Categoría" }, { value: "grupo", label: "Grupo" }, { value: "centro", label: "Centro de costo" }, { value: "local", label: "Local" },
  { value: "marca", label: "Marca" }, { value: "canal", label: "Canal" }, { value: "mes", label: "Mes" },
];
const AGRUPAR = POR.filter((x) => x.value !== "categoria").map((x) => ({ value: x.value, label: `Por ${x.label.toLowerCase()}` }));
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`;
const horas = (h: number) => (h < 48 ? `${h.toLocaleString("es-PE", { maximumFractionDigits: 1 })} h` : `${(h / 24).toLocaleString("es-PE", { maximumFractionDigits: 1 })} días`);

/** GAS-11 Reporte de gastos: por categoría, centro de costo, local, marca, canal o mes, con los KPI-GAS y la exportación a Excel. */
export default function Reporte() {
  const p = usePermisosGas();
  const [f, setF] = useState({ desde: inicioDeMes(), hasta: hoyLima(), por: "categoria", local: "", categoria: "" });
  const [bajando, setBajando] = useState(false);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { datos: d, error, cargando } = useDatos<Datos>(p.reporte ? `/v1/gas/reporte?${qs}` : null);
  const { datos: op } = useOpciones();
  if (!p.reporte) return <SinPermiso que="El reporte de gastos lo ve gerencia, administración y contabilidad." />;
  const pon = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const nombre = POR.find((x) => x.value === f.por)?.label ?? "Categoría";

  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/gas/reporte/exportar?${qs}`, `reporte-gastos-${f.desde}-a-${f.hasta}.xlsx`);
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setBajando(false);
    }
  }

  const columnas: Column<Fila>[] = [
    { key: "clave", header: nombre, cardTitle: true, render: (r) => (f.por === "mes" ? nombreMes(r.clave) : r.clave) },
    { key: "gastos", header: "Gastos", align: "right" },
    { key: "total", header: "Total", align: "right", render: (r) => <span className="font-medium">{soles(r.total)}</span> },
    { key: "pct", header: "% del total", align: "right", render: (r) => (
      <span className="inline-flex items-center justify-end gap-2">
        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-2 sm:inline-block"><span className="block h-full bg-primary" style={{ width: `${Math.min(100, r.pct)}%` }} /></span>
        {r.pct.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %
      </span>
    ) },
    { key: "sin_valido", header: "Sin comprobante válido", align: "right", hideOnMobile: true, render: (r) => (r.sin_valido ? soles(r.sin_valido) : "—") },
  ];
  const k = d?.kpi;
  const maxMes = Math.max(1, ...(d?.por_mes ?? []).map((m) => m.total));
  return (
    <div className="space-y-4">
      <PageHeader description="Gastos aprobados y pagados en soles. Si un gasto está repartido, cada parte cuenta en su centro de costo, marca y canal."
        actions={<Button icon={Download} loading={bajando} disabled={!d} onClick={exportar}>Exportar a Excel</Button>} />
      <div className="flex flex-wrap gap-2">
        <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta} onChange={(v) => pon("desde", v || inicioDeMes())} />
        <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde} onChange={(v) => pon("hasta", v || hoyLima())} />
        <FiltroSelect etiqueta="Agrupar por" value={f.por === "categoria" ? "" : f.por} onChange={(v) => pon("por", v || "categoria")} options={AGRUPAR} vacio="Por categoría" />
        <FiltroSelect etiqueta="Local" value={f.local} onChange={(v) => pon("local", v)} options={(op?.locales ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        <FiltroSelect etiqueta="Categoría" todos="todas" value={f.categoria} ancho={200} onChange={(v) => pon("categoria", v)} options={(op?.categorias ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando && !d && <Vacio>Cargando…</Vacio>}
      {k && d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Total del periodo" valor={soles(k.total)} detalle={`${k.gastos} gastos`} destacada />
            <Cifra titulo="Sin comprobante válido" valor={`${k.sin_valido_pct.toLocaleString("es-PE")} %`} detalle={soles(k.sin_valido)} tono={k.sin_valido_pct > 10 ? "warn" : "ok"} />
            <Cifra titulo="Por aprobar" valor={String(k.pendientes)} detalle={soles(k.pendientes_monto)} tono={k.pendientes > 0 ? "warn" : "ok"} />
            <Cifra titulo="Caja chica sin rendir" valor={k.caja_chica_dias === null ? "—" : `${k.caja_chica_dias} días`} detalle="El gasto más antiguo sin rendir" tono={(k.caja_chica_dias ?? 0) > 7 ? "warn" : "ok"} />
          </div>
          <Seccion titulo={`Por ${nombre.toLowerCase()}`}>
            <DataTable rows={d.filas} rowKey={(r) => r.clave} columns={columnas} empty="No hay gastos aprobados en ese periodo." />
          </Seccion>
          <div className="grid gap-4 lg:grid-cols-2">
            <Seccion titulo="Por mes">
              {d.por_mes.length === 0 ? <Vacio>Sin gastos en el periodo.</Vacio> : (
                <ul className="space-y-2">
                  {d.por_mes.map((m) => (
                    <li key={m.mes} className="grid grid-cols-[70px_minmax(0,1fr)_100px] items-center gap-2 text-[13px]">
                      <span className="text-muted">{nombreMes(m.mes)}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full bg-primary" style={{ width: `${(m.total / maxMes) * 100}%` }} /></span>
                      <span className="text-right font-medium text-ink">{soles(m.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>
            <Seccion titulo="Tiempo de aprobación (mediana)">
              {k.mediana_horas.length === 0 ? <Vacio>Todavía no hay gastos aprobados en el periodo.</Vacio> : (
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[13px]">
                  {k.mediana_horas.map((m) => (
                    <div key={m.nivel} className="contents">
                      <dt className="text-muted">{m.nombre || `Nivel ${m.nivel}`} <span className="text-[12px]">({m.gastos} gastos)</span></dt>
                      <dd className="text-right font-medium text-ink">{horas(m.horas)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Seccion>
          </div>
        </>
      )}
    </div>
  );
}
