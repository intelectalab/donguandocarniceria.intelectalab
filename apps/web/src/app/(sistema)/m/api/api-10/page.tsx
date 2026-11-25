"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertOctagon, Ban, CalendarClock, Gauge, TrendingUp } from "lucide-react";
import { Alert, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje } from "@/lib/formato";
import { BarrasApiladas } from "@/modulos/int/graficos";

type Opcion = { value: string; label: string };
type ClaveUso = { id: string; name: string; prefix: string; llamadas: number; err_4xx: number; err_5xx: number; rechazadas: number; rechazadas_pct: number | null; ultimo: string | null };
type Panel = {
  desde: string; hasta: string; entorno: string; hoy: string; limite: number | null; por_minuto: number;
  cifras: { llamadas: number; hoy: number; err_4xx: number; err_5xx: number; rechazadas: number; rechazadas_pct: number | null; pico: number };
  dias: { dia: string; llamadas: number; ok: number; err_4xx: number; err_5xx: number; rechazadas: number }[]; claves: ClaveUso[];
  rutas: { ruta: string; llamadas: number }[]; opciones: { claves: Opcion[] }; puede_parametros: boolean;
};

/** API-10 Uso de la API: llamadas por día y por clave frente al límite de la empresa, errores 4xx y 5xx y rechazos por límite. */
export default function UsoDeLaApi() {
  const [f, setF] = useState({ entorno: "LIVE", clave: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [p, setP] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [buscarRuta, setBuscarRuta] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  useEffect(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Panel>(`/v1/api/uso?${q}`).then((r) => { setP(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f]);
  const rutas = useMemo(() => {
    const t = buscarRuta.trim().toLowerCase();
    return (p?.rutas ?? []).filter((r) => t.length < 2 || r.ruta.toLowerCase().includes(t));
  }, [p, buscarRuta]);

  const c = p?.cifras;
  const usoHoy = p?.limite ? (c?.hoy ?? 0) / p.limite : null;
  const colClaves: Column<ClaveUso>[] = [
    { key: "name", header: "Clave", cardTitle: true, render: (k) => <Link href={`/m/api/api-03?id=${k.id}`} className="font-semibold text-ink hover:text-primary"><span>{k.name}</span><p className="font-mono text-[11.5px] font-normal text-muted">{k.prefix}…</p></Link> },
    { key: "llamadas", header: "Llamadas", align: "right", render: (k) => numero(k.llamadas) },
    { key: "err_4xx", header: "Errores 4xx", align: "right", render: (k) => numero(k.err_4xx) },
    { key: "err_5xx", header: "Errores 5xx", align: "right", render: (k) => k.err_5xx ? <span className="font-semibold text-bad">{numero(k.err_5xx)}</span> : "0" },
    { key: "rechazadas", header: "Rechazadas por límite", align: "right", render: (k) => k.rechazadas ? <span className="font-semibold text-warn">{numero(k.rechazadas)} ({porcentaje(k.rechazadas_pct, 2)})</span> : "0" },
    { key: "ultimo", header: "Último día con uso", hideOnMobile: true, render: (k) => k.ultimo ? fecha(k.ultimo) : "—" },
  ];
  const colRutas: Column<{ ruta: string; llamadas: number }>[] = [
    { key: "ruta", header: "Operación", cardTitle: true, render: (r) => <span className="font-mono text-[12.5px] text-ink">{r.ruta.replace(/^(\w+) /, "$1 /api/publica/v1")}</span> },
    { key: "llamadas", header: "Llamadas", align: "right", render: (r) => numero(r.llamadas) },
    { key: "pct", header: "Del total", align: "right", render: (r) => c?.llamadas ? porcentaje((r.llamadas / c.llamadas) * 100, 1) : "—" },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description="Cuántas llamadas hace cada sistema conectado, cuántas fallan y cuántas se rechazan por pasar el límite del día de tu empresa o la ráfaga por minuto de cada clave. Las rechazadas por límite no consumen el límite del día." />
      {error && <Alert tone="bad">{error}</Alert>}
      {p && c && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Cifra titulo="Llamadas de hoy" valor={numero(c.hoy)} icono={Gauge} destacada detalle={p.limite ? `de ${numero(p.limite)} del día` : "sin límite diario"} />
            <Cifra titulo="Llamadas del período" valor={numero(c.llamadas)} icono={Activity} detalle={`${fecha(p.desde)} al ${fecha(p.hasta)}`} />
            <Cifra titulo="Día con más llamadas" valor={numero(c.pico)} icono={TrendingUp} />
            <Cifra titulo="Errores 4xx" valor={numero(c.err_4xx)} icono={AlertOctagon} tono={c.err_4xx ? "warn" : undefined} detalle="Sin contar los rechazos por límite" />
            <Cifra titulo="Errores 5xx" valor={numero(c.err_5xx)} icono={AlertOctagon} tono={c.err_5xx ? "bad" : "ok"} detalle="Fallas nuestras" />
            <Cifra titulo="Rechazadas por límite" valor={c.rechazadas_pct === null ? "—" : porcentaje(c.rechazadas_pct, 2)} icono={Ban} tono={c.rechazadas ? "warn" : "ok"} detalle={`${numero(c.rechazadas)} de ${numero(c.llamadas)}`} />
          </div>
          {usoHoy !== null && usoHoy >= 0.8 && <Alert tone="warn">Hoy ya va el {porcentaje(usoHoy * 100, 0)} del límite del día. Al llegar, las llamadas responden 429 hasta la medianoche.</Alert>}
          <Alert tone="info">
            Límite del día: {p.limite ? `${numero(p.limite)} llamadas en producción` : "sin límite"}. Ráfaga: {numero(p.por_minuto)} llamadas por minuto por clave.
            {p.puede_parametros && <> Se cambian en <Link href="/m/plt/plt-10" className="font-semibold underline">Parámetros</Link>.</>}
          </Alert>
          <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-ink">Llamadas por día</h2>
              <div className="flex flex-wrap items-center gap-2">
                <FiltroSelect etiqueta="Entorno" vacio="Producción" ancho={150} value={f.entorno === "LIVE" ? "" : f.entorno} onChange={(v) => setF({ ...f, entorno: v || "LIVE", clave: "" })} options={[{ value: "TEST", label: "Pruebas" }]} />
                <FiltroSelect etiqueta="Clave" todos="todas" ancho={240} value={f.clave} onChange={(v) => setF({ ...f, clave: v })} options={p.opciones.claves} />
                <FiltroFecha etiqueta="Desde" visible value={f.desde || p.desde} max={f.hasta || p.hasta} onChange={(v) => setF({ ...f, desde: v })} />
                <FiltroFecha etiqueta="Hasta" visible value={f.hasta || p.hasta} min={f.desde || p.desde} max={p.hoy} onChange={(v) => setF({ ...f, hasta: v })} />
              </div>
            </div>
            <BarrasApiladas titulo="Llamadas por día" dias={p.dias.map((d) => d.dia)} series={[
              { nombre: "Correctas (2xx)", clase: "bg-ok", valores: p.dias.map((d) => d.ok) },
              { nombre: "Errores 4xx", clase: "bg-warn", valores: p.dias.map((d) => d.err_4xx) },
              { nombre: "Rechazadas por límite (429)", clase: "bg-bad", valores: p.dias.map((d) => d.rechazadas) },
              { nombre: "Errores 5xx", clase: "bg-muted", valores: p.dias.map((d) => d.err_5xx) },
            ]} />
          </section>
          <section className="grid gap-2">
            <h2 className="text-[14px] font-semibold text-ink">Por clave</h2>
            <DataTable rowKey={(k) => k.id} columns={colClaves} rows={p.claves} empty="Ninguna clave hizo llamadas en el período."
              search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar clave por nombre o prefijo…" }} />
          </section>
          <section className="grid gap-2">
            <h2 className="text-[14px] font-semibold text-ink">Operaciones más usadas</h2>
            <DataTable rowKey={(r) => r.ruta} columns={colRutas} rows={rutas} empty="Sin llamadas en el período."
              search={{ value: buscarRuta, onChange: setBuscarRuta, placeholder: "Buscar operación…" }} />
          </section>
        </>
      )}
      {p && p.claves.length === 0 && c?.llamadas === 0 && <p className="flex items-center gap-2 text-[13px] text-muted"><CalendarClock size={15} />Cuando un sistema use una clave, sus llamadas aparecerán aquí.</p>}
    </div>
  );
}
