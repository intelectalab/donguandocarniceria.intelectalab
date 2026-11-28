"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, FiltroFecha, FiltroSelect, StatusBadge, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { inicioMes, type Opciones } from "./tipos";

/** Tarjeta con título para agrupar datos en las pantallas de PER. */
export function Seccion({ titulo, acciones, children, className = "" }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
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

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}

/** GET a la API con recarga. Sin url (null) no pide nada. */
export function useDatos<T>(url: string | null) {
  const [estado, setEstado] = useState<{ url: string; datos?: T; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!url) return;
    let vigente = true;
    api<T>(url).then((d) => vigente && setEstado({ url, datos: d })).catch((e) => vigente && setEstado({ url, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [url, version]);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  const actual = estado && estado.url === url ? estado : null;
  return { datos: actual?.datos ?? null, error: actual?.error ?? "", cargando: Boolean(url) && !actual, recargar };
}

export function useOpciones() {
  return useDatos<Opciones>("/v1/per/opciones");
}

/** Aviso cuando el rol entra a una pantalla que no le toca. */
export function SinPermiso({ que }: { que: string }) {
  return <Alert tone="info" title="Esta pantalla no es de tu rol">{que} Si lo necesitas, pídelo a quien administra los roles.</Alert>;
}

/** Error de carga: si es de permisos, el aviso amable; si no, el mensaje. */
export function ErrorCarga({ error, que }: { error: string; que: string }) {
  return /permiso|rol|corresponde|es del|es de|no tiene acceso|Ley 29733/i.test(error) ? <SinPermiso que={que} /> : <Alert tone="bad">{error}</Alert>;
}

export const Estado = ({ s, labels }: { s: string | null | undefined; labels: Record<string, [string, Tone]> }) => <StatusBadge status={s} labels={labels} />;

/** Filtro de mes (AAAA-MM-01). */
export function FiltroMes({ value, onChange, etiqueta = "Mes" }: { value: string; onChange: (v: string) => void; etiqueta?: string }) {
  return <FiltroFecha etiqueta={etiqueta} tipo="month" value={value.slice(0, 7)} onChange={(v) => v && onChange(inicioMes(`${v}-01`))} />;
}

export function FiltroLocal({ op, value, onChange, todos = true }: { op: Opciones | null; value: string; onChange: (v: string) => void; todos?: boolean }) {
  return <FiltroSelect etiqueta="Local" value={value} onChange={onChange} vacio={todos ? undefined : "Elige"} options={(op?.locales ?? []).map((l) => ({ value: l.id, label: l.short }))} />;
}

/** Texto de un monto que la persona no puede ver (RN-PER-19). */
export const OCULTO = "•••";
