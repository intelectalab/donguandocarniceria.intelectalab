"use client";

import { useState } from "react";
import { AlertTriangle, Boxes, ClipboardList, Percent, RefreshCw, Unlock } from "lucide-react";
import { Alert, Button, DataTable, DetailList, IconButton, Modal, PageHeader, StatusBadge, Tabs, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, CifraLink, FiltroSelect, accion, opcionesAlmacen, qs, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { PEDIDO, RESERVA, type Num } from "@/modulos/alm/tipos";

type Reserva = { id: string; order_id: string; order_number: string; order_line_id: string; status: string; qty: Num; weight_kg: Num; delivery_date: string | null;
  reserved_at: string; closed_at: string | null; released_reason: string | null; released_by_name: string | null; sku: string; variant_name: string; sale_mode: string;
  warehouse_code: string; lot_code: string | null; expiry_date: string | null; customer_name: string | null; order_status: string | null };
type Pedido = { order_id: string; order_number: string; order_status: string | null; customer_name: string | null; establishment_short: string | null; delivery_date: string;
  lines: number; value: Num; warehouses: string; reserved_at: string };
type Faltante = { order_id: string; order_number: string; order_status: string; delivery_date: string | null; customer_name: string | null; establishment_short: string | null;
  short: { sku: string; variant_name: string; sale_mode: string; qty: Num }[] };
type FichaPedido = { id: string; number: string; status: string; delivery_date: string | null; customer_name: string | null; short: Faltante["short"];
  reservations: (Omit<Reserva, "order_id" | "order_number" | "order_line_id" | "delivery_date" | "weight_kg" | "customer_name" | "order_status">)[] };
type Cifras = { orders: number; lines: number; value: Num; short_orders: number; stockout_pct: number; stockout_orders: number; confirmed_orders: number };
type Vista = "pedidos" | "lineas" | "faltantes";

/** ALM-10 Reservas: activas por pedido, lote y almacén; liberación a mano con motivo y permiso; pedidos con faltante. */
export default function Reservas() {
  const { marca, local, can, puede } = useSesion();
  const op = useOpciones();
  const [vista, setVista] = useState<Vista>("pedidos");
  const [estado, setEstado] = useState("ACTIVE");
  const [almacen, setAlmacen] = useState("");
  const [estadoPedido, setEstadoPedido] = useState("");
  const [pedido, setPedido] = useState<string | null>(null);
  const alcance = { site: local, brand: marca };
  const lista = useListado<Reserva>("/v1/alm/reservas", { orden: "delivery_date", filtros: { status: estado, warehouse_id: almacen, ...alcance } });
  const pedidos = useListado<Pedido>("/v1/alm/reservas/pedidos", { orden: "delivery_date", filtros: { warehouse_id: almacen, order_status: estadoPedido, ...alcance } });
  const faltantes = useDatos<{ data: Faltante[] }>(`/v1/alm/reservas/faltantes${qs(alcance)}`);
  const c = useDatos<Cifras>(`/v1/alm/cifras/10${qs(alcance)}`);
  const libera = can("alm.reservation.release");
  const reintenta = puede("ALM", "E");
  const costos = can("alm.stock.view_cost");
  const todo = () => { lista.recargar(); pedidos.recargar(); faltantes.recargar(); c.recargar(); };

  async function liberar(r: { id: string; sku: string; lot_code: string | null; warehouse_code: string }, numeroPedido: string, despues = todo) {
    await accion({ title: `¿Liberar la reserva de ${numeroPedido}?`, message: `${r.sku} · ${r.lot_code ?? "sin lote"} en ${r.warehouse_code}. La línea del pedido queda sin stock reservado.`,
      confirmLabel: "Liberar", danger: true, reason: { min: 5 } },
    (m) => api(`/v1/alm/reservas/${r.id}/liberar`, { method: "POST", body: { reason: m } }), "Reserva liberada", despues);
  }
  async function reintentar(id: string, numeroPedido: string, despues = todo) {
    await accion({ title: `¿Reintentar la reserva de ${numeroPedido}?`, message: "Se vuelve a reservar todo el pedido por FEFO con el stock que hay ahora.", confirmLabel: "Reintentar" },
      () => api(`/v1/alm/reservas/pedidos/${id}/reintentar`, { method: "POST" }), "Reserva recalculada", despues);
  }

  const colLineas: Column<Reserva>[] = [
    { key: "order_number", header: "Pedido", sortable: true, cardTitle: true, render: (r) => <div><p className="font-mono font-semibold">{r.order_number}</p>{r.customer_name && <p className="text-[12px] text-muted">{r.customer_name}</p>}</div> },
    { key: "order_status", header: "Estado del pedido", hideOnMobile: true, render: (r) => r.order_status ? <StatusBadge status={r.order_status} labels={PEDIDO} /> : "—" },
    { key: "delivery_date", header: "Entrega", sortable: true, render: (r) => fecha(r.delivery_date) },
    { key: "sku", header: "Producto", render: (r) => <div className="min-w-[160px]"><p>{r.variant_name}</p><p className="font-mono text-[12px] text-muted">{r.sku}</p></div> },
    { key: "lot_code", header: "Lote", render: (r) => r.lot_code ? <div><p className="font-mono">{r.lot_code}</p><p className="text-[12px] text-muted">Vence {fecha(r.expiry_date)}</p></div> : "—" },
    { key: "warehouse_code", header: "Almacén", hideOnMobile: true, render: (r) => <span className="font-mono">{r.warehouse_code}</span> },
    { key: "qty", header: "Cantidad", sortable: true, align: "right", render: (r) => <div><Cant v={r.qty} modo={r.sale_mode} />{r.weight_kg !== null && r.sale_mode !== "KG" && <p className="text-[12px] text-muted">{kg(r.weight_kg)}</p>}</div> },
    { key: "reserved_at", header: "Reservada", sortable: true, hideOnMobile: true, render: (r) => fechaHora(r.reserved_at) },
    ...(estado === "RELEASED" ? [{ key: "released_reason", header: "Motivo", render: (r: Reserva) => <div><p>{r.released_reason ?? "—"}</p>{r.released_by_name && <p className="text-[12px] text-muted">{r.released_by_name}</p>}</div> }] as Column<Reserva>[] : []),
    { key: "status", header: "Estado", render: (r) => <StatusBadge status={r.status} labels={RESERVA} /> },
    ...(libera && estado === "ACTIVE" ? [{ key: "acciones", header: "", align: "right", render: (r: Reserva) => <IconButton icon={Unlock} label="Liberar reserva" onClick={(e) => { e.stopPropagation(); liberar(r, r.order_number); }} /> }] as Column<Reserva>[] : []),
  ];
  const colPedidos: Column<Pedido>[] = [
    { key: "order_number", header: "Pedido", sortable: true, cardTitle: true, render: (p) => <span className="font-mono font-semibold">{p.order_number}</span> },
    { key: "customer_name", header: "Cliente", render: (p) => <div><p>{p.customer_name ?? "—"}</p>{p.establishment_short && <p className="text-[12px] text-muted">{p.establishment_short}</p>}</div> },
    { key: "order_status", header: "Estado del pedido", render: (p) => p.order_status ? <StatusBadge status={p.order_status} labels={PEDIDO} /> : "—" },
    { key: "delivery_date", header: "Entrega", sortable: true, render: (p) => fecha(p.delivery_date) },
    { key: "warehouses", header: "Almacén", hideOnMobile: true, render: (p) => <span className="font-mono">{p.warehouses}</span> },
    { key: "lines", header: "Líneas", sortable: true, align: "right" },
    ...(costos ? [{ key: "value", header: "Valor", sortable: true, align: "right", render: (p: Pedido) => soles(p.value) }] as Column<Pedido>[] : []),
  ];
  const k = c.datos;
  const fs = faltantes.datos?.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader description="Stock apartado para pedidos confirmados, por lote y almacén (FEFO). Se libera solo al cancelar el pedido o a mano, con motivo." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Pedidos con reserva" valor={k ? numero(k.orders) : undefined} icono={ClipboardList} onClick={() => setVista("pedidos")} />
        <CifraLink titulo="Líneas reservadas" valor={k ? numero(k.lines) : undefined} detalle={k && costos ? soles(k.value) : undefined} icono={Boxes} onClick={() => setVista("lineas")} />
        <CifraLink titulo="Pedidos con faltante" valor={k ? numero(k.short_orders) : undefined} detalle="Sin stock suficiente" icono={AlertTriangle}
          tono={k?.short_orders ? "bad" : "ok"} onClick={() => setVista("faltantes")} />
        <CifraLink titulo="Quiebres de stock" valor={k ? `${numero(k.stockout_pct, 1)} %` : undefined} detalle={k ? `${k.stockout_orders} de ${k.confirmed_orders} del mes · KPI-ALM-07` : undefined}
          icono={Percent} href="/m/alm/alm-11?tab=indicadores" />
      </div>
      <Tabs<Vista> value={vista} onChange={setVista} tabs={[
        { key: "pedidos", label: "Por pedido", count: pedidos.total },
        { key: "lineas", label: "Por lote y almacén" },
        { key: "faltantes", label: "Con faltante", count: fs.length },
      ]} />
      {vista === "pedidos" && (
        <DataTable {...pedidos.tabla} columns={colPedidos} rowKey={(p) => p.order_id} onRowClick={(p) => setPedido(p.order_id)}
          search={{ ...pedidos.tabla.search, placeholder: "Buscar pedido o cliente…" }} empty="No hay pedidos con reserva."
          toolbar={<>
            <FiltroSelect label="Almacén" value={almacen} onChange={setAlmacen} options={opcionesAlmacen(op, (w) => w.allows_sale)} ancho="sm:w-[200px]" />
            <FiltroSelect label="Estado del pedido" value={estadoPedido} onChange={setEstadoPedido}
              options={["CONFIRMED", "IN_PREPARATION", "WEIGHED", "READY"].map((s) => ({ value: s, label: PEDIDO[s][0] }))} />
          </>} />
      )}
      {vista === "lineas" && (
        <DataTable {...lista.tabla} columns={colLineas} onRowClick={(r) => setPedido(r.order_id)}
          search={{ ...lista.tabla.search, placeholder: "Buscar pedido, cliente, SKU o lote…" }} empty="No hay reservas con ese estado."
          toolbar={<>
            <FiltroSelect label="Estado" value={estado} onChange={(v) => setEstado(v || "ACTIVE")}
              options={[{ value: "ACTIVE", label: "Activas" }, { value: "RELEASED", label: "Liberadas" }, { value: "CONSUMED", label: "Despachadas" }]} />
            <FiltroSelect label="Almacén" value={almacen} onChange={setAlmacen} options={opcionesAlmacen(op, (w) => w.allows_sale)} ancho="sm:w-[200px]" />
          </>} />
      )}
      {vista === "faltantes" && (
        <DataTable rows={fs} rowKey={(f) => f.order_id} loading={faltantes.cargando} error={faltantes.error} onRetry={faltantes.recargar} onRowClick={(f) => setPedido(f.order_id)}
          empty="Todos los pedidos confirmados tienen su stock reservado." columns={[
            { key: "order_number", header: "Pedido", cardTitle: true, render: (f) => <span className="font-mono font-semibold">{f.order_number}</span> },
            { key: "customer_name", header: "Cliente", render: (f) => <div><p>{f.customer_name ?? "—"}</p>{f.establishment_short && <p className="text-[12px] text-muted">{f.establishment_short}</p>}</div> },
            { key: "delivery_date", header: "Entrega", render: (f) => fecha(f.delivery_date) },
            { key: "short", header: "Falta", render: (f) => <ul className="text-[12.5px]">{f.short.map((x) => <li key={x.sku}><span className="font-mono text-muted">{x.sku}</span> <Cant v={x.qty} modo={x.sale_mode} /></li>)}</ul> },
            ...(reintenta ? [{ key: "acciones", header: "", align: "right", render: (f: Faltante) => <Button size="sm" icon={RefreshCw} onClick={(e) => { e.stopPropagation(); reintentar(f.order_id, f.order_number); }}>Reintentar reserva</Button> }] as Column<Faltante>[] : []),
          ]} />
      )}
      {pedido && <PedidoFicha id={pedido} onClose={() => setPedido(null)} libera={libera} reintenta={reintenta}
        onLiberar={(r, n, despues) => liberar(r, n, () => { despues(); todo(); })} onReintentar={(id, n, despues) => reintentar(id, n, () => { despues(); todo(); })} />}
    </div>
  );
}

