"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, PhoneCall, PhoneIncoming, PhoneMissed, ShieldAlert, Timer } from "lucide-react";
import Link from "next/link";
import { Badge, Checkbox, Cifra, DataTable, DetailList, Field, FiltroFecha, FiltroSelect, Input, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje, soles } from "@/lib/formato";
import { segundos } from "@/modulos/tel/BotonLlamar";
import { DetalleLlamada, TONO_LLAMADA } from "@/modulos/tel/DetalleLlamada";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Vivo = { id: string; status: string; estado: string; direccion: string; desde: string; numero: string; cliente: string | null; marca: string | null; vendedora: string };
type Vendedora = { id: string; nombre: string; llamadas: number; atendidas: number; perdidas: number; espera: number | null; duracion: number | null; con_pedido: number; alertas: number };
type Costo = { minutos: number; voz_usd: number; grabacion_usd: number; transcripcion_usd: number; total_usd: number; tipo_de_cambio: number; total_pen: number; pedidos: number; por_pedido_pen: number | null };
type Panel = {
  dia: string; hoy: string; mes: string; meses: { value: string; label: string }[]; vivo: Vivo[]; vendedoras: Vendedora[]; costo: Costo;
  cifras: { en_curso: number; sonando: number; entrantes: number; atendidas: number; atendidas_pct: number | null; perdidas: number; espera: number | null; duracion: number | null; alertas_mes: number };
  tarifas: { out_mobile: number; out_landline: number; inbound: number; recording: number; transcription: number };
};

const usd = (v: number) => `USD ${numero(v, 2)}`;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * TEL-11 Panel de supervisión: en vivo (en curso y sonando), las cifras y la tabla por vendedora del día elegido, y el
 * costo de telefonía del mes por pedido en soles, con un simulador para estimar el costo con las tarifas vigentes.
 */
