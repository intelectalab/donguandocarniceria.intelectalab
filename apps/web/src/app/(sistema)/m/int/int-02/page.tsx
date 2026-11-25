"use client";

import { Suspense, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, KeyRound, Loader2, Power, Zap } from "lucide-react";
import { Alert, Button, Checkbox, DataTable, DetailList, PageHeader, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Entorno, EstadoConector, claveLegible, nombreModulo, useDatos, venceEn, type Conector, type Credencial } from "@/modulos/int/tipos";

type Ficha = Conector & {
  config: Record<string, unknown>; errores: { at: string; msg: string }[]; credenciales: Credencial[];
  webhooks: { id: string; name: string; url: string; status: string }[];
  actividad: { enviados: number; reintentando: number; cola_muerta: number; webhooks: number; corridas: number }; umbral_errores: number;
};
type Resultado = { ok: boolean | null; mensaje: string; latencia: number | null };

function Tarjeta({ titulo, extra, children }: { titulo: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2"><h2 className="font-display text-[15px] font-bold text-ink">{titulo}</h2>{extra}</div>
      {children}
    </section>
  );
}
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const valor = (v: unknown) => (typeof v === "boolean" ? (v ? "Sí" : "No") : v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * INT-02 Ficha del conector: configuración no secreta, entorno, módulo dueño, marca y local; «Probar conexión»,
 * activar o desactivar con motivo, sus credenciales, webhooks, actividad e historial de errores.
 */
function FichaConector() {
  const id = useSearchParams().get("id");
  const { can, puede } = useSesion();
  const { datos: c, error, recargar } = useDatos<Ficha>(id ? `/v1/int/conectores/${id}` : null);
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const gestiona = can("int.connector.manage") && puede("INT", "E");

  const volver = <Link href="/m/int/int-01" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"><ArrowLeft size={14} />Conectores</Link>;
  if (!id) return <div className="grid gap-4">{volver}<Alert tone="info">Elige un conector en la lista de Conectores para ver su ficha.</Alert></div>;
  if (error) return <div className="grid gap-4">{volver}<Alert tone="bad">{error}</Alert></div>;
  if (!c) return <div className="grid place-items-center py-20 text-muted"><Loader2 className="animate-spin" /></div>;

  async function probar() {
    setProbando(true);
    try {
      const r = await api<{ resultado: Resultado }>(`/v1/int/conectores/${id}/probar`, { method: "POST" });
      setResultado(r.resultado);
      if (r.resultado.ok === true) toast.ok(r.resultado.mensaje); else if (r.resultado.ok === false) toast.error(r.resultado.mensaje); else toast.info(r.resultado.mensaje);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProbando(false);
    }
  }

  async function cambiarEstado() {
    const activar = c!.status === "DISABLED";
    const r = await confirmAction({ title: activar ? `¿Activar ${c!.name}?` : `¿Desactivar ${c!.name}?`, confirmLabel: activar ? "Activar" : "Desactivar", danger: !activar,
      message: activar ? "Vuelve a usarse para enviar y recibir." : "Deja de usarse: sus envíos no salen y sus pruebas de conexión no se hacen.",
      reason: { min: 10, label: "Motivo (queda en la bitácora)" } });
    if (!r) return;
    try {
      await api(`/v1/int/conectores/${id}/estado`, { method: "POST", body: { active: activar, reason: r.reason } });
      toast.ok(activar ? "Conector activado" : "Conector desactivado");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function simular(caido: boolean) {
    try {
      await api(`/v1/int/conectores/${id}/simular-caida`, { method: "POST", body: { down: caido } });
      toast.info(caido ? "El proveedor no responderá: las pruebas y envíos fallarán" : "El proveedor vuelve a responder");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  return (
    <div className="grid gap-5">
      {volver}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[22px] font-bold text-ink">{c.name}</h2>
        <EstadoConector c={c} /><Entorno e={c.environment} />
      </div>
      <PageHeader description={`${c.kind_name} · ${c.adapter_name} · módulo dueño: ${nombreModulo(c.owner_module)}. La configuración que se ve aquí no es secreta; los secretos están en Credenciales y nunca se muestran completos.`}
        actions={gestiona ? <div className="flex flex-wrap gap-2">
          <Button icon={Power} onClick={cambiarEstado}>{c.status === "DISABLED" ? "Activar" : "Desactivar"}</Button>
          <Button variant="primary" icon={Zap} loading={probando} onClick={probar} disabled={c.status === "DISABLED"}>Probar conexión</Button>
        </div> : undefined} />

      {c.status === "ERROR" && <Alert tone="bad">En error tras {plural(c.consecutive_failures, "fallo seguido", "fallos seguidos")}. La siguiente conexión correcta lo devuelve a Activo.</Alert>}
      {!c.module_on && <Alert tone="warn">Su módulo ({nombreModulo(c.owner_module)}) está apagado: sus webhooks se guardan como ignorados y no se crean mensajes salientes. No se puede activar hasta encender el módulo.</Alert>}
      {resultado && <Alert tone={resultado.ok === true ? "ok" : resultado.ok === false ? "bad" : "info"} title="Resultado de la prueba">{resultado.mensaje}</Alert>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Tarjeta titulo="Configuración (no secreta)">
          <DetailList items={[
            { label: "Código", value: <span className="font-mono">{c.code}</span> },
            { label: "Proveedor", value: c.adapter_name },
            { label: "Tipo", value: c.kind_name },
            { label: "Entorno", value: <Entorno e={c.environment} /> },
            { label: "Módulo dueño", value: nombreModulo(c.owner_module) },
            { label: "Marca", value: c.brand_name ?? "Toda la empresa" },
            { label: "Local", value: c.establishment_name ?? "—" },
            ...Object.entries(c.config).map(([k, v]) => ({ label: claveLegible(k), value: valor(v) })),
            { label: "Latencia", value: c.latency_ms ? `${Math.round(c.latency_ms)} ms` : "—" },
            { label: "Última conexión correcta", value: c.last_ok_at ? fechaHora(c.last_ok_at) : "Nunca" },
            { label: "Fallos seguidos", value: `${c.consecutive_failures} de ${c.umbral_errores} para pasar a «En error»` },
            ...(c.status_reason ? [{ label: "Motivo del último cambio de estado", value: c.status_reason }] : []),
          ]} />
        </Tarjeta>

        <div className="grid content-start gap-5">
          <Tarjeta titulo="Credenciales" extra={<Link href={`/m/int/int-03?connector=${c.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"><KeyRound size={14} />Gestionar</Link>}>
            {c.credenciales.length ? (
              <ul className="grid gap-1.5 text-[13px]">
                {c.credenciales.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                    <span className="font-mono text-ink">{k.name}</span>
                    <span className="text-muted"><span className="font-mono text-ink">{k.value}</span> · versión {k.version}{k.expires_at ? ` · vence ${fecha(k.expires_at)} (${venceEn(k.dias_para_vencer)})` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted">Sin credenciales vigentes.</p>}
          </Tarjeta>

          {c.webhooks.length > 0 && (
            <Tarjeta titulo="Webhooks de entrada">
              <ul className="grid gap-1.5 text-[13px]">
                {c.webhooks.map((w) => <li key={w.id}><p className="text-ink">{w.name}</p><p className="font-mono text-[12px] break-all text-muted">{w.url}</p></li>)}
              </ul>
            </Tarjeta>
          )}

          <Tarjeta titulo="Actividad">
            <DetailList items={[
              { label: "Mensajes salientes", value: `${c.actividad.enviados} enviados · ${c.actividad.reintentando} reintentando · ${c.actividad.cola_muerta} en cola muerta` },
              { label: "Webhooks recibidos", value: String(c.actividad.webhooks) },
              { label: "Corridas programadas", value: String(c.actividad.corridas) },
            ]} />
          </Tarjeta>

          {gestiona && c.environment === "SANDBOX" && (
            <Tarjeta titulo="Prueba">
              <Checkbox checked={c.simulate_down} onChange={(v) => simular(v)}
                label="Simular caída del proveedor: las pruebas de conexión y los envíos fallan, para ver los reintentos y el paso a «En error»." />
            </Tarjeta>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <h2 className="font-display text-[15px] font-bold text-ink">Historial de errores</h2>
        <DataTable rows={c.errores} rowKey={(e) => `${e.at}-${e.msg}`} empty="Sin errores registrados." columns={[
          { key: "at", header: "Fecha y hora", render: (e) => <span className="whitespace-nowrap">{fechaHora(e.at)}</span> },
          { key: "msg", header: "Error", cardTitle: true, render: (e) => <span className="text-bad">{e.msg}</span> },
        ]} />
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><FichaConector /></Suspense>;
}