function PedidoFicha({ id, onClose, libera, reintenta, onLiberar, onReintentar }: {
  id: string; onClose: () => void; libera: boolean; reintenta: boolean;
  onLiberar: (r: FichaPedido["reservations"][number], numero: string, despues: () => void) => void;
  onReintentar: (id: string, numero: string, despues: () => void) => void;
}) {
  const { datos: o, error, recargar } = useDatos<FichaPedido>(`/v1/alm/reservas/pedidos/${id}`);
  const abiertoAlStock = o && ["CONFIRMED", "IN_PREPARATION", "WEIGHED", "READY"].includes(o.status);
  return (
    <Modal open onClose={onClose} size="lg" title={o ? `Pedido ${o.number}` : "Pedido"}
      footer={o && reintenta && abiertoAlStock && <Button icon={RefreshCw} onClick={() => onReintentar(o.id, o.number, recargar)}>Reintentar reserva</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!o ? <p className="text-[13px] text-muted">Cargando…</p> : (
        <div className="space-y-4">
          <DetailList items={[
            { label: "Cliente", value: o.customer_name ?? "—" },
            { label: "Estado del pedido", value: <StatusBadge status={o.status} labels={PEDIDO} /> },
            { label: "Entrega", value: fecha(o.delivery_date) },
          ]} />
          {o.short.length > 0 && (
            <Alert tone="warn" title="Le falta stock">
              {o.short.map((x) => <p key={x.sku}>{x.sku} · {x.variant_name}: falta <Cant v={x.qty} modo={x.sale_mode} /></p>)}
            </Alert>
          )}
          <h3 className="text-[14px] font-semibold">Reservas e historial</h3>
          <DataTable rows={o.reservations} empty="Este pedido no tiene reservas." columns={[
            { key: "sku", header: "Producto", cardTitle: true, render: (r) => <div><p>{r.variant_name}</p><p className="font-mono text-[12px] text-muted">{r.sku}</p></div> },
            { key: "lot_code", header: "Lote", render: (r) => r.lot_code ? <span className="font-mono">{r.lot_code}</span> : "—" },
            { key: "warehouse_code", header: "Almacén", render: (r) => <span className="font-mono">{r.warehouse_code}</span> },
            { key: "qty", header: "Cantidad", align: "right", render: (r) => <Cant v={r.qty} modo={r.sale_mode} /> },
            { key: "reserved_at", header: "Fechas", render: (r) => <div className="text-[12.5px]"><p>Reservada {fechaHora(r.reserved_at)}</p>{r.closed_at && <p className="text-muted">Cerrada {fechaHora(r.closed_at)}</p>}</div> },
            { key: "status", header: "Estado", render: (r) => <div><StatusBadge status={r.status} labels={RESERVA} />{r.released_reason && <p className="text-[12px] text-muted">{r.released_reason}{r.released_by_name ? ` · ${r.released_by_name}` : ""}</p>}</div> },
            ...(libera ? [{ key: "acciones", header: "", align: "right", render: (r: FichaPedido["reservations"][number]) => r.status === "ACTIVE"
              ? <IconButton icon={Unlock} label="Liberar reserva" onClick={() => onLiberar(r, o.number, recargar)} /> : null }] as Column<FichaPedido["reservations"][number]>[] : []),
          ]} />
        </div>
      )}
    </Modal>
  );
}