export default function PanelSupervision() {
  const encendida = useTelefonia();
  const [f, setF] = useState({ dia: "", mes: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [buscarVivo, setBuscarVivo] = useState("");
  const [p, setP] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState<string | null>(null);
  const [sim, setSim] = useState({ minutos: "900", pedidos: "300", transcribir: true });

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!encendida) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Panel>(`/v1/tel/panel${q ? `?${q}` : ""}`).then((r) => { setP(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, encendida]);
  useEffect(() => cargar(), [cargar]);
  // Lo en vivo se refresca solo cada 20 segundos mientras la pestaña está a la vista.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 20000);
    return () => clearInterval(t);
  }, [cargar]);

  const vivo = useMemo(() => {
    const t = buscarVivo.trim().toLowerCase();
    return (p?.vivo ?? []).filter((v) => t.length < 2 || [v.numero, v.cliente, v.marca, v.vendedora].some((x) => (x ?? "").toLowerCase().includes(t)));
  }, [p, buscarVivo]);

  if (!encendida) return <div className="grid gap-5"><PageHeader description="El panel de la central." /><TelefoniaApagada /></div>;
  const c = p?.cifras;
  const esHoy = p ? p.dia === p.hoy : true;
  const t = p?.tarifas;
  const m = Number(sim.minutos) || 0;
  const ped = Number(sim.pedidos) || 0;
  const voz = t ? r2(m * t.out_mobile) : 0;
  const grab = t ? r2(m * t.recording) : 0;
  const trans = t && sim.transcribir ? r2(m * t.transcription) : 0;
  const total = r2(voz + grab + trans);
  const fx = p?.costo.tipo_de_cambio ?? 3.75;

  const colVivo: Column<Vivo>[] = [
    { key: "desde", header: "Desde", render: (v) => <span className="whitespace-nowrap">{fechaHora(v.desde)}</span> },
    { key: "numero", header: "Número", cardTitle: true, render: (v) => <div><p className="font-mono text-[12.5px] text-ink">{v.numero}</p><p className="text-[11.5px] text-muted">{v.direccion}</p></div> },
    { key: "cliente", header: "Cliente", render: (v) => v.cliente ?? "—" },
    { key: "marca", header: "Marca", hideOnMobile: true, render: (v) => <span className="text-[12.5px]">{v.marca ?? "—"}</span> },
    { key: "vendedora", header: "Vendedora", render: (v) => <span className="text-[12.5px]">{v.vendedora}</span> },
    { key: "status", header: "Estado", render: (v) => <Badge tone={TONO_LLAMADA[v.status] ?? "neutral"}>{v.estado}</Badge> },
  ];
  const colVend: Column<Vendedora>[] = [
    { key: "nombre", header: "Vendedora", cardTitle: true, render: (v) => <span className="font-semibold text-ink">{v.nombre}</span> },
    { key: "llamadas", header: "Llamadas", align: "right", render: (v) => numero(v.llamadas) },
    { key: "atendidas", header: "Atendidas", align: "right", render: (v) => numero(v.atendidas) },
    { key: "perdidas", header: "Perdidas", align: "right", render: (v) => v.perdidas ? <span className="font-semibold text-bad">{numero(v.perdidas)}</span> : "0" },
    { key: "espera", header: "Espera prom.", align: "right", hideOnMobile: true, render: (v) => segundos(v.espera) },
    { key: "duracion", header: "Duración prom.", align: "right", hideOnMobile: true, render: (v) => segundos(v.duracion) },
    { key: "con_pedido", header: "Con pedido", align: "right", render: (v) => numero(v.con_pedido) },
    { key: "alertas", header: "Alertas (mes)", align: "right", render: (v) => v.alertas ? <Badge tone="bad">{numero(v.alertas)}</Badge> : "0" },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="En vivo: llamadas en curso y sonando. Del día: atendidas, tiempos y alertas por vendedora. Del mes: el costo de telefonía por pedido en soles." />
      {error && !p && <p className="text-[13px] text-bad">{error}</p>}
      {c && p && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Cifra titulo="En curso" valor={numero(c.en_curso)} icono={PhoneCall} destacada />
            <Cifra titulo="Sonando o en espera" valor={numero(c.sonando)} icono={AlarmClock} tono={c.sonando ? "warn" : undefined} />
            <Cifra titulo={esHoy ? "Atendidas hoy" : "Atendidas del día"} valor={c.atendidas_pct === null ? "—" : porcentaje(c.atendidas_pct, 1)} icono={PhoneIncoming} detalle={`${numero(c.atendidas)} de ${numero(c.entrantes)} entrantes`} />
            <Cifra titulo={esHoy ? "Perdidas hoy" : "Perdidas del día"} valor={numero(c.perdidas)} icono={PhoneMissed} tono={c.perdidas ? "bad" : "ok"} />
            <Cifra titulo="Espera promedio" valor={segundos(c.espera)} icono={Timer} detalle={`Duración promedio ${segundos(c.duracion)}`} />
            <Cifra titulo="Alertas del mes" valor={numero(c.alertas_mes)} icono={ShieldAlert} tono={c.alertas_mes ? "bad" : "ok"} detalle="De las transcripciones" />
          </div>

          <section className="grid gap-2">
            <h2 className="text-[14px] font-semibold text-ink">En vivo</h2>
            <DataTable columns={colVivo} rows={vivo} onRowClick={(v) => setVer(v.id)} empty="Sin llamadas en este momento."
              search={{ value: buscarVivo, onChange: setBuscarVivo, placeholder: "Buscar número, cliente o vendedora…" }} />
          </section>

          <section className="grid gap-2">
            <h2 className="text-[14px] font-semibold text-ink">{esHoy ? "Del día por vendedora" : `Del ${p.dia.split("-").reverse().join("/")} por vendedora`}</h2>
            <DataTable columns={colVend} rows={p.vendedoras} empty="Ninguna vendedora atendió o hizo llamadas ese día."
              search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar vendedora…" }}
              toolbar={<>
                <FiltroFecha etiqueta="Día" visible value={f.dia || p.dia} max={p.hoy} onChange={(v) => setF({ ...f, dia: v })} />
                <FiltroSelect etiqueta="Mes del costo" vacio="Mes del día elegido" ancho={190} value={f.mes} onChange={(v) => setF({ ...f, mes: v })} options={p.meses} />
              </>} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div>
                <h2 className="text-[14px] font-semibold text-ink">Costo de telefonía de {p.meses.find((x) => x.value === p.mes)?.label ?? p.mes}</h2>
                <p className="text-[12.5px] text-muted">Tipo de cambio de venta {numero(p.costo.tipo_de_cambio, 3)}.</p>
              </div>
              <DetailList items={[
                { label: "Minutos", value: numero(p.costo.minutos) }, { label: "Voz", value: usd(p.costo.voz_usd) },
                { label: "Grabación", value: usd(p.costo.grabacion_usd) }, { label: "Transcripción", value: usd(p.costo.transcripcion_usd) },
                { label: "Total", value: <b>{usd(p.costo.total_usd)} ≈ {soles(p.costo.total_pen)}</b> }, { label: "Pedidos con llamada", value: numero(p.costo.pedidos) },
                { label: "Costo por pedido", value: <b>{p.costo.por_pedido_pen === null ? "—" : soles(p.costo.por_pedido_pen)}</b> },
              ]} />
            </section>
            <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div>
                <h2 className="text-[14px] font-semibold text-ink">Simulador de costo</h2>
                <p className="text-[12.5px] text-muted">Con las tarifas guardadas en <Link href="/m/tel/tel-02" className="text-primary hover:underline">Ajustes</Link>. No guarda nada.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Minutos salientes a celular"><Input type="number" min={0} max={1000000} value={sim.minutos} onChange={(e) => setSim({ ...sim, minutos: e.target.value })} /></Field>
                <Field label="Pedidos con llamada"><Input type="number" min={0} max={1000000} value={sim.pedidos} onChange={(e) => setSim({ ...sim, pedidos: e.target.value })} /></Field>
              </div>
              <Checkbox checked={sim.transcribir} onChange={(v) => setSim({ ...sim, transcribir: v })} label="Con transcripción" />
              {t && (
                <DetailList items={[
                  { label: "Voz saliente a celular", value: `${usd(voz)} (${numero(m)} × ${t.out_mobile})` },
                  { label: "Grabación", value: `${usd(grab)} (${numero(m)} × ${t.recording})` },
                  { label: "Transcripción", value: sim.transcribir ? `${usd(trans)} (${numero(m)} × ${t.transcription})` : usd(0) },
                  { label: "Total del mes", value: <b>{usd(total)} ≈ {soles(total * fx)}</b> },
                  { label: "Por pedido", value: ped ? soles(total * fx / ped) : "—" },
                ]} />
              )}
            </section>
          </div>
        </>
      )}
      {ver && <DetalleLlamada id={ver} onClose={() => setVer(null)} />}
    </div>
  );
}
