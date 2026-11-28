"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, Copy, Play, RotateCw, ShieldCheck, Skull } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { EstadoHttp, formatearEspera, type EntregaWebhook, type IntentoWebhook } from "@/modulos/api/comun";

type DetalleEntrega = EntregaWebhook & {
  cabeceras: Record<string, string>;
  intentos: IntentoWebhook[];
  horas_entre_intentos: number | null;
  verificacion: {
    al_enviar: { ok: boolean; reason: string };
    ahora: { ok: boolean; reason: string };
  };
  puede_gestionar: boolean;
  puede_reenviar: boolean;
};

/** API-07 Detalle de entrega: cuerpo crudo, cabeceras con firma HMAC, verificación como receptor, tabla de intentos y reenvío. */
function DetalleDeEntregaVista() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") || "primera";
  const [d, setD] = useState<DetalleEntrega | null>(null);
  const [error, setError] = useState("");
  const [mostrarVerif, setMostrarVerif] = useState(false);
  const [procesando, setProcesando] = useState(false);

  const cargar = () => {
    api<DetalleEntrega>(`/v1/api/entregas/${id}`).then((r) => { setD(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  };
  useEffect(cargar, [id]);

  async function reenviar() {
    if (!d) return;
    setProcesando(true);
    try {
      const nueva = await api<DetalleEntrega>(`/v1/api/entregas/${d.id}/reenviar`, { method: "POST" });
      toast.ok(`Reenviada como ${nueva.number}: ${nueva.estado.toLowerCase()}`);
      router.push(`/m/api/api-07?id=${nueva.id}`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  async function intentarAhora() {
    if (!d) return;
    setProcesando(true);
    try {
      const act = await api<DetalleEntrega>(`/v1/api/entregas/${d.id}/intentar`, { method: "POST" });
      setD(act);
      if (act.status === "DELIVERED") {
        toast.ok("Entregada correctamente");
      } else {
        toast.error(`Falló: ${act.last_error ?? "error"}`);
      }
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  async function copiar(texto: string, etiqueta: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.ok(`${etiqueta} copiado al portapapeles`);
    } catch {
      toast.error("No se pudo copiar.");
    }
  }

  let cuerpoFormateado = d?.payload ?? "";
  try {
    if (d?.payload) cuerpoFormateado = JSON.stringify(JSON.parse(d.payload), null, 2);
  } catch {
    // deja el cuerpo tal cual
  }

  const colIntentos: Column<IntentoWebhook>[] = [
    { key: "attempt_no", header: "#", align: "right", render: (a) => <span className="font-mono font-semibold">{a.attempt_no}</span> },
    { key: "at", header: "Fecha y hora", render: (a) => fechaHora(a.at) },
    { key: "http_status", header: "Código", render: (a) => <EstadoHttp s={a.http_status} /> },
    { key: "duration_ms", header: "Tiempo", align: "right", render: (a) => a.duration_ms >= 1000 ? `${numero(a.duration_ms / 1000, 1)} s` : `${a.duration_ms} ms` },
    {
      key: "response_snippet", header: "Respuesta (recortada) o error",
      render: (a) => (
        <div className="max-w-[420px] break-all text-[12px]">
          {a.error && !a.ok && <p className="font-medium text-bad">{a.error}</p>}
          {a.response_snippet && <p className="font-mono text-muted">{a.response_snippet.slice(0, 160)}</p>}
          {!a.error && !a.response_snippet && <span className="text-muted">—</span>}
        </div>
      ),
    },
    {
      key: "wait_next_min", header: "Espera al siguiente",
      render: (a) => a.wait_next_min ? formatearEspera(a.wait_next_min) : a.ok ? "—" : <Badge tone="bad">cola muerta</Badge>,
    },
    { key: "resolved_ip", header: "IP destino", hideOnMobile: true, render: (a) => <span className="font-mono text-[12px] text-muted">{a.resolved_ip || "—"}</span> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description={d ? `Entrega ${d.number} · ${d.event_type} → ${d.endpoint_name} · cuerpo enviado, cabeceras con firma HMAC, cada intento y reenvío.` : "Cargando entrega…"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/m/api/api-06"><Button variant="ghost" icon={ArrowLeft}>Entregas</Button></Link>
            {d && ["PENDING", "RETRYING"].includes(d.status) && d.puede_gestionar && (
              <Button variant="ghost" icon={Play} loading={procesando} onClick={intentarAhora}>Intentar ahora</Button>
            )}
            {d && ["DEAD", "DELIVERED"].includes(d.status) && (
              <Button variant="primary" icon={RotateCw} loading={procesando} disabled={!d.puede_reenviar} onClick={reenviar}>Reenviar</Button>
            )}
          </div>
        }
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {d && (
        <>
          {d.status === "DEAD" && (
            <Alert tone="bad">
              En la cola muerta desde {fechaHora(d.dead_at)} tras {d.attempts} intentos.
              {d.resent_to && d.resent_to_number ? (
                <> Reenviada el {fechaHora(d.resent_at)} como <Link href={`/m/api/api-07?id=${d.resent_to}`} className="font-mono font-semibold underline">{d.resent_to_number}</Link>.</>
              ) : (
                " Reenvíala cuando el destino responda: se crea una entrega nueva del mismo evento."
              )}
            </Alert>
          )}
          {d.resent_from && d.resent_from_number && (
            <Alert tone="info">
              Reenvío de <Link href={`/m/api/api-07?id=${d.resent_from}`} className="font-mono font-semibold underline">{d.resent_from_number}</Link> (mismo <span className="font-mono">{d.event_id}</span>; el receptor deduplica por <span className="font-mono">event_id</span>).
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra
              titulo="Estado"
              valor={d.estado}
              icono={d.status === "DELIVERED" ? CheckCircle2 : d.status === "DEAD" ? Skull : RotateCw}
              tono={d.status === "DELIVERED" ? "ok" : d.status === "DEAD" ? "bad" : d.status === "RETRYING" ? "warn" : undefined}
              destacada
            />
            <Cifra titulo="Intentos" valor={`${d.attempts} de ${d.max_attempts}`} icono={RotateCw} />
            <Cifra titulo="Entre primer y último intento" valor={d.horas_entre_intentos ? `${numero(d.horas_entre_intentos, 1)} h` : "—"} icono={Clock} />
            <Cifra titulo="Siguiente intento" valor={["PENDING", "RETRYING"].includes(d.status) && d.next_attempt_at ? fechaHora(d.next_attempt_at) : "—"} icono={Clock} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[14px] font-semibold text-ink">Cuerpo enviado</h2>
                <Button variant="ghost" size="sm" icon={Copy} onClick={() => copiar(d.payload, "Cuerpo crudo")}>Copiar cuerpo crudo</Button>
              </div>
              <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] whitespace-pre-wrap break-all text-ink">
                {cuerpoFormateado}
              </pre>
            </section>

            <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[14px] font-semibold text-ink">Cabeceras y firma</h2>
                <Button variant="ghost" size="sm" icon={ShieldCheck} onClick={() => setMostrarVerif((v) => !v)}>Verificar como el receptor</Button>
              </div>
              <pre className="max-h-60 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] whitespace-pre-wrap break-all text-ink">
                {Object.entries(d.cabeceras).map(([k, v]) => `${k}: ${v}`).join("\n")}
              </pre>
              <p className="text-[12.5px] text-muted">
                <span className="font-mono">v1</span> = HMAC-SHA256 en hexadecimal de <span className="font-mono">«t.cuerpo»</span> con el secreto del destino. Durante las 24 horas posteriores a una rotación viajan dos <span className="font-mono">v1</span>.
              </p>
              {mostrarVerif && (
                <div className="grid gap-2 rounded-lg border border-line bg-surface-2/60 p-3 text-[12.5px]">
                  <div className="flex items-center gap-2">
                    <EstadoHttp s={d.verificacion.al_enviar.ok ? 200 : 401} />
                    <span>A los 30 s del envío: <strong>{d.verificacion.al_enviar.reason}</strong>.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <EstadoHttp s={d.verificacion.ahora.ok ? 200 : 401} />
                    <span>Si se recibiera recién ahora: <strong>{d.verificacion.ahora.reason}</strong>.</span>
                  </div>
                </div>
              )}
            </section>
          </div>

          <section className="grid gap-2">
            <h2 className="text-[14px] font-semibold text-ink">Intentos (registro de solo inserción)</h2>
            <DataTable
              rowKey={(a) => a.id}
              columns={colIntentos}
              rows={d.intentos}
              empty="Aún sin intentos registrados."
            />
          </section>
        </>
      )}
    </div>
  );
}

export default function DetalleDeEntrega() {
  return <Suspense><DetalleDeEntregaVista /></Suspense>;
}
