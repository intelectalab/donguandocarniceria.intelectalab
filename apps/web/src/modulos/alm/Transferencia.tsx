"use client";

import { useState } from "react";
import { FileText, PackageCheck, Plus, Send, Trash2, XCircle } from "lucide-react";
import { Alert, Button, DataTable, DetailList, Field, IconButton, Input, Modal, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BuscaVariante, Cant, accion, num, opcionesAlmacen, useDatos } from "./comunes";
import { TRANSFERENCIA, type Disponible, type Num, type Opciones, type Variante } from "./tipos";

export type FilaTransferencia = {
  id: string; number: string; status: string; requires_guide: boolean; guide_number: string | null; requested_at: string; dispatched_at: string | null;
  received_at: string | null; notes: string | null; from_code: string; from_name: string; to_code: string; to_name: string; dispatched_by_name: string | null;
  lines: number; total_qty: Num; hours_in_transit: Num; value: Num;
};
type LineaT = { id: string; variant_id: string; lot_id: string | null; qty: Num; weight_kg: Num; received_qty: Num; received_weight_kg: Num;
  difference_reason: string | null; sku: string; variant_name: string; sale_mode: string; lot_code: string | null };
type Ficha = Omit<FilaTransferencia, "lines"> & { cancel_reason: string | null; lines: LineaT[] };

/** Ficha de una transferencia con sus pasos: guía (si cambia de local), despacho, recepción o cancelación. */
export function TransferenciaFicha({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const { can, puede } = useSesion();
  const { datos: t, error, recargar } = useDatos<Ficha>(`/v1/alm/transferencias/${id}`);
  const [guia, setGuia] = useState(false);
  const [recibir, setRecibir] = useState(false);
  const hecho = () => { recargar(); onCambio(); };
  const crea = can("alm.transfer.create") && puede("ALM", "E");
  const recibe = can("alm.transfer.receive") && puede("ALM", "E");
  const borrador = t?.status === "DRAFT";
  return (
    <Modal open onClose={onClose} size="lg" title={t ? `Transferencia ${t.number}` : "Transferencia"}
      footer={t && <>
        {borrador && crea && <Button variant="ghost" icon={XCircle} onClick={() => accion({ title: `¿Cancelar ${t.number}?`, danger: true, confirmLabel: "Cancelar transferencia", reason: { min: 5 } },
          (m) => api(`/v1/alm/transferencias/${t.id}/cancelar`, { method: "POST", body: { reason: m } }), "Transferencia cancelada", hecho)}>Cancelar</Button>}
        {borrador && crea && t.requires_guide && !t.guide_number && <Button icon={FileText} onClick={() => setGuia(true)}>Registrar guía</Button>}
        {borrador && crea && <Button variant="primary" icon={Send} disabled={t.requires_guide && !t.guide_number}
          onClick={() => accion({ title: `¿Despachar ${t.number}?`, message: t.requires_guide ? "Sale del origen y queda en tránsito hasta que el destino la reciba." : "Pasa del origen al destino en este momento.", confirmLabel: "Despachar" },
            () => api(`/v1/alm/transferencias/${t.id}/despachar`, { method: "POST" }), "Transferencia despachada", hecho)}>Despachar</Button>}
        {t.status === "DISPATCHED" && recibe && <Button variant="primary" icon={PackageCheck} onClick={() => setRecibir(true)}>Recibir</Button>}
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {t && <div className="space-y-4">
        <DetailList items={[
          { label: "Estado", value: <StatusBadge status={t.status} labels={TRANSFERENCIA} /> },
          { label: "Guía de remisión", value: t.requires_guide ? (t.guide_number ?? "Falta registrarla") : "No aplica (mismo local)" },
          { label: "Origen", value: `${t.from_code} · ${t.from_name}` },
          { label: "Destino", value: `${t.to_code} · ${t.to_name}` },
          { label: "Solicitada", value: fechaHora(t.requested_at) },
          { label: "Despachada", value: t.dispatched_at ? fechaHora(t.dispatched_at) : "—" },
          { label: "Recibida", value: t.received_at ? fechaHora(t.received_at) : "—" },
          ...(t.notes ? [{ label: "Notas", value: t.notes }] : []),
          ...(t.cancel_reason ? [{ label: "Motivo de cancelación", value: t.cancel_reason }] : []),
        ]} />
        {borrador && t.requires_guide && !t.guide_number && <Alert tone="info">Va a otro local: registra la guía de remisión (motivo 04) antes de despachar.</Alert>}
        <DataTable rows={t.lines} columns={[
          { key: "sku", header: "Producto", cardTitle: true, render: (l) => <div className="min-w-[160px]"><p>{l.variant_name}</p><p className="font-mono text-[12px] text-muted">{l.sku}{l.lot_code ? ` · ${l.lot_code}` : ""}</p></div> },
          { key: "qty", header: "Enviado", align: "right", render: (l) => <Cant v={l.qty} modo={l.sale_mode} /> },
          { key: "received_qty", header: "Recibido", align: "right", render: (l) => l.received_qty !== null ? <Cant v={l.received_qty} modo={l.sale_mode} /> : "—" },
          { key: "difference_reason", header: "Diferencia", render: (l) => l.difference_reason ?? "—" },
        ]} />
      </div>}
      {guia && t && <GuiaForm id={t.id} onClose={() => setGuia(false)} onHecho={() => { setGuia(false); hecho(); }} />}
      {recibir && t && <RecibirForm t={t} onClose={() => setRecibir(false)} onHecho={() => { setRecibir(false); hecho(); }} />}
    </Modal>
  );
}

function GuiaForm({ id, onClose, onHecho }: { id: string; onClose: () => void; onHecho: () => void }) {
  const [numero, setNumero] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function enviar() {
    setGuardando(true); setError("");
    try {
      await api(`/v1/alm/transferencias/${id}/guia`, { method: "POST", body: { guide_number: numero.trim().toUpperCase() || null } });
      toast.ok("Guía registrada");
      onHecho();
    } catch (e) { setError(mensajeDe(e)); } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} placement="center" size="sm" title="Guía de remisión" dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={enviar}>Registrar</Button></>}>
      <div className="space-y-3">
        {error && <Alert tone="bad">{error}</Alert>}
        <p className="text-[13px] text-muted">Mientras no esté la facturación electrónica, escribe el número de la guía que emitiste (serie de 4 caracteres y número).</p>
        <Field label="Número de guía" required hint="Ejemplo: T001-123"><Input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} /></Field>
      </div>
    </Modal>
  );
}

