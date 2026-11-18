"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, Gauge, Pencil, ShieldCheck, Wrench } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, PageHeader, Select, StatusBadge, Tabs, buttonClass, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import {
  CifraLink, FichaOrden, FormCalibracion, FormEquipo, Qr, VentanaQr, olvidarOpcionesEqu, resultado, urlDelQr, useDatos, useOpcionesEqu, useParametrosIniciales,
} from "@/modulos/equ/comunes";
import { CALIBRACION, CATEGORIA, ESTADO, ESTADO_ORDEN, ESTADO_PLAN, MOTIVO_FUERA, TIPO_ORDEN, type Calibracion, type Equipo, type Num, type Orden, type Plan } from "@/modulos/equ/tipos";

type Ficha = Equipo & {
  meter_readings: { at: string; hours: number; by: string }[];
  not_usable: { rule: string; msg: string } | null;
  calibration: { state: string; days: number | null; calibration: Calibracion | null };
  calibrations: Calibracion[]; orders: Orden[]; plans: Plan[];
  usage: { id: string; used_on: string; order_ref: string | null; hours: Num; hourly_rate: Num; cost: Num }[];
  temperature_point: { id: string; code: string; name: string; min_c: Num; max_c: Num } | null;
  totals: { maintenance_cost: Num; calibration_cost: Num; failures: number; downtime_hours: Num; usage_hours: Num; usage_cost: Num; accumulated_cost: Num };
  suggested_rate: { rate: Num; monthly_depreciation: Num; monthly_maintenance: Num; monthly_hours: Num };
};
type Pestana = "calibraciones" | "mantenimiento" | "planes" | "uso";

