"use client";

import { useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { Badge, Cifra, DataTable, FiltroSelect, PageHeader, type Column } from "@/components/ui";
import { fechaHora, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { DetalleCobro } from "@/modulos/caj/DetalleCobro";
import { Seccion, Vacio, useDatos } from "@/modulos/caj/comunes";

type Fila = { id: string; number: string; paid_at: string; amount: string; reference: string | null; settlement_batch_id: string | null; medio: string; cuenta: string; cuenta_id: string; cliente: string | null; marca: string | null; dias: number };
type PorCuenta = { cuenta_id: string; cuenta: string; n: number; monto: number; vencido: number; n_vencido: number; max_dias: number };
type Resumen = { dias_alerta: number; por_cuenta: PorCuenta[]; total: number; vencido: number };

/** CAJ-09 Conciliación pendiente: cobros digitales que aún no se ven en un abono o el banco, con su antigüedad. */
export default function ConciliacionPendiente() {
  const [cuenta, setCuenta] = useState("");
  const [alerta, setAlerta] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const lista = useListado<Fila>("/v1/caj/conciliacion", { orden: "paid_at", filtros: { cuenta, alerta } });
  const { datos } = useDatos<{ resumen: Resumen }>("/v1/caj/conciliacion?per_page=1");
  const r = datos?.resumen;

  const columnas: Column<Fila>[] = [
    { key: "number", header: "Cobro", cardTitle: true, render: (p) => <div><div className="font-medium">{p.number}</div><div className="text-[12px] text-muted">{fechaHora(p.paid_at)}</div></div> },
    { key: "cliente", header: "Cliente", render: (p) => <div className="min-w-0"><div className="truncate">{p.cliente ?? "—"}</div><div className="text-[12px] text-muted">{p.marca ?? ""}</div></div> },
    { key: "cuenta", header: "Cuenta", render: (p) => <div className="text-[13px]">{p.cuenta}<div className="text-[12px] text-muted">{p.medio}{p.reference ? ` · op. ${p.reference}` : ""}</div></div> },
    { key: "amount", header: "Monto", sortable: true, align: "right", render: (p) => soles(p.amount) },
    { key: "dias", header: "Antigüedad", sortable: true, align: "right", render: (p) => (
      <span className="inline-flex items-center justify-end gap-1.5">
        {p.settlement_batch_id && <Badge tone="info">En abono</Badge>}
        <Badge tone={r && p.dias > r.dias_alerta ? "bad" : "neutral"}>{p.dias} {p.dias === 1 ? "día" : "días"}</Badge>
      </span>
    ) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cobros por Yape, Plin, tarjeta, Mercado Pago o transferencia que todavía no se cruzan con su abono o con el banco. Pasados los días de alerta, hay que revisarlos." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Por conciliar" icono={Clock} destacada valor={r ? soles(r.total) : undefined} detalle={r ? `${numero(r.por_cuenta.reduce((s, c) => s + c.n, 0))} cobros` : ""} />
        <Cifra titulo={r ? `Con más de ${r.dias_alerta} días` : "Atrasados"} icono={AlertTriangle} tono={r && r.vencido > 0 ? "bad" : undefined}
          valor={r ? soles(r.vencido) : undefined} detalle={r ? `${numero(r.por_cuenta.reduce((s, c) => s + c.n_vencido, 0))} cobros` : ""} />
      </div>
      <Seccion titulo="Por cuenta">
        {!r ? <Vacio>Cargando…</Vacio> : !r.por_cuenta.length ? <Vacio>Todo está conciliado.</Vacio> : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {r.por_cuenta.map((c) => (
              <li key={c.cuenta_id}>
                <button type="button" onClick={() => setCuenta(cuenta === c.cuenta_id ? "" : c.cuenta_id)}
                  className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors hover:bg-surface-2 ${cuenta === c.cuenta_id ? "border-primary" : "border-line"}`}>
                  <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[13.5px] font-medium">{c.cuenta}</span><span className="shrink-0 tabular-nums">{soles(c.monto)}</span></div>
                  <div className="text-[12px] text-muted">{c.n} cobros · el más antiguo de {c.max_dias} días{c.n_vencido ? <span className="text-bad"> · {c.n_vencido} atrasados</span> : null}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(p) => setAbierto(p.id)} empty="No hay cobros por conciliar."
        search={{ ...lista.tabla.search, placeholder: "Cobro, operación o cliente…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Cuenta" todos="todas" value={cuenta} onChange={setCuenta} options={(r?.por_cuenta ?? []).map((c) => ({ value: c.cuenta_id, label: c.cuenta }))} ancho={200} />
          <FiltroSelect etiqueta="Antigüedad" value={alerta} onChange={setAlerta} vacio="Todos" options={[{ value: "1", label: r ? `Más de ${r.dias_alerta} días` : "Atrasados" }]} ancho={170} />
        </>} />
      {abierto && <DetalleCobro id={abierto} onClose={() => setAbierto(null)} onCambio={lista.recargar} />}
    </div>
  );
}
