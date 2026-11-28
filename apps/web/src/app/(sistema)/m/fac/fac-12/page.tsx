"use client";

import { useState } from "react";
import { Download, FileMinus, Receipt, Scale, Timer } from "lucide-react";
import { Alert, Button, Cifra, DataTable, FiltroFecha, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { apiDescargar, mensajeDe } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { SUNAT, TIPOS, hoyLima, type Num } from "@/modulos/fac/tipos";

type Fila = { doc_type: string; marca: string | null; brand_id: string; sunat_status: string; status: string; cantidad: Num; subtotal: Num; igv: Num; total: Num; desde: string; hasta: string };
type Periodo = {
  mes: string; desde: string; hasta: string; filas: Fila[];
  cifras: { ventas: number; notas_credito: number; notas_debito: number; neto: number; comprobantes: number; igv: number };
  kpis: { rechazados_pct: number; pendientes_24h: number; notas_sobre_ventas_pct: number; mediana_aceptacion_min: number | null; entregados_sin_comprobante_pct: number; entregados_sin_comprobante: number };
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;

/** FAC-12 Comprobantes del período: resumen por tipo, marca y estado para la contadora; exportación a Excel. */
export default function Periodo() {
  const { marca, local } = useSesion();
  const [mes, setMes] = useState(hoyLima().slice(0, 7));
  const p = new URLSearchParams(Object.entries({ month: mes, brand: marca !== "ALL" ? marca : "", site: local !== "ALL" ? local : "" }).filter(([, v]) => v));
  const { datos: d, error, cargando } = useDatos<Periodo>(`/v1/fac/periodo?${p}`);
  const [bajando, setBajando] = useState(false);

  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/fac/periodo/exportar?${p}`, `comprobantes-${mes}.xlsx`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }

  const columnas: Column<Fila>[] = [
    { key: "doc_type", header: "Tipo", cardTitle: true, render: (f) => <div><div className="font-medium">{TIPOS[f.doc_type] ?? f.doc_type}</div><div className="text-[12px] text-muted">{f.marca ?? "—"}</div></div> },
    { key: "sunat_status", header: "Estado", render: (f) => <span className="inline-flex flex-wrap gap-1"><StatusBadge status={f.sunat_status} labels={SUNAT} />{f.status === "VOIDED" && <StatusBadge status="V" labels={{ V: ["Anulado", "neutral"] }} />}</span> },
    { key: "cantidad", header: "Cantidad", align: "right", render: (f) => numero(f.cantidad) },
    { key: "desde", header: "Rango", hideOnMobile: true, render: (f) => <span className="font-mono text-[12.5px]">{f.desde === f.hasta ? f.desde : `${f.desde} a ${f.hasta}`}</span> },
    { key: "subtotal", header: "Valor de venta", align: "right", hideOnMobile: true, render: (f) => soles(f.subtotal) },
    { key: "igv", header: "IGV", align: "right", render: (f) => soles(f.igv) },
    { key: "total", header: "Total", align: "right", render: (f) => soles(f.total) },
  ];

  const c = d?.cifras;
  const k = d?.kpis;
  return (
    <div className="space-y-5">
      <PageHeader description="Resumen del mes por tipo, marca y estado SUNAT. El Excel trae una hoja de resumen y otra con un renglón por comprobante (registro de ventas)."
        actions={<>
          <FiltroFecha etiqueta="Mes" tipo="month" value={mes} max={hoyLima().slice(0, 7)} onChange={(v) => setMes(v || hoyLima().slice(0, 7))} ancho={170} />
          <Button variant="primary" icon={Download} loading={bajando} onClick={exportar}>Excel para la contadora</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo={`Ventas de ${nombreMes(mes)}`} icono={Receipt} destacada valor={c ? soles(c.ventas) : undefined} detalle={c ? `${numero(c.comprobantes)} comprobantes` : ""} />
        <Cifra titulo="Notas de crédito" icono={FileMinus} valor={c ? soles(c.notas_credito) : undefined} detalle={k ? `${porcentaje(k.notas_sobre_ventas_pct, 1)} de las ventas` : ""}
          tono={k && k.notas_sobre_ventas_pct > 5 ? "warn" : undefined} />
        <Cifra titulo="Neto" icono={Scale} valor={c ? soles(c.neto) : undefined} detalle={c ? `IGV ${soles(c.igv)} · ND ${soles(c.notas_debito)}` : ""} />
        <Cifra titulo="Aceptación SUNAT" icono={Timer} valor={k ? (k.mediana_aceptacion_min !== null ? `${numero(k.mediana_aceptacion_min, 1)} min` : "—") : undefined}
          detalle={k ? `${porcentaje(k.rechazados_pct, 2)} rechazados` : ""} tono={k && k.rechazados_pct > 1 ? "bad" : k ? "ok" : undefined} />
      </div>

      {error && <Alert tone="bad">{error}</Alert>}
      {k && k.pendientes_24h > 0 && <Alert tone="bad">{k.pendientes_24h} comprobante(s) llevan más de 24 horas sin informarse a SUNAT. Revisa la cola de envío.</Alert>}
      {k && k.entregados_sin_comprobante > 0 && (
        <Alert tone="warn">{k.entregados_sin_comprobante} pedido(s) entregados hace más de un día siguen sin comprobante ({porcentaje(k.entregados_sin_comprobante_pct, 1)} de los entregados). Emítelos en «Emitir desde el pedido».</Alert>
      )}

      <Seccion titulo={`Resumen de ${nombreMes(mes)}`}>
        {cargando && !d ? <Vacio>Cargando…</Vacio> : (
          <DataTable rows={d?.filas ?? []} columns={columnas} rowKey={(f) => `${f.doc_type}|${f.brand_id}|${f.sunat_status}|${f.status}`} empty="No hay comprobantes en este mes." />
        )}
      </Seccion>
    </div>
  );
}
