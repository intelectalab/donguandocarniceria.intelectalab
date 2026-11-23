"use client";

import { Clock } from "lucide-react";
import { Badge, StatusBadge, type Tone } from "@/components/ui";
import { fechaHora } from "@/lib/formato";

// Tickets de soporte: lo que comparten la pantalla de la empresa (Soporte) y la bandeja de la consola.

export type Plazo = { estado: "PENDIENTE" | "VENCIDO" | "CUMPLIDO" | "FUERA_DE_PLAZO" | "SIN_RESPUESTA"; vence: string };
export type TicketFila = {
  id: string; tenant_id: string; tenant_short: string | null; number: string; subject: string; category: string; category_name: string;
  priority: string; priority_name: string; status: string; status_name: string; opened_by_name: string; opened_at: string;
  assigned_platform_user: string | null; assigned_name: string | null; first_response_at: string | null; resolved_at: string | null;
  closed_at: string | null; satisfaction: number | null; plazo: Plazo;
};
export type Mensaje = { author_type: "CUSTOMER" | "PLATFORM" | "SYSTEM"; author_name: string; body: string; status_to: string | null; status_to_name: string | null; created_at: string };
export type Ticket = TicketFila & { description: string; mensajes: Mensaje[] };

export const ESTADOS_TICKET: Record<string, [string, Tone]> = {
  OPEN: ["Abierto", "warn"], IN_PROGRESS: ["En proceso", "info"], WAITING_CUSTOMER: ["Espera respuesta del cliente", "neutral"],
  RESOLVED: ["Resuelto", "ok"], CLOSED: ["Cerrado", "neutral"],
};
const TONO_PRIORIDAD: Record<string, Tone> = { URGENT: "bad", HIGH: "warn", NORMAL: "neutral", LOW: "neutral" };

export function EstadoTicket({ t, paraEmpresa }: { t: Pick<TicketFila, "status">; paraEmpresa?: boolean }) {
  const labels = paraEmpresa ? { ...ESTADOS_TICKET, WAITING_CUSTOMER: ["Espera tu respuesta", "warn"] as [string, Tone] } : ESTADOS_TICKET;
  return <StatusBadge status={t.status} labels={labels} />;
}

export function PrioridadTicket({ t }: { t: Pick<TicketFila, "priority" | "priority_name"> }) {
  return <Badge tone={TONO_PRIORIDAD[t.priority] ?? "neutral"}>{t.priority_name}</Badge>;
}

/** Plazo de la primera respuesta de soporte. */
export function PlazoTicket({ p }: { p: Plazo }) {
  const texto = {
    PENDIENTE: `Responder antes del ${fechaHora(p.vence)}`, VENCIDO: `Venció el ${fechaHora(p.vence)}`, CUMPLIDO: "Respondido a tiempo",
    FUERA_DE_PLAZO: "Respondido fuera de plazo", SIN_RESPUESTA: "Cerrado sin respuesta",
  }[p.estado];
  const tono = p.estado === "VENCIDO" || p.estado === "FUERA_DE_PLAZO" ? "text-bad" : p.estado === "CUMPLIDO" ? "text-ok" : "text-muted";
  return <span className={`inline-flex items-center gap-1 text-[12px] ${tono}`}><Clock size={12} aria-hidden="true" />{texto}</span>;
}

/** Conversación del ticket: el pedido inicial y luego cada mensaje; los cambios de estado van como notas. */
export function Conversacion({ t, lado }: { t: Ticket; lado: "empresa" | "consola" }) {
  const propio = (m: Mensaje) => (lado === "empresa" ? m.author_type === "CUSTOMER" : m.author_type === "PLATFORM");
  return (
    <ol className="grid gap-3">
      <Burbuja propio={lado === "empresa"} autor={t.opened_by_name} rotulo={lado === "consola" ? t.tenant_short ?? "Cliente" : null} fecha={t.opened_at} texto={t.description} />
      {t.mensajes.map((m, i) => m.author_type === "SYSTEM" ? (
        <li key={i} className="text-center text-[12px] text-muted">{m.body} · {fechaHora(m.created_at)}</li>
      ) : (
        <Burbuja key={i} propio={propio(m)} autor={m.author_name} rotulo={m.author_type === "PLATFORM" ? "Soporte GestionCarnica" : null}
          fecha={m.created_at} texto={m.body} estado={m.status_to_name} />
      ))}
    </ol>
  );
}

function Burbuja({ propio, autor, rotulo, fecha, texto, estado }: { propio: boolean; autor: string; rotulo: string | null; fecha: string; texto: string; estado?: string | null }) {
  return (
    <li className={`flex ${propio ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-xl border px-3.5 py-2.5 ${propio ? "border-primary/25 bg-primary-soft" : "border-line bg-surface-2"}`}>
        <p className="text-[12px] text-muted"><strong className="font-semibold text-ink">{autor}</strong>{rotulo ? ` · ${rotulo}` : ""} · {fechaHora(fecha)}</p>
        <p className="mt-1 text-[13.5px] whitespace-pre-wrap text-ink">{texto}</p>
        {estado && <p className="mt-1.5 text-[12px] text-muted">Pasó a: {estado}</p>}
      </div>
    </li>
  );
}
