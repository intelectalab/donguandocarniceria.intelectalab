"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { api, type Pagina } from "@/lib/api";
import { celular, type ClienteFila } from "./tipos";

/**
 * Buscador de cliente por celular, nombre o documento, para las pantallas que trabajan sobre uno
 * (CLI-04, CLI-05, CLI-07). Al elegir, llama a onElegir con el id.
 */
export function BuscarCliente({ onElegir, placeholder = "Buscar otro cliente: celular, nombre o documento…" }: { onElegir: (id: string) => void; placeholder?: string }) {
  const [texto, setTexto] = useState("");
  const [res, setRes] = useState<{ q: string; filas: ClienteFila[]; pos: Posicion } | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const q = texto.trim();

  useEffect(() => {
    if (q.length < 3) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Pagina<ClienteFila>>(`/v1/cli/clientes?per_page=8&q=${encodeURIComponent(q)}`)
        .then((p) => vigente && setRes({ q, filas: p.data, pos: posicion(caja.current) })).catch(() => {});
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);

  const filas = q.length >= 3 && res?.q === q ? res.filas : [];

  const pos = res?.pos;

  // La lista va en un portal con posición fija: así no la corta la cabecera ni una tarjeta con overflow.
  useEffect(() => {
    if (!filas.length) return;
    const cerrar = (e: Event) => { if (!(e.target instanceof Node && lista.current?.contains(e.target))) setRes(null); };
    window.addEventListener("resize", cerrar);
    window.addEventListener("scroll", cerrar, true);
    return () => { window.removeEventListener("resize", cerrar); window.removeEventListener("scroll", cerrar, true); };
  }, [filas.length]);

  return (
    <div ref={caja} className="relative w-full sm:max-w-[380px]">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} aria-label="Buscar cliente"
        onKeyDown={(e) => { if (e.key === "Escape") setTexto(""); }}
        className="h-9 w-full rounded-[9px] border border-line bg-surface pr-3 pl-9 text-[13.5px] text-ink outline-none focus:border-primary" />
      {filas.length > 0 && pos && createPortal(
        <ul ref={lista} role="listbox" aria-label="Clientes encontrados" style={{ top: pos.top, left: pos.left, width: pos.width }}
          className="fixed z-[1000] max-h-80 overflow-auto rounded-[9px] border border-line bg-surface py-1 shadow-card">
          {filas.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { setTexto(""); onElegir(c.id); }}
                className="flex w-full cursor-pointer items-start justify-between gap-3 px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="block font-medium">{c.trade_name || c.full_name}</span>
                  {c.trade_name && <span className="block text-[12px] text-muted">{c.full_name}</span>}
                </span>
                <span className="shrink-0 font-mono text-[12px] whitespace-nowrap text-muted">{celular(c.phone)}</span>
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}

type Posicion = { top: number; left: number; width: number };

/** Debajo del buscador, al menos 340 px de ancho y sin salirse de la pantalla. */
function posicion(el: HTMLElement | null): Posicion {
  const r = el?.getBoundingClientRect() ?? { bottom: 0, left: 0, width: 340 };
  const width = Math.min(Math.max(r.width, 340), window.innerWidth - 16);
  return { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width };
}