/** EQU-02 Ficha del equipo: compra, vida útil, carga por hora, potencia, manual; historial de calibraciones, mantenimientos, fallas, horas de uso y costo acumulado. */
export default function FichaEquipo() {
  const { puede } = useSesion();
  const p = useParametrosIniciales();
  const op = useOpcionesEqu();
  const [elegido, setElegido] = useState<string | null>(null);
  const id = elegido ?? p?.get("id") ?? op?.equipment[0]?.id ?? null;
  const { datos: e, error, recargar } = useDatos<Ficha>(id ? `/v1/equ/equipos/${id}` : null);
  const [tab, setTab] = useState<Pestana>("calibraciones");
  const [editando, setEditando] = useState(false);
  const [calibrando, setCalibrando] = useState(false);
  const [orden, setOrden] = useState<string | null>(null);
  const [qr, setQr] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const gestiona = Boolean(op?.can.manage) && puede("EQU", "E");
  const elegir = (v: string) => {
    setElegido(v);
    try { window.history.replaceState(null, "", `?id=${v}`); } catch { /* solo en pantalla */ }
  };
  async function aplicarCarga() {
    if (!e?.suggested_rate.rate) return;
    setAplicando(true);
    try {
      await api(`/v1/equ/equipos/${e.id}/carga`, { method: "PUT", body: { hourly_rate: e.suggested_rate.rate } });
      toast.ok(`Carga por hora de ${e.code}: ${soles(e.suggested_rate.rate)}`);
      olvidarOpcionesEqu(); recargar();
    } catch (err) { toast.error(mensajeDe(err)); } finally { setAplicando(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Datos de compra, vida útil, carga por hora y potencia, con el historial de calibraciones, mantenimientos, fallas, horas de uso y su costo acumulado."
        actions={e && <>
          {gestiona && <Button icon={Pencil} onClick={() => setEditando(true)}>Editar</Button>}
          {op?.can.calibrate && e.requires_calibration && <Button onClick={() => setCalibrando(true)}>Registrar calibración</Button>}
          {op?.can.report && e.status !== "RETIRED" && <Link className={buttonClass("danger")} href={`/m/equ/equ-07?id=${e.id}`}>Reportar falla</Link>}
        </>} />
      <div className="w-full sm:max-w-[460px]">
        <Select aria-label="Equipo" value={id ?? ""} placeholder="Elegir equipo" searchable onChange={(x) => elegir(x.target.value)}
          options={(op?.equipment ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {e && <>
        {e.not_usable
          ? <Alert tone="bad" title={`${e.not_usable.rule}: no se usa`}>{e.not_usable.msg}</Alert>
          : <Alert tone="ok" title="Apto para usarse hoy">{e.requires_calibration && e.calibration.calibration ? `Calibración conforme vigente hasta el ${fecha(e.calibration.calibration.valid_until)}.` : `${e.code} está activo.`}</Alert>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CifraLink destacada titulo="Costo acumulado" valor={soles(e.totals.accumulated_cost)} detalle={`Mantenimiento ${soles(e.totals.maintenance_cost)} · calibración ${soles(e.totals.calibration_cost)}`} icono={Wrench} />
          <CifraLink titulo="Fallas" valor={numero(e.totals.failures)} detalle={`${numero(e.totals.downtime_hours, 1)} h fuera de servicio`} icono={AlertTriangle} tono={e.totals.failures ? "warn" : "ok"}
            onClick={() => setTab("mantenimiento")} />
          <CifraLink titulo="Horas de uso" valor={`${numero(e.totals.usage_hours, 1)} h`} detalle={`${soles(e.totals.usage_cost)} cargado a producción`} icono={Clock} onClick={() => setTab("uso")} />
          <CifraLink titulo="Horómetro" valor={Number(e.hour_meter) ? `${numero(e.hour_meter, 1)} h` : "—"} detalle={e.meter_readings[0] ? `Última lectura ${fecha(e.meter_readings[0].at)}` : "Sin lecturas"} icono={Gauge} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold">{e.code} · {e.name}</h2>
              <StatusBadge status={e.status} labels={ESTADO} />
              {e.status === "OUT_OF_SERVICE" && e.oos_reason && <Badge tone="bad">Por {MOTIVO_FUERA[e.oos_reason] ?? e.oos_reason} desde {fecha(e.oos_since)}</Badge>}
              {e.requires_calibration && <StatusBadge status={e.calibration.state} labels={CALIBRACION} />}
            </div>
            <DetailList items={[
              { label: "Categoría", value: CATEGORIA[e.category] ?? e.category }, { label: "Local", value: e.establishment_name },
              { label: "Almacén asociado", value: e.warehouse_code ? `${e.warehouse_code} · ${e.warehouse_name}` : "—" },
              { label: "Marca y modelo", value: [e.brand_name, e.model].filter(Boolean).join(" · ") || "—" }, { label: "N.º de serie", value: e.serial_number ?? "—" },
              { label: "Capacidad", value: e.capacity ?? "—" }, { label: "Potencia", value: e.power_kw != null ? `${numero(e.power_kw, 2)} kW` : "—" },
              { label: "Compra", value: e.purchase_date ? `${fecha(e.purchase_date)} · ${soles(e.purchase_cost)}` : "—" },
              { label: "Vida útil", value: e.useful_life_months ? `${e.useful_life_months} meses` : "—" },
              { label: "Carga por hora", value: soles(e.hourly_rate) }, { label: "Centro de costo", value: e.cost_center_code ? `${e.cost_center_code} · ${e.cost_center_name}` : "—" },
              { label: "Exige calibración", value: e.requires_calibration ? "Sí" : "No" },
              ...(e.category === "COLD_ROOM" || e.category === "FREEZER" ? [{ label: "Punto de temperatura (CAL-04)", value: e.temperature_point
                ? `${e.temperature_point.code} · ${numero(e.temperature_point.min_c, 0)} a ${numero(e.temperature_point.max_c, 0)} °C` : <span className="text-bad">Sin punto: no pasa a activo (RN-EQU-11)</span> }] : []),
              { label: "Manual", value: e.manual_url ?? "—" }, { label: "Fotos", value: e.photos.length ? e.photos.join(", ") : "—" },
              ...(e.notes ? [{ label: "Notas", value: e.notes }] : []),
            ]} />
          </section>
          <section className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface p-4 text-center shadow-card">
            <button type="button" className="cursor-pointer" onClick={() => setQr(true)} aria-label="Ver QR grande"><Qr texto={urlDelQr(e.qr_code)} tamano={140} titulo={`QR de ${e.code}`} /></button>
            <span className="font-mono text-[13px] font-semibold">{e.qr_code}</span>
            <div className="mt-2 w-full border-t border-line pt-3 text-left text-[12.5px]">
              <p className="font-medium">Carga por hora sugerida (RN-EQU-09)</p>
              <p className="text-[18px] font-semibold tabular-nums">{e.suggested_rate.rate ? soles(e.suggested_rate.rate) : "—"}</p>
              <p className="text-muted">({e.suggested_rate.monthly_depreciation ? soles(e.suggested_rate.monthly_depreciation) : "sin compra"} al mes + {soles(e.suggested_rate.monthly_maintenance)} de mantenimiento) / {numero(e.suggested_rate.monthly_hours, 1)} h de uso al mes, últimos 90 días.</p>
              {gestiona && e.suggested_rate.rate && Number(e.suggested_rate.rate) !== Number(e.hourly_rate) &&
                <Button size="sm" className="mt-2 w-full" loading={aplicando} onClick={aplicarCarga}>Aplicar {soles(e.suggested_rate.rate)}</Button>}
            </div>
          </section>
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: "calibraciones", label: "Calibraciones", count: e.calibrations.length }, { key: "mantenimiento", label: "Mantenimientos y fallas", count: e.orders.length },
          { key: "planes", label: "Planes preventivos", count: e.plans.length }, { key: "uso", label: "Uso y horómetro", count: e.usage.length },
        ]} />
        {tab === "calibraciones" && <DataTable rows={e.calibrations} rowKey={(c) => c.id} empty={e.requires_calibration ? "Sin calibraciones: no se usa hasta calibrarlo." : "Este equipo no exige calibración."} columns={[
          { key: "calibrated_on", header: "Fecha", cardTitle: true, render: (c) => fecha(c.calibrated_on) }, { key: "valid_until", header: "Vigente hasta", render: (c) => fecha(c.valid_until) },
          { key: "certificate_number", header: "Certificado", render: (c) => <span className="font-mono">{c.certificate_number}</span> },
          { key: "provider_name", header: "Proveedor", hideOnMobile: true, render: (c) => c.provider_name ?? "—" },
          { key: "max_error_g", header: "Error máx.", align: "right", render: (c) => c.max_error_g != null ? numero(c.max_error_g, 2) : "—" },
          { key: "result", header: "Resultado", render: (c) => resultado(c.result) }, { key: "cost", header: "Costo", align: "right", render: (c) => soles(c.cost) },
          { key: "recorded_by", header: "Registró", hideOnMobile: true, render: (c) => c.recorded_by },
        ]} />}
        {tab === "mantenimiento" && <DataTable rows={e.orders} rowKey={(o) => o.id} onRowClick={(o) => setOrden(o.id)} empty="Sin órdenes de mantenimiento." columns={[
          { key: "number", header: "Orden", cardTitle: true, render: (o) => <span className="font-mono font-semibold">{o.number}</span> },
          { key: "kind", header: "Tipo", render: (o) => <StatusBadge status={o.kind} labels={TIPO_ORDEN} /> },
          { key: "description", header: "Falla o actividad", render: (o) => <span className="line-clamp-2 min-w-[180px]">{o.description}</span> },
          { key: "reported_at", header: "Reportada", render: (o) => fechaHora(o.reported_at) },
          { key: "downtime_hours", header: "Parada", align: "right", render: (o) => o.downtime_hours != null ? `${numero(o.downtime_hours, 1)} h` : "—" },
          { key: "total_cost", header: "Costo", align: "right", render: (o) => soles(o.total_cost) },
          { key: "status", header: "Estado", render: (o) => <StatusBadge status={o.status} labels={ESTADO_ORDEN} /> },
        ]} />}
        {tab === "planes" && <DataTable rows={e.plans} rowKey={(x) => x.id} empty="Sin planes preventivos." columns={[
          { key: "activity", header: "Actividad", cardTitle: true, render: (x) => x.activity },
          { key: "freq", header: "Frecuencia", render: (x) => x.frequency_days ? `Cada ${x.frequency_days} días` : `Cada ${x.frequency_hours} h de uso` },
          { key: "next", header: "Próxima", render: (x) => x.frequency_days ? fecha(x.next_due_on) : `${numero(x.next_due_hours, 0)} h` },
          { key: "last_done_on", header: "Última", render: (x) => fecha(x.last_done_on) },
          { key: "state", header: "Estado", render: (x) => <StatusBadge status={x.state} labels={ESTADO_PLAN} /> },
        ]} />}
        {tab === "uso" && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <DataTable rows={e.usage} rowKey={(u) => u.id} empty="Sin horas registradas." columns={[
            { key: "used_on", header: "Fecha", cardTitle: true, render: (u) => fecha(u.used_on) },
            { key: "order_ref", header: "Orden de producción", render: (u) => <span className="font-mono">{u.order_ref ?? "—"}</span> },
            { key: "hours", header: "Horas", align: "right", render: (u) => numero(u.hours, 1) },
            { key: "cost", header: "Costo", align: "right", render: (u) => soles(u.cost) },
          ]} />
          <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="mb-2 text-[14px] font-semibold">Lecturas de horómetro</h2>
            {e.meter_readings.length ? <ul className="space-y-1.5 text-[13px]">{e.meter_readings.map((m, i) => <li key={i} className="flex justify-between gap-2">
              <span>{fechaHora(m.at)}<span className="block text-[12px] text-muted">{m.by}</span></span><span className="tabular-nums font-medium">{numero(m.hours, 1)} h</span></li>)}</ul>
              : <p className="text-[13px] text-muted">Sin lecturas.</p>}
            <Link href="/m/equ/equ-08" className="mt-3 inline-flex items-center gap-1 text-[13px] text-primary"><ShieldCheck size={14} aria-hidden="true" /> Registrar en Uso del equipo</Link>
          </section>
        </div>}
      </>}
      {editando && e && op && <FormEquipo e={e} op={op} onClose={() => setEditando(false)} onGuardado={() => { setEditando(false); recargar(); }} />}
      {calibrando && e && op && <FormCalibracion op={op} equipoId={e.id} onClose={() => setCalibrando(false)} onGuardado={() => { setCalibrando(false); recargar(); }} />}
      {orden && <FichaOrden id={orden} op={op} onClose={() => setOrden(null)} onCambio={recargar} />}
      {qr && e && <VentanaQr e={e} onClose={() => setQr(false)} />}
    </div>
  );
}
