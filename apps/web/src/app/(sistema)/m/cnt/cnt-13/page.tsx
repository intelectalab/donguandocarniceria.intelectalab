"use client";

import { useState } from "react";
import { Alert, DataTable, PageHeader, Tabs } from "@/components/ui";
import { fecha, soles } from "@/lib/formato";
import { FiltroSelect, Importe, Seccion, SelectorMes, mesActual, nombreMes, qs, rangoMes, useAlAbrir, useDatos, useOpcionesCnt } from "@/modulos/cnt/comunes";

type Linea = { code: string; label: string; kind: string; value: number | null; refs: string[] };
type Estado = { code: string; name: string; kind: string; from: string; to: string; lines: Linea[] };
type Comparativo = { code: string; columns: { month: string; values: Record<string, number | null> }[]; labels: { code: string; label: string; kind: string }[] };
const ESTADOS = [{ key: "ESF", label: "Situación financiera" }, { key: "ERF", label: "Resultados por función" }, { key: "ERN", label: "Resultados por naturaleza" }] as const;
type Codigo = (typeof ESTADOS)[number]["key"];
const mesCorto = (m: string) => { const [a, mm] = m.split("-").map(Number); return new Date(a, mm - 1, 1).toLocaleDateString("es-PE", { month: "short", year: "2-digit" }); };

/** CNT-13 Estados financieros: situación financiera y resultados por función y por naturaleza, por marca, local o consolidado, con comparativo mensual. */
export default function EstadosFinancieros() {
  const op = useOpcionesCnt();
  const [mes, setMes] = useState(mesActual());
  const [codigo, setCodigo] = useState<Codigo>("ERF");
  const [marca, setMarca] = useState("");
  const [local, setLocal] = useState("");
  useAlAbrir((p) => { if (p.get("month")) setMes(p.get("month")!); });
  const { from, to } = rangoMes(mes);
  const e = useDatos<Estado>(`/v1/cnt/estados/${codigo}${qs({ from, to, brand: marca, site: local })}`);
  const comp = useDatos<Comparativo>(codigo === "ESF" ? null : `/v1/cnt/estados/${codigo}/comparativo${qs({ to, months: 6, brand: marca, site: local })}`);
  const filas = e.datos?.lines ?? [];
  const alcance = [op?.brands.find((b) => b.id === marca)?.name, op?.establishments.find((s) => s.id === local)?.name].filter(Boolean).join(" · ") || "Consolidado";
  const fila = (l: { kind: string }) => (l.kind === "SUM" || l.kind === "TOTAL" ? "font-semibold" : l.kind === "HEADER" || l.kind === "TITLE" ? "font-semibold uppercase text-[12px] text-muted" : "");
  return (
    <div className="space-y-5">
      <PageHeader description={codigo === "ESF" ? `Saldos acumulados al ${fecha(to)}. ${alcance}.` : `Resultados de ${nombreMes(mes)}. ${alcance}. Solo cuentan los asientos aprobados.`}
        actions={<SelectorMes value={mes} onChange={setMes} />} />
      <Tabs tabs={ESTADOS.map((x) => ({ key: x.key, label: x.label }))} value={codigo} onChange={setCodigo} />
      {e.error && <Alert tone="bad">{e.error}</Alert>}
      <div className={`grid gap-4 ${codigo === "ESF" ? "lg:max-w-[760px]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"}`}>
        <Seccion titulo={e.datos?.name ?? "Estado"}>
          <DataTable rows={filas} rowKey={(l) => l.code} loading={e.cargando} empty="Sin movimientos aprobados en el período."
            toolbar={<>
              <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
              <FiltroSelect label="Local" value={local} onChange={setLocal} options={(op?.establishments ?? []).map((s) => ({ value: s.id, label: s.name }))} ancho="sm:w-[200px]" />
            </>}
            columns={[
              { key: "label", header: "Rubro", cardTitle: true, render: (l) => <span className={fila(l)}>{l.label}{l.kind === "ACC" && l.refs.length > 0 && <span className="ml-1 text-[11.5px] font-normal text-muted">({l.refs.join(", ")})</span>}</span> },
              { key: "value", header: "Importe", align: "right", render: (l) => l.value == null ? "" : <span className={fila(l)}><Importe v={l.value} formato={soles} /></span> },
            ]} />
        </Seccion>
        {codigo !== "ESF" && <Seccion titulo="Comparativo de los últimos seis meses">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12.5px]">
              <thead><tr className="border-b border-line text-left text-muted"><th className="py-2 pr-2 font-medium">Rubro</th>{(comp.datos?.columns ?? []).map((c) => <th key={c.month} className="py-2 pl-2 text-right font-medium capitalize">{mesCorto(c.month)}</th>)}</tr></thead>
              <tbody>{(comp.datos?.labels ?? []).map((l) => (
                <tr key={l.code} className={`border-b border-line/60 ${fila(l)}`}>
                  <td className="py-1.5 pr-2">{l.label}</td>
                  {(comp.datos?.columns ?? []).map((c) => <td key={c.month} className="py-1.5 pl-2 text-right whitespace-nowrap">{c.values[l.code] == null ? "" : <Importe v={c.values[l.code]} formato={soles} />}</td>)}
                </tr>))}</tbody>
            </table>
            {comp.cargando && <p className="py-2 text-muted">Cargando…</p>}
          </div>
        </Seccion>}
      </div>
    </div>
  );
}
