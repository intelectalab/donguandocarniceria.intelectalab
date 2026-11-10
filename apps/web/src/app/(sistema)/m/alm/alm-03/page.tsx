"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Badge, DataTable, IconButton, PageHeader, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, kg, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { BuscaVariante, Cant, FiltroFecha, FiltroSelect, accion, opcionesAlmacen, useOpciones } from "@/modulos/alm/comunes";
import { MOVIMIENTO, ORIGEN, type Movimiento, type Variante } from "@/modulos/alm/tipos";

const opciones = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

/** ALM-03 Kardex: cada movimiento con tipo, origen, cantidad, peso, costo, saldo después y usuario. */
export default function Kardex() {
  const { marca, local, can, puede } = useSesion();
  const op = useOpciones();
  const [almacen, setAlmacen] = useState("");
  const [variante, setVariante] = useState<Variante | null>(null);
  const [tipo, setTipo] = useState("");
  const [origen, setOrigen] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const lista = useListado<Movimiento>("/v1/alm/kardex", {
    orden: "-moved_at",
    filtros: { warehouse_id: almacen, variant_id: variante?.id, movement_type: tipo, source_type: origen, from: desde, to: hasta, site: local, brand: marca },
  });
  const costos = can("alm.stock.view_cost");
  const puedeReversar = can("alm.count.approve") && puede("ALM", "E");

  async function reversar(m: Movimiento) {
    await accion({ title: `¿Reversar este movimiento de ${m.sku}?`, message: "Se registra un movimiento contrario con referencia a este. El original no se borra.",
      confirmLabel: "Reversar", danger: true, reason: { label: "Motivo", min: 10 } },
    (motivo) => api(`/v1/alm/kardex/${m.id}/reversar`, { method: "POST", body: { reason: motivo } }), "Movimiento reversado", lista.recargar);
  }

  const columnas: Column<Movimiento>[] = [
    { key: "moved_at", header: "Fecha", sortable: true, render: (m) => <span className="whitespace-nowrap">{fechaHora(m.moved_at)}</span> },
    {
      key: "movement_type", header: "Movimiento", sortable: true, cardTitle: true, render: (m) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{MOVIMIENTO[m.movement_type] ?? m.movement_type}</span>
          {m.reversed && <Badge tone="warn">Reversado</Badge>}
          {m.reversal_of && <Badge>Reverso</Badge>}
        </div>
      ),
    },
    { key: "sku", header: "Producto", sortable: true, render: (m) => <div className="min-w-[160px]"><p>{m.variant_name}</p><p className="font-mono text-[12px] text-muted">{m.sku}</p></div> },
    { key: "warehouse_code", header: "Almacén", render: (m) => <span className="font-mono">{m.warehouse_code}</span> },
    { key: "lot_code", header: "Lote", hideOnMobile: true, render: (m) => m.lot_code ? <span className="font-mono">{m.lot_code}</span> : "—" },
    { key: "source_type", header: "Origen", hideOnMobile: true, render: (m) => <div className="min-w-[140px]"><p>{m.source_type ? ORIGEN[m.source_type] ?? m.source_type : "—"}</p>{m.reason && <p className="text-[12px] text-muted">{m.reason}</p>}</div> },
    { key: "qty", header: "Cantidad", sortable: true, align: "right", render: (m) => <span className={Number(m.qty) < 0 ? "text-bad" : "text-ok"}><Cant v={m.qty} modo={m.sale_mode} signo /></span> },
    { key: "weight_kg", header: "Peso", align: "right", hideOnMobile: true, render: (m) => m.weight_kg !== null && m.sale_mode !== "KG" ? kg(m.weight_kg) : "—" },
    ...(costos ? [{ key: "total_cost", header: "Costo", align: "right", hideOnMobile: true, render: (m: Movimiento) => <div><p>{soles(m.total_cost)}</p><p className="text-[12px] text-muted">{soles(m.unit_cost)} c/u</p></div> }] as Column<Movimiento>[] : []),
    { key: "bal_qty", header: "Saldo", align: "right", hideOnMobile: true, render: (m) => <Cant v={m.bal_qty} modo={m.sale_mode} /> },
    { key: "user_name", header: "Usuario", hideOnMobile: true, render: (m) => m.user_name ?? "—" },
    ...(puedeReversar ? [{
      key: "acciones", header: "", align: "right", render: (m: Movimiento) => !m.reversed && !m.reversal_of && m.movement_type !== "REVERSAL"
        ? <IconButton icon={Undo2} label="Reversar" onClick={(e) => { e.stopPropagation(); reversar(m); }} /> : null,
    }] as Column<Movimiento>[] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Todo lo que entró y salió, con el saldo que quedó. Un movimiento no se edita ni se borra: se corrige con un reverso." />
      <div className="max-w-md"><BuscaVariante value={variante} onChange={setVariante} /></div>
      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar SKU, lote, motivo o usuario…" }}
        empty="No hay movimientos con esos filtros."
        toolbar={<>
          <FiltroSelect label="Almacén" value={almacen} onChange={setAlmacen} options={opcionesAlmacen(op)} ancho="sm:w-[200px]" />
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opciones(MOVIMIENTO)} />
          <FiltroSelect label="Origen" value={origen} onChange={setOrigen} options={opciones(ORIGEN)} />
          <FiltroFecha label="Desde" value={desde} onChange={setDesde} />
          <FiltroFecha label="Hasta" value={hasta} onChange={setHasta} />
        </>} />
    </div>
  );
}
