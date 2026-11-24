"use client";

import { useEffect, useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { Alert, Button, DetailList, Modal, StatusBadge, confirmAction, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { nombreModulo } from "@/modulos/int/tipos";

export type Saliente = {
  id: string; number: string; status: string; status_name: string; attempts: number; next_attempt_at: string | null; last_error: string | null;
  module: string; kind: string; kind_name: string; event: string | null; ref: string | null; sent_at: string | null; dead_at: string | null;
  created_at: string; connector_id: string; connector_name: string;
};
type Intento = { at: string; ok: boolean; error?: string | null; delay?: number | null };
type Manual = { at: string; by: string; action: "RETRY" | "CANCEL"; reason: string };
export type SalienteFicha = Saliente & {
  idempotency_key: string; provider_ref: string | null; cancel_reason: string | null; max_intentos: number; tries: Intento[]; manual: Manual[]; payload: unknown;
};

export const ESTADOS_SALIENTE: Record<string, [string, Tone]> = {
  PENDING: ["Pendiente", "info"], RETRYING: ["Reintentando", "warn"], SENT: ["Enviado", "ok"], DEAD: ["Cola muerta", "bad"], CANCELLED: ["Cancelado", "neutral"],
};

export function EstadoSaliente({ status }: { status: string }) {
  return <StatusBadge status={status} labels={ESTADOS_SALIENTE} />;
}

/** 30 → «30 s», 120 → «2 min», 3600 → «1 h». */
export function duracion(seg: number): string {
  if (seg < 60) return `${seg} s`;
  if (seg < 3600) return `${Math.round(seg / 60)} min`;
  return `${Math.round((seg / 3600) * 10) / 10} h`.replace(".", ",");
}

/** Reintentar o cancelar a mano un mensaje de la cola muerta, con motivo (RN-INT-10). Devuelve true si se hizo. */
export async function accionCola(m: Pick<Saliente, "id" | "number" | "connector_name">, accion: "reintentar" | "cancelar"): Promise<boolean> {
  const reintentar = accion === "reintentar";
  const r = await confirmAction({
    title: reintentar ? `¿Reintentar ${m.number}?` : `¿Cancelar ${m.number}?`, danger: !reintentar, confirmLabel: reintentar ? "Reintentar" : "Cancelar el mensaje",
    message: reintentar
      ? `Se envía una vez más por ${m.connector_name}. Si vuelve a fallar, sigue en la cola muerta.`
      : "El mensaje no se enviará nunca. Úsalo cuando ya no hace falta (por ejemplo, se anuló el comprobante o se avisó por otro medio).",
    reason: { min: 10, label: reintentar ? "Motivo del reintento" : "Motivo de la cancelación" },
  });
  if (!r) return false;
  try {
    const f = await api<SalienteFicha>(`/v1/int/salientes/${m.id}/${accion}`, { method: "POST", body: { reason: r.reason } });
    if (!reintentar) toast.ok("Mensaje cancelado");
    else if (f.status === "SENT") toast.ok("Mensaje enviado");
    else toast.error(`Volvió a fallar: sigue en la cola muerta. ${f.last_error ?? ""}`.trim());
    return true;
  } catch (e) {
    toast.error(mensajeDe(e));
    return false;
  }
}

/** Ficha de un mensaje saliente: datos, intentos con su espera, acciones a mano y contenido. */
export function FichaSaliente({ id, gestiona, onClose, onCambio }: { id: string; gestiona: boolean; onClose: () => void; onCambio: () => void }) {
  const [m, setM] = useState<SalienteFicha | null>(null);
  const [error, setError] = useState("");
  const [vez, setVez] = useState(0);

  useEffect(() => {
    let vivo = true;
    api<SalienteFicha>(`/v1/int/salientes/${id}`).then((r) => { if (vivo) { setM(r); setError(""); } }).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id, vez]);

  async function accion(a: "reintentar" | "cancelar") {
    if (m && (await accionCola(m, a))) {
      setVez((v) => v + 1);
      onCambio();
    }
  }

  const espera = m && ["PENDING", "RETRYING"].includes(m.status);
  return (
    <Modal open onClose={onClose} title={m ? `Mensaje ${m.number}` : "Mensaje"} size="lg"
      footer={m?.status === "DEAD" && gestiona ? (
        <>
          <Button variant="ghost" icon={Ban} onClick={() => accion("cancelar")}>Cancelar el mensaje</Button>
          <Button variant="primary" icon={RotateCcw} onClick={() => accion("reintentar")}>Reintentar</Button>
        </>
      ) : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!m && !error && <p className="text-[13.5px] text-muted">Cargando…</p>}
      {m && (
        <div className="grid gap-5">
          {m.status === "DEAD" && !gestiona && <Alert tone="info">Solo quien tiene el permiso de la cola de mensajes puede reintentarlo o cancelarlo.</Alert>}
          <DetailList items={[
            { label: "Conector", value: m.connector_name }, { label: "Módulo", value: nombreModulo(m.module) },
            { label: "Evento", value: m.event ? <span className="font-mono text-[12.5px]">{m.event}</span> : "—" }, { label: "Tipo", value: m.kind_name },
            { label: "Referencia", value: m.ref ? <span className="font-mono">{m.ref}</span> : "—" },
            { label: "Clave de idempotencia", value: <span className="font-mono text-[12px] break-all">{m.idempotency_key}</span> },
            { label: "Estado", value: <EstadoSaliente status={m.status} /> }, { label: "Intentos", value: `${m.attempts} de ${m.max_intentos}` },
            { label: "Próximo intento", value: espera && m.next_attempt_at ? fechaHora(m.next_attempt_at) : "—" },
            { label: "Enviado", value: m.sent_at ? fechaHora(m.sent_at) : "—" },
            { label: "Respuesta del proveedor", value: m.provider_ref ? <span className="font-mono text-[12.5px]">{m.provider_ref}</span> : "—" },
            { label: "Creado", value: fechaHora(m.created_at) },
            ...(m.dead_at ? [{ label: "Cayó en la cola muerta", value: fechaHora(m.dead_at) }] : []),
            ...(m.last_error ? [{ label: "Último error", value: <span className="text-bad">{m.last_error}</span> }] : []),
            ...(m.cancel_reason ? [{ label: "Motivo de cancelación", value: m.cancel_reason }] : []),
          ]} />

          {m.manual.map((x, i) => (
            <Alert key={i} tone="info">{x.action === "RETRY" ? "Reintento" : "Cancelación"} a mano de {x.by} el {fechaHora(x.at)}: {x.reason}</Alert>
          ))}

          <section className="grid gap-2">
            <h3 className="text-[14px] font-semibold text-ink">Intentos</h3>
            {m.tries.length === 0 ? <p className="text-[13px] text-muted">Todavía no se intentó enviar.</p> : (
              <ol className="grid gap-2 border-l border-line pl-4">
                {m.tries.map((t, i) => (
                  <li key={i} className="relative text-[13px]">
                    <span aria-hidden="true" className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ${t.ok ? "bg-ok" : "bg-bad"}`} />
                    <p><b className="text-ink">Intento {i + 1}: {t.ok ? "enviado" : "falló"}</b> <span className="text-muted">· {fechaHora(t.at)}</span></p>
                    {t.error && <p className="text-bad">{t.error}</p>}
                    {t.delay ? <p className="text-muted">El siguiente, {duracion(t.delay)} después.</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="grid gap-2">
            <h3 className="text-[14px] font-semibold text-ink">Contenido</h3>
            <pre className="max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink">{JSON.stringify(m.payload, null, 2)}</pre>
          </section>
        </div>
      )}
    </Modal>
  );
}
