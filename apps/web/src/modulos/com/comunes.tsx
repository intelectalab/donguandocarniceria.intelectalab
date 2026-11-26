"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import type { Opciones } from "./tipos";

export { useDatos, qs, num, accion, CifraLink, FiltroSelect, FiltroFecha, Barras, useAlAbrir, useParametrosIniciales } from "@/modulos/alm/comunes";

/** Una sola petición de opciones por módulo y carga de página. */
export function opcionesDe<T>(ruta: string) {
  let cache: Promise<T> | null = null;
  const usar = function useOpcionesModulo(): T | null {
    const [op, setOp] = useState<T | null>(null);
    useEffect(() => {
      let vigente = true;
      cache ??= api<T>(ruta);
      cache.then((o) => vigente && setOp(o)).catch((e) => { cache = null; toast.error(mensajeDe(e)); });
      return () => { vigente = false; };
    }, []);
    return op;
  };
  return { usar, olvidar: () => { cache = null; } };
}

const com = opcionesDe<Opciones>("/v1/com/opciones");
export const useOpcionesCom = com.usar;
export const olvidarOpcionesCom = com.olvidar;

/** Tarjeta de sección con título. */
export function Seccion({ titulo, acciones, children, className = "" }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      {(titulo || acciones) && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {titulo && <h2 className="text-[14px] font-semibold">{titulo}</h2>}
        {acciones}
      </div>}
      {children}
    </section>
  );
}

/** Quita referencias internas de la especificación que pudieran venir en textos de datos antiguos. */
export const limpio = (t: string | null | undefined) =>
  (t ?? "").replace(/\s*\((?:RN|CA|KPI|D)-[A-Z]{3}-\d+\)/g, "").replace(/\b(?:RN|CA|KPI|D)-[A-Z]{3}-\d+:\s*/g, "").replace(/(?:, | · )(?:RN|CA|KPI|D)-[A-Z]{3}-\d+/g, "");

/** Mes actual en formato AAAA-MM según la hora de Lima. */
export const mesActual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }).slice(0, 7);
export const hoyLima = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });

/** Nombre del mes: «octubre de 2026». */
export const nombreMes = (p: string | null | undefined) => {
  if (!p) return "—";
  const [a, m] = p.slice(0, 7).split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("es-PE", { month: "long", year: "numeric" });
};
