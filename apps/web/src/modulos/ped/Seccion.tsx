import type { ReactNode } from "react";

/** Tarjeta con título para agrupar datos en las pantallas de PED. */
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
