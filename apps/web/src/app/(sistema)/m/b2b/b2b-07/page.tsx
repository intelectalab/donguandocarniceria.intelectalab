"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Alert, Button, PageHeader, StatusBadge } from "@/components/ui";
import { fecha, soles } from "@/lib/formato";
import { FiltroSelect, Panel, Sub, descargar, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { CifrasCredito, Movimientos } from "@/modulos/b2b/EstadoCuenta";
import { ESTADO_PROMESA, type Movimiento, type Opciones, type Resumen } from "@/modulos/b2b/tipos";

type Promesa = { id: string; full_number: string | null; promised_date: string; amount: string; status: string; notes: string | null; recorded_name: string };
type Resp = { movements: Movimiento[]; summary: Resumen; promises: Promesa[]; customer: { full_name: string; doc_number: string } };

/** B2B-07 Estado de cuenta: comprobantes, notas de crédito y pagos con saldo acumulado y mora, exportable a Excel. */
export default function EstadoDeCuenta() {
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [id, setId] = useState("");
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const r = useDatos<Resp>(id ? `/v1/b2b/clientes/${id}/estado-de-cuenta` : null);
  const d = r.datos;
  return (
    <div className="space-y-5">
      <PageHeader code={d ? `${d.customer.full_name} · RUC ${d.customer.doc_number}` : undefined} description="Todo lo que el cliente compró, pagó y se le abonó, con el saldo después de cada movimiento."
        actions={<>
          <div className="w-[280px]"><FiltroSelect label="Cliente" value={id} onChange={setId} ancho="w-full" options={(op?.customers ?? []).filter((c) => c.has_credit).map((c) => ({ value: c.id, label: c.full_name }))} /></div>
          {id && <Button icon={Download} onClick={() => descargar(`/v1/b2b/clientes/${id}/estado-de-cuenta/exportar`, `estado-de-cuenta-${d?.customer.doc_number ?? id}.csv`)}>Exportar a Excel</Button>}
        </>} />
      {!id && <Alert tone="info">Elige un cliente.</Alert>}
      {r.error && <Alert tone="bad">{r.error}</Alert>}
      {id && <>
        <CifrasCredito s={d?.summary} />
        {d && d.promises.length > 0 && <Panel titulo="Promesas de pago">
          <ul className="divide-y divide-line text-[13.5px]">{d.promises.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>{soles(p.amount)} para el {fecha(p.promised_date)}{p.full_number ? ` · ${p.full_number}` : ""}<Sub>{p.notes ?? ""} · registró {p.recorded_name}</Sub></span>
            <StatusBadge status={p.status} labels={ESTADO_PROMESA} /></li>)}</ul>
        </Panel>}
        <Movimientos filas={d?.movements ?? []} cargando={r.cargando} />
      </>}
    </div>
  );
}
