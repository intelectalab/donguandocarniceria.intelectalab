"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, CalendarClock, ShieldAlert, Timer } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, StatusBadge, Tabs, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Cant, Dias, qs, useDatos } from "@/modulos/alm/comunes";
import { LOTE, TRAMO, type Num } from "@/modulos/alm/tipos";

type Alerta = { lot_id: string; lot_code: string; expiry_date: string; qc_status: string; variant_id: string; sku: string; variant_name: string; sale_mode: string; line: string | null;
  qty: Num; reserved_qty: Num; value: Num; warehouses: string; days_left: number; bucket: string; action: string; action_label: string };
type Respuesta = { data: Alerta[]; summary: Record<"EXPIRED" | "D3" | "D7", { lots: number; value: number }> };
type Parte = { label: string | null; value: Num };
type Kpi = { name: string; value: Num; numerator?: Num; denominator?: Num; by_reason?: Parte[]; by_line?: Parte[]; by_warehouse?: Parte[]; by_brand?: Parte[];
  by_supplier?: { label: string; value: Num; observed: number; total: number }[]; d3?: Num; d7?: Num };
type Kpis = { period: { from: string; to: string; days: number } } & Record<string, Kpi>;

const ACCION: Record<string, "bad" | "warn" | "info"> = { WASTE: "bad", PROMO: "warn", PROMO_FEFO: "warn", SELL_FIRST: "info" };

/** ALM-11 Alertas de vencimiento: lotes con stock que vencen en 3 y 7 días y vencidos, con valor y acción sugerida. Más los KPI de ALM. */
export default function Alertas() {
  const { marca, local, can, puede } = useSesion();
  const [tramo, setTramo] = useState<"ALL" | "EXPIRED" | "D3" | "D7">("ALL");
  const [vista, setVista] = useState<"alertas" | "kpi">("alertas");
  const [generando, setGenerando] = useState(false);
  const { datos, error, cargando } = useDatos<Respuesta>(`/v1/alm/alertas${qs({ site: local, brand: marca })}`);
  const kpi = useDatos<Kpis>(vista === "kpi" ? `/v1/alm/kpi${qs({ site: local, brand: marca })}` : null);
  const costos = can("alm.stock.view_cost");
  const filas = (datos?.data ?? []).filter((a) => tramo === "ALL" || a.bucket === tramo);
  const s = datos?.summary;

  async function generar() {
    setGenerando(true);
    try {
      const r = await api<{ new?: Record<string, number> }>("/v1/alm/alertas/generar", { method: "POST" });
      const n = r.new ? Object.values(r.new).reduce((a, b) => a + b, 0) : 0;
      toast.ok(n ? `${n} alerta(s) nuevas de hoy avisadas al almacén` : "Las alertas de hoy ya estaban avisadas");
    } catch (e) { toast.error(mensajeDe(e)); } finally { setGenerando(false); }
  }

  const columnas: Column<Alerta>[] = [
    { key: "lot_code", header: "Lote", cardTitle: true, render: (a) => <div className="flex flex-wrap items-center gap-1.5"><Link href={`/m/alm/alm-06?lote=${a.lot_id}`} className="font-mono font-semibold text-primary hover:underline">{a.lot_code}</Link>{a.qc_status !== "RELEASED" && <StatusBadge status={a.qc_status} labels={LOTE} />}</div> },
    { key: "sku", header: "Producto", render: (a) => <div className="min-w-[160px]"><p>{a.variant_name}</p><p className="font-mono text-[12px] text-muted">{a.sku}{a.line ? ` · ${a.line}` : ""}</p></div> },
    { key: "expiry_date", header: "Vence", render: (a) => <div><p>{fecha(a.expiry_date)}</p><Dias d={a.days_left} /></div> },
    { key: "warehouses", header: "Almacenes", hideOnMobile: true, render: (a) => <span className="font-mono text-[12px]">{a.warehouses}</span> },
    { key: "qty", header: "Stock", align: "right", render: (a) => <div><Cant v={a.qty} modo={a.sale_mode} />{Number(a.reserved_qty) > 0 && <p className="text-[12px] text-muted">{numero(a.reserved_qty)} reservado</p>}</div> },
    ...(costos ? [{ key: "value", header: "Valor", align: "right", render: (a: Alerta) => soles(a.value) }] as Column<Alerta>[] : []),
    { key: "action", header: "Acción sugerida", render: (a) => <Badge tone={ACCION[a.action]}>{a.action_label}</Badge> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lotes con stock que vencen pronto o ya vencieron. Cada mañana a las 6:00 el sistema avisa al almacén; un lote se avisa una sola vez por día."
        actions={puede("ALM", "E") && <Button icon={BellRing} loading={generando} onClick={generar}>Avisar ahora</Button>} />
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "alertas", label: "Alertas", count: datos?.data.length }, { key: "kpi", label: "Indicadores" }]} />
      {vista === "alertas" ? <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["EXPIRED", "D3", "D7"] as const).map((b) => (
            <button key={b} type="button" onClick={() => setTramo(tramo === b ? "ALL" : b)} className={`cursor-pointer rounded-xl text-left ${tramo === b ? "ring-2 ring-primary" : ""}`}>
              <Cifra titulo={TRAMO[b][0]} valor={s ? `${s[b].lots} lotes` : "…"} detalle={s && costos ? soles(s[b].value) : undefined}
                icono={b === "EXPIRED" ? ShieldAlert : b === "D3" ? Timer : CalendarClock} tono={b === "EXPIRED" ? "bad" : b === "D3" ? "warn" : undefined} />
            </button>
          ))}
        </div>
        {error && <Alert tone="bad">{error}</Alert>}
        <DataTable rows={filas} columns={columnas} rowKey={(a) => a.lot_id} loading={cargando}
          empty={tramo === "ALL" ? "Ningún lote con stock vence en los próximos días." : "Ningún lote en este tramo."} />
      </> : <Indicadores k={kpi.datos} cargando={kpi.cargando} error={kpi.error} costos={costos} />}
    </div>
  );
}

