"use client";

import { useState } from "react";
import { Alert, Button, DataTable, DetailList, Field, Modal, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, kg, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Cant, Dias, opcionesAlmacen, useDatos, useOpciones } from "./comunes";
import { LOTE, MOVIMIENTO, RESERVA, type FichaLote } from "./tipos";

const ORIGEN_LOTE: Record<string, string> = { PURCHASE: "Compra", FARM: "Granja", PRODUCTION: "Producción", CUTTING: "Despiece", OPENING: "Carga inicial", RETURN: "Devolución" };

const VERBO: Record<string, string> = { RELEASED: "Liberar", BLOCKED: "Bloquear", REJECTED: "Rechazar", RECALLED: "Retirar del mercado" };

/** Ficha del lote: datos, stock por almacén, pedidos que lo usaron, historial y cambio de estado (ALM-06). */
export function LoteFicha({ id, conAcciones, onCambio }: { id: string; conAcciones?: boolean; onCambio?: () => void }) {
  const { can, puede } = useSesion();
  const { datos: l, error, cargando, recargar } = useDatos<FichaLote>(`/v1/alm/lotes/${id}`);
  const [cambio, setCambio] = useState<string | null>(null);
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!l) return <p className="text-[13px] text-muted">{cargando ? "Cargando…" : ""}</p>;
  const permitido = (s: string) => puede("ALM", "E") && can(s === "RELEASED" ? "alm.lot.release" : "alm.lot.block");
  const acciones = conAcciones ? l.flow.filter(permitido) : [];
  return (
    <div className="space-y-5">
      <DetailList items={[
        { label: "Lote", value: <span className="font-mono font-semibold">{l.code}</span> },
        { label: "Estado", value: <StatusBadge status={l.qc_status} labels={LOTE} /> },
        { label: "Producto", value: `${l.sku} · ${l.variant_name}` },
        { label: "Marca y línea", value: [l.brand_name, l.line].filter(Boolean).join(" · ") || "—" },
        { label: "Origen", value: ORIGEN_LOTE[l.origin ?? ""] ?? l.origin ?? "—" },
        { label: "Proveedor", value: l.supplier_name },
        ...(l.supplier_lot_code || l.farm_lot_code ? [{ label: "Lote del proveedor", value: l.supplier_lot_code ?? l.farm_lot_code }] : []),
        ...(l.unit_cost !== null ? [{ label: "Costo unitario", value: soles(l.unit_cost) }] : []),
        ...(l.received_weight_kg !== null ? [{ label: "Peso recibido", value: kg(l.received_weight_kg) }] : []),
        { label: "Producción", value: fecha(l.production_date) },
        { label: "Vencimiento", value: <span>{fecha(l.expiry_date)} · <Dias d={l.days_left} /></span> },
        ...(l.block_reason ? [{ label: "Motivo del bloqueo", value: l.block_reason }] : []),
        ...(l.released_at ? [{ label: "Liberado", value: `${fechaHora(l.released_at)} · ${l.released_by ?? ""}` }] : []),
      ]} />
      {conAcciones && (acciones.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {acciones.map((s) => <Button key={s} variant={s === "RELEASED" ? "primary" : "danger"} onClick={() => setCambio(s)}>{VERBO[s]}</Button>)}
        </div>
      ) : l.flow.length === 0 ? <Alert tone="info">Un lote {LOTE[l.qc_status]?.[0].toLowerCase()} ya no cambia de estado.</Alert>
        : <Alert tone="info">Tu rol no puede cambiar el estado de este lote.</Alert>)}

      <section>
        <h3 className="mb-2 text-[14px] font-semibold">Stock por almacén</h3>
        <DataTable rows={l.stock.filter((s) => Number(s.qty) > 0)} empty="Sin stock." columns={[
          { key: "warehouse_code", header: "Almacén", cardTitle: true, render: (s) => <span><span className="font-mono">{s.warehouse_code}</span> · {s.warehouse_name}</span> },
          { key: "qty", header: "Saldo", align: "right", render: (s) => <Cant v={s.qty} modo={l.sale_mode} /> },
          { key: "reserved_qty", header: "Reservado", align: "right", render: (s) => <Cant v={s.reserved_qty} modo={l.sale_mode} /> },
          { key: "weight_kg", header: "Peso", align: "right", render: (s) => kg(s.weight_kg) },
        ]} />
      </section>
      <section>
        <h3 className="mb-2 text-[14px] font-semibold">Pedidos que lo usaron</h3>
        <DataTable rows={l.orders} rowKey={(o) => `${o.order_id}-${o.status}`} empty="Ningún pedido lo reservó ni despachó." columns={[
          { key: "order_number", header: "Pedido", cardTitle: true, render: (o) => <span className="font-mono">{o.order_number}</span> },
          { key: "status", header: "Estado", render: (o) => <StatusBadge status={o.status} labels={RESERVA} /> },
          { key: "qty", header: "Cantidad", align: "right", render: (o) => <Cant v={o.qty} modo={l.sale_mode} /> },
        ]} />
      </section>
      <section>
        <h3 className="mb-2 text-[14px] font-semibold">Kardex del lote</h3>
        <DataTable rows={l.movements} empty="Sin movimientos." columns={[
          { key: "moved_at", header: "Fecha", render: (m) => fechaHora(m.moved_at) },
          { key: "movement_type", header: "Movimiento", cardTitle: true, render: (m) => MOVIMIENTO[m.movement_type] ?? m.movement_type },
          { key: "warehouse_code", header: "Almacén", render: (m) => <span className="font-mono">{m.warehouse_code}</span> },
          { key: "qty", header: "Cantidad", align: "right", render: (m) => <span className={Number(m.qty) < 0 ? "text-bad" : "text-ok"}><Cant v={m.qty} modo={l.sale_mode} signo /></span> },
          { key: "user_name", header: "Usuario", render: (m) => m.user_name ?? "—" },
        ]} />
      </section>
      <section>
        <h3 className="mb-2 text-[14px] font-semibold">Historial de estados</h3>
        <DataTable rows={l.history} empty="Sin cambios de estado." columns={[
          { key: "changed_at", header: "Fecha", render: (h) => fechaHora(h.changed_at) },
          { key: "to_status", header: "Cambio", cardTitle: true, render: (h) => <span className="flex flex-wrap items-center gap-1">{h.from_status && <><StatusBadge status={h.from_status} labels={LOTE} />→</>}<StatusBadge status={h.to_status} labels={LOTE} /></span> },
          { key: "reason", header: "Motivo", render: (h) => h.reason ?? "—" },
          { key: "changed_by_name", header: "Quién", render: (h) => h.changed_by_name ?? "—" },
        ]} />
      </section>
      {cambio && <CambioEstado lote={l} estado={cambio} onClose={() => setCambio(null)} onHecho={() => { setCambio(null); recargar(); onCambio?.(); }} />}
    </div>
  );
}

