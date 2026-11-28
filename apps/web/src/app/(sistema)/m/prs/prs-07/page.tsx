"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, PageHeader, buttonClass, type Column } from "@/components/ui";
import { fecha, porcentaje } from "@/lib/formato";
import { ErrorCarga, Seccion, Vacio, hoyLima, mesLargo, s0, useDatos, type Version } from "@/modulos/prs/comunes";

type Flota = { tipo: string; id: string | null; placa: string | null; texto: string } | null;
type Fila = { source: string; origen: string; ref_type: string; ref_id: string; label: string; detail?: string | null; date: string | null; amount: number;
  dimension: string; linea: string; sin_linea: boolean; flota: Flota; categoria?: string | null; _k?: string };
type Datos = { concepto: { id: string; code: string; name: string; type: string; behavior: string | null }; mapeos: string[]; mes: string; modo: string; al: string;
  version: Version | null; presupuesto: number; real: number; pct: number | null; por_origen: { origen: string; monto: number }[]; filas: Fila[]; total_filas: number;
  dim: string | null; valor: string | null; valor_nombre: string | null };

/** PRS-07 Detalle del real: los documentos, gastos y planillas que forman el real de un concepto, con su enlace de flota (RN-PRS-06). */
export default function DetalleDelReal() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const concepto = sp.get("concepto");
  const mes = sp.get("mes") ?? hoyLima().slice(0, 7);
  const al = sp.get("al") ?? hoyLima();
  const modo = sp.get("modo") ?? "MES";
  const q = new URLSearchParams({ mes, al, modo, ...(concepto ? { concepto } : {}), ...(sp.get("dim") ? { dim: sp.get("dim")! } : {}), ...(sp.get("valor") ? { valor: sp.get("valor")! } : {}) });
  const { datos, error, cargando } = useDatos<Datos>(concepto ? `/v1/prs/detalle?${q}` : null);
  const volver = <Link className={buttonClass("secondary")} href={`/m/prs/prs-06?mes=${mes}&al=${al}&modo=${modo}`}><ArrowLeft className="h-4 w-4" /> Volver a la ejecución</Link>;
  if (!concepto) return <div className="space-y-4"><PageHeader actions={volver} /><Alert tone="info">Elige un concepto desde <Link className="underline" href="/m/prs/prs-06">Real frente a presupuesto</Link> para ver su detalle.</Alert></div>;
  if (error) return <ErrorCarga error={error} que="El detalle del real lo ven Gerencia, Administración, la Contadora y Auditoría." />;
  const d = datos;
  const ingreso = d?.concepto.type === "INCOME";
  const dif = d ? d.real - d.presupuesto : 0;

  const columnas: Column<Fila>[] = [
    { key: "label", header: "Documento", cardTitle: true, render: (x) => (
      <span className="flex flex-col">
        <span className="font-medium">{x.label}</span>
        {x.detail && <span className="text-[12px] text-muted">{x.detail}</span>}
      </span>) },
    { key: "date", header: "Fecha", render: (x) => (x.date ? fecha(x.date) : "—") },
    { key: "origen", header: "Origen", render: (x) => <Badge>{x.origen}</Badge> },
    { key: "dimension", header: "Dimensión", hideOnMobile: true, render: (x) => <span className="flex flex-col"><span>{x.dimension}</span>
      <span className={`text-[12px] ${x.sin_linea ? "text-warn" : "text-muted"}`}>Línea: {x.linea}</span></span> },
    { key: "flota", header: "Flota", hideOnMobile: true, render: (x) => (x.flota ? <span className="flex flex-col"><span>{x.flota.tipo}{x.flota.placa ? ` · ${x.flota.placa}` : ""}</span>
      {x.flota.texto && <span className="text-[12px] text-muted">{x.flota.texto}</span>}</span> : "—") },
    { key: "amount", header: "Importe sin IGV", align: "right", render: (x) => <span className={x.amount < 0 ? "text-bad" : ""}>{s0(x.amount)}</span> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description={d ? `${d.concepto.code} · ${d.concepto.name}${d.valor_nombre ? ` · ${d.valor_nombre}` : ""} · ${d.modo === "ACUMULADO" ? "acumulado a " : ""}${mesLargo(d.mes)}, al ${fecha(d.al)}` : "Cargando…"}
        actions={volver} />
      {d && !d.version && <Alert tone="warn">El año no tiene versión aprobada: solo se ve el real.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Presupuesto" valor={d ? s0(d.presupuesto) : undefined} detalle={d?.version?.etiqueta ?? ""} />
        <Cifra titulo="Real" valor={d ? s0(d.real) : undefined} detalle={d ? `${d.total_filas} movimiento(s)` : ""} destacada />
        <Cifra titulo="Diferencia" valor={d ? `${dif > 0 ? "+" : ""}${s0(dif)}` : undefined} tono={d && d.presupuesto > 0 ? ((ingreso ? dif < 0 : dif > 0) ? "bad" : "ok") : undefined} />
        <Cifra titulo="% de ejecución" valor={d ? (d.pct === null ? "—" : porcentaje(d.pct, 1)) : undefined} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Seccion titulo="De dónde sale el real">
          {d && d.por_origen.length === 0 && <Vacio>Sin movimientos en el período.</Vacio>}
          <ul className="space-y-1 text-[13px]">
            {d?.por_origen.map((o) => <li key={o.origen} className="flex justify-between gap-2"><span>{o.origen}</span><span className="font-medium">{s0(o.monto)}</span></li>)}
          </ul>
        </Seccion>
        <Seccion titulo="Qué entra en este concepto">
          {d && d.mapeos.length === 0 && <Vacio>El concepto no tiene mapeos: no recibe real. Mapéalo en <Link className="underline" href="/m/prs/prs-02">Conceptos presupuestales</Link>.</Vacio>}
          <div className="flex flex-wrap gap-1.5">{d?.mapeos.map((m) => <Badge key={m}>{m}</Badge>)}</div>
        </Seccion>
      </div>
      {d && d.total_filas > d.filas.length && <Alert tone="info">Se muestran los {d.filas.length} movimientos más recientes de {d.total_filas}.</Alert>}
      <DataTable rows={(d?.filas ?? []).map((x, i) => ({ ...x, _k: String(i) }))} columns={columnas} rowKey={(x) => x._k ?? ""} loading={cargando} empty="Sin movimientos del real en este período." />
    </div>
  );
}
