"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Alert, Badge, Select, StatusBadge, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useDatos, useParametrosIniciales } from "@/modulos/alm/comunes";
import { VERSION, type Opciones, type Version } from "./tipos";

export { useDatos, qs, num, accion, CifraLink, FiltroSelect } from "@/modulos/alm/comunes";

let cacheOpciones: Promise<Opciones> | null = null;

/** Opciones de los formularios de REC (productos, insumos, aditivos…), una vez por carga de página. */
export function useOpcionesRec(): Opciones | null {
  const [op, setOp] = useState<Opciones | null>(null);
  useEffect(() => {
    let vigente = true;
    cacheOpciones ??= api<Opciones>("/v1/rec/opciones");
    cacheOpciones.then((o) => vigente && setOp(o)).catch((e) => { cacheOpciones = null; toast.error(mensajeDe(e)); });
    return () => { vigente = false; };
  }, []);
  return op;
}
/** Después de cambiar el catálogo de aditivos, las opciones se vuelven a pedir. */
export const olvidarOpcionesRec = () => { cacheOpciones = null; };

type FilaVersion = { id: string; version: number; status: string; recipe_id: string; recipe_code: string; recipe_name: string };

/**
 * Versión elegida en las pantallas de una versión (REC-02 a REC-10). Sale de ?v= en la URL y se
 * recuerda ahí al cambiarla, para que los enlaces entre pantallas lleven la misma versión.
 */
export function useVersionElegida(estados?: string) {
  const p = useParametrosIniciales();
  const [elegida, setElegida] = useState<string | null>(null);
  const lista = useDatos<{ data: FilaVersion[] }>(`/v1/rec/versiones${estados ? `?status=${estados}` : ""}`).datos?.data;
  const deUrl = p?.get("v") ?? null;
  // Sin elegir: primero la que espera revisión, luego un borrador, luego la primera.
  const porDefecto = lista?.find((v) => v.status === "IN_REVIEW") ?? lista?.find((v) => v.status === "DRAFT") ?? lista?.[0];
  const id = elegida ?? deUrl ?? porDefecto?.id ?? null;
  const elegir = (v: string) => {
    setElegida(v);
    try { window.history.replaceState(null, "", `?v=${v}`); } catch { /* sin historial: solo en pantalla */ }
  };
  // Si la versión de la URL no está en la lista (otro estado), se agrega igual para que el selector la muestre.
  return { id, elegir, lista: lista ?? [], cargando: !lista && p !== null };
}

/** ?v= de la URL (null hasta que la página monta). */
export function useVersionDeUrl(): string | null {
  return useParametrosIniciales()?.get("v") ?? null;
}

/** Selector de versión: «RC-CHO · Chorizo parrillero · v2 (En revisión)». */
export function SelectorVersion({ id, lista, onChange, version }: { id: string | null; lista: FilaVersion[]; onChange: (id: string) => void; version?: Version | null }) {
  const opciones = lista.map((v) => ({ value: v.id, label: `${v.recipe_code} · ${v.recipe_name} · v${v.version} (${VERSION[v.status]?.[0] ?? v.status})` }));
  if (version && id && !lista.some((v) => v.id === id)) {
    opciones.unshift({ value: id, label: `${version.recipe_code} · ${version.recipe_name} · v${version.version} (${VERSION[version.status]?.[0] ?? version.status})` });
  }
  return (
    <div className="w-full sm:max-w-[520px]">
      <Select aria-label="Versión de receta" value={id ?? ""} onChange={(e) => onChange(e.target.value)} options={opciones} placeholder="Elegir receta y versión" />
    </div>
  );
}

const PANTALLAS = [
  ["rec-02", "Versión"], ["rec-03", "Ingredientes"], ["rec-05", "Pasos"], ["rec-06", "Puntos de control"], ["rec-07", "Revisión"],
  ["rec-08", "Escalado"], ["rec-09", "Costo"], ["rec-10", "Ficha técnica"],
] as const;

/** Enlaces a las otras pantallas de la misma versión. */
export function NavVersion({ v, actual, costos }: { v: Version; actual: string; costos: boolean }) {
  return (
    <nav aria-label="Pantallas de la versión" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[13px] font-semibold">{v.recipe_code} · {v.recipe_name} · v{v.version}</span>
      <StatusBadge status={v.status} labels={VERSION} />
      <span className="mx-1 hidden h-4 w-px bg-line sm:inline-block" aria-hidden="true" />
      {PANTALLAS.filter(([p]) => costos || p !== "rec-09").map(([p, label]) => (
        <Link key={p} href={`/m/rec/${p}?v=${v.id}`} aria-current={p === actual ? "page" : undefined}
          className={`rounded-full px-2.5 py-1 text-[12.5px] transition-colors ${p === actual ? "bg-primary-soft font-medium text-primary" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** RN-REC-03: aviso de versión cerrada o en revisión. */
export function AvisoCerrada({ v }: { v: Version }) {
  if (v.status === "DRAFT") return null;
  if (v.status === "IN_REVIEW") return <Alert tone="info" title="En revisión">Para cambiarla, Calidad o quien edita la devuelve a borrador.</Alert>;
  return (
    <Alert tone="warn" title={`Versión ${v.status === "APPROVED" ? "aprobada" : "retirada"}: no cambia`}>
      <span className="inline-flex items-center gap-1"><Lock size={13} aria-hidden="true" /> Ni ingredientes, ni pasos, ni puntos de control. Para cambiar la receta, crea una versión nueva.</span>
    </Alert>
  );
}

/** Alérgenos como etiquetas. */
export function Alergenos({ lista }: { lista: string[] }) {
  if (!lista.length) return <Badge tone="ok">Ninguno</Badge>;
  return <span className="flex flex-wrap gap-1">{lista.map((a) => <Badge key={a} tone="warn">{a}</Badge>)}</span>;
}

/** Carga la versión elegida con recarga. */
export function useVersion(id: string | null) {
  return useDatos<Version>(id ? `/v1/rec/versiones/${id}` : null);
}

/** Minutos legibles: 45 min, 2.5 h. */
export const tiempo = (min: number | string | null | undefined) => {
  if (min === null || min === undefined || min === "") return "—";
  const m = Number(min);
  return m >= 120 ? `${(m / 60).toLocaleString("es-PE", { maximumFractionDigits: 1 })} h` : `${m.toLocaleString("es-PE", { maximumFractionDigits: 1 })} min`;
};