function CambioEstado({ lote, estado, onClose, onHecho }: { lote: FichaLote; estado: string; onClose: () => void; onHecho: () => void }) {
  const op = useOpciones();
  const [motivo, setMotivo] = useState("");
  const destinos = opcionesAlmacenLote(op, lote);
  const [mover, setMover] = useState<string | null>(null);
  const moverA = mover ?? destinos.sugerido ?? "";
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const enCuarentena = lote.stock.some((s) => s.wh_type === "QUARANTINE" && Number(s.qty) > 0);
  const exigeMotivo = estado !== "RELEASED";
  async function enviar() {
    setGuardando(true); setError("");
    try {
      const r = await api<{ rereserved?: string[]; moved?: unknown[] }>(`/v1/alm/lotes/${lote.id}/estado`, { method: "POST", body: { status: estado, reason: motivo || null, move_to: (enCuarentena && moverA) || null } });
      const extra = r.rereserved?.length ? ` · ${r.rereserved.length} pedido(s) se volvieron a reservar con otro lote` : "";
      toast.ok(`Lote ${lote.code}: ${LOTE[estado]?.[0].toLowerCase()}${extra}`);
      onHecho();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} placement="center" size="sm" title={`${VERBO[estado]} el lote ${lote.code}`} dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button variant={estado === "RELEASED" ? "primary" : "danger"} loading={guardando} disabled={exigeMotivo && motivo.trim().length < 5} onClick={enviar}>{VERBO[estado]}</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        {estado !== "RELEASED" && <Alert tone="warn">Los pedidos que tenían reservado este lote se vuelven a reservar con otro lote, si hay.</Alert>}
        {estado === "RELEASED" && enCuarentena && (
          <Field label="Pasar el saldo de cuarentena a" hint="Opcional: si no eliges, se queda en cuarentena ya liberado.">
            <Select value={moverA} onChange={(e) => setMover(e.target.value)} placeholder="No mover" options={destinos.opciones} />
          </Field>
        )}
        <Field label="Motivo" required={exigeMotivo} hint={exigeMotivo ? "Mínimo 5 caracteres" : undefined}>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
        </Field>
      </div>
    </Modal>
  );
}

/** Destinos al liberar desde cuarentena: almacenes del mismo local que venden; se sugiere el que corresponde al tipo de conservación. */
function opcionesAlmacenLote(op: ReturnType<typeof useOpciones>, lote: FichaLote) {
  const origen = lote.stock.find((s) => s.wh_type === "QUARANTINE" && Number(s.qty) > 0);
  const local = op?.warehouses.find((w) => w.id === origen?.warehouse_id)?.establishment_id ?? null;
  const filtro = (w: NonNullable<typeof op>["warehouses"][number]) => !["QUARANTINE", "TRANSIT", "VEHICLE"].includes(w.wh_type) && (!local || w.establishment_id === local);
  const lista = (op?.warehouses ?? []).filter(filtro);
  const tipo = lote.storage === "FROZEN" ? "FREEZER" : lote.storage === "CHILLED" ? "COLD_ROOM" : "MAIN";
  const sugerido = (lista.find((w) => w.wh_type === tipo) ?? lista.find((w) => w.allows_sale))?.id;
  return { opciones: opcionesAlmacen(op, filtro), sugerido };
}
