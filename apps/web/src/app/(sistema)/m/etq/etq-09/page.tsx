"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, PackageCheck, Printer, Siren } from "lucide-react";
import { Alert, Input, PageHeader } from "@/components/ui";
import { fecha, fechaHora, kg, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Barras, CifraLink, Seccion, Tabla, qs, useDatos, type Num } from "@/modulos/etq/comunes";

type Tablero = { period: { from: string; to: string }; recalls: number; open_recalls: number; listing_minutes_avg: Num; recovery_pct: Num; sold_kg: Num; recovered_kg: Num;
  prints: number; reprints: number; labels: number; reprint_pct: Num;
  by_establishment: { id: string; establishment_name: string; prints: number; reprints: number; labels: number; reprint_pct: Num }[];
  open: { id: string; number: string; reason: string; initiated_at: string; pending: number }[]; brands_without_template: string[] };

/** ETQ-09 Tablero de trazabilidad: KPI-ETQ-01 (minutos para listar clientes), KPI-ETQ-02 (kg recuperados) y KPI-ETQ-03 (reimpresiones), de los últimos 90 días. */
export default function TableroEtq() {
  const { local } = useSesion();
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const { datos: t, error } = useDatos<Tablero>(`/v1/etq/tablero${qs({ desde, hasta, site: local })}`);
  return (
    <div className="space-y-5">
      <PageHeader description={t ? `Del ${fecha(t.period.from)} al ${fecha(t.period.to)}.` : "Últimos 90 días."}
        actions={<div className="flex gap-2"><div className="w-[150px]"><Input type="date" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="w-[150px]"><Input type="date" aria-label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div></div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {t && t.brands_without_template.length > 0 && <Alert tone="warn" title="Marcas sin plantilla activa">{t.brands_without_template.join(", ")}: sus productos no se pueden etiquetar. <Link href="/m/etq/etq-01" className="underline">Ir a plantillas</Link></Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Minutos para listar clientes" valor={t ? numero(t.listing_minutes_avg) : undefined} detalle={t ? `KPI-ETQ-01 · promedio de ${t.recalls} retiro(s)` : undefined} icono={Clock} href="/m/etq/etq-05" />
        <CifraLink titulo="Kg recuperados" valor={t ? porcentaje(t.recovery_pct, 1) : undefined} detalle={t ? `KPI-ETQ-02 · ${kg(t.recovered_kg)} de ${kg(t.sold_kg)}` : undefined} icono={PackageCheck} href="/m/etq/etq-05" />
        <CifraLink titulo="Reimpresiones" valor={t ? porcentaje(t.reprint_pct, 1) : undefined} detalle={t ? `KPI-ETQ-03 · ${t.reprints} de ${numero(t.prints)} impresiones` : undefined} icono={Printer}
          tono={t ? (Number(t.reprint_pct) > 5 ? "warn" : "ok") : undefined} href="/m/etq/etq-03?reprints=1" />
        <CifraLink titulo="Retiros en curso" valor={t ? String(t.open_recalls) : undefined} detalle={t ? `${numero(t.labels)} etiquetas impresas` : undefined} icono={Siren}
          tono={t ? (t.open_recalls ? "bad" : "ok") : undefined} href="/m/etq/etq-07" />
      </div>
      {t && <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Reimpresiones por local"><Barras filas={t.by_establishment.map((e) => ({ label: e.establishment_name, value: e.reprint_pct }))} formato={(v) => porcentaje(v, 1)} /></Seccion>
        <Seccion titulo="Retiros en curso">
          <Tabla cabeza={["Retiro", "Iniciado", "Por contactar"]} filas={t.open.map((r) => [<Link key="r" href={`/m/etq/etq-07?id=${r.id}`} className="text-primary hover:underline"><span className="font-mono">{r.number}</span>
            <span className="block max-w-[260px] truncate text-[12px] text-muted">{r.reason}</span></Link>, fechaHora(r.initiated_at), r.pending])} vacio="No hay retiros en curso." />
        </Seccion>
        <Seccion titulo="Impresiones por local" className="lg:col-span-2">
          <Tabla cabeza={["Local", "Impresiones", "Etiquetas", "Reimpresiones", "% reimpresión"]} filas={t.by_establishment.map((e) => [e.establishment_name, numero(e.prints), numero(e.labels), e.reprints, porcentaje(e.reprint_pct, 1)])} />
        </Seccion>
      </div>}
    </div>
  );
}
