"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Plug, Skull, Timer } from "lucide-react";
import { useState } from "react";
import { Badge, Cifra, DataTable, FiltroSelect, PageHeader, type Column } from "@/components/ui";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { useDatos, venceEn } from "@/modulos/int/tipos";
import { BarrasApiladas, LineaPorDia } from "@/modulos/int/graficos";

type DiaLatencia = { dia: string; p95: number | null; webhooks: number };
type DiaSalientes = { dia: string; enviados: number; reintentando: number; muertos: number };
type Serie<T> = { desde: string; hasta: string; dias: T[] };
type Problema = { id: string; name: string; status: string; status_name: string; consecutive_failures: number; last_error: string | null; last_error_at: string | null; simulate_down: boolean };
type PorVencer = { id: string; name: string; expires_at: string; connector_id: string; connector_name: string; dias: number };
type Datos = {
  indicadores: { exito: number | null; enviados_30: number; base_30: number; muertos: number; duplicados: number | null; repetidos: number; p95: number | null; en_error: number };
  latencia: Serie<DiaLatencia>; salientes: Serie<DiaSalientes>; mes: string | null; meses: string[]; problemas: Problema[]; credenciales: PorVencer[]; metas: { exito: number; p95: number }; umbral_errores: number;
};

const seg = (s: number) => (s <= 60 ? `${numero(s, s < 10 ? 1 : 0)} s` : `${numero(s / 60, 1)} min`);
const pct = (v: number) => `${numero(v, 2)} %`;
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
/** «2026-10» → «Octubre 2026». */
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Envuelve una cifra en un enlace a su pantalla, sin cambiar su diseño. */
function A({ href, titulo, children }: { href: string; titulo: string; children: React.ReactNode }) {
  return <Link href={href} title={titulo} className="rounded-xl focus-visible:outline-2 focus-visible:outline-primary">{children}</Link>;
}

/**
 * INT-12 Salud de integraciones: los cinco indicadores del módulo (cada uno lleva a su pantalla), los últimos 10 días de
 * webhooks y mensajes salientes, los conectores con problemas y las credenciales que vencen en 30 días.
 */
