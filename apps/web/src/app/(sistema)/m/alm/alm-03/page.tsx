"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ListOrdered, SlidersHorizontal, Trash2, Undo2 } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, IconButton, Modal, PageHeader, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { BuscaVariante, Cant, CifraLink, FiltroFecha, FiltroSelect, accion, opcionesAlmacen, qs, useAlAbrir, useDatos, useOpciones, varianteDe } from "@/modulos/alm/comunes";
import { MOVIMIENTO, ORIGEN, type Movimiento, type Num, type Variante } from "@/modulos/alm/tipos";

type Cifras = { total: number; in_today: number; out_today: number; waste_month: Num; waste_count: number; adjust_month: Num; adjust_count: number };
type FichaMov = Movimiento & { warehouse_name: string; document: string | null;
  reversal_of_move: { id: string; moved_at: string; movement_type: string; qty: Num; reason: string } | null;
  reversed_by: { id: string; moved_at: string; qty: Num; reason: string; user_name: string | null } | null };
/** Solo estos se corrigen con un reverso; el resto, desde su documento (anular, recibir, devolver). */
const REVERSIBLES = ["RECEIPT", "ADJUSTMENT", "WASTE"];

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
  const [marcaF, setMarcaF] = useState("");
  const [abierto, setAbierto] = useState<Movimiento | null>(null);
  useAlAbrir((p) => {
    setAlmacen(p.get("wh") ?? "");
    const v = p.get("variant");
    if (v) varianteDe(v).then(setVariante).catch(() => undefined);
  });
  const c = useDatos<Cifras>(`/v1/alm/cifras/03${qs({ site: local, brand: marca })}`).datos;
  const lista = useListado<Movimiento>("/v1/alm/kardex", {
    orden: "-moved_at",
    filtros: { warehouse_id: almacen, variant_id: variante?.id, movement_type: tipo, source_type: origen, from: desde, to: hasta, site: local, brand: marca, brand_id: marcaF },
  });
  const costos = can("alm.stock.view_cost");
  const puedeReversar = can("alm.count.approve") && puede("ALM", "E");

  const reversable = (m: Movimiento) => REVERSIBLES.includes(m.movement_type) && !m.reversed && !m.reversal_of;
  async function reversar(m: Movimiento) {
    await accion({ title: `¿Reversar este movimiento de ${m.sku}?`, message: "Se registra un movimiento contrario con referencia a este. El original no se borra.",
      confirmLabel: "Reversar", danger: true, reason: { label: "Motivo", min: 10 } },
    (motivo) => api(`/v1/alm/kardex/${m.id}/reversar`, { method: "POST", body: { reason: motivo } }), "Movimiento reversado", () => { setAbierto(null); lista.recargar(); });
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
    { key: "source_type", header: "Origen", hideOnMobile: true, render: (m) => <div className="min-w-[140px]"><p>{m.source_type ? ORIGEN[m.source_type] ?? m.source_type : "—"}{m.document && <span className="ml-1 font-mono text-[12px]">{m.document}</span>}</p>{m.reason && <p className="text-[12px] text-muted">{m.reason}</p>}</div> },
    { key: "qty", header: "Cantidad", sortable: true, align: "right", render: (m) => <span className={Number(m.qty) < 0 ? "text-bad" : "text-ok"}><Cant v={m.qty} modo={m.sale_mode} signo /></span> },
    { key: "weight_kg", header: "Peso", align: "right", hideOnMobile: true, render: (m) => m.weight_kg !== null && m.sale_mode !== "KG" ? kg(m.weight_kg) : "—" },
    ...(costos ? [{ key: "total_cost", header: "Costo", align: "right", hideOnMobile: true, render: (m: Movimiento) => <div><p>{soles(m.total_cost)}</p><p className="text-[12px] text-muted">{soles(m.unit_cost)} c/u</p></div> }] as Column<Movimiento>[] : []),
    { key: "bal_qty", header: "Saldo", align: "right", hideOnMobile: true, render: (m) => <Cant v={m.bal_qty} modo={m.sale_mode} /> },
    { key: "user_name", header: "Usuario", hideOnMobile: true, render: (m) => m.user_name ?? "—" },
    ...(puedeReversar ? [{
      key: "acciones", header: "", align: "right", render: (m: Movimiento) => reversable(m)
        ? <IconButton icon={Undo2} label="Reversar" onClick={(e) => { e.stopPropagation(); reversar(m); }} /> : null,
    }] as Column<Movimiento>[] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Todo lo que entró y salió, con el saldo que quedó. Un movimiento no se edita ni se borra: se corrige con un reverso." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Movimientos" valor={c ? numero(c.total) : undefined} detalle="En tus locales y marcas" icono={ListOrdered} />
        <CifraLink titulo="Hoy" valor={c ? `${numero(c.in_today)} / ${numero(c.out_today)}` : undefined} detalle="Ingresos / salidas" icono={c && c.out_today > c.in_today ? ArrowUpRight : ArrowDownLeft} />
        <CifraLink titulo="Mermas del mes" valor={c ? (costos ? soles(c.waste_month) : numero(c.waste_count)) : undefined} detalle={c ? `${c.waste_count} movimientos` : undefined}
          icono={Trash2} tono={c?.waste_count ? "warn" : undefined} href="/m/alm/alm-09" />
        <CifraLink titulo="Ajustes del mes" valor={c ? (costos ? soles(c.adjust_month) : numero(c.adjust_count)) : undefined} detalle={c ? `${c.adjust_count} por conteos y reversos` : undefined}
          icono={SlidersHorizontal} href="/m/alm/alm-08" />
      </div>
      <Alert tone="info">Todo movimiento de stock pasa por una sola acción de inventario (RN-ALM-01): nadie escribe el saldo a mano. Solo se reversan ingresos, ajustes y mermas; una venta o un traslado se corrige desde su documento.</Alert>
      <div className="max-w-md"><BuscaVariante value={variante} onChange={setVariante} /></div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={setAbierto}
        search={{ ...lista.tabla.search, placeholder: "Buscar SKU, lote, motivo o usuario…" }}
        empty="No hay movimientos con esos filtros."
        toolbar={<>
          <FiltroSelect label="Almacén" value={almacen} onChange={setAlmacen} options={opcionesAlmacen(op)} ancho="sm:w-[200px]" />
          <FiltroSelect label="Marca" value={marcaF} onChange={setMarcaF} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opciones(MOVIMIENTO)} />
          <FiltroSelect label="Origen" value={origen} onChange={setOrigen} options={opciones(ORIGEN)} />
          <FiltroFecha label="Desde" value={desde} onChange={setDesde} />
          <FiltroFecha label="Hasta" value={hasta} onChange={setHasta} />
        </>} />
      {abierto && <FichaMovimiento id={abierto.id} onClose={() => setAbierto(null)} onReversar={puedeReversar && reversable(abierto) ? () => reversar(abierto) : undefined} />}
    </div>
  );
}

