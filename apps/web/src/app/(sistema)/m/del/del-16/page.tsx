"use client";

import { useState } from "react";
import { PackageCheck, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, VerArchivo, hoyLima, sumarDias, useDatos, useOpciones } from "@/modulos/del/comunes";
import { PARADA, PEDIDO, type Opciones } from "@/modulos/del/tipos";

type Fila = {
  id: string; seq: number; status: string; motivo: string | null; nota: string | null; foto_id: string | null; closed_at: string | null; bolsas_devueltas: boolean;
  bags_returned_at: string | null; reprogramado_a: string | null; order_id: string; pedido: string; order_status: string; reprogramaciones: number; cliente: string | null;
  direccion: string | null; distrito: string | null; route_id: string; ruta: string; route_date: string; repartidor: string | null; establishment_id: string;
};

/** DEL-16 No entregados: recibir las bolsas de vuelta (el stock regresa) y reprogramar con fecha y franja nuevas. */
export default function NoEntregados() {
  const { can } = useSesion();
  const op = useOpciones();
  const [estado, setEstado] = useState<"PENDIENTES" | "TODOS">("PENDIENTES");
  const { datos, error, cargando, recargar } = useDatos<{ data: Fila[] }>(`/v1/del/no-entregados?estado=${estado}`);
  const [reprog, setReprog] = useState<Fila | null>(null);
  const planifica = can("del.route.plan");
  const recibir = async (f: Fila) => {
    const c = await confirmAction({ title: `Recibir las bolsas de ${f.pedido}`, confirmLabel: "Recibidas",
      message: "Confirma que las bolsas volvieron completas al local. El producto regresa al stock y la preparación se cierra.", reason: { label: "Nota", optional: true } });
    if (!c) return;
    try { await api(`/v1/del/paradas/${f.id}/recibir-bolsas`, { method: "POST", body: { note: c.reason || null } }); toast.ok("Bolsas recibidas."); recargar(); } catch (x) { toast.error(mensajeDe(x)); }
  };
  return (
    <div className="space-y-5">
      <PageHeader description="Primero se reciben las bolsas de vuelta; después se reprograma el pedido (vuelve a preparación con la fecha y franja nuevas)." />
      <Tabs value={estado} onChange={setEstado} tabs={[{ key: "PENDIENTES", label: "Por atender" }, { key: "TODOS", label: "Últimos 30 días" }]} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No hay pedidos no entregados.</Vacio> : (
        <div className="grid gap-3 md:grid-cols-2">
          {datos.data.map((f) => (
            <Seccion key={f.id} titulo={`${f.pedido} · ${f.cliente ?? "—"}`} acciones={<StatusBadge status={f.status} labels={PARADA} />}>
              <p className="text-[13px] font-medium text-bad">{f.motivo ?? "Sin motivo"}</p>
              {f.nota && <p className="text-[12.5px] text-muted">{f.nota}</p>}
              <p className="mt-1 text-[12.5px] text-muted">{[f.direccion, f.distrito].filter(Boolean).join(", ") || "—"}</p>
              <p className="text-[12.5px] text-muted">{f.ruta} · parada {f.seq} · {f.repartidor ?? "—"} · {fechaHora(f.closed_at)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={f.order_status} labels={PEDIDO} />
                {f.bolsas_devueltas ? <Badge tone="ok">Bolsas recibidas {fechaHora(f.bags_returned_at)}</Badge> : <Badge tone="warn">Bolsas por recibir</Badge>}
                {f.reprogramado_a && <Badge tone="info">Reprogramado al {fecha(f.reprogramado_a)}</Badge>}
                {f.reprogramaciones > 0 && <Badge>{f.reprogramaciones} reprogramación(es)</Badge>}
                {f.foto_id && <VerArchivo id={f.foto_id} />}
              </div>
              {planifica && f.status === "FAILED" && f.order_status === "NOT_DELIVERED" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!f.bolsas_devueltas && <Button size="sm" icon={PackageCheck} onClick={() => recibir(f)}>Recibir bolsas</Button>}
                  <Button size="sm" variant="primary" icon={RotateCcw} disabled={!f.bolsas_devueltas} onClick={() => setReprog(f)}>Reprogramar</Button>
                </div>
              )}
            </Seccion>
          ))}
        </div>
      )}
      {reprog && op.datos && <Reprogramar f={reprog} op={op.datos} onClose={() => setReprog(null)} onListo={() => { setReprog(null); recargar(); }} />}
    </div>
  );
}

function Reprogramar({ f, op, onClose, onListo }: { f: Fila; op: Opciones; onClose: () => void; onListo: () => void }) {
  // Por defecto, el día siguiente a la entrega fallida (o mañana, si ya pasó): la misma fecha y franja no se aceptan.
  const manana = sumarDias(hoyLima(), 1);
  const siguiente = sumarDias(f.route_date, 1);
  const [d, setD] = useState({ date: siguiente > manana ? siguiente : manana, slot_id: "", reason: "" });
  const [ocupado, setOcupado] = useState(false);
  const franjas = op.franjas.filter((x) => x.establishment_id === f.establishment_id);
  return (
    <Modal open onClose={onClose} title={`Reprogramar ${f.pedido}`} size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={!d.slot_id || d.reason.trim().length < 3} onClick={async () => {
          setOcupado(true);
          try { await api(`/v1/del/paradas/${f.id}/reprogramar`, { method: "POST", body: d }); toast.ok("Pedido reprogramado: vuelve a preparación."); onListo(); }
          catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Reprogramar</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Fecha nueva" required><Input type="date" min={hoyLima()} value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="Franja" required><Select value={d.slot_id} onChange={(e) => setD({ ...d, slot_id: e.target.value })} placeholder="Elige la franja"
          options={franjas.map((x) => ({ value: x.id, label: `${x.name} (${x.slot_from.slice(0, 5)}–${x.slot_to.slice(0, 5)})` }))} /></Field>
        <Field label="Motivo" required><Input value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} placeholder="Ej.: el cliente pidió para mañana" /></Field>
      </div>
    </Modal>
  );
}
