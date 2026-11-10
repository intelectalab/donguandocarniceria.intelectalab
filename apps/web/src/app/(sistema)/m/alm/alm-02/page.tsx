"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Boxes, CalendarClock, Lock, Trash2 } from "lucide-react";
import { Alert, Checkbox, DataTable, DetailList, Modal, PageHeader, StatusBadge, buttonClass, type Column } from "@/components/ui";
import { fecha, fechaHora, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, CifraLink, Dias, FiltroSelect, opcionesAlmacen, qs, useAlAbrir, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { ESTADOS_LOTE, LOTE, MOVIMIENTO, PEDIDO, etiqueta, TIPOS_ALMACEN, type Num, type Saldo } from "@/modulos/alm/tipos";

type Resumen = { balances: number; variants: number; value: Num; quarantine: number; blocked: number; expired: number; expiring: number; reserved: Num;
  reserved_balances: number; reserved_value: Num; expiring_value: Num; on_hold_qty: Num; qty: Num; weight_kg: Num };
type FichaSaldo = Saldo & { allows_sale: boolean; storage: string | null; production_date: string | null; supplier_name: string | null;
  reservations: { id: string; order_id: string; order_number: string; qty: Num; delivery_date: string; order_status: string | null; customer_name: string | null }[];
  movements: { id: string; moved_at: string; movement_type: string; reason: string | null; user_name: string | null; qty: Num; bal_qty: Num }[] };

/** ALM-02 Stock: saldo por almacén, variante y lote con disponible, reservado, peso, costo y vencimiento. */
export default function Stock() {
  const { marca, local, can } = useSesion();
  const op = useOpciones();
  const [almacen, setAlmacen] = useState("");
  const [linea, setLinea] = useState("");
  const [marcaF, setMarcaF] = useState("");
  const [estadoLote, setEstadoLote] = useState("");
  const [conCero, setConCero] = useState(false);
  const [abierto, setAbierto] = useState<Saldo | null>(null);
  useAlAbrir((p) => { setAlmacen(p.get("wh") ?? ""); setEstadoLote(p.get("estado") ?? ""); });
  const filtros = { warehouse_id: almacen, line: linea, lot_status: estadoLote, con_cero: conCero ? 1 : "", site: local, brand: marca, brand_id: marcaF };
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
    { key: "brand_name", header: "Marca", hideOnMobile: true, render: (s) => s.brand_name ?? "—" },
    { key: "warehouse_code", header: "Almacén", sortable: true, render: (s) => <span title={s.warehouse_name} className="font-mono">{s.warehouse_code}</span> },
    {
      key: "lot_code", header: "Lote", render: (s) => s.lot_code ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono">{s.lot_code}</span>
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
        <CifraLink titulo={costos ? "Valor del stock" : "Saldos"} valor={r ? (costos ? soles(r.value) : numero(r.balances)) : undefined}
          detalle={r ? `${numero(r.balances)} saldos · ${numero(r.variants)} productos` : undefined} icono={Boxes} destacada />
        <CifraLink titulo="Reservado" valor={r ? (costos ? soles(r.reserved_value) : numero(r.reserved)) : undefined}
          detalle={r ? `${r.reserved_balances} saldos con reserva` : undefined} href="/m/alm/alm-10" />
        <CifraLink titulo="Vence en 7 días" valor={r ? (costos ? soles(r.expiring_value) : numero(r.expiring + r.expired)) : undefined}
          detalle={r ? `${r.expiring} por vencer · ${r.expired} vencidos` : undefined} icono={CalendarClock} tono={r?.expired ? "bad" : r?.expiring ? "warn" : undefined} href="/m/alm/alm-11" />
        <CifraLink titulo="Cuarentena o bloqueado" valor={r ? numero(r.on_hold_qty) : undefined}
          detalle={r ? `${r.quarantine} en cuarentena · ${r.blocked} bloqueados · no se venden` : undefined} icono={Lock} tono={r?.blocked ? "bad" : r?.quarantine ? "warn" : undefined} href="/m/alm/alm-06" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} rowKey={(s) => s.id} onRowClick={setAbierto}
        search={{ ...lista.tabla.search, placeholder: "Buscar SKU, producto, lote o almacén…" }}
        empty="No hay stock con esos filtros."
        toolbar={<>
          <FiltroSelect label="Almacén" value={almacen} onChange={setAlmacen} options={opcionesAlmacen(op)} ancho="sm:w-[200px]" />
          <FiltroSelect label="Marca" value={marcaF} onChange={setMarcaF} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          <FiltroSelect label="Línea" value={linea} onChange={setLinea} options={(op?.lines ?? []).map((l) => ({ value: l, label: l }))} />
          <FiltroSelect label="Lote" value={estadoLote} onChange={setEstadoLote} options={[...ESTADOS_LOTE, { value: "HOLD", label: "Cuarentena o bloqueado" }, { value: "NONE", label: "Sin lote" }]} />
          <div className="flex items-center"><Checkbox checked={conCero} onChange={setConCero} label="Con saldo cero" /></div>
        </>} />
      {r && (
        <p className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-[13px] text-muted">
          <span>Total con estos filtros:</span>
          <span><b className="text-ink tabular-nums">{numero(r.qty, 3)}</b> en cantidad</span>
          <span><b className="text-ink tabular-nums">{kg(r.weight_kg)}</b></span>
          <span><b className="text-ink tabular-nums">{numero(r.reserved, 3)}</b> reservado</span>
          {costos && <span><b className="text-ink tabular-nums">{soles(r.value)}</b></span>}
        </p>
      )}
      {abierto && <FichaSaldo id={abierto.id} onClose={() => setAbierto(null)} />}
    </div>
  );
}

