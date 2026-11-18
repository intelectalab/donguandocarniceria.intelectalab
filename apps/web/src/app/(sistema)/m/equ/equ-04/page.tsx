"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CalendarClock, Scale, ShieldX } from "lucide-react";
import { Alert, Button, DataTable, PageHeader, StatusBadge, Tabs, type Column } from "@/components/ui";
import { fecha, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Apto, CifraLink, DiasVence, FormCalibracion, qs, resultado, useDatos, useOpcionesEqu } from "@/modulos/equ/comunes";
import { CALIBRACION, CATEGORIA, ESTADO, type Num } from "@/modulos/equ/tipos";

type Fila = {
  id: string; code: string; name: string; category: string; status: string; establishment_name: string; state: string; days: number | null; alert: boolean;
  valid_until: string | null; calibrated_on: string | null; certificate_number: string | null; result: string | null; provider_name: string | null;
  usable: boolean; rule: string | null; message: string | null;
};
type Calendario = { rows: Fila[]; summary: { blocked: number; expiring: number; alert: number; usable: number; alert_days: number; scales_ok: number; scales: number; scales_pct: Num } };
type Pestana = "TODOS" | "BLOCKED" | "EXPIRING" | "USABLE";

/** EQU-04 Calendario de calibraciones: balanzas y termómetros vencidos, por vencer en 30 días y vigentes. */
export default function CalendarioCalibraciones() {
  const { local, puede } = useSesion();
  const router = useRouter();
  const op = useOpcionesEqu();
  const [tab, setTab] = useState<Pestana>("TODOS");
  const [cat, setCat] = useState("");
  const { datos, error, recargar } = useDatos<Calendario>(`/v1/equ/calendario${qs({ site: local, category: cat })}`);
  const [calibrar, setCalibrar] = useState<string | null>(null);
  const s = datos?.summary;
  const filas = (datos?.rows ?? []).filter((f) => tab === "TODOS" || f.state === tab);
  const registra = Boolean(op?.can.calibrate) && puede("EQU", "C");

  const columnas: Column<Fila>[] = [
    { key: "code", header: "Equipo", cardTitle: true, render: (f) => <div className="min-w-[170px]"><p className="font-mono font-semibold">{f.code}</p><p className="text-[12px] text-muted">{f.name}</p></div> },
    { key: "category", header: "Categoría", render: (f) => CATEGORIA[f.category] ?? f.category },
    { key: "establishment_name", header: "Local", render: (f) => f.establishment_name },
    { key: "state", header: "Calibración", render: (f) => <StatusBadge status={f.state} labels={CALIBRACION} /> },
    { key: "valid_until", header: "Vigente hasta", render: (f) => <span className="whitespace-nowrap">{fecha(f.valid_until)}</span> },
    { key: "days", header: "Días", align: "right", render: (f) => <DiasVence d={f.days} /> },
    { key: "certificate_number", header: "Último certificado", hideOnMobile: true, render: (f) => f.certificate_number ? <span className="whitespace-nowrap"><span className="font-mono">{f.certificate_number}</span> {f.result && resultado(f.result)}</span> : "—" },
    { key: "usable", header: "Uso hoy", render: (f) => <span className="flex flex-wrap items-center gap-1"><Apto usable={f.usable} rule={f.rule} />{f.status !== "ACTIVE" && <StatusBadge status={f.status} labels={ESTADO} />}</span> },
    { key: "acciones", header: "", align: "right", hideInCard: true, render: (f) => registra &&
      <Button size="sm" variant={f.state === "BLOCKED" ? "primary" : "secondary"} onClick={(e) => { e.stopPropagation(); setCalibrar(f.id); }}>Calibrar</Button> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Balanzas y termómetros que exigen calibración. Se avisa ${s?.alert_days ?? 15} días antes del vencimiento (RN-EQU-08); con la calibración vencida no pesan ventas ni lotes, ni se usan en producción (RN-EQU-03).`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Vencidas o bloqueadas" valor={s ? String(s.blocked) : undefined} detalle="No se usan hasta calibrarlas" icono={ShieldX} tono={s?.blocked ? "bad" : "ok"} onClick={() => setTab("BLOCKED")} />
        <CifraLink titulo="Vencen en 30 días" valor={s ? String(s.expiring) : undefined} detalle="Programa su calibración" icono={CalendarClock} tono={s?.expiring ? "warn" : "ok"} onClick={() => setTab("EXPIRING")} />
        <CifraLink titulo={`Con aviso (≤ ${s?.alert_days ?? 15} días)`} valor={s ? String(s.alert) : undefined} detalle="Avisados a Calidad y al jefe" icono={BellRing} tono={s?.alert ? "warn" : undefined} />
        <CifraLink destacada titulo="Balanzas con calibración vigente" valor={s?.scales_pct != null ? porcentaje(s.scales_pct, 1) : undefined}
          detalle={s ? `${s.scales_ok} de ${s.scales} · KPI-EQU-02 · meta 100 %` : undefined} icono={Scale} tono={s && s.scales_ok === s.scales ? "ok" : "bad"} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "TODOS", label: "Todos", count: datos?.rows.length }, { key: "BLOCKED", label: "Vencidas", count: s?.blocked },
        { key: "EXPIRING", label: "Por vencer", count: s?.expiring }, { key: "USABLE", label: "Vigentes", count: s?.usable },
      ]} />
      <DataTable rows={filas} rowKey={(f) => f.id} columns={columnas} loading={!datos && !error} onRowClick={(f) => router.push(`/m/equ/equ-02?id=${f.id}`)}
        empty="No hay equipos en este grupo."
        toolbar={<div className="flex gap-1.5">
          {[["", "Todos"], ["SCALE", "Balanzas"], ["THERMOMETER", "Termómetros"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setCat(v)} aria-pressed={cat === v}
              className={`cursor-pointer rounded-full px-3 py-1 text-[12.5px] ${cat === v ? "bg-primary-soft font-medium text-primary" : "bg-surface-2 text-muted hover:text-ink"}`}>{l}</button>
          ))}
        </div>} />
      {calibrar && op && <FormCalibracion op={op} equipoId={calibrar} onClose={() => setCalibrar(null)} onGuardado={() => { setCalibrar(null); recargar(); }} />}
    </div>
  );
}
