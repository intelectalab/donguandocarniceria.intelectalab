"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Ban, CalendarClock, Clock, Percent, Receipt, Scale, ShoppingBag, Truck, Wallet } from "lucide-react";
import { Badge, Cifra, Input, StatusBadge, Tabs, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio } from "@/modulos/ped/Seccion";
import { CANALES, ESTADOS, ORDEN_ESTADOS, etiqueta, franjaTexto, hoyLima } from "@/modulos/ped/tipos";

type Corto = { id: string; number: string; status: string; slot_from: string | null; slot_to: string | null; estimated_total: string; fulfillment: string; cliente: string | null; zona: string | null };
type Dia = {
  fecha: string; es_hoy: boolean; hora: string; por_estado: Record<string, number>;
  por_franja: { id: string; franja: string; local: string; zona: string | null; corte: string; paso_corte: boolean; cupo: number; ocupados: number; borradores: number; estados: Record<string, number> }[];
  sin_preparar: (Corto & { cutoff: string })[]; en_ruta: (Corto & { repartidor: string | null })[]; sin_franja: number; total: number;
};
type Kpis = {
  mes: string; ventas: number; por_canal: { canal: string; n: number; ventas: string }[]; por_marca: { marca: string; n: number; ventas: string }[]; ticket: number;
  entregados: number; confirmados: number; incompletos_pct: number; peso_pct: number; cancelados_pct: number; cancelados_por_motivo: { motivo: string; n: number }[];
  reprogramados_pct: number; descuentos_pct: number; por_dia: number; avisos_pct: number; confirmacion_min: number | null;
};

/** PED-14 Tablero del día: pedidos de hoy por franja y estado, confirmados sin preparar pasada la hora de corte y pedidos en ruta; y las cifras del mes. */
export default function Tablero() {
  const [tab, setTab] = useState<"dia" | "mes">("dia");
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "dia", label: "Hoy" }, { key: "mes", label: "Cifras del mes" }]} />
      {tab === "dia" ? <DelDia /> : <DelMes />}
    </div>
  );
}