function Desglose({ titulo, partes, formato }: { titulo: string; partes?: Parte[]; formato: (v: Num) => string }) {
  if (!partes?.length) return null;
  const max = Math.max(...partes.map((p) => Math.abs(Number(p.value ?? 0))), 1);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-medium text-muted">{titulo}</p>
      <ul className="space-y-1">
        {partes.slice(0, 6).map((p, i) => (
          <li key={`${p.label}-${i}`} className="text-[12.5px]">
            <div className="flex justify-between gap-2"><span className="truncate">{p.label ?? "Sin dato"}</span><span className="tabular-nums">{formato(p.value)}</span></div>
            <div className="h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(Math.abs(Number(p.value ?? 0)) / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Indicadores({ k, cargando, error, costos }: { k?: Kpis; cargando: boolean; error?: string; costos: boolean }) {
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!k) return <p className="text-[13px] text-muted">{cargando ? "Cargando…" : ""}</p>;
  const g = (c: string) => k[c] as Kpi;
  const s = (v: Num) => (costos ? soles(v) : "—");
  const tarjeta = "min-w-0 space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card";
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">Del {fecha(k.period.from)} al {fecha(k.period.to)} ({k.period.days} días).</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Días de inventario" valor={g("KPI-ALM-01").value !== null ? numero(g("KPI-ALM-01").value, 1) : "—"} detalle="KPI-ALM-01" />
        <Cifra titulo="Mermas sobre costo de venta" valor={porcentaje(g("KPI-ALM-02").value, 1)} detalle={costos ? `${s(g("KPI-ALM-02").numerator ?? null)} · KPI-ALM-02` : "KPI-ALM-02"} />
        <Cifra titulo="Vencidos" valor={s(g("KPI-ALM-03").value)} detalle="KPI-ALM-03" tono={Number(g("KPI-ALM-03").value) > 0 ? "bad" : undefined} />
        <Cifra titulo="Por vencer en 7 días" valor={s(g("KPI-ALM-04").value)} detalle={costos ? `${s(g("KPI-ALM-04").d3 ?? null)} en 3 días · KPI-ALM-04` : "KPI-ALM-04"} />
        <Cifra titulo="Exactitud del conteo" valor={porcentaje(g("KPI-ALM-05").value, 1)} detalle={`${g("KPI-ALM-05").numerator ?? 0} de ${g("KPI-ALM-05").denominator ?? 0} líneas · KPI-ALM-05`} />
        <Cifra titulo="Recepciones observadas" valor={porcentaje(g("KPI-ALM-06").value, 1)} detalle={`${g("KPI-ALM-06").numerator ?? 0} de ${g("KPI-ALM-06").denominator ?? 0} · KPI-ALM-06`} />
        <Cifra titulo="Quiebres de stock" valor={porcentaje(g("KPI-ALM-07").value, 1)} detalle={`${g("KPI-ALM-07").numerator ?? 0} de ${g("KPI-ALM-07").denominator ?? 0} pedidos · KPI-ALM-07`} />
        <Cifra titulo="Valor del inventario" valor={s(g("KPI-ALM-08").value)} detalle="KPI-ALM-08" destacada />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {costos && <section className={tarjeta}>
          <h3 className="text-[14px] font-semibold">Mermas</h3>
          <Desglose titulo="Por motivo" partes={g("KPI-ALM-02").by_reason} formato={soles} />
          <Desglose titulo="Por línea" partes={g("KPI-ALM-02").by_line} formato={soles} />
          <Desglose titulo="Por almacén" partes={g("KPI-ALM-02").by_warehouse} formato={soles} />
        </section>}
        <section className={tarjeta}>
          <h3 className="text-[14px] font-semibold">Recepciones observadas por proveedor</h3>
          <Desglose titulo="Porcentaje observado" partes={g("KPI-ALM-06").by_supplier} formato={(v) => porcentaje(v, 1)} />
          {!g("KPI-ALM-06").by_supplier?.length && <p className="text-[13px] text-muted">Sin recepciones en el período.</p>}
        </section>
        {costos && <section className={tarjeta}>
          <h3 className="text-[14px] font-semibold">Valor del inventario</h3>
          <Desglose titulo="Por almacén" partes={g("KPI-ALM-08").by_warehouse} formato={soles} />
          <Desglose titulo="Por marca" partes={g("KPI-ALM-08").by_brand} formato={soles} />
          <Desglose titulo="Por línea" partes={g("KPI-ALM-08").by_line} formato={soles} />
        </section>}
      </div>
    </div>
  );
}
