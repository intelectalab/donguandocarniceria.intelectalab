import type { ReactNode } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui";

/** Tarjeta con título para agrupar datos en las pantallas del mostrador. */
export function Seccion({ titulo, acciones, children, className = "" }: { titulo?: string; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      {(titulo || acciones) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-[14.5px] font-semibold text-ink">{titulo}</h2>}
          {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Mensaje de pantalla vacía o de carga. */
export function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}

/** Aviso cuando la acción pide un turno abierto (RN-POS-03 y RN-POS-05). */
export function SinTurno({ abrir, texto = "Para vender o cobrar necesitas un turno de caja abierto." }: { abrir: boolean; texto?: string }) {
  return (
    <Alert tone="warn" title="No tienes un turno abierto">
      {texto}{" "}
      {abrir
        ? <Link href="/m/pos/pos-01" className="font-medium text-primary underline">Abrir turno</Link>
        : "Pide a la cajera o a la supervisora que abra uno."}
    </Alert>
  );
}

/** Fila «etiqueta … monto» para resúmenes de caja. */
export function Renglon({ label, valor, fuerte, tono }: { label: ReactNode; valor: ReactNode; fuerte?: boolean; tono?: "ok" | "bad" | "warn" }) {
  const color = tono === "bad" ? "text-bad" : tono === "ok" ? "text-ok" : tono === "warn" ? "text-warn" : "text-ink";
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 text-[13.5px] ${fuerte ? "border-t border-line pt-2 font-semibold" : ""}`}>
      <span className="min-w-0 text-muted">{label}</span>
      <span className={`shrink-0 tabular-nums ${color}`}>{valor}</span>
    </div>
  );
}

/** Avisos del mostrador (cierres por aprobar, turno de otro día, comprobantes en reintento) con enlace. */
export function Alertas({ alertas, salvo }: { alertas: { tono: "info" | "warn" | "bad"; texto: string; pantalla: string }[]; salvo?: string }) {
  const lista = alertas.filter((a) => a.pantalla !== salvo);
  if (!lista.length) return null;
  return (
    <div className="space-y-2">
      {lista.map((a) => (
        <Alert key={a.texto} tone={a.tono}>
          {a.texto} <Link href={`/m/pos/${a.pantalla}`} className="font-medium underline">Ver</Link>
        </Alert>
      ))}
    </div>
  );
}
