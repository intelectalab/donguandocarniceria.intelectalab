"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import type { Opciones } from "./tipos";

export { useDatos, qs, num, accion, CifraLink, FiltroSelect, Barras, useAlAbrir } from "@/modulos/alm/comunes";
export { Seccion, Tabla } from "@/modulos/pro/comunes";

let cacheOpciones: Promise<Opciones> | null = null;

/** Opciones de CAL (checklists, usuarios, equipos, productos…), una vez por carga de página. */
export function useOpcionesCal(): Opciones | null {
  const [op, setOp] = useState<Opciones | null>(null);
  useEffect(() => {
    let vigente = true;
    cacheOpciones ??= api<Opciones>("/v1/cal/opciones");
    cacheOpciones.then((o) => vigente && setOp(o)).catch((e) => { cacheOpciones = null; toast.error(mensajeDe(e)); });
    return () => { vigente = false; };
  }, []);
  return op;
}
export const olvidarOpcionesCal = () => { cacheOpciones = null; };

export const opcionesDe = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));
export const opcionesEt = (m: Record<string, [string, unknown]>) => Object.entries(m).map(([value, [label]]) => ({ value, label }));

/** Temperatura con signo y °C. */
export const grados = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : `${Number(v).toLocaleString("es-PE", { maximumFractionDigits: 1 })} °C`);
