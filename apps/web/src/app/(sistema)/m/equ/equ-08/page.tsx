"use client";

import { useState } from "react";
import { CircleDollarSign, Clock, Factory, Gauge, Plus, Wrench } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { Barras, CifraLink, FiltroSelect, num, olvidarOpcionesEqu, opcionesEquipo, qs, useDatos, useOpcionesEqu } from "@/modulos/equ/comunes";
import { SIN_HORAS, type Num, type Opciones } from "@/modulos/equ/tipos";

type Uso = { id: string; used_on: string; order_ref: string | null; equipment_id: string; equipment_code: string; equipment_name: string; hours: Num; hourly_rate: Num; cost: Num;
  establishment_name: string; recorded_by_name: string | null; source: string };
type Cifras = { hours: Num; cost: Num; orders: number; equipment: number; from: string };
type Apto = { usable: boolean; rule: string | null; message: string | null; hourly_rate: Num; hour_meter: Num };

/** EQU-08 Uso del equipo: horas por orden de producción (PRO-09) y lecturas de horómetro. Solo equipos aptos (RN-EQU-03 y RN-EQU-04). */
export default function UsoEquipo() {
  const { local, puede } = useSesion();
  const op = useOpcionesEqu();
  const [equipo, setEquipo] = useState("");
  const lista = useListado<Uso>("/v1/equ/uso", { orden: "-used_on", filtros: { equipment_id: equipo, site: local } });
  const c = useDatos<Cifras>(`/v1/equ/cifras/08${qs({ site: local })}`);
  const barras = useDatos<{ label: string; value: Num }[]>(`/v1/equ/uso/por-equipo${qs({ site: local })}`);
  const [registrar, setRegistrar] = useState(false);
  const [lectura, setLectura] = useState(false);
  const registra = Boolean(op?.can.usage) && puede("EQU", "C");
  const cambio = () => { lista.recargar(); c.recargar(); barras.recargar(); olvidarOpcionesEqu(); };

  const columnas: Column<Uso>[] = [
    { key: "used_on", header: "Fecha", sortable: true, render: (u) => <span className="whitespace-nowrap">{fecha(u.used_on)}</span> },
    { key: "order_ref", header: "Orden", sortable: true, render: (u) => <span className="font-mono">{u.order_ref ?? "—"}</span> },
    { key: "equipment_code", header: "Equipo", sortable: true, cardTitle: true, render: (u) => <span><span className="font-mono font-semibold">{u.equipment_code}</span> · {u.equipment_name}</span> },
    { key: "hours", header: "Horas", sortable: true, align: "right", render: (u) => numero(u.hours, 1) },
    { key: "hourly_rate", header: "S/ por hora", align: "right", hideOnMobile: true, render: (u) => soles(u.hourly_rate) },
    { key: "cost", header: "Costo", sortable: true, align: "right", render: (u) => soles(u.cost) },
    { key: "recorded_by_name", header: "Registró", hideOnMobile: true, render: (u) => u.recorded_by_name ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Las horas de cada equipo en una orden de producción entran al costo de la orden con la carga por hora del equipo. Solo se registran equipos aptos: ni fuera de servicio ni con la calibración vencida."
        actions={registra && <>
          <Button icon={Gauge} disabled={!op} onClick={() => setLectura(true)}>Lectura de horómetro</Button>
          <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setRegistrar(true)}>Registrar horas</Button>
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Horas del mes" valor={c.datos ? `${numero(c.datos.hours, 1)} h` : undefined} detalle={c.datos ? `Desde el ${fecha(c.datos.from)}` : undefined} icono={Clock} />
        <CifraLink titulo="Costo de equipos cargado" valor={c.datos ? soles(c.datos.cost) : undefined} detalle="Va al costo de producción" icono={CircleDollarSign} />
        <CifraLink titulo="Órdenes con equipos" valor={c.datos ? numero(c.datos.orders) : undefined} detalle="Este mes" icono={Factory} />
        <CifraLink titulo="Equipos usados" valor={c.datos ? numero(c.datos.equipment) : undefined} detalle="Este mes" icono={Wrench} />
      </div>
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-[14px] font-semibold">Horas del mes por equipo</h2>
        <Barras filas={barras.datos ?? []} formato={(v) => `${numero(v, 1)} h`} />
      </section>
      <DataTable {...lista.tabla} columns={columnas} search={{ ...lista.tabla.search, placeholder: "Buscar equipo u orden…" }} empty="No hay horas registradas."
        toolbar={<FiltroSelect label="Equipo" value={equipo} onChange={setEquipo} options={opcionesEquipo(op, (e) => !SIN_HORAS.includes(e.category)).map((o) => ({ ...o, label: o.label.split(" · ")[0] }))} />} />
      {registrar && op && <RegistrarHoras op={op} onClose={() => setRegistrar(false)} onGuardado={() => { setRegistrar(false); cambio(); }} />}
      {lectura && op && <LecturaHorometro op={op} onClose={() => setLectura(false)} onGuardado={() => { setLectura(false); cambio(); }} />}
    </div>
  );
}

function RegistrarHoras({ op, onClose, onGuardado }: { op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ equipment_id: "", order_ref: "", hours: "", used_on: op.today });
  const apto = useDatos<Apto>(f.equipment_id ? `/v1/equ/equipos/${f.equipment_id}/apto${qs({ fecha: f.used_on })}` : null).datos;
  const eq = op.equipment.find((e) => e.id === f.equipment_id);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo="Registrar horas de uso" boton="Registrar" onClose={onClose}
      enviar={async () => {
        const u = await api<{ hours: Num; cost: Num }>("/v1/equ/uso", { method: "POST", body: { ...f, hours: num(f.hours) } });
        toast.ok(`${numero(u.hours, 1)} h registradas: ${soles(u.cost)} al costo de la orden`);
        onGuardado();
      }}>
      {(err) => <>
        <Field label="Equipo" required error={err.equipment_id} className="sm:col-span-2">
          <Select value={f.equipment_id} placeholder="Elegir" searchable options={opcionesEquipo(op, (e) => !SIN_HORAS.includes(e.category))} onChange={(x) => set("equipment_id", x.target.value)} />
        </Field>
        {eq && apto && <div className="sm:col-span-2">
          <Alert tone={apto.usable ? "ok" : "bad"}>{apto.usable ? `${eq.code} apto · ${soles(apto.hourly_rate)} por hora · horómetro ${numero(apto.hour_meter, 1)} h` : apto.message}</Alert>
        </div>}
        <Field label="Orden de producción" required error={err.order_ref} hint="Número de la orden de producción"><Input value={f.order_ref} maxLength={40} placeholder="OP01-0420" onChange={(x) => set("order_ref", x.target.value.toUpperCase())} /></Field>
        <Field label="Horas" required error={err.hours}><Input inputMode="decimal" suffix="h" value={f.hours} onChange={(x) => set("hours", x.target.value)} /></Field>
        <Field label="Fecha" required error={err.used_on}><Input type="date" value={f.used_on} max={op.today} onChange={(x) => set("used_on", x.target.value)} /></Field>
        {eq && num(f.hours) && <p className="self-end text-[13px] text-muted">Costo: <b className="text-ink">{soles((num(f.hours) ?? 0) * Number(eq.hourly_rate ?? 0))}</b></p>}
      </>}
    </Dialogo>
  );
}

