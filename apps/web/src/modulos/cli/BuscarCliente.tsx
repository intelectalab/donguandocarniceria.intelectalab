"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, type Pagina } from "@/lib/api";
import { celular, type ClienteFila } from "./tipos";

/**
 * Buscador de cliente por celular, nombre o documento, para las pantallas que trabajan sobre uno
 * (CLI-04, CLI-05, CLI-07). Al elegir, llama a onElegir con el id.
 */
export function BuscarCliente({ onElegir, placeholder = "Buscar otro cliente: celular, nombre o documento…" }: { onElegir: (id: string) => void; placeholder?: string }) {
  const [texto, setTexto] = useState("");
  const [res, setRes] = useState<{ q: string; filas: ClienteFila[] } | null>(null);
  const q = texto.trim();

  useEffect(() => {
    if (q.length < 3) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Pagina<ClienteFila>>(`/v1/cli/clientes?per_page=8&q=${encodeURIComponent(q)}`)
        .then((p) => vigente && setRes({ q, filas: p.data })).catch(() => {});
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);

  const filas = q.length >= 3 && res?.q === q ? res.filas : [];

  return (
    <div className="relative w-full sm:max-w-[380px]">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} aria-label="Buscar cliente"
        className="h-9 w-full rounded-[9px] border border-line bg-surface pr-3 pl-9 text-[13.5px] text-ink outline-none focus:border-primary" />
      {filas.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-[9px] border border-line bg-surface py-1 shadow-card">
          {filas.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { setTexto(""); onElegir(c.id); }}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                <span className="min-w-0 truncate">{c.trade_name || c.full_name}</span>
                <span className="shrink-0 font-mono text-[12px] text-muted">{celular(c.phone)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
