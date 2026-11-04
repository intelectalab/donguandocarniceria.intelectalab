"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { CornerDownLeft, LayoutGrid, Search } from "lucide-react";

export type SearchScreen = { label: string; href: string; group?: string; code?: string };

/**
 * Botón de la cabecera + diálogo de búsqueda (Ctrl K) sobre las pantallas a las que la persona
 * puede entrar. Cuando los módulos tengan registros (clientes, pedidos…), se suman aquí.
 */
export default function GlobalSearch({ screens }: { screens: SearchScreen[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = query.trim();

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
    return screens.filter((s) => !needle || `${s.label} ${s.group ?? ""} ${s.code ?? ""}`.toLowerCase().includes(needle));
  }, [screens, term]);

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
                placeholder="Busca un módulo o pantalla…" aria-label="Texto a buscar"
                className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted" />
              <kbd className="rounded-[5px] border border-line bg-surface-2 px-1.5 py-px text-[10.5px] text-muted">Esc</kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto py-1.5">
              {entries.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-muted">{term ? `Sin resultados para «${term}».` : "Escribe para buscar."}</p>
              ) : (
                entries.map((s, index) => {
                  const firstOfGroup = index === 0 || entries[index - 1].group !== s.group;
                  return (
                    <div key={s.href}>
                      {firstOfGroup && s.group && (
                        <div className="px-4 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.09em] text-muted uppercase">{s.group}</div>
                      )}
                      <button type="button" onClick={() => choose(s)} onMouseMove={() => setSelected(index)} aria-current={index === selected}
                        className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left ${index === selected ? "bg-primary-soft" : ""}`}>
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-primary">
                          {s.code ? <span className="font-mono text-[10px] font-semibold">{s.code}</span> : <LayoutGrid size={16} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{s.label}</span>
                        {index === selected && <CornerDownLeft size={14} className="shrink-0 text-muted" />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
