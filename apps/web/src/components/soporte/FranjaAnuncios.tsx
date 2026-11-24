"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Megaphone, Sparkles, Wrench, X, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { fechaHora } from "@/lib/formato";

type Anuncio = { id: string; title: string; body: string; kind: string; maintenance_starts_at: string | null; maintenance_ends_at: string | null };

const ESTILO: Record<string, [string, LucideIcon]> = {
  INCIDENT: ["border-bad/40 bg-bad-soft text-bad", AlertTriangle], MAINTENANCE: ["border-warn/40 bg-warn-soft text-warn", Wrench],
  FEATURE: ["border-primary/30 bg-primary-soft text-primary", Sparkles], INFO: ["border-line bg-surface-2 text-ink", Megaphone],
};
const CLAVE = "gc-anuncios-cerrados";
const leerCerrados = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
  } catch {
    return [];
  }
};

/**
 * Anuncios de GestionCarnica para esta empresa (OPS-11): incidentes, mantenimientos y novedades, en una franja arriba
 * del contenido. Cada persona puede cerrar uno (se recuerda en su navegador); se vuelve a consultar cada 5 minutos.
 */
export function FranjaAnuncios() {
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [cerrados, setCerrados] = useState<string[]>(leerCerrados);

  const cargar = useCallback(() => {
    api<{ data: Anuncio[] }>("/v1/anuncios").then((r) => setAnuncios(r.data)).catch(() => undefined);
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 300000);
    return () => clearInterval(t);
  }, [cargar]);

  function cerrar(id: string) {
    const nuevos = [...cerrados, id].slice(-50);
    setCerrados(nuevos);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(nuevos));
    } catch {
      // Sin almacenamiento del navegador solo se oculta por ahora.
    }
  }

  const visibles = anuncios.filter((a) => !cerrados.includes(a.id));
  if (!visibles.length) return null;
  return (
    <div className="mb-5 grid gap-2">
      {visibles.map((a) => {
        const [clase, Icono] = ESTILO[a.kind] ?? ESTILO.INFO;
        return (
          <div key={a.id} role="status" className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${clase}`}>
            <Icono size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">{a.title}</p>
              <p className="text-[13px] whitespace-pre-wrap text-ink">{a.body}</p>
              {a.maintenance_starts_at && (
                <p className="mt-1 text-[12.5px] text-ink">Mantenimiento: {fechaHora(a.maintenance_starts_at)} a {fechaHora(a.maintenance_ends_at)}</p>
              )}
            </div>
            <button type="button" aria-label="Ocultar este anuncio" onClick={() => cerrar(a.id)} className="cursor-pointer rounded p-1 opacity-70 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
