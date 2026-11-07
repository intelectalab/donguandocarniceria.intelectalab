"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Layers, MapPin } from "lucide-react";
import { useSesion } from "@/lib/sesion";

/**
 * Marca y local del contexto. Filtran las listas de los módulos; con una sola opción no hay nada
 * que elegir y no se muestra.
 * variant "sidebar": bajo la empresa en la barra lateral; "header": sobre fondo claro.
 */
export default function ContextSelectors({ variant }: { variant: "header" | "sidebar" }) {
  const { me, marca, local, setMarca, setLocal } = useSesion();
  const marcas = me.brands.map((b) => ({ id: b.id, nombre: b.name, color: b.primary_color }));
  const locales = me.establishments.map((e) => ({ id: e.id, nombre: e.name }));
  return (
    <>
      <Selector variant={variant} etiqueta="Marca" todas="Todas las marcas" valor={marca} onChange={setMarca} opciones={marcas} tipo="marca" />
      <Selector variant={variant} etiqueta="Local" todas="Todos los locales" valor={local} onChange={setLocal} opciones={locales} tipo="local" />
    </>
  );
}

type Opcion = { id: string; nombre: string; color?: string };

/** Punto de color de la marca, o el ícono de «todas» o de local. */
function Icono({ tipo, color, todas }: { tipo: "marca" | "local"; color?: string; todas?: boolean }) {
  if (todas) {
    return tipo === "marca" ? <Layers size={14} aria-hidden="true" className="shrink-0 opacity-80" /> : <MapPin size={14} aria-hidden="true" className="shrink-0 opacity-80" />;
  }
  if (tipo === "local") return <MapPin size={14} aria-hidden="true" className="shrink-0 opacity-80" />;
  // Solo colores #RRGGBB llegan al estilo.
  const c = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : undefined;
  return <span aria-hidden="true" className="block size-2.5 shrink-0 rounded-full ring-2 ring-white/70" style={{ background: c ?? "currentColor" }} />;
}

/**
 * Desplegable propio (el del sistema operativo no se puede diseñar): lista con el punto de color
 * de cada marca y un check en la elegida. Teclado: flechas, Enter, Escape; escribir salta a la
 * opción que empieza con esa letra. Se dibuja sobre la página para que la barra lateral no lo recorte.
 */
function Selector({ variant, etiqueta, todas, valor, onChange, opciones, tipo }: {
  variant: "header" | "sidebar"; etiqueta: string; todas: string; valor: string; onChange: (v: string) => void;
  opciones: Opcion[]; tipo: "marca" | "local";
}) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const id = useId();

  const todasLas: Opcion[] = [{ id: "ALL", nombre: todas }, ...opciones];
  const elegida = todasLas.find((o) => o.id === valor) ?? todasLas[0];

  useLayoutEffect(() => {
    if (!abierto) return;
    const ubicar = () => {
      const r = boton.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 6, width: Math.max(r.width, 230) });
    };
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => { window.removeEventListener("resize", ubicar); window.removeEventListener("scroll", ubicar, true); };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    lista.current?.focus();
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boton.current?.contains(t) && !lista.current?.contains(t)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  if (opciones.length <= 1) return null;

  function abrir() {
    setActivo(Math.max(0, todasLas.findIndex((o) => o.id === valor)));
    setAbierto(true);
  }
  function elegir(o: Opcion) {
    onChange(o.id);
    setAbierto(false);
    boton.current?.focus();
  }
  function tecla(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActivo((i) => Math.min(i + 1, todasLas.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setActivo(0); }
    else if (e.key === "End") { e.preventDefault(); setActivo(todasLas.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(todasLas[activo]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAbierto(false); boton.current?.focus(); }
    else if (e.key === "Tab") setAbierto(false);
    else if (e.key.length === 1) {
      const i = todasLas.findIndex((o) => o.nombre.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActivo(i);
    }
  }

  const estilo = variant === "header"
    ? "h-10 rounded-[10px] border border-line bg-surface px-2.5 text-[13px] text-ink hover:border-primary"
    : `h-9 rounded-lg px-2.5 text-[12.5px] text-white transition-colors ${abierto ? "bg-white/20" : "bg-white/10 hover:bg-white/15"}`;

  return (
    <>
      <button ref={boton} type="button" onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={(e) => { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); abrir(); } }}
        aria-haspopup="listbox" aria-expanded={abierto} aria-controls={abierto ? id : undefined} aria-label={`${etiqueta}: ${elegida.nombre}`}
        className={`flex w-full min-w-0 cursor-pointer items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${estilo}`}>
        <Icono tipo={tipo} color={elegida.color} todas={elegida.id === "ALL"} />
        <span className={`min-w-0 flex-1 truncate ${variant === "header" ? "max-w-[150px]" : ""}`}>{elegida.nombre}</span>
        <ChevronDown size={15} aria-hidden="true" className={`shrink-0 opacity-80 transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>

      {abierto && pos && createPortal(
        <ul ref={lista} id={id} role="listbox" tabIndex={-1} aria-label={etiqueta} aria-activedescendant={`${id}-${activo}`} onKeyDown={tecla}
          style={{ left: pos.left, top: pos.top, width: pos.width }}
          className="fixed z-[350] max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-ink shadow-[0_20px_50px_rgba(40,8,18,0.28)] outline-none animate-[ui-fade_.12s_ease-out]">
          <li role="presentation" className="px-2.5 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.09em] text-muted uppercase">{etiqueta}</li>
          {todasLas.map((o, i) => {
            const sel = o.id === valor;
            return (
              <li key={o.id} id={`${id}-${i}`} role="option" aria-selected={sel}
                onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(o)} onMouseMove={() => setActivo(i)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${i === activo ? "bg-surface-2" : ""} ${sel ? "font-semibold text-primary" : ""}`}>
                <span className={`flex w-3.5 shrink-0 justify-center ${o.id === "ALL" ? "text-muted" : ""}`}><Icono tipo={tipo} color={o.color} todas={o.id === "ALL"} /></span>
                <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
                {sel && <Check size={15} aria-hidden="true" className="shrink-0" />}
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </>
  );
}