function FichaSaldo({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, puede } = useSesion();
  const { datos: s, error } = useDatos<FichaSaldo>(`/v1/alm/stock/${id}`);
  const costos = can("alm.stock.view_cost");
  const prellenado = s ? `wh=${s.warehouse_id}&variant=${s.variant_id}${s.lot_id ? `&lot=${s.lot_id}` : ""}` : "";
  const boton = buttonClass("secondary", "md", "gap-2");
  return (
    <Modal open onClose={onClose} size="lg" title={s ? `${s.sku} · ${s.warehouse_code}` : "Saldo"}
      footer={s && <div className="flex flex-wrap gap-2">
        {s.lot_id && <Link href={`/m/alm/alm-06?lote=${s.lot_id}`} className={boton}>Ficha del lote</Link>}
        {puede("ALM", "C") && can("alm.transfer.create") && Number(s.available_qty) > 0 &&
          <Link href={`/m/alm/alm-07?nuevo=1&from=${s.warehouse_id}&variant=${s.variant_id}${s.lot_id ? `&lot=${s.lot_id}` : ""}`} className={boton}><ArrowLeftRight size={16} aria-hidden="true" />Transferir</Link>}
        {puede("ALM", "C") && <Link href={`/m/alm/alm-09?nuevo=1&${prellenado}`} className={boton}><Trash2 size={16} aria-hidden="true" />Registrar merma</Link>}
        {s.lot_id && s.qc_status === "RELEASED" && puede("ALM", "E") && can("alm.lot.block") &&
          <Link href={`/m/alm/alm-06?lote=${s.lot_id}`} className={buttonClass("danger", "md", "gap-2")}><Lock size={16} aria-hidden="true" />Bloquear lote</Link>}
      </div>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!s ? <p className="text-[13px] text-muted">Cargando…</p> : (
        <div className="space-y-5">
          <DetailList items={[
            { label: "Producto", value: `${s.sku} · ${s.variant_name}` },
            { label: "Marca y línea", value: [s.brand_name, s.line].filter(Boolean).join(" · ") || "—" },
            { label: "Almacén", value: `${s.warehouse_code} · ${s.warehouse_name} (${etiqueta(TIPOS_ALMACEN, s.wh_type).toLowerCase()})` },
            { label: "Vende desde aquí", value: s.allows_sale ? "Sí" : "No" },
            { label: "Lote", value: s.lot_code ? <span className="flex flex-wrap items-center gap-1.5"><span className="font-mono">{s.lot_code}</span><StatusBadge status={s.qc_status} labels={LOTE} /></span> : "Sin lote" },
            { label: "Vencimiento", value: s.expiry_date ? <span>{fecha(s.expiry_date)} · <Dias d={s.days_left} /></span> : "—" },
            { label: "Proveedor", value: s.supplier_name ?? "—" },
            { label: "Saldo", value: <Cant v={s.qty} modo={s.sale_mode} /> },
            { label: "Reservado", value: <Cant v={s.reserved_qty} modo={s.sale_mode} /> },
            { label: "Disponible", value: <b><Cant v={s.available_qty} modo={s.sale_mode} /></b> },
            { label: "Peso", value: kg(s.weight_kg) },
            ...(costos ? [{ label: "Costo promedio y valor", value: `${soles(s.avg_cost)} · ${soles(s.value)}` }] : []),
          ]} />
          <section>
            <h3 className="mb-2 text-[14px] font-semibold">Reservado para</h3>
            <DataTable rows={s.reservations} empty="Nada de este saldo está reservado." columns={[
              { key: "order_number", header: "Pedido", cardTitle: true, render: (x) => <span className="font-mono">{x.order_number}</span> },
              { key: "customer_name", header: "Cliente", render: (x) => x.customer_name ?? "—" },
              { key: "order_status", header: "Estado", render: (x) => <StatusBadge status={x.order_status ?? ""} labels={PEDIDO} /> },
              { key: "delivery_date", header: "Entrega", render: (x) => fecha(x.delivery_date) },
              { key: "qty", header: "Cantidad", align: "right", render: (x) => <Cant v={x.qty} modo={s.sale_mode} /> },
            ]} />
          </section>
          <section>
            <h3 className="mb-2 text-[14px] font-semibold">Kardex de este saldo</h3>
            <DataTable rows={s.movements} empty="Sin movimientos." columns={[
              { key: "moved_at", header: "Fecha", render: (m) => fechaHora(m.moved_at) },
              { key: "movement_type", header: "Movimiento", cardTitle: true, render: (m) => MOVIMIENTO[m.movement_type] ?? m.movement_type },
              { key: "qty", header: "Cantidad", align: "right", render: (m) => <span className={Number(m.qty) < 0 ? "text-bad" : "text-ok"}><Cant v={m.qty} modo={s.sale_mode} signo /></span> },
              { key: "bal_qty", header: "Saldo", align: "right", render: (m) => <Cant v={m.bal_qty} modo={s.sale_mode} /> },
              { key: "user_name", header: "Usuario", render: (m) => m.user_name ?? "—" },
            ]} />
            <Link href={`/m/alm/alm-03?wh=${s.warehouse_id}&variant=${s.variant_id}`} className="mt-2 inline-block text-[13px] text-primary hover:underline">Ver en el kardex</Link>
          </section>
        </div>
      )}
    </Modal>
  );
}