export default function SaludIntegraciones() {
  const router = useRouter();
  const [mes, setMes] = useState("");
  const { datos, error, recargar } = useDatos<Datos>(`/v1/int/salud${mes ? `?mes=${mes}` : ""}`);
  const k = datos?.indicadores;
  const lat = datos?.latencia;
  const sal = datos?.salientes;

  const colProblemas: Column<Problema>[] = [
    { key: "name", header: "Conector", cardTitle: true, render: (c) => <span className="font-semibold text-ink">{c.name}</span> },
    { key: "consecutive_failures", header: "Fallos seguidos", align: "right", render: (c) => `${c.consecutive_failures} de ${datos?.umbral_errores ?? 3}` },
    { key: "last_error", header: "Último error", render: (c) => (
      <span className="text-[12.5px] text-bad">{c.simulate_down ? "Caída simulada del proveedor. " : ""}{c.last_error ?? ""}{c.last_error_at ? <span className="text-muted"> · {fechaHora(c.last_error_at)}</span> : null}</span>
    ) },
    { key: "status", header: "Estado", render: (c) => <Badge tone={c.status === "ERROR" ? "bad" : c.status === "ACTIVE" ? "warn" : "neutral"} dot>{c.status_name}</Badge> },
  ];
  const colCredenciales: Column<PorVencer>[] = [
    { key: "connector", header: "Conector", cardTitle: true, render: (x) => <span className="font-semibold text-ink">{x.connector_name}</span> },
    { key: "name", header: "Credencial", render: (x) => <span className="font-mono text-[12.5px]">{x.name}</span> },
    { key: "expires_at", header: "Vence", render: (x) => <span className={x.dias < 0 ? "font-semibold text-bad" : x.dias <= 7 ? "font-semibold text-warn" : ""}>{fecha(x.expires_at)} ({venceEn(x.dias)})</span> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="El estado de todas las integraciones en una sola vista: si los mensajes salen, si hay algo en la cola muerta, si los webhooks se procesan a tiempo, qué conectores fallan y qué credenciales están por vencer. Cada cifra lleva a su pantalla." />
      {k && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <A href="/m/int/int-06" titulo="Abrir los mensajes salientes">
            <Cifra titulo="Éxito de los mensajes" valor={k.exito === null ? "—" : pct(k.exito)} icono={CheckCircle2} destacada
              detalle={k.base_30 ? `${numero(k.enviados_30)} de ${numero(k.base_30)} · meta ≥ 99,5 %` : "Sin envíos en 30 días"} />
          </A>
          <A href="/m/int/int-07" titulo="Abrir la cola muerta">
            <Cifra titulo="Cola muerta" valor={numero(k.muertos)} icono={Skull} tono={k.muertos ? "bad" : "ok"} detalle="Meta: 0" />
          </A>
          <A href="/m/int/int-05" titulo="Abrir la bitácora de webhooks">
            <Cifra titulo="Webhooks repetidos" valor={k.duplicados === null ? "—" : pct(k.duplicados)} icono={Copy} detalle={`${numero(k.repetidos)} en 30 días · informativo`} />
          </A>
          <A href="/m/int/int-05" titulo="Abrir la bitácora de webhooks">
            <Cifra titulo="Tiempo de proceso (p95)" valor={k.p95 === null ? "—" : seg(k.p95)} icono={Timer} tono={k.p95 !== null && k.p95 > 60 ? "warn" : "ok"} detalle="Meta: 60 s o menos" />
          </A>
          <A href="/m/int/int-01" titulo="Abrir los conectores">
            <Cifra titulo="Conectores en error" valor={numero(k.en_error)} icono={k.en_error ? AlertTriangle : Plug} tono={k.en_error ? "bad" : "ok"} detalle="Meta: 0" />
          </A>
        </div>
      )}
      {error && <p className="text-[13.5px] text-bad">{error} <button type="button" className="cursor-pointer underline" onClick={recargar}>Reintentar</button></p>}

      {datos && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-ink">Por día</h2>
          <FiltroSelect etiqueta="Período" ancho={250} value={mes} onChange={setMes} vacio="Últimos 10 días con actividad"
            options={datos.meses.map((m) => ({ value: m, label: nombreMes(m) }))} />
        </div>
      )}
      {datos && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Tiempo de proceso de los webhooks por día</h2>
              <p className="text-[12px] text-muted">El 95 % se procesó en este tiempo o menos · del {fecha(datos.latencia.desde)} al {fecha(datos.latencia.hasta)}</p>
            </div>
            {lat && lat.dias.some((d) => d.p95 !== null)
              ? <LineaPorDia titulo="Tiempo de proceso p95 por día" dias={lat.dias.map((d) => d.dia)} valor={(i) => lat.dias[i].p95} meta={datos.metas.p95} formato={seg} />
              : <p className="py-10 text-center text-[13px] text-muted">Todavía no hay webhooks procesados.</p>}
          </section>
          <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Mensajes salientes por día</h2>
              <p className="text-[12px] text-muted">Según su estado actual · del {fecha(datos.salientes.desde)} al {fecha(datos.salientes.hasta)}</p>
            </div>
            {sal && sal.dias.some((d) => d.enviados + d.reintentando + d.muertos > 0) ? (
              <BarrasApiladas titulo="Mensajes salientes por día" dias={sal.dias.map((d) => d.dia)} series={[
                { nombre: "Enviados", clase: "bg-ok", valores: sal.dias.map((d) => d.enviados) },
                { nombre: "Pendientes o reintentando", clase: "bg-warn", valores: sal.dias.map((d) => d.reintentando) },
                { nombre: "Cola muerta", clase: "bg-bad", valores: sal.dias.map((d) => d.muertos) },
              ]} />
            ) : <p className="py-10 text-center text-[13px] text-muted">Todavía no hay mensajes salientes.</p>}
          </section>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="grid content-start gap-2">
          <h2 className="text-[14px] font-semibold text-ink">Conectores con problemas</h2>
          <DataTable columns={colProblemas} rows={datos?.problemas ?? []} loading={!datos && !error} onRowClick={(c) => router.push(`/m/int/int-02?id=${c.id}`)}
            empty="Todos los conectores responden." />
        </section>
        <section className="grid content-start gap-2">
          <h2 className="text-[14px] font-semibold text-ink">Credenciales que vencen en 30 días</h2>
          <DataTable columns={colCredenciales} rows={datos?.credenciales ?? []} loading={!datos && !error} onRowClick={(x) => router.push(`/m/int/int-03?connector=${x.connector_id}`)}
            empty="Ninguna vence en los próximos 30 días." />
        </section>
      </div>
    </div>
  );
}
