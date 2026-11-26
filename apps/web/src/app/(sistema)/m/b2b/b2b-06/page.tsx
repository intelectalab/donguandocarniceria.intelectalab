"use client";

import { useState } from "react";
import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { Badge, Button, DataTable, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { FiltroSelect, Panel, Sub, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { ESTADO_CORRIDA, type Opciones } from "@/modulos/b2b/tipos";

type Proxima = { run_date: string; run_time: string; delivery_date: string; recurring_order_id: string; name: string; customer_name: string; auto_confirm: boolean; holiday: boolean; done: string | null };
type Corrida = { id: string; recurring_order_id: string; delivery_date: string; run_at: string; order_id: string | null; status: string; message: string | null; name: string; customer_name: string;
  order_number: string | null; order_status: string | null; estimated_total: string | null };
type Resp = { upcoming: Proxima[]; runs: Corrida[]; run_time: string; today: string };

/** B2B-06 Calendario de corridas: lo que se va a generar en los próximos 14 días y el resultado de cada corrida. */
export default function Corridas() {
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [estado, setEstado] = useState("");
  const r = useDatos<Resp>(`/v1/b2b/corridas${qs({ status: estado })}`);
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const gestiona = Boolean(op?.can["b2b.recurring.manage"]);

  async function correr(id?: string) {
    setCorriendo(id ?? "todas");
    try {
      const x = await api<{ ran: number; runs: { status: string }[] }>("/v1/b2b/corridas", { method: "POST", body: { recurring_order_id: id ?? null } });
      const de = (...e: string[]) => x.runs.filter((y) => e.includes(y.status)).length;
      toast.ok(x.ran ? `Corrida hecha: ${de("CREATED", "CONFIRMED")} pedidos, ${de("BLOCKED_CREDIT")} retenidos, ${de("SKIPPED")} saltados` : "No había nada por correr");
      r.recargar();
    } catch (e) { toast.error(mensajeDe(e)); } finally { setCorriendo(null); }
  }

  const proximas = r.datos?.upcoming ?? [];
  const porDia = proximas.reduce<Record<string, Proxima[]>>((a, p) => { (a[p.run_date] ??= []).push(p); return a; }, {});
  const columnas: Column<Corrida>[] = [
    { key: "run_at", header: "Corrió", render: (x) => fechaHora(x.run_at) },
    { key: "name", header: "Plantilla", cardTitle: true, render: (x) => <div>{x.name}<Sub>{x.customer_name}</Sub></div> },
    { key: "delivery_date", header: "Entrega", render: (x) => fecha(x.delivery_date) },
    { key: "status", header: "Resultado", render: (x) => <div><StatusBadge status={x.status} labels={ESTADO_CORRIDA} />{x.message && <Sub>{x.message}</Sub>}</div> },
    { key: "order_number", header: "Pedido", render: (x) => x.order_number ? <div><span className="font-mono">{x.order_number}</span><Sub>{soles(x.estimated_total)}</Sub></div> : "—" },
    { key: "acc", header: "", render: (x) => x.status === "BLOCKED_CREDIT" ? <Link className="text-[13px] text-primary underline" href="/m/b2b/b2b-04">Pedir excepción</Link> : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`La corrida diaria es a las ${r.datos?.run_time ?? "18:00"} (hora de Lima). Corre una sola vez por plantilla y fecha: volver a correrla no duplica pedidos.`}
        actions={gestiona && <Button variant="primary" icon={PlayCircle} loading={corriendo === "todas"} onClick={() => correr()}>Correr ahora</Button>} />
      <Panel titulo="Próximos 14 días">
        {!proximas.length ? <p className="text-[13px] text-muted">No hay corridas programadas.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(porDia).map(([dia, ps]) => (
            <div key={dia} className={`rounded-lg border p-3 ${dia === r.datos?.today ? "border-primary" : "border-line"}`}>
              <p className="mb-2 text-[12.5px] font-semibold text-muted">Corre {fecha(dia)} {ps[0].run_time}</p>
              <ul className="space-y-1.5 text-[13px]">{ps.map((p) => <li key={p.recurring_order_id + p.delivery_date}>
                <p className="font-medium">{p.customer_name}</p><Sub>{p.name} · entrega {fecha(p.delivery_date)}</Sub>
                <div className="mt-0.5 flex flex-wrap gap-1">{p.holiday && <Badge tone="warn">Feriado: se salta</Badge>}{p.done && <Badge tone="ok">Ya corrió</Badge>}{!p.auto_confirm && <Badge tone="info">Por confirmar</Badge>}
                  {gestiona && !p.done && dia === r.datos?.today && <Button size="sm" variant="ghost" loading={corriendo === p.recurring_order_id} onClick={() => correr(p.recurring_order_id)}>Correr</Button>}</div>
              </li>)}</ul>
            </div>
          ))}
        </div>}
      </Panel>
      <DataTable columns={columnas} rows={r.datos?.runs ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="Sin corridas."
        toolbar={<FiltroSelect label="Resultado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_CORRIDA)} />} />
    </div>
  );
}
