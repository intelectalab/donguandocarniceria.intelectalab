"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { IconButton, Input } from "@/components/ui";
import { api } from "@/lib/api";

export type ClienteBuscado = { id: string; full_name: string; phone: string | null; customer_type: string; referral_code: string | null; orders_count: number | null };

/** Busca un cliente activo por nombre, teléfono o documento (mínimo 2 letras) y lo deja elegido. */
export function BuscarCliente({ valor, onChange, placeholder = "Nombre, teléfono o documento…" }: { valor: ClienteBuscado | null; onChange: (c: ClienteBuscado | null) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ClienteBuscado[]>([]);
  useEffect(() => {
    if (valor || q.trim().length < 2) return;
    let vigente = true;
    const t = setTimeout(() => { api<ClienteBuscado[]>(`/v1/cmp/clientes/buscar?q=${encodeURIComponent(q.trim())}`).then((x) => vigente && setRes(x)).catch(() => vigente && setRes([])); }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [q, valor]);

  if (valor) return (
    <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">
      <div className="min-w-0"><p className="truncate font-medium">{valor.full_name}</p><p className="truncate text-[12px] text-muted">{valor.phone ?? "Sin teléfono"}{valor.orders_count != null ? ` · ${valor.orders_count} pedidos` : ""}</p></div>
      <IconButton icon={X} label="Cambiar cliente" onClick={() => { onChange(null); setQ(""); setRes([]); }} />
    </div>
  );
  const visibles = q.trim().length < 2 ? [] : res;
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Buscar cliente" />
      {visibles.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {visibles.map((c) => (
            <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => onChange(c)}>
              <span className="block font-medium">{c.full_name}</span><span className="block text-[12px] text-muted">{c.phone ?? "Sin teléfono"}{c.referral_code ? ` · ${c.referral_code}` : ""}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
