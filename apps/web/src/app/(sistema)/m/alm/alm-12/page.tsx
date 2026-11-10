"use client";

import { useState } from "react";
import { Clock, Layers, PackageCheck, Truck } from "lucide-react";
import { DataTable, IconButton, PageHeader, type Column } from "@/components/ui";
import { fecha, fechaHora, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, CifraLink, Dias, qs, useDatos } from "@/modulos/alm/comunes";
import { TransferenciaFicha, type FilaTransferencia } from "@/modulos/alm/Transferencia";
import type { Num } from "@/modulos/alm/tipos";

type Cifras = { transfers: number; oldest_hours: number | null; value: Num; lots: number };
type SaldoTransito = { id: string; sku: string; variant_name: string; sale_mode: string; lot_code: string | null; expiry_date: string | null; days_left: number | null; qty: Num; weight_kg: Num; value: Num };

/** Antigüedad en tránsito: más de un día ya es para revisar. */
function Antiguedad({ h }: { h: number }) {
  const clase = h >= 24 ? "text-bad" : h >= 6 ? "text-warn" : "text-ink";
  return <span className={`font-medium tabular-nums ${clase}`}>{h >= 24 ? `${numero(h / 24, 1)} días` : `${numero(h, 1)} h`}</span>;
}

/** ALM-12 Stock en tránsito: transferencias despachadas sin recibir, con su antigüedad, y lo que hay en el almacén de tránsito. */
export default function EnTransito() {
  const { local, can, puede } = useSesion();
  const lista = useListado<FilaTransferencia>("/v1/alm/transferencias", { orden: "-hours_in_transit", porPagina: 50, filtros: { status: "DISPATCHED", site: local } });
  const c = useDatos<Cifras>(`/v1/alm/cifras/12${qs({ site: local })}`);
  const saldos = useDatos<{ data: SaldoTransito[] }>("/v1/alm/transito");
  const [abierta, setAbierta] = useState<string | null>(null);
  const costos = can("alm.stock.view_cost");
  const recibe = can("alm.transfer.receive") && puede("ALM", "E");
  const k = c.datos;

  const columnas: Column<FilaTransferencia>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (t) => <span className="font-mono font-semibold">{t.number}</span> },
    { key: "from_code", header: "Origen → destino", render: (t) => <div><p className="font-mono">{t.from_code} → {t.to_code}</p><p className="text-[12px] text-muted">{t.to_name}</p></div> },
    { key: "content", header: "Contenido", hideOnMobile: true, render: (t) => <span className="font-mono text-[12px]">{t.content ?? "—"}</span> },
    { key: "guide_number", header: "Guía", render: (t) => t.guide_number ?? "—" },
    { key: "dispatched_at", header: "Despachada", sortable: true, render: (t) => <div><p>{fechaHora(t.dispatched_at)}</p>{t.dispatched_by_name && <p className="text-[12px] text-muted">{t.dispatched_by_name}</p>}</div> },
    { key: "hours_in_transit", header: "En tránsito", sortable: true, align: "right", render: (t) => <Antiguedad h={Number(t.hours_in_transit ?? 0)} /> },
    ...(costos ? [{ key: "value", header: "Valor", align: "right", render: (t: FilaTransferencia) => soles(t.value) }] as Column<FilaTransferencia>[] : []),
    ...(recibe ? [{ key: "acciones", header: "", align: "right", render: (t: FilaTransferencia) => <IconButton icon={PackageCheck} label={`Recibir ${t.number}`} onClick={(e) => { e.stopPropagation(); setAbierta(t.id); }} /> }] as Column<FilaTransferencia>[] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que salió de un local y todavía no llega al otro. Desde aquí se recibe." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="En tránsito" valor={k ? numero(k.transfers) : undefined} detalle="Transferencias" icono={Truck} tono={k?.transfers ? "warn" : "ok"} />
        {costos && <CifraLink titulo="Valor en tránsito" valor={k ? soles(k.value) : undefined} destacada />}
        <CifraLink titulo="Más antigua" valor={k ? (k.oldest_hours === null ? "—" : k.oldest_hours >= 24 ? `${numero(k.oldest_hours / 24, 1)} días` : `${numero(k.oldest_hours, 1)} h`) : undefined}
          icono={Clock} tono={k?.oldest_hours && k.oldest_hours > 24 ? "bad" : undefined} />
        <CifraLink titulo="Lotes en tránsito" valor={k ? numero(k.lots) : undefined} icono={Layers} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(t) => setAbierta(t.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar número, guía o almacén…" }} empty="No hay nada en tránsito." />
      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold">Saldo del almacén de tránsito</h2>
        <DataTable rows={saldos.datos?.data ?? []} loading={saldos.cargando} error={saldos.error} onRetry={saldos.recargar} empty="El almacén de tránsito está vacío." columns={[
          { key: "sku", header: "Producto", cardTitle: true, render: (b) => <div className="min-w-[160px]"><p>{b.variant_name}</p><p className="font-mono text-[12px] text-muted">{b.sku}</p></div> },
          { key: "lot_code", header: "Lote", render: (b) => b.lot_code ? <span className="font-mono">{b.lot_code}</span> : "—" },
          { key: "expiry_date", header: "Vence", render: (b) => b.expiry_date ? <div><p>{fecha(b.expiry_date)}</p><Dias d={b.days_left} /></div> : "—" },
          { key: "qty", header: "Cantidad", align: "right", render: (b) => <Cant v={b.qty} modo={b.sale_mode} /> },
          { key: "weight_kg", header: "Peso", align: "right", render: (b) => (Number(b.weight_kg) ? kg(b.weight_kg) : "—") },
          ...(costos ? [{ key: "value", header: "Valor", align: "right", render: (b: SaldoTransito) => soles(b.value) }] as Column<SaldoTransito>[] : []),
        ]} />
      </section>
      {abierta && <TransferenciaFicha id={abierta} onClose={() => setAbierta(null)} onCambio={() => { lista.recargar(); c.recargar(); saldos.recargar(); }} />}
    </div>
  );
}