function DelDia() {
  const router = useRouter();
  const { marca, local } = useSesion();
  const [dia, setDia] = useState(hoyLima());
  const [d, setD] = useState<Dia | null>(null);

  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams({ fecha: dia, brand: marca });
    if (local !== "ALL") p.set("establishment_id", local);
    const cargar = () => api<Dia>(`/v1/ped/tablero?${p}`).then((r) => vigente && setD(r)).catch((e) => toast.error(mensajeDe(e)));
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => { vigente = false; clearInterval(t); };
  }, [dia, marca, local]);

  const abrir = (id: string) => router.push(`/m/ped/ped-03?id=${id}`);
  const actual = d?.fecha === dia ? d : null;
  const pe = actual?.por_estado ?? {};
  const activos = Object.entries(pe).filter(([s]) => !["DRAFT", "CANCELLED"].includes(s)).reduce((a, [, n]) => a + Number(n), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" aria-label="Fecha" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} className="w-[160px]" />
        {actual?.es_hoy && <span className="text-[12.5px] text-muted">Actualizado a las {actual.hora} · se refresca cada minuto</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Pedidos del día" icono={ShoppingBag} destacada valor={actual ? numero(activos) : undefined} detalle={actual ? `${numero(pe.DRAFT ?? 0)} borradores aparte` : ""} />
        <Cifra titulo="Por entregar" icono={Wallet} valor={actual ? soles(actual.total) : undefined} detalle="Total de los pedidos del día" />
        <Cifra titulo="Sin preparar tras el corte" icono={AlarmClock} valor={actual ? numero(actual.sin_preparar.length) : undefined} tono={actual ? (actual.sin_preparar.length ? "bad" : "ok") : undefined} detalle="Confirmados que no pasan a preparación" />
        <Cifra titulo="En ruta" icono={Truck} valor={actual ? numero(actual.en_ruta.length) : undefined} detalle={actual?.sin_franja ? `${actual.sin_franja} sin franja (mostrador o provincia)` : ""} />
      </div>

      {actual && (
        <div className="flex flex-wrap gap-1.5">
          {ORDEN_ESTADOS.filter((s) => pe[s]).map((s) => <span key={s} className="rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-ink">{ESTADOS[s][0]} <b>{pe[s]}</b></span>)}
        </div>
      )}

      <Seccion titulo="Por franja">
        {!actual ? <Vacio>Cargando…</Vacio> : actual.por_franja.length === 0 ? <Vacio>No hay franjas activas.</Vacio> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {actual.por_franja.map((f) => {
              const pct = f.cupo ? Math.min(100, Math.round((f.ocupados / f.cupo) * 100)) : 0;
              return (
                <div key={f.id} className="rounded-[10px] border border-line bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{f.franja}</span>
                    <span className="text-[12px] text-muted">{f.ocupados}/{f.cupo}</span>
                  </div>
                  <div className="text-[12px] text-muted">{f.local}{f.zona ? ` · ${f.zona}` : ""} · corte {f.corte} {f.paso_corte && <Badge tone="warn">pasó el corte</Badge>}</div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={`${pct}% del cupo`}>
                    <div className={`h-full ${pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ok"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ORDEN_ESTADOS.filter((s) => f.estados[s]).map((s) => <span key={s} className="text-[11.5px] text-muted">{ESTADOS[s][0]} {f.estados[s]} ·</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Seccion>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Confirmados sin preparar pasada la hora de corte">
          <Lista filas={actual?.sin_preparar} vacio="Todo a tiempo." onAbrir={abrir} extra={(o) => `corte ${o.cutoff.slice(0, 5)}`} />
        </Seccion>
        <Seccion titulo="En ruta">
          <Lista filas={actual?.en_ruta} vacio="No hay pedidos en ruta." onAbrir={abrir} extra={(o) => o.repartidor ?? "sin repartidor"} />
        </Seccion>
      </div>
    </div>
  );
}

function Lista<T extends Corto>({ filas, vacio, onAbrir, extra }: { filas?: T[]; vacio: string; onAbrir: (id: string) => void; extra: (o: T) => string }) {
  if (!filas) return <Vacio>Cargando…</Vacio>;
  if (!filas.length) return <Vacio>{vacio}</Vacio>;
  return (
    <ul className="divide-y divide-line">
      {filas.map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => onAbrir(o.id)} className="flex w-full cursor-pointer items-center justify-between gap-2 py-2.5 text-left hover:bg-surface-2">
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium text-ink">{o.number} · {o.cliente}</span>
              <span className="block text-[12px] text-muted">{franjaTexto(o.slot_from, o.slot_to)} · {o.zona ?? "—"} · {extra(o)}</span>
            </span>
            <StatusBadge status={o.status} labels={ESTADOS} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function DelMes() {
  const [mes, setMes] = useState(hoyLima().slice(0, 7));
  const [k, setK] = useState<Kpis | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Kpis>(`/v1/ped/kpis?mes=${mes}`).then((r) => vigente && setK(r)).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [mes]);

  const v = k?.mes === mes ? k : null;
  const maxCanal = Math.max(1, ...(v?.por_canal ?? []).map((c) => Number(c.ventas)));
  return (
    <div className="space-y-4">
      <Input type="month" aria-label="Mes" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="w-[170px]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Ventas entregadas" icono={Wallet} destacada valor={v ? soles(v.ventas) : undefined} detalle={v ? `${numero(v.entregados)} pedidos` : ""} />
        <Cifra titulo="Ticket promedio" icono={Receipt} valor={v ? soles(v.ticket) : undefined} />
        <Cifra titulo="Pedidos por día" icono={CalendarClock} valor={v ? numero(v.por_dia, 1) : undefined} detalle={v ? `${numero(v.confirmados)} confirmados` : ""} />
        <Cifra titulo="Minutos hasta confirmar" icono={Clock} valor={v ? (v.confirmacion_min != null ? numero(v.confirmacion_min) : "—") : undefined} detalle="Mediana, de creado a confirmado" />
        <Cifra titulo="Cancelados" icono={Ban} valor={v ? porcentaje(v.cancelados_pct, 1) : undefined} tono={v && v.cancelados_pct > 5 ? "warn" : undefined} detalle="De los confirmados" />
        <Cifra titulo="Reprogramados" icono={CalendarClock} valor={v ? porcentaje(v.reprogramados_pct, 1) : undefined} detalle="De los confirmados" />
        <Cifra titulo="Descuentos" icono={Percent} valor={v ? porcentaje(v.descuentos_pct, 1) : undefined} detalle="Sobre la venta bruta" />
        <Cifra titulo="Peso real vs estimado" icono={Scale} valor={v ? `${v.peso_pct > 0 ? "+" : ""}${porcentaje(v.peso_pct, 1)}` : undefined} detalle={v ? `Avisos de peso en ${porcentaje(v.avisos_pct, 1)} de los pesados` : ""} />
      </div>
      {v && v.incompletos_pct > 0 && <p className="text-[12.5px] text-warn">{porcentaje(v.incompletos_pct, 1)} de los confirmados son importados con datos incompletos.</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Seccion titulo="Ventas por canal">
          {!v ? <Vacio>Cargando…</Vacio> : v.por_canal.length === 0 ? <Vacio>Sin ventas este mes.</Vacio> : (
            <ul className="space-y-2.5">
              {v.por_canal.map((c) => (
                <li key={c.canal} className="text-[13px]">
                  <div className="flex justify-between gap-2"><span className="text-ink">{etiqueta(CANALES, c.canal)}</span><span className="text-ink">{soles(c.ventas)} <span className="text-muted">· {c.n}</span></span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full bg-primary" style={{ width: `${(Number(c.ventas) / maxCanal) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
        <Seccion titulo="Ventas por marca">
          {!v ? <Vacio>Cargando…</Vacio> : v.por_marca.length === 0 ? <Vacio>Sin ventas este mes.</Vacio> : (
            <ul className="space-y-1.5 text-[13px]">
              {v.por_marca.map((m) => <li key={m.marca} className="flex justify-between gap-2"><span className="text-ink">{m.marca}</span><span className="text-ink">{soles(m.ventas)} <span className="text-muted">· {m.n}</span></span></li>)}
            </ul>
          )}
        </Seccion>
        <Seccion titulo="Cancelaciones por motivo">
          {!v ? <Vacio>Cargando…</Vacio> : v.cancelados_por_motivo.length === 0 ? <Vacio>Sin cancelaciones de pedidos confirmados.</Vacio> : (
            <ul className="space-y-1.5 text-[13px]">
              {v.cancelados_por_motivo.map((m) => <li key={m.motivo} className="flex justify-between gap-2"><span className="text-ink">{m.motivo}</span><b className="text-ink">{m.n}</b></li>)}
            </ul>
          )}
        </Seccion>
      </div>
    </div>
  );
}
