"use client";

import { useEffect, useState } from "react";
import { UserRound, X } from "lucide-react";
import { IconButton, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { soles } from "@/lib/formato";
import type { Cliente } from "./tipos";

/** Identifica al cliente de la venta por celular, DNI, RUC o nombre (opcional: sin cliente va a «Clientes varios»). */
export function BuscarCliente({ cliente, onElegir }: { cliente: Cliente | null; onElegir: (c: Cliente | null) => void }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (q.trim().length < 3) return;
    let vigente = true;
    const t = setTimeout(() => {
      setBuscando(true);
      api<Cliente[]>(`/v1/pos/clientes?q=${encodeURIComponent(q.trim())}`)
        .then((r) => vigente && setLista(r))
        .catch(() => vigente && setLista([]))
        .finally(() => vigente && setBuscando(false));
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);

  if (cliente) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2">
        <UserRound size={18} className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-ink">{cliente.trade_name || cliente.full_name}</div>
          <div className="truncate text-[12px] text-muted">
            {[cliente.doc_type && cliente.doc_number ? `${cliente.doc_type} ${cliente.doc_number}` : "Sin documento", cliente.phone, cliente.saldo > 0 ? `saldo a favor ${soles(cliente.saldo)}` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        <IconButton icon={X} label="Quitar cliente" onClick={() => onElegir(null)} />
      </div>
    );
  }

  const mostrar = q.trim().length >= 3;
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente: celular, DNI, RUC o nombre (opcional)" aria-label="Buscar cliente" />
      {mostrar && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface shadow-card">
          {buscando && lista.length === 0 && <p className="px-3 py-2 text-[13px] text-muted">Buscando…</p>}
          {!buscando && lista.length === 0 && <p className="px-3 py-2 text-[13px] text-muted">Sin resultados. La venta puede ir sin cliente.</p>}
          {lista.map((c) => (
            <button key={c.id} type="button" onClick={() => { onElegir(c); setQ(""); setLista([]); }}
              className="block w-full cursor-pointer px-3 py-2 text-left hover:bg-surface-2">
              <div className="text-[13.5px] text-ink">{c.trade_name || c.full_name}{c.status !== "ACTIVE" && <span className="text-bad"> · {c.status === "BLOCKED" ? "bloqueado" : c.status.toLowerCase()}</span>}</div>
              <div className="text-[12px] text-muted">{[c.doc_type && c.doc_number ? `${c.doc_type} ${c.doc_number}` : null, c.phone, c.saldo > 0 ? `saldo ${soles(c.saldo)}` : null].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
