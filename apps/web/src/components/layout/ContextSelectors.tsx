"use client";

import { useSesion } from "@/lib/sesion";

/**
 * Marca y local del contexto. Filtran las listas de los
 * módulos; con una sola opción no hay nada que elegir y no se muestra.
 * variant "sidebar": bajo la empresa en la barra lateral; "header": sobre fondo claro (pantallas que lo necesiten).
 */
export default function ContextSelectors({ variant }: { variant: "header" | "sidebar" }) {
  const { me, marca, local, setMarca, setLocal } = useSesion();
  const marcas = me.brands.map((b) => ({ id: b.id, nombre: b.name, color: b.primary_color }));
  const locales = me.establishments.map((e) => ({ id: e.id, nombre: e.name }));
  return (
    <>
      <Selector variant={variant} etiqueta="Marca" todas="Todas las marcas" valor={marca} onChange={setMarca} opciones={marcas} />
      <Selector variant={variant} etiqueta="Local" todas="Todos los locales" valor={local} onChange={setLocal} opciones={locales} />
    </>
  );
}

function Selector({ variant, etiqueta, todas, valor, onChange, opciones }: {
  variant: "header" | "sidebar"; etiqueta: string; todas: string; valor: string; onChange: (v: string) => void;
  opciones: { id: string; nombre: string; color?: string }[];
}) {
  if (opciones.length <= 1) return null;
  const color = opciones.find((o) => o.id === valor)?.color;
  const estilo = variant === "header"
    ? "h-10 rounded-[10px] border border-line bg-surface px-2.5 text-[13px] text-ink hover:border-primary"
    : "h-9 rounded-lg bg-white/10 px-2.5 text-[12.5px] text-white";
  return (
    <label className={`flex min-w-0 items-center gap-1.5 ${estilo}`} title={etiqueta}>
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color ?? "transparent", boxShadow: color ? undefined : "inset 0 0 0 1.5px currentColor" }} />
      <span className="sr-only">{etiqueta}</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)}
        className={`min-w-0 flex-1 cursor-pointer truncate bg-transparent outline-none ${variant === "header" ? "max-w-[150px]" : "[&>option]:text-ink"}`}>
        <option value="ALL">{todas}</option>
        {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
      </select>
    </label>
  );
}
