"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dato, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/del/comunes";
import { DOC_TONO, lista, type Opciones } from "@/modulos/del/tipos";

type Vehiculo = {
  id: string; plate: string; vehicle_type: string; ownership: string; provider_id: string | null; proveedor: string | null; establishment_id: string; local: string | null;
  capacity_kg: number | null; refrigerated: boolean; status: string; fuel_type: string | null; soat_policy_no: string | null; soat_expires_on: string | null;
  tech_inspection_expires_on: string | null; odometer_km: number; rental_daily_rate: number | null; notes: string | null;
  avisos: { level: string; doc: string; msg: string }[]; rutas_mes: number; mantenimiento_mes: number;
};
type Proveedor = { id: string; trade_name: string | null; legal_name: string; supplier_type: string };

const ESTADOS = { ACTIVE: "Activo", MAINTENANCE: "En mantenimiento", INACTIVE: "De baja" };
const PROPIEDAD = { OWN: "Propio", RENTED: "Alquilado" };

/** DEL-12 Vehículos propios y alquilados, con SOAT, revisión técnica y kilometraje (RN-DEL-03). */
export default function Vehiculos() {
  const { can } = useSesion();
  const op = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<{ data: Vehiculo[]; proveedores: Proveedor[] }>("/v1/del/vehiculos");
  const [editar, setEditar] = useState<Vehiculo | "nuevo" | null>(null);
  const gestiona = can("del.vehicle.manage");
  return (
    <div className="space-y-5">
      <PageHeader description="Un vehículo con el SOAT o la revisión técnica vencidos no puede salir a ruta. El aviso aparece días antes del vencimiento."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Vehículo</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No hay vehículos registrados.</Vacio> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {datos.data.map((v) => (
            <Seccion key={v.id} titulo={v.plate} acciones={
              <span className="flex items-center gap-1">
                <Badge tone={v.status === "ACTIVE" ? "ok" : v.status === "MAINTENANCE" ? "warn" : "neutral"}>{ESTADOS[v.status as keyof typeof ESTADOS] ?? v.status}</Badge>
                {gestiona && <Button size="sm" variant="ghost" onClick={() => setEditar(v)}>Editar</Button>}
              </span>
            }>
              <p className="text-[12.5px] text-muted">
                {op.datos?.tipos_vehiculo[v.vehicle_type] ?? v.vehicle_type} · {PROPIEDAD[v.ownership as keyof typeof PROPIEDAD]}{v.proveedor ? ` (${v.proveedor})` : ""} · {v.local ?? "—"}
              </p>
              {v.avisos.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{v.avisos.map((a) => <Badge key={a.msg} tone={DOC_TONO(a.level)}>{a.msg}</Badge>)}</div>}
              <div className="mt-2">
                <Dato label="SOAT">{v.soat_expires_on ? `vence ${fecha(v.soat_expires_on)}` : "—"}</Dato>
                <Dato label="Revisión técnica">{v.tech_inspection_expires_on ? `vence ${fecha(v.tech_inspection_expires_on)}` : "—"}</Dato>
                <Dato label="Kilometraje">{Number(v.odometer_km).toLocaleString("es-PE")} km</Dato>
                <Dato label="Capacidad">{v.capacity_kg ? `${v.capacity_kg} kg` : "—"}{v.refrigerated ? " · refrigerado" : ""}</Dato>
                {v.ownership === "RENTED" && <Dato label="Alquiler por día">{v.rental_daily_rate != null ? soles(v.rental_daily_rate) : "—"}</Dato>}
                <Dato label="Este mes">{v.rutas_mes} ruta(s) · mantenimiento {soles(v.mantenimiento_mes)}</Dato>
              </div>
            </Seccion>
          ))}
        </div>
      )}
      {editar && op.datos && datos && (
        <FormVehiculo v={editar === "nuevo" ? null : editar} op={op.datos} proveedores={datos.proveedores}
          onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />
      )}
    </div>
  );
}

