"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Ban, CheckCircle2, ClipboardList, Gauge, PackageX, Scale, ScanLine, Timer, Truck } from "lucide-react";
import { Alert, Badge, Cifra, FiltroFecha, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Avance, Seccion, Vacio, useDatos } from "@/modulos/pre/comunes";
import { OLA, R, TAREA, hoyLima } from "@/modulos/pre/tipos";

type Dia = {
  fecha: string; hora: string; es_hoy: boolean;
  olas: { id: string; numero: string; estado: string; local: string; franja: string; pedidos: number; verificados: number; avance: number; atrasados: number }[];
  tareas: { id: string; order_id: string; pedido: string; cliente: string | null; ola: string; estado: string; estado_pedido: string; franja: string | null; ruta: string | null; parada: number | null; preparador: string | null; avance: number; listo_a: string | null; atrasado: boolean; stock_error: string | null }[];
  preparadores: { nombre: string; pedidos: number; terminados: number; en_armado: number }[];
  cifras: { pedidos: number; pendientes: number; en_armado: number; armados: number; verificados: number; atrasados: number; bloqueos: number };
};
type Kpis = {
  mes: string; por_hora: number | null; verificados: number; por_preparador: { nombre: string; pedidos: number; por_hora: number | null }[]; mediana_min: number | null;
  entregados: number; con_error: number; error_pct: number | null; lineas: number; lineas_escaneadas_pct: number | null; bloqueos: number;
  bloqueos_por_motivo: { motivo: string; n: number }[]; bloqueos_por_preparador: { nombre: string; n: number }[]; desvio_peso_pct: number | null;
  a_tiempo_pct: number | null; con_franja: number;
};

const minutos = (m: number | null) => (m == null ? "—" : m < 60 ? `${numero(m)} min` : `${numero(Math.floor(m / 60))} h ${numero(m % 60)} min`);

/** PRE-11 Tablero de preparación: avance de las olas, pedidos atrasados, preparadores y los indicadores del mes (KPI-PRE-01 a 07). */
export default function Tablero() {
  const [tab, setTab] = useState<"DIA" | "MES">("DIA");
  return (
    <div className="space-y-5">
      <PageHeader description="Cómo va la preparación del día y los indicadores del mes." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "DIA", label: "Día" }, { key: "MES", label: "Indicadores del mes" }]} />
      {tab === "DIA" ? <Hoy /> : <Mes />}
    </div>
  );
}

