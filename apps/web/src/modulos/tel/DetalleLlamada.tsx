"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Badge, DetailList, Modal, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { segundos, type Llamada } from "@/modulos/tel/BotonLlamar";

type Detalle = Llamada & {
  answered_at: string | null; ended_at: string | null; provider_call_id: string; preview: boolean;
  grabacion: { id: string; status: string; retention_until: string; legal_hold: boolean } | null;
  tarea: { id: string; status: string; due_at: string; done_at: string | null; result: string | null; responsable: string | null } | null;
  ficha: { tipo: "CLIENTE" | "LEAD"; id: string; nombre: string };
};

export const TONO_LLAMADA: Record<string, Tone> = { COMPLETED: "ok", MISSED: "bad", NO_ANSWER: "bad", VOICEMAIL: "warn", BUSY: "warn", FAILED: "bad", RINGING: "info", IN_PROGRESS: "info" };

/** La ficha de una llamada: quién, cuándo, cuánto esperó y duró, el aviso, la grabación, el costo y la tarea de devolver. */
export function DetalleLlamada({ id, onClose }: { id: string; onClose: () => void }) {
  const [c, setC] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let vivo = true;
    api<Detalle>(`/v1/tel/llamadas/${id}`).then((r) => vivo && setC(r)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);
  return (
    <Modal open onClose={onClose} size="lg" title={c ? `${c.direccion} · ${c.direction === "INBOUND" ? c.from_e164 : c.to_e164}` : "Llamada"} description={c ? fechaHora(c.started_at) : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid gap-4">
          {c.preview && <Alert tone="info">Llamada de los datos de demostración.</Alert>}
          <DetailList items={[
            { label: "Estado", value: <Badge tone={TONO_LLAMADA[c.status] ?? "neutral"}>{c.estado}</Badge> }, { label: "Marca", value: c.marca ?? "—" },
            { label: "Desde", value: c.from_e164 }, { label: "Hacia", value: c.to_e164 },
            { label: c.ficha.tipo === "CLIENTE" ? "Cliente" : "Lead", value: c.ficha.id ? <Link href={c.ficha.tipo === "CLIENTE" ? `/m/crm/crm-04?id=${c.ficha.id}` : `/m/crm/crm-05?id=${c.ficha.id}`} className="font-semibold text-primary hover:underline">{c.ficha.nombre ?? "—"}</Link> : "—" },
            { label: "Vendedora", value: c.vendedora ?? "—" }, { label: "Opción del menú", value: c.menu_option ?? "—" }, { label: "Pedido", value: c.pedido ?? "—" },
            { label: "Atendida", value: c.answered_at ? fechaHora(c.answered_at) : "—" }, { label: "Terminó", value: c.ended_at ? fechaHora(c.ended_at) : "—" },
            { label: "Espera", value: segundos(c.wait_seconds) }, { label: "Duración", value: segundos(c.duration_seconds) },
            { label: "Aviso de grabación", value: c.notice_played ? "Reproducido" : "No" },
            { label: "Grabación", value: c.grabacion ? `${c.grabacion.status === "AVAILABLE" ? "Disponible" : "Purgada"}${c.grabacion.status === "AVAILABLE" ? ` hasta el ${fecha(c.grabacion.retention_until)}` : ""}${c.grabacion.legal_hold ? " · retención legal" : ""}` : "Sin grabación" },
            { label: "Costo", value: c.cost_usd !== null ? `USD ${c.cost_usd.toFixed(4)}` : "—" }, { label: "Identificador del proveedor", value: <span className="font-mono text-[12px]">{c.provider_call_id}</span> },
          ]} />
          {c.tarea && (
            <section className="grid gap-1 rounded-lg border border-line p-3 text-[13px]">
              <p className="font-semibold text-ink">Tarea de devolver la llamada</p>
              <p>{c.tarea.responsable ?? "Sin responsable"} · vence {fechaHora(c.tarea.due_at)} · {c.tarea.status === "OPEN" ? "abierta" : "hecha"}</p>
              {c.tarea.done_at && <p className="text-muted">Hecha el {fechaHora(c.tarea.done_at)}{c.tarea.result ? `: ${c.tarea.result}` : ""}</p>}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
