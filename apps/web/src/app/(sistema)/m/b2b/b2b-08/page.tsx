"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, PageHeader, Tabs, type Column } from "@/components/ui";
import { porcentaje, soles } from "@/lib/formato";
import { Cifras, CifraLink, FiltroSelect, Panel, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import type { Opciones } from "@/modulos/b2b/tipos";

type Fila = { key: string; name: string; total: number; buckets: Record<string, number> };
type Resp = { rows: Fila[]; totals: Record<string, number>; total: number; buckets: string[] };
const TONO = ["bg-ok", "bg-info", "bg-warn", "bg-bad/70", "bg-bad"];

/** B2B-08 Cartera por antigüedad: saldo por vencer y vencido en tramos, por cliente, vendedora o marca. */
export default function Cartera() {
  const router = useRouter();
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [por, setPor] = useState<"customer" | "seller" | "brand">("customer");
  const [vendedora, setVendedora] = useState("");
  const r = useDatos<Resp>(`/v1/b2b/cartera${qs({ by: por, seller_id: vendedora })}`);
  const d = r.datos;
  const tramos = d?.buckets ?? [];
  const vencido = d ? d.total - (d.totals[tramos[0]] ?? 0) : 0;

  const columnas: Column<Fila>[] = [
    { key: "name", header: por === "customer" ? "Cliente" : por === "seller" ? "Vendedora" : "Marca", cardTitle: true, render: (x) => <span className="font-medium">{x.name}</span> },
    ...tramos.map((t, i) => ({ key: t, header: t, align: "right" as const, render: (x: Fila) => x.buckets[t] ? <span className={i >= 2 ? "text-bad" : i === 1 ? "text-warn" : ""}>{soles(x.buckets[t])}</span> : <span className="text-muted">—</span> })),
    { key: "total", header: "Total", align: "right", render: (x) => <strong>{soles(x.total)}</strong> },
    { key: "bar", header: "", hideOnMobile: true, render: (x) => <div className="flex h-2 w-28 overflow-hidden rounded-full bg-surface-2">{tramos.map((t, i) => <span key={t} className={TONO[i]} style={{ width: `${x.total ? (x.buckets[t] / x.total) * 100 : 0}%` }} />)}</div> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Saldo de comprobantes a crédito según los días desde su vencimiento. Se cuenta lo pendiente de cada comprobante, ya descontados pagos y notas de crédito." />
      <Cifras>
        <CifraLink destacada titulo="Cartera total" valor={d ? soles(d.total) : undefined} detalle="Por cobrar" />
        <CifraLink titulo="Por vencer" valor={d ? soles(d.totals[tramos[0]] ?? 0) : undefined} detalle="Dentro del plazo" tono="ok" />
        <CifraLink titulo="Vencido" valor={d ? soles(vencido) : undefined} detalle={d?.total ? `${porcentaje((vencido / d.total) * 100, 1)} de la cartera` : undefined} tono={vencido ? "warn" : "ok"} href="/m/b2b/b2b-09" />
        <CifraLink titulo="Más de 30 días" valor={d ? soles(tramos.slice(3).reduce((a, t) => a + (d.totals[t] ?? 0), 0)) : undefined} detalle="Riesgo alto" tono="bad" />
      </Cifras>
      {d && <Panel titulo="Distribución">
        <div className="flex h-4 overflow-hidden rounded-full bg-surface-2">{tramos.map((t, i) => <span key={t} title={`${t}: ${soles(d.totals[t])}`} className={TONO[i]} style={{ width: `${d.total ? (d.totals[t] / d.total) * 100 : 0}%` }} />)}</div>
        <ul className="mt-3 flex flex-wrap gap-4 text-[12.5px]">{tramos.map((t, i) => <li key={t} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-full ${TONO[i]}`} />{t}: <strong>{soles(d.totals[t])}</strong></li>)}</ul>
      </Panel>}
      <Tabs value={por} onChange={setPor} tabs={[{ key: "customer", label: "Por cliente" }, { key: "seller", label: "Por vendedora" }, { key: "brand", label: "Por marca" }]} />
      <DataTable columns={columnas} rows={d?.rows ?? []} rowKey={(x) => x.key} loading={r.cargando} error={r.error} empty="Sin saldo por cobrar."
        onRowClick={por === "customer" ? (x) => router.push(`/m/b2b/b2b-07?id=${x.key}`) : undefined}
        toolbar={<FiltroSelect label="Vendedora" value={vendedora} onChange={setVendedora} options={(op?.sellers ?? []).map((x) => ({ value: x.id, label: x.name }))} />} />
    </div>
  );
}
