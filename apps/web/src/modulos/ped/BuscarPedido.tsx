"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, type Pagina } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { StatusBadge } from "@/components/ui";
import { ESTADOS, franjaTexto, type PedidoFila } from "./tipos";

/**
 * Lista corta de pedidos para elegir uno (PED-05, PED-08, PED-09): busca por número, cliente o
 * celular entre los estados indicados.
 */
export function BuscarPedido({ estados, onElegir, vacio = "No hay pedidos en ese estado." }:
  { estados: string[]; onElegir: (id: string) => void; vacio?: string }) {
  const [texto, setTexto] = useState("");
  const [filas, setFilas] = useState<PedidoFila[] | null>(null);
  const clave = estados.join(",");

  useEffect(() => {
    let vigente = true;
    const t = setTimeout(() => {
      api<Pagina<PedidoFila>>(`/v1/ped/pedidos?vista=TODOS&status=${clave}&per_page=40&sort=delivery_date&q=${encodeURIComponent(texto.trim())}`)
        .then((p) => vigente && setFilas(p.data))
        .catch(() => vigente && setFilas([]));
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [texto, clave]);

  return (
    <div className="space-y-3">
      <div className="relative w-full sm:max-w-[380px]">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Número de pedido, cliente o celular…" aria-label="Buscar pedido"
          className="h-10 w-full rounded-[9px] border border-line bg-surface pr-3 pl-9 text-[13.5px] text-ink outline-none focus:border-primary" />
      </div>
      {filas === null ? <p className="text-[13px] text-muted">Cargando…</p> : filas.length === 0 ? <p className="text-[13px] text-muted">{vacio}</p> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {filas.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => onElegir(o.id)} className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-ink">{o.number} · {o.cliente}</span>
                  <span className="block text-[12px] text-muted">{o.marca} · {fecha(o.delivery_date)} {franjaTexto(o.slot_from, o.slot_to)} · {o.zona ?? "sin zona"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[13px] text-ink">{soles(o.final_total ?? o.estimated_total)}</span>
                  <StatusBadge status={o.status} labels={ESTADOS} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
