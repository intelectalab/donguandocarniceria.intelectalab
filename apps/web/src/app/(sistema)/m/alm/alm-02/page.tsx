"use client";

import { useState } from "react";
import Link from "next/link";
import { Boxes, CalendarClock, Lock, ShieldAlert } from "lucide-react";
import { Checkbox, Cifra, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fecha, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, Dias, FiltroSelect, opcionesAlmacen, qs, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { ESTADOS_LOTE, LOTE, type Num, type Saldo } from "@/modulos/alm/tipos";

type Resumen = { balances: number; variants: number; value: Num; quarantine: number; blocked: number; expired: number; expiring: number; reserved: Num };

/** ALM-02 Stock: saldo por almacén, variante y lote con disponible, reservado, peso, costo y vencimiento. */
export default function Stock() {
  const { marca, local, can } = useSesion();
  const op = useOpciones();
  const [almacen, setAlmacen] = useState("");
  const [linea, setLinea] = useState("");
  const [estadoLote, setEstadoLote] = useState("");
  const [conCero, setConCero] = useState(false);
  const filtros = { warehouse_id: almacen, line: linea, lot_status: estadoLote, con_cero: conCero ? 1 : "", site: local, brand: marca };
  const lista = useListado<Saldo>("/v1/alm/stock", { orden: "expiry_date", filtros });
  const r = useDatos<Resumen>(`/v1/alm/stock/resumen${qs(filtros)}`).datos;
  const costos = can("alm.stock.view_cost");

  const columnas: Column<Saldo>[] = [
    {
      key: "sku", header: "Producto", sortable: true, cardTitle: true, render: (s) => (
        <div className="min-w-[180px]">
          <p className="font-medium">{s.variant_name}</p>
          <p className="font-mono text-[12px] text-muted">{s.sku}{s.line ? ` · ${s.line}` : ""}</p>
        </div>
      ),
    },
    { key: "warehouse_code", header: "Almacén", sortable: true, render: (s) => <span title={s.warehouse_name} className="font-mono">{s.warehouse_code}</span> },
    {
      key: "lot_code", header: "Lote", render: (s) => s.lot_code ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/m/alm/alm-06?lote=${s.lot_id}`} className="font-mono text-primary hover:underline">{s.lot_code}</Link>
          <StatusBadge status={s.qc_status} labels={LOTE} />
        </div>
      ) : <span className="text-muted">Sin lote</span>,
    },
    { key: "expiry_date", header: "Vence", sortable: true, render: (s) => s.expiry_date ? <div><p>{fecha(s.expiry_date)}</p><Dias d={s.days_left} /></div> : "—" },
    { key: "qty", header: "Saldo", sortable: true, align: "right", render: (s) => <Cant v={s.qty} modo={s.sale_mode} /> },
    { key: "reserved_qty", header: "Reservado", align: "right", hideOnMobile: true, render: (s) => Number(s.reserved_qty) ? <Cant v={s.reserved_qty} modo={s.sale_mode} /> : <span className="text-muted">—</span> },
    { key: "available_qty", header: "Disponible", sortable: true, align: "right", render: (s) => <span className="font-semibold"><Cant v={s.available_qty} modo={s.sale_mode} /></span> },
    { key: "weight_kg", header: "Peso", align: "right", hideOnMobile: true, render: (s) => s.sale_mode === "KG" ? "—" : kg(s.weight_kg) },
    ...(costos ? [
      { key: "avg_cost", header: "Costo prom.", align: "right", hideOnMobile: true, render: (s: Saldo) => soles(s.avg_cost) },
      { key: "value", header: "Valor", sortable: true, align: "right", render: (s: Saldo) => soles(s.value) },
    ] as Column<Saldo>[] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que hay en cada almacén, por producto y lote. Disponible es el saldo menos lo reservado para pedidos confirmados." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Saldos" valor={r ? numero(r.balances) : "…"} detalle={r ? `${numero(r.variants)} productos` : undefined} icono={Boxes} />
        <Cifra titulo={costos ? "Valor del stock" : "Reservado"} valor={r ? (costos ? soles(r.value) : numero(r.reserved)) : "…"} detalle={costos && r ? `Reservado: ${numero(r.reserved)}` : undefined} destacada />
        <Cifra titulo="Cuarentena o bloqueados" valor={r ? numero(r.quarantine + r.blocked) : "…"} detalle={r ? `${r.quarantine} en cuarentena · ${r.blocked} bloqueados` : undefined} icono={Lock} tono={r && r.blocked ? "bad" : undefined} />
        <Cifra titulo="Vencidos o por vencer" valor={r ? numero(r.expired + r.expiring) : "…"} detalle={r ? `${r.expired} vencidos · ${r.expiring} en 7 días` : undefined}
          icono={r?.expired ? ShieldAlert : CalendarClock} tono={r?.expired ? "bad" : r?.expiring ? "warn" : undefined} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} rowKey={(s) => s.id}
        search={{ ...lista.tabla.search, placeholder: "Buscar SKU, producto, lote o almacén…" }}
        empty="No hay stock con esos filtros."
        toolbar={<>
          <FiltroSelect label="Almacén" value={almacen} onChange={setAlmacen} options={opcionesAlmacen(op)} ancho="sm:w-[200px]" />
          <FiltroSelect label="Línea" value={linea} onChange={setLinea} options={(op?.lines ?? []).map((l) => ({ value: l, label: l }))} />
          <FiltroSelect label="Lote" value={estadoLote} onChange={setEstadoLote} options={[...ESTADOS_LOTE, { value: "NONE", label: "Sin lote" }]} />
          <div className="flex items-center"><Checkbox checked={conCero} onChange={setConCero} label="Con saldo cero" /></div>
        </>} />
    </div>
  );
}