function RecibirForm({ t, onClose, onHecho }: { t: Ficha; onClose: () => void; onHecho: () => void }) {
  const [filas, setFilas] = useState(t.lines.map((l) => ({ line_id: l.id, received_qty: String(l.qty ?? ""), received_weight_kg: l.weight_kg?.toString() ?? "", difference_reason: "" })));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (i: number, k: string, v: string) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  async function enviar() {
    setGuardando(true); setError("");
    try {
      await api(`/v1/alm/transferencias/${t.id}/recibir`, { method: "POST", body: { lines: filas.map((f) => ({ ...f, received_qty: num(f.received_qty) ?? 0, received_weight_kg: num(f.received_weight_kg), difference_reason: f.difference_reason || null })) } });
      toast.ok("Transferencia recibida");
      onHecho();
    } catch (e) { setError(mensajeDe(e)); } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={`Recibir ${t.number}`} dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={enviar}>Confirmar recepción</Button></>}>
      <div className="space-y-3">
        {error && <Alert tone="bad">{error}</Alert>}
        <p className="text-[13px] text-muted">Lo que falte se registra como merma de la transferencia y necesita motivo.</p>
        {t.lines.map((l, i) => {
          const dif = Number(l.qty) - (num(filas[i].received_qty) ?? 0);
          return (
            <div key={l.id} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-3">
              <p className="text-[13px] sm:col-span-3"><span className="font-mono text-muted">{l.sku}</span> {l.variant_name} · enviado <Cant v={l.qty} modo={l.sale_mode} /></p>
              <Field label="Recibido"><Input inputMode="decimal" value={filas[i].received_qty} onChange={(e) => set(i, "received_qty", e.target.value)} /></Field>
              <Field label="Peso recibido (kg)"><Input inputMode="decimal" value={filas[i].received_weight_kg} onChange={(e) => set(i, "received_weight_kg", e.target.value)} /></Field>
              <Field label="Motivo de la diferencia" required={Math.abs(dif) > 0.0005}><Input value={filas[i].difference_reason} onChange={(e) => set(i, "difference_reason", e.target.value)} /></Field>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

type LineaNueva = { key: number; variante: Variante | null; lot_id: string; qty: string };
let llave = 0;

/** Nueva solicitud de transferencia. Si el destino es de otro local pedirá guía de remisión. */
export function TransferenciaNueva({ op, onClose, onCreada }: { op: Opciones; onClose: () => void; onCreada: (id: string) => void }) {
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<LineaNueva[]>([{ key: ++llave, variante: null, lot_id: "", qty: "" }]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const wh = (id: string) => op.warehouses.find((w) => w.id === id);
  const otroLocal = origen && destino && wh(origen)?.establishment_id !== wh(destino)?.establishment_id;
  const setL = (i: number, k: keyof LineaNueva, v: unknown) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  async function enviar() {
    setGuardando(true); setError(""); setErrores({});
    try {
      const r = await api<{ id: string }>("/v1/alm/transferencias", { method: "POST", body: {
        from_warehouse_id: origen, to_warehouse_id: destino, notes: notas || null,
        lines: lineas.filter((l) => l.variante).map((l) => ({ variant_id: l.variante!.id, lot_id: l.lot_id || null, qty: num(l.qty) })),
      } });
      toast.ok("Transferencia solicitada");
      onCreada(r.id);
    } catch (e) {
      const c = erroresDe(e); setErrores(c); setError(Object.keys(c).length ? "Revisa los datos marcados." : mensajeDe(e));
    } finally { setGuardando(false); }
  }
  const almacenes = opcionesAlmacen(op, (w) => w.wh_type !== "TRANSIT");
  return (
    <Modal open onClose={onClose} size="lg" title="Nueva transferencia" dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={enviar}>Solicitar</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Origen" required error={errores.from_warehouse_id}><Select value={origen} onChange={(e) => setOrigen(e.target.value)} placeholder="Elegir" options={almacenes} /></Field>
          <Field label="Destino" required error={errores.to_warehouse_id}><Select value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Elegir" options={almacenes.filter((a) => a.value !== origen)} /></Field>
        </div>
        {otroLocal && <Alert tone="info">El destino es de otro local: viaja con guía de remisión y pasa por tránsito.</Alert>}
        {lineas.map((l, i) => (
          <div key={l.key} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_180px_120px_auto] sm:items-end">
            <Field label="Producto" required error={errores[`lines.${i}.variant_id`]}><BuscaVariante value={l.variante} onChange={(v) => { setL(i, "variante", v); setL(i, "lot_id", ""); }} /></Field>
            <LoteSelect variante={l.variante} almacen={origen} value={l.lot_id} onChange={(v) => setL(i, "lot_id", v)} />
            <Field label="Cantidad" required error={errores[`lines.${i}.qty`]}><Input inputMode="decimal" value={l.qty} onChange={(e) => setL(i, "qty", e.target.value)} /></Field>
            {lineas.length > 1 ? <IconButton icon={Trash2} label="Quitar línea" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} /> : <span />}
          </div>
        ))}
        <Button size="sm" icon={Plus} onClick={() => setLineas((ls) => [...ls, { key: ++llave, variante: null, lot_id: "", qty: "" }])}>Agregar línea</Button>
        <Field label="Notas"><Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} /></Field>
      </div>
    </Modal>
  );
}

/** Lote de un producto en un almacén (sin elegir: FEFO). Con todos=true incluye los no liberados (mermas y conteos). */
export function LoteSelect({ variante, almacen, value, onChange, todos, label = "Lote" }:
  { variante: Variante | null; almacen: string; value: string; onChange: (v: string) => void; todos?: boolean; label?: string }) {
  const url = variante && almacen ? `/v1/alm/disponibles?variant_id=${variante.id}&warehouse_id=${almacen}${todos ? "&todos=1" : ""}` : null;
  const lotes = useDatos<{ data: Disponible[] }>(url).datos?.data ?? [];
  return (
    <Field label={label} hint={todos ? undefined : "Vacío: el sistema usa FEFO"}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={todos ? "Sin lote" : "FEFO"} disabled={!url}
        options={lotes.filter((x) => x.lot_id).map((x) => ({ value: x.lot_id!, label: `${x.lot_code} · ${x.expiry_date?.slice(0, 10) ?? ""} · ${Number(x.qty ?? 0)}` }))} />
    </Field>
  );
}
