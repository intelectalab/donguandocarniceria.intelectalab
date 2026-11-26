"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { Alert, Button, DataTable, Input, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, porcentaje } from "@/lib/formato";
import { mesActual, nombreMes, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { TIPO_PROVEEDOR, type Num } from "@/modulos/com/tipos";

type Fila = { supplier_id: string; supplier_name: string; supplier_type: string; current_rating: number | null; receipts: number; with_po: number; on_time: number; punctuality: Num;
  lines: number; observed: number; observed_pct: Num; weight_diff_pct: Num; docs: number; price_obs: number; price_obs_pct: Num; score: Num; rating: number };
type Respuesta = { month: string; from: string; to: string; data: Fila[] };

const estrellas = (n: number | null) => n ? <span aria-label={`${n} de 5`} className="whitespace-nowrap text-warn">{"★".repeat(n)}<span className="text-line">{"★".repeat(5 - n)}</span></span> : <span className="text-muted">—</span>;

/** COM-11 Evaluación de proveedores: puntualidad, recepciones observadas, diferencias de peso y de precio, por mes. */
export default function Evaluacion() {
  const op = useOpcionesCom();
  const [mes, setMes] = useState(mesActual());
  const { datos: r, error, recargar } = useDatos<Respuesta>(`/v1/com/evaluacion?month=${mes}`);
  async function fijar() {
    try { await api("/v1/com/evaluacion/fijar", { method: "POST", body: { month: mes } }); toast.ok("Calificaciones actualizadas en las fichas de los proveedores"); recargar(); }
    catch (e) { toast.error(mensajeDe(e)); }
  }
  const columnas: Column<Fila>[] = [
    { key: "supplier_name", header: "Proveedor", cardTitle: true, render: (f) => <div className="min-w-[150px]"><p className="font-medium">{f.supplier_name}</p><p className="text-[12px] text-muted">{TIPO_PROVEEDOR[f.supplier_type] ?? f.supplier_type}</p></div> },
    { key: "receipts", header: "Recepciones", align: "right", render: (f) => numero(f.receipts) },
    { key: "punctuality", header: "Puntualidad", align: "right", render: (f) => f.punctuality !== null ? <span>{porcentaje(f.punctuality, 1)}<span className="block text-[12px] text-muted">{f.on_time} de {f.with_po}</span></span> : "—" },
    { key: "observed_pct", header: "Observadas", align: "right", render: (f) => <span className={Number(f.observed_pct) > 5 ? "text-bad" : ""}>{porcentaje(f.observed_pct, 1)}</span> },
    { key: "weight_diff_pct", header: "Dif. de peso", align: "right", render: (f) => porcentaje(f.weight_diff_pct, 2) },
    { key: "price_obs_pct", header: "Precio observado", align: "right", hideOnMobile: true, render: (f) => porcentaje(f.price_obs_pct, 1) },
    { key: "score", header: "Puntaje", align: "right", render: (f) => numero(f.score, 1) },
    { key: "rating", header: "Calificación del mes", render: (f) => <span className="flex items-center gap-2">{estrellas(f.rating)}{f.current_rating !== f.rating && <span className="text-[12px] text-muted">antes {f.current_rating ?? "—"}</span>}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={`Cómo cumplieron los proveedores en ${nombreMes(mes)}: entregas a tiempo, recepciones observadas por Calidad y diferencias de peso y de precio. El puntaje va de 0 a 100 y se traduce en estrellas.`}
        actions={<div className="flex flex-wrap items-center gap-2"><div className="w-[170px]"><Input type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.target.value)} /></div>
          {op?.can.order_create && <Button icon={Star} disabled={!r?.data.length} onClick={fijar}>Fijar calificaciones</Button>}</div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <DataTable rows={r?.data ?? []} rowKey={(f) => f.supplier_id} loading={!r && !error} columns={columnas} empty={`Sin recepciones en ${nombreMes(mes)}.`} />
    </div>
  );
}
