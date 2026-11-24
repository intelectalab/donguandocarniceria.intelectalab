"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, Lock } from "lucide-react";
import { fecha, soles } from "@/lib/formato";

export type AvisoSuscripcion = {
  status: string; deuda: number; dias: number; solo_lectura_desde: string | null; trial_ends_at: string | null;
  cancel_effective_on: string | null; conservacion_hasta: string | null;
};

/**
 * SUS-08 Aviso de mora y solo lectura: franja en toda la aplicación con los días de mora y el botón de pago; en solo
 * lectura explica qué se puede hacer. También avisa una prueba por vencer sin tarjeta y una cancelación pedida.
 */
export function FranjaSuscripcion({ a, puedePagar }: { a: AvisoSuscripcion; puedePagar: boolean }) {
  const [tono, Icono, texto] = a.status === "READ_ONLY"
    ? ["bg-bad text-white", Lock, `Tu empresa está en solo lectura por un pago pendiente de ${soles(a.deuda)}: puedes consultar, exportar y pagar, pero no registrar nada nuevo.`]
    : a.status === "PAST_DUE"
      ? ["bg-warn text-black", AlertTriangle, `Tienes un pago vencido hace ${a.dias} día(s) (${soles(a.deuda)}).${a.solo_lectura_desde ? ` Si no se paga, el ${fecha(a.solo_lectura_desde)} pasa a solo lectura.` : ""}`]
      : a.status === "CANCELLED"
        ? ["bg-surface-2 text-ink", Lock, `Tu suscripción está cancelada: puedes consultar y exportar tus datos${a.conservacion_hasta ? ` hasta el ${fecha(a.conservacion_hasta)}` : ""}.`]
        : a.trial_ends_at
          ? ["bg-primary-soft text-ink", CalendarClock, `Tu prueba termina el ${fecha(a.trial_ends_at)}. Registra tu tarjeta para seguir sin interrupciones.`]
          : ["bg-surface-2 text-ink", CalendarClock, `Pediste cancelar tu suscripción: se cancela el ${fecha(a.cancel_effective_on)}.`];
  const accion = a.status === "READ_ONLY" || a.status === "PAST_DUE" ? "Pagar" : a.trial_ends_at ? "Registrar tarjeta" : "Ver mi suscripción";
  const destino = a.status === "READ_ONLY" || a.status === "PAST_DUE" ? "/suscripcion?tab=comprobantes" : a.trial_ends_at ? "/suscripcion?tab=pago" : "/suscripcion";

  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] font-semibold sm:px-6 ${tono}`}>
      <Icono size={16} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1">{texto}</span>
      {puedePagar && <Link href={destino} className="rounded-md bg-black/10 px-2.5 py-1 text-[12.5px] font-semibold hover:bg-black/20">{accion}</Link>}
    </div>
  );
}