function Hoy() {
  const router = useRouter();
  const { marca, local } = useSesion();
  const [dia, setDia] = useState(hoyLima());
  const p = new URLSearchParams({ fecha: dia, ...(local !== "ALL" ? { establishment_id: local } : {}), ...(marca !== "ALL" ? { brand: marca } : {}) });
  const { datos: d, error, cargando } = useDatos<Dia>(`/v1/pre/tablero?${p}`);
  const c = d?.cifras;
  const atrasadas = (d?.tareas ?? []).filter((t) => t.atrasado || t.stock_error);

  return (
    <div className="space-y-5">
      <FiltroFecha etiqueta="Fecha de entrega" value={dia} onChange={(v) => setDia(v || hoyLima())} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Pedidos en olas" icono={ClipboardList} destacada valor={c ? numero(c.pedidos) : undefined} detalle={c ? `${c.pendientes} pendientes · ${c.en_armado} en armado` : ""} />
        <Cifra titulo="Verificados" icono={CheckCircle2} valor={c ? numero(c.verificados) : undefined} detalle={c ? `${c.armados} armados por verificar` : ""} tono={c && c.pedidos && c.verificados === c.pedidos ? "ok" : undefined} />
        <Cifra titulo="Atrasados" icono={AlarmClock} valor={c ? numero(c.atrasados) : undefined} detalle={d?.es_hoy ? `A las ${d.hora}` : "Según la franja"} tono={c ? (c.atrasados ? "bad" : "ok") : undefined} />
        <Cifra titulo="Lecturas bloqueadas" icono={Ban} valor={c ? numero(c.bloqueos) : undefined} detalle="Del día" tono={c && c.bloqueos ? "warn" : undefined} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando && !d ? <Vacio>Cargando…</Vacio> : d && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Seccion titulo="Olas">
            {d.olas.length === 0 ? <Vacio>No hay olas liberadas para esta fecha.</Vacio> : (
              <ul className="space-y-3">
                {d.olas.map((w) => (
                  <li key={w.id} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="text-ink"><b>{w.numero}</b> · {w.franja} · {w.verificados}/{w.pedidos} verificados</span>
                      <span className="flex items-center gap-1.5">{w.atrasados > 0 && <Badge tone="bad">{w.atrasados} atrasado(s)</Badge>}<StatusBadge status={w.estado} labels={OLA} /></span>
                    </div>
                    <Avance valor={w.avance} tono={w.atrasados ? "bad" : undefined} />
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          <Seccion titulo="Preparadores">
            {d.preparadores.length === 0 ? <Vacio>Nadie empezó a armar todavía.</Vacio> : (
              <ul className="divide-y divide-line">
                {d.preparadores.map((x) => (
                  <li key={x.nombre} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                    <span className="text-ink">{x.nombre}</span>
                    <span className="text-muted">{x.terminados} terminados · {x.en_armado} en armado</span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          <Seccion titulo="Atrasados y con problemas" className="lg:col-span-2">
            {atrasadas.length === 0 ? <Vacio>Ningún pedido atrasado.</Vacio> : (
              <ul className="divide-y divide-line">
                {atrasadas.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => router.push(`${R.ticket}?id=${t.id}`)} className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 py-2.5 text-left">
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium text-ink">{t.pedido} · {t.cliente}</span>
                        <span className="block text-[12px] text-muted">{t.ola} · franja {t.franja ?? "—"} · listo a las {t.listo_a ?? "—"}{t.preparador ? ` · ${t.preparador}` : ""}</span>
                        {t.stock_error && <span className="block text-[12px] text-bad">Stock: {t.stock_error}</span>}
                      </span>
                      <span className="flex items-center gap-2">{t.atrasado && <Badge tone="bad">Atrasado</Badge>}<StatusBadge status={t.estado} labels={TAREA} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>
      )}
    </div>
  );
}

function Mes() {
  const { local } = useSesion();
  const [mes, setMes] = useState(hoyLima().slice(0, 7));
  const { datos: k, error, cargando } = useDatos<Kpis>(`/v1/pre/kpis?mes=${mes}${local !== "ALL" ? `&establishment_id=${local}` : ""}`);

  return (
    <div className="space-y-5">
      <FiltroFecha etiqueta="Mes" tipo="month" value={mes} onChange={(v) => setMes(v || hoyLima().slice(0, 7))} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando && !k ? <Vacio>Cargando…</Vacio> : k && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Pedidos por hora" icono={Gauge} destacada valor={k.por_hora != null ? numero(k.por_hora, 1) : "—"} detalle={`${numero(k.verificados)} verificados (KPI-PRE-01)`} />
            <Cifra titulo="Armado a verificado" icono={Timer} valor={minutos(k.mediana_min)} detalle="Mediana (KPI-PRE-02)" />
            <Cifra titulo="Pedidos con error" icono={PackageX} valor={porcentaje(k.error_pct, 2)} detalle={`${k.con_error} de ${numero(k.entregados)} entregados (KPI-PRE-03)`} tono={k.error_pct != null ? (k.error_pct > 1 ? "bad" : "ok") : undefined} />
            <Cifra titulo="Líneas escaneadas" icono={ScanLine} valor={porcentaje(k.lineas_escaneadas_pct, 1)} detalle={`${numero(k.lineas)} líneas (KPI-PRE-04)`} tono={k.lineas_escaneadas_pct != null ? (k.lineas_escaneadas_pct >= 99 ? "ok" : "warn") : undefined} />
            <Cifra titulo="Lecturas bloqueadas" icono={Ban} valor={numero(k.bloqueos)} detalle="Errores evitados (KPI-PRE-05)" />
            <Cifra titulo="Desvío de peso" icono={Scale} valor={porcentaje(k.desvio_peso_pct, 1)} detalle="Promedio real vs estimado (KPI-PRE-06)" />
            <Cifra titulo="Listos a tiempo" icono={Truck} valor={porcentaje(k.a_tiempo_pct, 1)} detalle={`${numero(k.con_franja)} con franja (KPI-PRE-07)`} tono={k.a_tiempo_pct != null ? (k.a_tiempo_pct >= 95 ? "ok" : "warn") : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Barras titulo="Pedidos por hora de cada preparador" filas={k.por_preparador.map((x) => ({ k: x.nombre, v: x.por_hora ?? 0, t: `${numero(x.por_hora ?? 0, 1)} /h · ${x.pedidos}` }))} />
            <Barras titulo="Bloqueos por motivo" filas={k.bloqueos_por_motivo.map((x) => ({ k: x.motivo, v: x.n, t: numero(x.n) }))} />
            <Barras titulo="Bloqueos por preparador" filas={k.bloqueos_por_preparador.map((x) => ({ k: x.nombre, v: x.n, t: numero(x.n) }))} />
          </div>
        </>
      )}
    </div>
  );
}

function Barras({ titulo, filas }: { titulo: string; filas: { k: string; v: number; t: string }[] }) {
  const max = Math.max(1, ...filas.map((f) => f.v));
  return (
    <Seccion titulo={titulo}>
      {filas.length === 0 ? <Vacio>Sin datos en el mes.</Vacio> : (
        <ul className="space-y-2.5">
          {filas.map((f) => (
            <li key={f.k} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]"><span className="truncate text-ink">{f.k}</span><span className="shrink-0 font-semibold text-ink tabular-nums">{f.t}</span></div>
              <div className="h-2 rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${(f.v / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}
