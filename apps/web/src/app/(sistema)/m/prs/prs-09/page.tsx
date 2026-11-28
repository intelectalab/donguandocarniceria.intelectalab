"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Cifra, DataTable, PageHeader, type Column } from "@/components/ui";
import { porcentaje } from "@/lib/formato";
import { ErrorCarga, EstadoVersion, FiltroVersion, Seccion, mesCorto, s0, useDatos, useOpciones, type Totales, type VersionCorta } from "@/modulos/prs/comunes";

type Fila = { concept_id: string; code: string; name: string; type: string; a: number[]; b: number[]; diff: number[]; total_a: number; total_b: number; total_diff: number; pct: number | null };
type Lado = { id: string; etiqueta: string; name: string; status: string; year: number };
type Datos = { a: Lado; b: Lado; filas: Fila[]; totales: { a: Totales; b: Totales }; meses_a: string[]; meses_b: string[] };

/** PRS-09 Comparativo de versiones: dos versiones (del mismo año o de años distintos) lado a lado por concepto y mes. */
export default function ComparativoDeVersiones() {
  return <Suspense><Pantalla /></Suspense>;
}

/** Por defecto: la vigente más reciente contra la última versión de otra. */
function porDefecto(vs: VersionCorta[]): [string, string] {
  const orden = [...vs].sort((x, y) => y.year - x.year || y.version_no - x.version_no);
  const a = orden.find((v) => v.status === "APPROVED") ?? orden[1] ?? orden[0];
  const b = orden.find((v) => v.id !== a?.id);
  return [a?.id ?? "", b?.id ?? ""];
}

function Pantalla() {
  const sp = useSearchParams();
  const router = useRouter();
  const { datos: op, error: errOp } = useOpciones();
  const [elegidas, setElegidas] = useState<{ a: string; b: string }>({ a: sp.get("a") ?? "", b: sp.get("b") ?? "" });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [da, db] = op ? porDefecto(op.versiones) : ["", ""];
  const a = elegidas.a || da;
  const b = elegidas.b || db;
  const { datos, error, cargando } = useDatos<Datos>(a && b && a !== b ? `/v1/prs/comparativo?a=${a}&b=${b}` : null);
  if (errOp || error) return <ErrorCarga error={errOp || error} que="El comparativo de versiones lo ven Gerencia, Administración, la Contadora y Auditoría." />;
  const elegir = (lado: "a" | "b", v: string) => {
    const n = { a, b, [lado]: v };
    setElegidas(n);
    router.replace(`/m/prs/prs-09?a=${n.a}&b=${n.b}`);
  };
  const d = datos;
  const ta = d?.totales.a;
  const tb = d?.totales.b;
  const dif = (x?: number, y?: number) => (x === undefined || y === undefined ? undefined : `${y - x > 0 ? "+" : ""}${s0(y - x)}`);
  const fila = d?.filas.find((x) => x.concept_id === abierto);

  const columnas: Column<Fila>[] = [
    { key: "name", header: "Concepto", cardTitle: true, render: (x) => <span className="flex flex-col"><span className="font-medium text-primary">{x.name}</span><span className="text-[12px] text-muted">{x.code}{x.type === "INCOME" ? " · ingreso" : ""}</span></span> },
    { key: "total_a", header: d?.a.etiqueta ?? "A", align: "right", render: (x) => s0(x.total_a) },
    { key: "total_b", header: d?.b.etiqueta ?? "B", align: "right", render: (x) => s0(x.total_b) },
    { key: "total_diff", header: "Diferencia", align: "right", render: (x) => <span className={x.total_diff === 0 ? "" : x.type === "INCOME" ? (x.total_diff < 0 ? "text-bad" : "text-ok") : x.total_diff > 0 ? "text-bad" : "text-ok"}>{x.total_diff > 0 ? "+" : ""}{s0(x.total_diff)}</span> },
    { key: "pct", header: "%", align: "right", render: (x) => (x.pct === null ? "—" : `${x.pct > 0 ? "+" : ""}${porcentaje(x.pct, 1)}`) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Dos versiones lado a lado por concepto y mes. Sirve para ver qué cambió entre la vigente y una reformulación, o entre un año y el siguiente." />
      <div className="flex flex-wrap gap-2">
        {op && <FiltroVersion versiones={op.versiones} value={a} onChange={(v) => elegir("a", v)} etiqueta="Versión A" />}
        {op && <FiltroVersion versiones={op.versiones} value={b} onChange={(v) => elegir("b", v)} etiqueta="Versión B" />}
      </div>
      {op && op.versiones.length < 2 && <Alert tone="info">Hace falta al menos dos versiones para comparar.</Alert>}
      {a && b && a === b && <Alert tone="warn">Elige dos versiones distintas.</Alert>}
      {d && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span>A: {d.a.etiqueta} · {d.a.name}</span><EstadoVersion s={d.a.status} /><span>· B: {d.b.etiqueta} · {d.b.name}</span><EstadoVersion s={d.b.status} />
        </div>)}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Ingresos (B − A)" valor={dif(ta?.ingreso, tb?.ingreso)} detalle={ta && tb ? `${s0(ta.ingreso)} → ${s0(tb.ingreso)}` : ""} />
        <Cifra titulo="Costo de ventas (B − A)" valor={dif(ta?.costo, tb?.costo)} detalle={ta && tb ? `${s0(ta.costo)} → ${s0(tb.costo)}` : ""} />
        <Cifra titulo="Gastos (B − A)" valor={dif(ta?.gasto, tb?.gasto)} detalle={ta && tb ? `${s0(ta.gasto)} → ${s0(tb.gasto)}` : ""} />
        <Cifra titulo="Resultado (B − A)" valor={dif(ta?.resultado, tb?.resultado)} detalle={ta && tb ? `${s0(ta.resultado)} → ${s0(tb.resultado)}` : ""} destacada />
      </div>
      <DataTable rows={d?.filas ?? []} columns={columnas} rowKey={(x) => x.concept_id} loading={cargando} onRowClick={(x) => setAbierto(abierto === x.concept_id ? null : x.concept_id)}
        empty={a && b && a !== b ? "Las versiones no tienen líneas." : "Elige dos versiones."} />
      {fila && d && (
        <Seccion titulo={`${fila.name}: mes a mes`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead><tr className="text-left text-muted"><th className="py-1 pr-3 font-medium">Mes</th><th className="py-1 pr-3 text-right font-medium">{d.a.etiqueta}</th>
                <th className="py-1 pr-3 text-right font-medium">{d.b.etiqueta}</th><th className="py-1 text-right font-medium">Diferencia</th></tr></thead>
              <tbody>
                {fila.a.map((x, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1 pr-3">{d.meses_a[i] === d.meses_b[i] ? mesCorto(d.meses_a[i]) : `${mesCorto(d.meses_a[i])} ${d.meses_a[i].slice(2, 4)} / ${mesCorto(d.meses_b[i])} ${d.meses_b[i].slice(2, 4)}`}</td>
                    <td className="py-1 pr-3 text-right">{s0(x)}</td><td className="py-1 pr-3 text-right">{s0(fila.b[i])}</td>
                    <td className="py-1 text-right">{fila.diff[i] > 0 ? "+" : ""}{s0(fila.diff[i])}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </Seccion>)}
    </div>
  );
}