function FichaMovimiento({ id, onClose, onReversar }: { id: string; onClose: () => void; onReversar?: () => void }) {
  const { can } = useSesion();
  const { datos: m, error } = useDatos<FichaMov>(`/v1/alm/kardex/${id}`);
  return (
    <Modal open onClose={onClose} title={m ? `${MOVIMIENTO[m.movement_type] ?? m.movement_type} · ${m.sku}` : "Movimiento"}
      footer={onReversar && <Button variant="danger" icon={Undo2} onClick={onReversar}>Reversar</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!m ? <p className="text-[13px] text-muted">Cargando…</p> : (
        <div className="space-y-4">
          <DetailList items={[
            { label: "Fecha", value: fechaHora(m.moved_at) },
            { label: "Movimiento", value: MOVIMIENTO[m.movement_type] ?? m.movement_type },
            { label: "Producto", value: `${m.sku} · ${m.variant_name}` },
            { label: "Almacén", value: `${m.warehouse_code} · ${m.warehouse_name}` },
            { label: "Lote", value: m.lot_code ? <span className="font-mono">{m.lot_code}</span> : "—" },
            { label: "Origen", value: <span>{m.source_type ? ORIGEN[m.source_type] ?? m.source_type : "—"}{m.document && <span className="ml-1 font-mono">{m.document}</span>}</span> },
            { label: "Cantidad", value: <Cant v={m.qty} modo={m.sale_mode} signo /> },
            { label: "Peso", value: m.weight_kg !== null ? kg(m.weight_kg) : "—" },
            ...(can("alm.stock.view_cost") ? [{ label: "Costo", value: `${soles(m.total_cost)} (${soles(m.unit_cost)} c/u)` }] : []),
            { label: "Saldo después", value: <Cant v={m.bal_qty} modo={m.sale_mode} /> },
            { label: "Usuario", value: m.user_name ?? "—" },
            { label: "Motivo", value: m.reason ?? "—" },
          ]} />
          {m.reversal_of_move && (
            <Alert tone="info" title="Es el reverso de">
              {MOVIMIENTO[m.reversal_of_move.movement_type] ?? m.reversal_of_move.movement_type} del {fechaHora(m.reversal_of_move.moved_at)} · {numero(m.reversal_of_move.qty, 3)} · {m.reversal_of_move.reason}
            </Alert>
          )}
          {m.reversed_by && (
            <Alert tone="warn" title="Reversado">
              El {fechaHora(m.reversed_by.moved_at)} por {m.reversed_by.user_name ?? "—"} · {m.reversed_by.reason}
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}
