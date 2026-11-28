"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, PauseCircle, PlayCircle, Plus, RefreshCw, Send, Skull, Webhook } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroSelect, Modal, PageHeader, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { Entorno, TONO_DESTINO, TONO_ENTREGA, type DestinoWebhook, type EntregaWebhook } from "@/modulos/api/comun";

type Lista = {
  data: DestinoWebhook[];
  cifras: {
    total: number; activos: number; inactivos: number; desactivados: number;
    a_la_primera_pct: number | null; a_la_primera_num: number; a_la_primera_den: number; cola_muerta: number;
  };
  limite_fallos: number;
  puede: boolean;
};

/** API-04 Destinos de webhooks: receptores https públicos con racha de fallos, pausa, reactivación con motivo y envío de prueba. */
export default function DestinosDeWebhooks() {
  const router = useRouter();
  const [f, setF] = useState({ estado: "", entorno: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [res, setRes] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState<DestinoWebhook | null>(null);
  const [reactivar, setReactivar] = useState<DestinoWebhook | null>(null);
  const [motivo, setMotivo] = useState("");
  const [procesando, setProcesando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/api/destinos?${q}`).then((r) => { setRes(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  };
  useEffect(cargar, [f]);

  async function abrirDetalle(e: DestinoWebhook) {
    try {
      const r = await api<DestinoWebhook>(`/v1/api/destinos/${e.id}`);
      setDetalle(r);
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  async function procesarVencidas() {
    setProcesando(true);
    try {
      const r = await api<{ procesadas: number }>("/v1/api/entregas/procesar", { method: "POST", body: {} });
      toast.ok(r.procesadas ? `${r.procesadas} intento(s) realizados` : "No hay reintentos vencidos a esta hora");
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setProcesando(false);
    }
  }

  async function enviarPrueba(e: DestinoWebhook) {
    try {
      const d = await api<EntregaWebhook>(`/v1/api/destinos/${e.id}/probar`, { method: "POST" });
      if (d.status === "DELIVERED") {
        toast.ok(`Prueba entregada (${d.number}): HTTP ${d.last_http ?? 200}`);
      } else {
        toast.error(`La prueba falló (${d.last_error ?? "error"}); quedó programado su reintento.`);
      }
      cargar();
      if (detalle?.id === e.id) abrirDetalle(e);
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  async function cambiarEstado(e: DestinoWebhook, status: "ACTIVE" | "PAUSED", reason?: string) {
    try {
      const r = await api<DestinoWebhook>(`/v1/api/destinos/${e.id}/estado`, { method: "POST", body: { status, reason } });
      toast.ok(status === "PAUSED" ? "Destino pausado: las entregas quedan pendientes" : "Destino activo");
      setDetalle(r);
      setReactivar(null);
      setMotivo("");
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  const c = res?.cifras;
  const cols: Column<DestinoWebhook>[] = [
    {
      key: "name", header: "Destino", cardTitle: true,
      render: (e) => (
        <div className="min-w-0">
          <button type="button" onClick={() => abrirDetalle(e)} className="cursor-pointer text-left font-semibold text-ink hover:text-primary">{e.name}</button>
          <p className="truncate font-mono text-[11.5px] text-muted">{e.url}</p>
        </div>
      ),
    },
    {
      key: "events", header: "Eventos",
      render: (e) => (
        <div className="flex max-w-[300px] flex-wrap gap-1">
          {e.events.map((ev) => <span key={ev} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">{ev}</span>)}
        </div>
      ),
    },
    { key: "environment", header: "Entorno", render: (e) => <Entorno e={e.environment} /> },
    {
      key: "failure_streak", header: "Racha de fallos", align: "right",
      render: (e) => <span className={e.failure_streak > 0 ? "font-semibold text-bad" : "text-muted"}>{e.failure_streak} / {e.limite_fallos}</span>,
    },
    {
      key: "last_delivery_at", header: "Última entrega", hideOnMobile: true,
      render: (e) => e.last_delivery_at ? (
        <div className="flex items-center gap-1.5 text-[12px]">
          <span>{fechaHora(e.last_delivery_at)}</span>
          <Badge tone={e.last_delivery_status === "DELIVERED" ? "ok" : "bad"}>{e.last_delivery_status === "DELIVERED" ? "OK" : "Falló"}</Badge>
        </div>
      ) : <span className="text-muted">—</span>,
    },
    { key: "entregas_count", header: "Entregas", align: "right", render: (e) => numero(e.entregas_count) },
    { key: "status", header: "Estado", render: (e) => <Badge tone={TONO_DESTINO[e.status]}>{e.estado}</Badge> },
    {
      key: "acc", header: "", align: "right",
      render: (e) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => abrirDetalle(e)}>Ver</Button>
          {res?.puede && <Button variant="ghost" size="sm" onClick={() => router.push(`/m/api/api-05?id=${e.id}`)}>Editar</Button>}
          {res?.puede && e.status === "ACTIVE" && <Button variant="ghost" size="sm" onClick={() => enviarPrueba(e)}>Probar</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Destinos https que reciben los eventos firmados de tu empresa. Una racha de fallos seguidos desactiva el destino automáticamente; una entrega exitosa reinicia la racha."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" icon={RefreshCw} loading={procesando} onClick={procesarVencidas}>Procesar reintentos vencidos</Button>
            {res?.puede && <Link href="/m/api/api-05"><Button variant="primary" icon={Plus}>Nuevo destino</Button></Link>}
          </div>
        }
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Destinos activos" valor={`${numero(c.activos)} de ${numero(c.total)}`} icono={Webhook} destacada />
          <Cifra titulo="Desactivados o pausados" valor={numero(c.inactivos)} icono={AlertTriangle} tono={c.desactivados ? "bad" : undefined} detalle={c.desactivados ? `${c.desactivados} por racha de fallos` : "ninguno por fallos"} />
          <Cifra titulo="Entrega a la primera (30 d)" valor={c.a_la_primera_pct === null ? "—" : porcentaje(c.a_la_primera_pct, 1)} icono={CheckCircle2} detalle={`${numero(c.a_la_primera_num)} de ${numero(c.a_la_primera_den)}`} />
          <Link href="/m/api/api-06?estado=DEAD" className="contents">
            <Cifra titulo="En cola muerta" valor={numero(c.cola_muerta)} icono={Skull} tono={c.cola_muerta ? "bad" : "ok"} detalle="sin reenviar" />
          </Link>
        </div>
      )}
      <DataTable
        rowKey={(e) => e.id}
        columns={cols}
        rows={res?.data ?? []}
        loading={!res && !error}
        empty="Aún no hay destinos de webhooks configurados."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por nombre o URL…" }}
        toolbar={
          <>
            <FiltroSelect etiqueta="Estado" todos="todos" ancho={165} value={f.estado} onChange={(v) => setF({ ...f, estado: v })}
              options={[{ value: "ACTIVE", label: "Activo" }, { value: "PAUSED", label: "Pausado" }, { value: "DISABLED", label: "Desactivado" }]} />
            <FiltroSelect etiqueta="Entorno" todos="todos" ancho={165} value={f.entorno} onChange={(v) => setF({ ...f, entorno: v })}
              options={[{ value: "LIVE", label: "Producción" }, { value: "TEST", label: "Pruebas" }]} />
          </>
        }
      />

      {detalle && (
        <Modal
          open
          onClose={() => setDetalle(null)}
          title={detalle.name}
          description={detalle.url}
          footer={
            <div className="flex flex-wrap justify-between gap-2 w-full">
              <div className="flex flex-wrap gap-2">
                {res?.puede && <Button variant="ghost" onClick={() => router.push(`/m/api/api-05?id=${detalle.id}`)}>Editar</Button>}
                {res?.puede && detalle.status === "ACTIVE" && <Button variant="ghost" icon={PauseCircle} onClick={() => cambiarEstado(detalle, "PAUSED", "Pausa manual")}>Pausar</Button>}
                {res?.puede && detalle.status === "PAUSED" && <Button variant="primary" icon={PlayCircle} onClick={() => cambiarEstado(detalle, "ACTIVE")}>Reanudar</Button>}
                {res?.puede && detalle.status === "DISABLED" && <Button variant="primary" icon={PlayCircle} onClick={() => { setReactivar(detalle); setMotivo(""); }}>Reactivar con motivo</Button>}
                {res?.puede && detalle.status === "ACTIVE" && <Button variant="ghost" icon={Send} onClick={() => enviarPrueba(detalle)}>Enviar prueba</Button>}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => router.push(`/m/api/api-06?destino=${detalle.id}`)}>Ver entregas</Button>
                <Button variant="primary" onClick={() => setDetalle(null)}>Cerrar</Button>
              </div>
            </div>
          }
        >
          <div className="grid gap-4">
            {detalle.status === "DISABLED" && <Alert tone="bad">{detalle.disabled_reason || "Destino desactivado por fallos seguidos."}</Alert>}
            <DetailList
              items={[
                { label: "URL", value: <span className="font-mono text-[12px] break-all">{detalle.url}</span> },
                {
                  label: "IP resuelta (al enviar)",
                  value: (
                    <span className="flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
                      {detalle.resolved_ip}
                      {detalle.ip_privada && <Badge tone="bad">red privada · bloqueada</Badge>}
                    </span>
                  ),
                },
                { label: "Entorno", value: <Entorno e={detalle.environment} /> },
                { label: "Estado", value: <Badge tone={TONO_DESTINO[detalle.status]}>{detalle.estado}</Badge> },
                { label: "Eventos suscritos", value: <span className="font-mono text-[12px]">{detalle.events.join(", ")}</span> },
                { label: "Marcas", value: detalle.marcas.length ? detalle.marcas.join(", ") : "Todas" },
                { label: "Cliente vinculado", value: detalle.cliente || "Todos" },
                {
                  label: "Secreto de firma",
                  value: (
                    <span className="font-mono text-[12px]">
                      v{detalle.secret_version} · whsec_••••{detalle.secret_last4}
                      {detalle.prev_vigente && detalle.prev_valid_until ? ` · anterior (••••${detalle.prev_last4}) firma hasta ${fechaHora(detalle.prev_valid_until)}` : ""}
                    </span>
                  ),
                },
                { label: "Racha de fallos", value: `${detalle.failure_streak} de ${detalle.limite_fallos}` },
                { label: "Comportamiento (demo)", value: detalle.simulador },
              ]}
            />
            {detalle.ultimas_entregas && detalle.ultimas_entregas.length > 0 && (
              <div className="grid gap-2">
                <p className="text-[12.5px] font-semibold text-ink">Últimas entregas</p>
                <div className="divide-y divide-line rounded-lg border border-line">
                  {detalle.ultimas_entregas.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                      <div className="flex items-center gap-2">
                        <Link href={`/m/api/api-07?id=${d.id}`} className="font-mono font-semibold text-ink hover:text-primary">{d.number}</Link>
                        <span className="font-mono text-muted">{d.event_type}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted">{d.attempts} int.</span>
                        <Badge tone={TONO_ENTREGA[d.status]}>{d.estado}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {reactivar && (
        <Modal
          open
          onClose={() => setReactivar(null)}
          title={`Reactivar ${reactivar.name}`}
          description="Explica qué se corrigió en el receptor (mínimo 10 caracteres). Queda en la auditoría."
          footer={
            <>
              <Button variant="ghost" onClick={() => setReactivar(null)}>Cancelar</Button>
              <Button variant="primary" disabled={motivo.trim().length < 10} onClick={() => cambiarEstado(reactivar, "ACTIVE", motivo.trim())}>Confirmar reactivación</Button>
            </>
          }
        >
          <Field label="Qué se corrigió en el receptor" required hint={`${motivo.trim().length}/10 caracteres mínimo.`}>
            <Textarea rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