function LecturaHorometro({ op, onClose, onGuardado }: { op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ equipment_id: "", hours: "" });
  const eq = op.equipment.find((e) => e.id === f.equipment_id);
  return (
    <Dialogo titulo="Lectura de horómetro" boton="Guardar lectura" onClose={onClose} aviso="La lectura no puede ser menor que la acumulada. Si un plan por horas ya toca, se avisa."
      enviar={async () => {
        const r = await api<{ equipment: { code: string; hour_meter: Num }; due_plans: string[] }>(`/v1/equ/equipos/${f.equipment_id}/horometro`, { method: "POST", body: { hours: num(f.hours) } });
        if (r.due_plans.length) toast.info(`Horómetro de ${r.equipment.code}: ${numero(r.equipment.hour_meter, 1)} h · toca «${r.due_plans[0]}»`);
        else toast.ok(`Horómetro de ${r.equipment.code}: ${numero(r.equipment.hour_meter, 1)} h`);
        onGuardado();
      }}>
      {(err) => <>
        <Field label="Equipo" required error={err.equipment_id} className="sm:col-span-2">
          <Select value={f.equipment_id} placeholder="Elegir" searchable options={opcionesEquipo(op, (e) => Number(e.hour_meter) > 0)} onChange={(x) => setF({ ...f, equipment_id: x.target.value })} />
        </Field>
        <Field label="Lectura" required error={err.hours} hint={eq ? `Acumulado: ${numero(eq.hour_meter, 1)} h` : undefined}>
          <Input inputMode="decimal" suffix="h" value={f.hours} onChange={(x) => setF({ ...f, hours: x.target.value })} />
        </Field>
      </>}
    </Dialogo>
  );
}
