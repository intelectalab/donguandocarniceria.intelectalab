"use client";

import { useSyncExternalStore } from "react";
import { LayoutGrid, Table2 } from "lucide-react";

export type Vista = "tarjetas" | "tabla";

const EVENTO = "vista-cambiada";
const leer = (clave: string): Vista | null => {
  try {
    const v = localStorage.getItem(`vista.${clave}`);
    return v === "tarjetas" || v === "tabla" ? v : null;
  } catch {
    return null;   // sin almacenamiento (ventana privada): queda la inicial
  }
};
const suscribir = (aviso: () => void) => {
  window.addEventListener(EVENTO, aviso);
  window.addEventListener("storage", aviso);
  return () => { window.removeEventListener(EVENTO, aviso); window.removeEventListener("storage", aviso); };
};

/**
 * Vista de una lista en tarjetas o en tabla, recordada por pantalla en este navegador.
 *   const [vista, setVista] = useVista("consola.salud", "tabla");
 *   <VistaToggle value={vista} onChange={setVista} />
 */
export function useVista(clave: string, inicial: Vista): [Vista, (v: Vista) => void] {
  const vista = useSyncExternalStore(suscribir, () => leer(clave) ?? inicial, () => inicial);
  const cambiar = (v: Vista) => {
    try { localStorage.setItem(`vista.${clave}`, v); } catch { /* sin almacenamiento */ }
    window.dispatchEvent(new Event(EVENTO));
  };
  return [vista, cambiar];
}

export function VistaToggle({ value, onChange }: { value: Vista; onChange: (v: Vista) => void }) {
  const opciones = [{ v: "tarjetas" as const, nombre: "Tarjetas", Icono: LayoutGrid }, { v: "tabla" as const, nombre: "Tabla", Icono: Table2 }];
  return (
    <div role="group" aria-label="Ver como" className="inline-flex shrink-0 rounded-[9px] border border-line bg-surface p-0.5">
      {opciones.map(({ v, nombre, Icono }) => (
        <button key={v} type="button" aria-pressed={value === v} title={`Ver en ${nombre.toLowerCase()}`} onClick={() => onChange(v)}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${value === v
            ? "bg-primary text-white" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
          <Icono size={14} aria-hidden="true" />{nombre}
        </button>
      ))}
    </div>
  );
}
