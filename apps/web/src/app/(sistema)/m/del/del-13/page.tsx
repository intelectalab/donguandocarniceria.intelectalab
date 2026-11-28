"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { lista, mesLima, type Opciones } from "@/modulos/del/tipos";

type Costo = {
  id: string; cost_date: string; cost_type: string; tipo: string; amount: number; status: string; source: string; plate: string | null; ruta: string | null;
  trabajador: string | null; proveedor: string | null; zona: string | null; fuel_gallons: number | null; fuel_voucher_no: string | null; odometer_km: number | null; notes: string | null;
  void_reason?: string | null;
};
type Datos = {
  data: Costo[]; mes: string; total: number; por_tipo: { tipo: string; total: number; n: number }[];
  rutas: { id: string; code: string; route_date: string; vehicle_id: string | null }[]; trabajadores: { id: string; full_name: string }[];
  proveedores: { id: string; trade_name: string | null; legal_name: string }[];
};

/** DEL-13 Costos de reparto: combustible, mantenimiento, SOAT, alquiler, peajes, sueldos… cada uno con su destino (RN-DEL-13). */
export default function Costos() {
  const { can } = useSesion();
  const op = useOpciones();
  const [mes, setMes] = useState(mesLima());
  const [tipo, setTipo] = useState("");
  const { datos, error, cargando, recargar } = useDatos<Datos>(`/v1/del/costos?mes=${mes}${tipo ? `&tipo=${tipo}` : ""}`);
  const [nuevo, setNuevo] = useState(false);
  const gestiona = can("del.cost.manage");
  const anular = async (c: Costo) => {
    const r = await confirmAction({ title: `Anular ${c.tipo.toLowerCase()} de ${soles(c.amount)}`, danger: true, confirmLabel: "Anular", reason: { label: "Motivo", min: 3 } });
    if (!r) return;
    try { await api(`/v1/del/costos/${c.id}/anular`, { method: "POST", body: { reason: r.reason } }); toast.ok("Costo anulado."); recargar(); } catch (x) { toast.error(mensajeDe(x)); }
  };
  return (
    <div className="space-y-5">
      <PageHeader description="Todo costo lleva fecha, monto y al menos un destino (ruta, vehículo, repartidor, empresa o zona). El combustible pide vehículo, galones y vale."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Costo</Button>} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mes"><Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></Field>
        <FiltroSelect etiqueta="Tipo" value={tipo} onChange={setTipo} options={lista(op.datos?.costos)} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : datos && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cifra titulo="Total del mes" valor={soles(datos.total)} destacada />
            {datos.por_tipo.slice(0, 3).map((t) => <Cifra key={t.tipo} titulo={t.tipo} valor={soles(t.total)} detalle={`${t.n} registro(s)`} />)}
          </div>
          <Seccion titulo={`Costos (${datos.data.length})`}>
            {!datos.data.length ? <Vacio>No hay costos en este mes.</Vacio> : (
              <ul className="divide-y divide-line">
                {datos.data.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 py-2.5 text-[13.5px]">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{c.tipo} · {soles(c.amount)} {c.status !== "ACTIVE" && <Badge tone="bad">Anulado</Badge>}</span>
                      <span className="block text-[12.5px] text-muted">
                        {fecha(c.cost_date)} · {[c.ruta, c.plate, c.trabajador, c.proveedor, c.zona].filter(Boolean).join(" · ") || "—"}
                        {c.fuel_gallons ? ` · ${c.fuel_gallons} gal · vale ${c.fuel_voucher_no ?? "—"}` : ""}
                      </span>
                      {c.notes && <span className="block text-[12.5px] text-muted">{c.notes}</span>}
                    </span>
                    {gestiona && c.status === "ACTIVE" && <Button size="sm" variant="ghost" onClick={() => anular(c)}>Anular</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </>
      )}
      {nuevo && op.datos && datos && <FormCosto op={op.datos} d0={datos} onClose={() => setNuevo(false)} onListo={() => { setNuevo(false); recargar(); }} />}
    </div>
  );
}

function FormCosto({ op, d0, onClose, onListo }: { op: Opciones; d0: Datos; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ cost_date: hoyLima(), cost_type: "FUEL", amount: "", route_id: "", vehicle_id: "", employee_id: "", supplier_id: "", zone_id: "",
    fuel_gallons: "", fuel_voucher_no: "", odometer_km: "", notes: "" });
  const [ocupado, setOcupado] = useState(false);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const comb = d.cost_type === "FUEL";
  return (
    <Modal open onClose={onClose} title="Nuevo costo" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={d.amount === "" || !d.cost_date} onClick={async () => {
          setOcupado(true);
          try {
            const n = (x: string) => (x === "" ? null : Number(x));
            const body = { cost_date: d.cost_date, cost_type: d.cost_type, amount: Number(d.amount), route_id: d.route_id || null, vehicle_id: d.vehicle_id || null,
              employee_id: d.employee_id || null, supplier_id: d.supplier_id || null, zone_id: d.zone_id || null, fuel_gallons: comb ? n(d.fuel_gallons) : null,
              fuel_voucher_no: comb ? d.fuel_voucher_no || null : null, odometer_km: n(d.odometer_km), notes: d.notes || null };
            await api("/v1/del/costos", { method: "POST", body });
            toast.ok("Costo registrado.");
            onListo();
          } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Registrar</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha" required><Input type="date" max={hoyLima()} value={d.cost_date} onChange={set("cost_date")} /></Field>
          <Field label="Monto (S/)" required><Input type="number" inputMode="decimal" min={0} step="0.1" value={d.amount} onChange={set("amount")} /></Field>
        </div>
        <Field label="Tipo"><Select value={d.cost_type} onChange={set("cost_type")} options={lista(op.costos)} /></Field>
        <p className="text-[12.5px] text-muted">Destino: al menos uno.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ruta"><Select value={d.route_id} onChange={set("route_id")} placeholder="—" options={d0.rutas.map((r) => ({ value: r.id, label: `${r.code} · ${fecha(r.route_date)}` }))} /></Field>
          <Field label="Vehículo" required={comb}><Select value={d.vehicle_id} onChange={set("vehicle_id")} placeholder="—" options={op.vehiculos.map((v) => ({ value: v.id, label: v.plate }))} /></Field>
          <Field label="Trabajador"><Select value={d.employee_id} onChange={set("employee_id")} placeholder="—" options={d0.trabajadores.map((t) => ({ value: t.id, label: t.full_name }))} /></Field>
          <Field label="Proveedor"><Select value={d.supplier_id} onChange={set("supplier_id")} placeholder="—" options={d0.proveedores.map((p) => ({ value: p.id, label: p.trade_name ?? p.legal_name }))} /></Field>
          <Field label="Zona"><Select value={d.zone_id} onChange={set("zone_id")} placeholder="—" options={op.zonas.map((z) => ({ value: z.id, label: z.name }))} /></Field>
          <Field label="Odómetro (km)"><Input type="number" inputMode="numeric" min={0} value={d.odometer_km} onChange={set("odometer_km")} /></Field>
        </div>
        {comb && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Galones" required><Input type="number" inputMode="decimal" min={0} step="0.01" value={d.fuel_gallons} onChange={set("fuel_gallons")} /></Field>
            <Field label="N.º de vale" required><Input value={d.fuel_voucher_no} onChange={set("fuel_voucher_no")} /></Field>
          </div>
        )}
        <Field label="Notas"><Textarea rows={2} value={d.notes} onChange={set("notes")} /></Field>
      </div>
    </Modal>
  );
}
