"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, Input, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { FiltroSelect, grados, num, opcionesDe, qs, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { TIPO_PUNTO, type Opciones, type Punto } from "@/modulos/cal/tipos";


/** CAL-04 Puntos de temperatura: cámaras, congeladoras, ollas, vitrinas y vehículos con su rango y frecuencia de lectura (RN-CAL-13, RN-CAL-14). */
export default function Puntos() {
  const { local, puede } = useSesion();
  const op = useOpcionesCal();
  const [tipo, setTipo] = useState("");
  const { datos, error, recargar } = useDatos<{ data: Punto[] }>(`/v1/cal/puntos${qs({ site: local, point_type: tipo })}`);
  const [editar, setEditar] = useState<Punto | null | undefined>(undefined);
  const gestiona = Boolean(op?.can.checklist) && puede("CAL", "C");
  const columnas: Column<Punto>[] = [
    { key: "code", header: "Código", render: (p) => <span className="font-mono font-semibold">{p.code}</span> },
    { key: "name", header: "Punto", cardTitle: true, render: (p) => <div><p className="font-medium">{p.name}</p><p className="text-[12px] text-muted">{TIPO_PUNTO[p.point_type]} · {p.establishment_name}{p.vehicle_plate ? ` · ${p.vehicle_plate}` : ""}</p></div> },
    { key: "range", header: "Rango", render: (p) => `${grados(p.min_c)} a ${grados(p.max_c)}` },
    { key: "freq", header: "Lectura cada", render: (p) => `${numero(Number(p.reading_frequency_min) / 60, 1)} h${p.sensor ? " · sensor" : ""}` },
    { key: "last", header: "Última lectura", render: (p) => p.last_read_at ? <span className="whitespace-nowrap"><Badge tone={p.last_in_range ? "ok" : "bad"}>{grados(p.last_value_c)}</Badge> <span className="text-[12px] text-muted">{fechaHora(p.last_read_at)}</span></span> : "—" },
    { key: "status", header: "Estado", render: (p) => p.status !== "ACTIVE" ? <StatusBadge status={p.status} /> : p.open_excursion_id ? <Badge tone="bad">Excursión abierta</Badge> : p.overdue ? <Badge tone="warn">Lectura atrasada</Badge> : <Badge tone="ok">Al día</Badge> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cada punto tiene su rango en °C. Una lectura fuera de rango abre una excursión y avisa a Calidad; si pasa el tiempo de lectura sin registrarla, el punto queda atrasado."
        actions={gestiona && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setEditar(null)}>Nuevo punto</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <DataTable rows={(datos?.data ?? []).filter((p) => !tipo || p.point_type === tipo)} columns={columnas} loading={!datos && !error} onRowClick={gestiona ? (p) => setEditar(p) : undefined} empty="No hay puntos."
        toolbar={<FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opcionesDe(TIPO_PUNTO)} />} />
      {editar !== undefined && op && <FormPunto p={editar} op={op} onClose={() => setEditar(undefined)} onGuardado={() => { setEditar(undefined); recargar(); }} />}
    </div>
  );
}

function FormPunto({ p, op, onClose, onGuardado }: { p: Punto | null; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ code: p?.code ?? "", name: p?.name ?? "", point_type: p?.point_type ?? "COLD_ROOM", establishment_id: p?.establishment_id ?? op.establishments[0]?.id ?? "",
    equipment_id: p?.equipment_id ?? "", warehouse_id: p?.warehouse_id ?? "", vehicle_id: p?.vehicle_id ?? "", min_c: p ? String(Number(p.min_c)) : "0", max_c: p ? String(Number(p.max_c)) : "4",
    reading_frequency_min: p ? String(Number(p.reading_frequency_min)) : "240", status: p?.status ?? "ACTIVE", sensor: p?.sensor ?? false });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo={p ? `Editar ${p.code}` : "Nuevo punto de temperatura"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(p ? `/v1/cal/puntos/${p.id}` : "/v1/cal/puntos", { method: p ? "PUT" : "POST", body: { ...f, equipment_id: f.equipment_id || null, warehouse_id: f.warehouse_id || null,
          vehicle_id: f.vehicle_id || null, min_c: num(f.min_c), max_c: num(f.max_c), reading_frequency_min: num(f.reading_frequency_min) } });
        toast.ok("Punto guardado"); onGuardado();
      }}>
      {(err) => <>
        <Field label="Código" required error={err.code}><Input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
        <Field label="Nombre" required error={err.name}><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Tipo" required error={err.point_type}><Select value={f.point_type} options={opcionesDe(TIPO_PUNTO)} onChange={(e) => set("point_type", e.target.value)} /></Field>
        <Field label="Local" required error={err.establishment_id}><Select value={f.establishment_id} options={op.establishments.map((e) => ({ value: e.id, label: e.short ?? e.name }))} onChange={(e) => set("establishment_id", e.target.value)} /></Field>
        {f.point_type === "VEHICLE"
          ? <Field label="Vehículo" required error={err.vehicle_id}><Select value={f.vehicle_id} placeholder="Elegir" options={op.vehicles.map((v) => ({ value: v.id, label: v.plate }))} onChange={(e) => set("vehicle_id", e.target.value)} /></Field>
          : <Field label="Equipo" error={err.equipment_id}><Select value={f.equipment_id} placeholder="Ninguno" searchable options={op.equipment.filter((e) => e.establishment_id === f.establishment_id).map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))} onChange={(e) => set("equipment_id", e.target.value)} /></Field>}
        <Field label="Almacén" error={err.warehouse_id}><Select value={f.warehouse_id} placeholder="Ninguno" options={op.warehouses.filter((w) => w.establishment_id === f.establishment_id).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} onChange={(e) => set("warehouse_id", e.target.value)} /></Field>
        <Field label="Mínimo" required error={err.min_c}><Input inputMode="decimal" suffix="°C" value={f.min_c} onChange={(e) => set("min_c", e.target.value)} /></Field>
        <Field label="Máximo" required error={err.max_c}><Input inputMode="decimal" suffix="°C" value={f.max_c} onChange={(e) => set("max_c", e.target.value)} /></Field>
        <Field label="Lectura cada" required error={err.reading_frequency_min}><Input inputMode="numeric" suffix="min" value={f.reading_frequency_min} onChange={(e) => set("reading_frequency_min", e.target.value)} /></Field>
        <Field label="Estado" error={err.status}><Select value={f.status} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} onChange={(e) => set("status", e.target.value)} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={f.sensor} onChange={(v) => set("sensor", v)} label="Tiene sensor" hint="Las lecturas llegan solas; igual se puede registrar a mano" /></div>
      </>}
    </Dialogo>
  );
}
