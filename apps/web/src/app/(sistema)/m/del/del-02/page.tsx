"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Field, FiltroFecha, Input, PageHeader, Select, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { TarjetaRuta, Vacio, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { DOC_TONO, R, lista, type Opciones, type RutaResumen } from "@/modulos/del/tipos";

/** DEL-02 Asignación: por ruta, modalidad, vehículo y repartidor o empresa; avisa documentos y capacidad (RN-DEL-01, RN-DEL-03). */
export default function Asignacion() {
  const router = useRouter();
  const [dia, setDia] = useState(hoyLima());
  const op = useOpciones(dia);
  const rutas = useDatos<{ data: RutaResumen[] }>(`/v1/del/rutas?fecha=${dia}`);
  return (
    <div className="space-y-5">
      <PageHeader description="Asigna cada ruta: propia o alquilada con vehículo y repartidor, o de tercero con la empresa de delivery. Un vehículo con SOAT o revisión técnica vencidos no sale." />
      <FiltroFecha etiqueta="Fecha" value={dia} onChange={(v) => setDia(v || hoyLima())} />
      {(rutas.error || op.error) && <Alert tone="bad">{rutas.error || op.error}</Alert>}
      {rutas.cargando || !op.datos ? <Vacio>Cargando…</Vacio> : !rutas.datos?.data.length ? <Vacio>No hay rutas para esta fecha. Créalas en el Planificador.</Vacio> : (
        <div className="grid gap-4 md:grid-cols-2">
          {rutas.datos.data.map((r) => (
            <TarjetaRuta key={r.id} r={r} onClick={() => router.push(`${R.hoja}?id=${r.id}`)}>
              {["PLANNED", "LOADING"].includes(r.status) && op.datos?.puede.planificar
                ? <Formulario r={r} op={op.datos} onListo={rutas.recargar} />
                : <p className="text-[12.5px] text-muted">La ruta ya salió: la asignación no cambia.</p>}
            </TarjetaRuta>
          ))}
        </div>
      )}
    </div>
  );
}

function Formulario({ r, op, onListo }: { r: RutaResumen; op: Opciones; onListo: () => void }) {
  const [modo, setModo] = useState(r.mode);
  const [vehiculo, setVehiculo] = useState(r.vehicle_id ?? "");
  const [chofer, setChofer] = useState(r.driver_user_id ?? "");
  const [empresa, setEmpresa] = useState(r.carrier_supplier_id ?? "");
  const [pago, setPago] = useState(r.driver_pay_mode ?? "");
  const [tarifa, setTarifa] = useState(r.driver_pay_rate !== null ? String(r.driver_pay_rate) : "");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const vehiculos = op.vehiculos.filter((v) => v.establishment_id === r.establishment_id && v.ownership === (modo === "RENTED" ? "RENTED" : "OWN"));
  const v = op.vehiculos.find((x) => x.id === vehiculo);

  function elegirChofer(id: string) {
    setChofer(id);
    const p = op.repartidores.find((x) => x.id === id)?.pago;
    if (p && !pago) { setPago(p.mode); setTarifa(String(p.rate)); }
  }

  async function guardar() {
    setOcupado(true);
    try {
      const x = await api<{ warnings: string[] }>(`/v1/del/rutas/${r.id}/asignar`, { method: "POST", body: modo === "THIRD_PARTY"
        ? { mode: modo, carrier_supplier_id: empresa || null }
        : { mode: modo, vehicle_id: vehiculo || null, driver_user_id: chofer || null, driver_pay_mode: pago || null, driver_pay_rate: tarifa === "" ? null : Number(tarifa) } });
      setAvisos(x.warnings);
      toast.ok(`Ruta ${r.code} asignada.`);
      onListo();
    } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
  }

  return (
    <div className="space-y-3">
      <Field label="Modalidad">
        <Select value={modo} onChange={(e) => { setModo(e.target.value); setVehiculo(""); }} options={lista(op.modos)} />
      </Field>
      {modo === "THIRD_PARTY" ? (
        <Field label="Empresa de delivery">
          <Select value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Elige la empresa"
            options={op.empresas.filter((x) => x.status === "ACTIVE").map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
      ) : (
        <>
          <Field label="Vehículo">
            <Select value={vehiculo} onChange={(e) => setVehiculo(e.target.value)} placeholder="Elige el vehículo"
              options={vehiculos.map((x) => ({ value: x.id, label: `${x.plate} · ${op.tipos_vehiculo[x.vehicle_type] ?? x.vehicle_type}${x.capacity_kg ? ` · ${x.capacity_kg} kg` : ""}`, disabled: x.status !== "ACTIVE" }))} />
          </Field>
          {v && v.docs.length > 0 && <div className="flex flex-wrap gap-1">{v.docs.map((d) => <Badge key={d.msg} tone={DOC_TONO(d.level)}>{d.msg}</Badge>)}</div>}
          <Field label="Repartidor">
            <Select value={chofer} onChange={(e) => elegirChofer(e.target.value)} placeholder="Elige el repartidor" options={op.repartidores.map((x) => ({ value: x.id, label: x.name }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pago">
              <Select value={pago} onChange={(e) => setPago(e.target.value)} placeholder="—" options={[{ value: "DAILY", label: "Jornal" }, { value: "PER_DELIVERY", label: "Por entrega" }]} />
            </Field>
            <Field label="Monto (S/)">
              <Input type="number" inputMode="decimal" min={0} step="0.5" value={tarifa} onChange={(e) => setTarifa(e.target.value)} />
            </Field>
          </div>
        </>
      )}
      {avisos.length > 0 && <Alert tone="warn" title="Avisos">{avisos.map((a) => <span key={a} className="block">{a}</span>)}</Alert>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={async () => {
          const c = await confirmAction({ title: `Cancelar la ruta ${r.code}`, message: "Sus pedidos quedan libres para otra ruta.", danger: true, confirmLabel: "Cancelar ruta", reason: { label: "Motivo", min: 3 } });
          if (!c) return;
          try { await api(`/v1/del/rutas/${r.id}/cancelar`, { method: "POST", body: { reason: c.reason } }); toast.ok("Ruta cancelada."); onListo(); } catch (e) { toast.error(mensajeDe(e)); }
        }}>Cancelar ruta</Button>
        <Button variant="primary" loading={ocupado} onClick={() => void guardar()}>Guardar asignación</Button>
      </div>
    </div>
  );
}