function FormVehiculo({ v, op, proveedores, onClose, onListo }: { v: Vehiculo | null; op: Opciones; proveedores: Proveedor[]; onClose: () => void; onListo: () => void }) {
  const t = (x: unknown) => (x == null ? "" : String(x));
  const [d, setD] = useState({
    plate: t(v?.plate), vehicle_type: v?.vehicle_type ?? "MOTO", ownership: v?.ownership ?? "OWN", provider_id: t(v?.provider_id),
    establishment_id: v?.establishment_id ?? op.locales[0]?.id ?? "", capacity_kg: t(v?.capacity_kg), refrigerated: v?.refrigerated ?? false, status: v?.status ?? "ACTIVE",
    fuel_type: t(v?.fuel_type), soat_policy_no: t(v?.soat_policy_no), soat_expires_on: t(v?.soat_expires_on), tech_inspection_expires_on: t(v?.tech_inspection_expires_on),
    odometer_km: t(v?.odometer_km), rental_daily_rate: t(v?.rental_daily_rate), notes: t(v?.notes),
  });
  const [ocupado, setOcupado] = useState(false);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const num = (x: string) => (x === "" ? null : Number(x));
  return (
    <Modal open onClose={onClose} title={v ? `Editar ${v.plate}` : "Nuevo vehículo"} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={!d.plate.trim() || !d.establishment_id} onClick={async () => {
          setOcupado(true);
          try {
            const body = { ...d, plate: d.plate.trim().toUpperCase(), provider_id: d.ownership === "RENTED" ? d.provider_id || null : null, fuel_type: d.fuel_type || null,
              capacity_kg: num(d.capacity_kg), odometer_km: num(d.odometer_km), rental_daily_rate: d.ownership === "RENTED" ? num(d.rental_daily_rate) : null,
              soat_policy_no: d.soat_policy_no || null, soat_expires_on: d.soat_expires_on || null, tech_inspection_expires_on: d.tech_inspection_expires_on || null, notes: d.notes || null };
            await api(v ? `/v1/del/vehiculos/${v.id}` : "/v1/del/vehiculos", { method: v ? "PUT" : "POST", body });
            toast.ok("Vehículo guardado.");
            onListo();
          } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Guardar</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Placa" required><Input value={d.plate} onChange={set("plate")} maxLength={12} /></Field>
          <Field label="Tipo"><Select value={d.vehicle_type} onChange={set("vehicle_type")} options={lista(op.tipos_vehiculo)} /></Field>
          <Field label="Propiedad"><Select value={d.ownership} onChange={set("ownership")} options={lista(PROPIEDAD)} /></Field>
          <Field label="Estado"><Select value={d.status} onChange={set("status")} options={lista(ESTADOS)} /></Field>
        </div>
        {d.ownership === "RENTED" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Proveedor"><Select value={d.provider_id} onChange={set("provider_id")} placeholder="Elige" options={proveedores.map((p) => ({ value: p.id, label: p.trade_name ?? p.legal_name }))} /></Field>
            <Field label="Alquiler por día (S/)"><Input type="number" inputMode="decimal" min={0} step="0.1" value={d.rental_daily_rate} onChange={set("rental_daily_rate")} /></Field>
          </div>
        )}
        <Field label="Local" required><Select value={d.establishment_id} onChange={set("establishment_id")} options={op.locales.map((l) => ({ value: l.id, label: l.name }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Capacidad (kg)"><Input type="number" inputMode="decimal" min={0} value={d.capacity_kg} onChange={set("capacity_kg")} /></Field>
          <Field label="Combustible"><Select value={d.fuel_type} onChange={set("fuel_type")} placeholder="—" options={lista(op.combustibles)} /></Field>
          <Field label="N.º de póliza SOAT"><Input value={d.soat_policy_no} onChange={set("soat_policy_no")} /></Field>
          <Field label="SOAT vence"><Input type="date" value={d.soat_expires_on} onChange={set("soat_expires_on")} /></Field>
          <Field label="Revisión técnica vence"><Input type="date" value={d.tech_inspection_expires_on} onChange={set("tech_inspection_expires_on")} /></Field>
          <Field label="Kilometraje"><Input type="number" inputMode="numeric" min={0} value={d.odometer_km} onChange={set("odometer_km")} /></Field>
        </div>
        <Checkbox label="Refrigerado" checked={d.refrigerated} onChange={(x) => setD({ ...d, refrigerated: x })} />
        <Field label="Notas"><Textarea rows={2} value={d.notes} onChange={set("notes")} /></Field>
      </div>
    </Modal>
  );
}
