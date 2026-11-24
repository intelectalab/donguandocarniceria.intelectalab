"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Plug, Skull, Timer } from "lucide-react";
import { Badge, Cifra, DataTable, PageHeader, type Column } from "@/components/ui";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { useDatos, venceEn } from "@/modulos/int/tipos";
import { BarrasApiladas, LineaPorDia } from "@/modulos/int/graficos";

type Dia = { dia: string; p95: number | null; webhooks: number; enviados: number; reintentando: number; muertos: number };
type Problema = { id: string; name: string; status: string; status_name: string; consecutive_failures: number; last_error: string | null; last_error_at: string | null; simulate_down: boolean };
type PorVencer = { id: string; name: string; expires_at: string; connector_id: string; connector_name: string; dias: number };
type Datos = {
  indicadores: { exito: number | null; enviados_30: number; base_30: number; muertos: number; duplicados: number | null; repetidos: number; p95: number | null; en_error: number };
  dias: Dia[]; desde: string; hasta: string; problemas: Problema[]; credenciales: PorVencer[]; metas: { exito: number; p95: number }; umbral_errores: number;
};

const seg = (s: number) => (s <= 60 ? `${numero(s, s < 10 ? 1 : 0)} s` : `${numero(s / 60, 1)} min`);
const pct = (v: number) => `${numero(v, 2)} %`;

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
  const { datos, error, recargar } = useDatos<Datos>("/v1/int/salud");
  const k = datos?.indicadores;
  const dias = datos?.dias ?? [];

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
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Tiempo de proceso de los webhooks por día</h2>
              <p className="text-[12px] text-muted">El 95 % se procesó en este tiempo o menos · del {fecha(datos.desde)} al {fecha(datos.hasta)}</p>
            </div>
            <LineaPorDia titulo="Tiempo de proceso p95 por día" dias={dias.map((d) => d.dia)} valor={(i) => dias[i].p95} meta={datos.metas.p95} formato={seg} />
          </section>
          <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Mensajes salientes por día</h2>
              <p className="text-[12px] text-muted">Según su estado actual · del {fecha(datos.desde)} al {fecha(datos.hasta)}</p>
            </div>
            <BarrasApiladas titulo="Mensajes salientes por día" dias={dias.map((d) => d.dia)} series={[
              { nombre: "Enviados", clase: "bg-ok", valores: dias.map((d) => d.enviados) },
              { nombre: "Pendientes o reintentando", clase: "bg-warn", valores: dias.map((d) => d.reintentando) },
              { nombre: "Cola muerta", clase: "bg-bad", valores: dias.map((d) => d.muertos) },
            ]} />
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
