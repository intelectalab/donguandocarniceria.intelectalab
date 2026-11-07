"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { CornerDownLeft, LayoutGrid, Search } from "lucide-react";
import { api } from "@/lib/api";

export type SearchScreen = { label: string; href: string; group?: string; code?: string; sub?: string };

/** Respuesta de GET /v1/plt/buscar (PLT-02). */
export type ResultadoBusqueda = { tipo: string; modulo: string; id: string; titulo: string; detalle: string | null; url: string };
type RespuestaBusqueda = { q: string; corta: boolean; total: number; resultados: ResultadoBusqueda[]; tipos: Record<string, string> };

/**
 * Botón de la cabecera + diálogo de búsqueda (Ctrl K o «/»): pantallas a las que la persona puede
 * entrar y, desde 3 letras, clientes, pedidos, comprobantes, productos, trabajadores y lo que
 * publican los módulos (PLT-02). La API respeta módulos, permisos y alcance.
 */
export default function GlobalSearch({ screens }: { screens: SearchScreen[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = query.trim();
  const [busqueda, setBusqueda] = useState<RespuestaBusqueda | null>(null);
  const [buscando, setBuscando] = useState(false);

  // Registros: se piden a la API un momento después de dejar de escribir.
  useEffect(() => {
    if (!open || term.length < 3) return;
    let vigente = true;
    const t = setTimeout(() => {
      setBuscando(true);
      api<RespuestaBusqueda>(`/v1/plt/buscar?q=${encodeURIComponent(term)}`)
        .then((r) => vigente && setBusqueda(r)).catch(() => {}).finally(() => vigente && setBuscando(false));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [open, term]);

  function close() {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }

  // Ctrl K (o Cmd K) abre y cierra el buscador desde cualquier pantalla.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Con el buscador abierto, lo cierra. Con otro modal abierto no se abre encima.
        setOpen((v) => (v ? false : !document.querySelector('[aria-modal="true"]')));
      } else if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // «/» abre la búsqueda, salvo que se esté escribiendo en un campo.
        const t = event.target as HTMLElement | null;
        if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
        if (document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const entries = useMemo(() => {
    const needle = term.toLowerCase();
    const pantallas = screens.filter((s) => !needle || `${s.label} ${s.group ?? ""} ${s.code ?? ""}`.toLowerCase().includes(needle))
      .map((s) => ({ ...s, group: s.group ? `Pantallas · ${s.group}` : "Pantallas" }));
    // Los registros solo si la respuesta es de lo que está escrito ahora.
    const registros: SearchScreen[] = busqueda && busqueda.q === term && term.length >= 3
      ? busqueda.resultados.map((r) => ({ label: r.titulo, sub: r.detalle ?? undefined, href: r.url, group: busqueda.tipos[r.tipo] ?? "Otros", code: r.modulo }))
      : [];
    // Agrupados por tipo, en el orden en que llegan los tipos.
    const orden = [...new Set(registros.map((r) => r.group))];
    return [...orden.flatMap((g) => registros.filter((r) => r.group === g)), ...pantallas];
  }, [screens, term, busqueda]);

  const verTodo = term.length >= 3 ? `/m/plt/plt-02?q=${encodeURIComponent(term)}` : null;

  function choose(s: SearchScreen) {
    router.push(s.href);
    close();
  }

  function onInputKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((i) => Math.min(i + 1, entries.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && entries[selected]) {
      event.preventDefault();
      choose(entries[selected]);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Buscar (Ctrl+K)"
        className="hidden h-10 w-[min(300px,26vw)] cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-surface-2 pr-2 pl-3 text-[13px] text-muted transition-colors hover:border-primary lg:flex">
        <Search size={17} className="shrink-0" />
        <span className="flex-1 truncate text-left">Buscar en el sistema…</span>
        <kbd className="rounded-[5px] border border-line bg-surface px-1.5 py-px text-[10.5px]">Ctrl K</kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} aria-label="Buscar"
        className="relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-primary transition-colors hover:bg-primary-soft lg:hidden">
        <Search size={20} />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[300] flex items-start justify-center bg-[var(--overlay)] px-4 pt-[12vh]"
          onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <div role="dialog" aria-modal="true" aria-label="Buscar en el sistema"
            className="w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_20px_50px_rgba(40,8,18,0.28)]">
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={18} className="shrink-0 text-muted" />
              <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setSelected(0); }} onKeyDown={onInputKeyDown}
                placeholder="Busca clientes, pedidos, comprobantes, productos o pantallas…" aria-label="Texto a buscar"
                className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted" />
              <kbd className="rounded-[5px] border border-line bg-surface-2 px-1.5 py-px text-[10.5px] text-muted">Esc</kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto py-1.5">
              {entries.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-muted">{buscando ? "Buscando…" : term ? `Sin resultados para «${term}».` : "Escribe para buscar."}</p>
              ) : (
                entries.map((s, index) => {
                  const firstOfGroup = index === 0 || entries[index - 1].group !== s.group;
                  return (
                    <div key={`${s.group}-${s.href}-${index}`}>
                      {firstOfGroup && s.group && (
                        <div className="px-4 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.09em] text-muted uppercase">{s.group}</div>
                      )}
                      <button type="button" onClick={() => choose(s)} onMouseMove={() => setSelected(index)} aria-current={index === selected}
                        className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left ${index === selected ? "bg-primary-soft" : ""}`}>
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-primary">
                          {s.code ? <span className="font-mono text-[10px] font-semibold">{s.code}</span> : <LayoutGrid size={16} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-ink">{s.label}</span>
                          {s.sub && <span className="block truncate text-[12px] text-muted">{s.sub}</span>}
                        </span>
                        {index === selected && <CornerDownLeft size={14} className="shrink-0 text-muted" />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            {verTodo && (
              <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-[12.5px] text-muted">
                <span>{buscando ? "Buscando…" : busqueda && busqueda.q === term ? `${busqueda.total} registro${busqueda.total === 1 ? "" : "s"} encontrado${busqueda.total === 1 ? "" : "s"}` : ""}</span>
                <button type="button" onClick={() => { router.push(verTodo); close(); }} className="cursor-pointer font-medium text-primary hover:underline">Ver todos los resultados</button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
