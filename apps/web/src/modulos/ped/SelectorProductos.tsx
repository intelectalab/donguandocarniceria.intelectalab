"use client";

import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { kg, numero, soles } from "@/lib/formato";
import { MODOS_VENTA, type Producto } from "./tipos";

/**
 * PED-04 Selector de productos: busca por nombre, SKU o código de barras dentro de la marca del
 * pedido; muestra el corte, el modo de venta, el precio vigente del canal y el stock disponible
 * del local. No permite texto libre (RN-PED-02). onElegir recibe el producto.
 */
export function SelectorProductos({ marca, canal, cliente, local, onElegir, elegidos = [] }:
  { marca: string; canal: string; cliente?: string; local?: string; onElegir?: (p: Producto) => void; elegidos?: string[] }) {
  const [texto, setTexto] = useState("");
  const [res, setRes] = useState<{ clave: string; filas: Producto[] } | null>(null);
  const clave = [marca, canal, cliente, local, texto.trim()].join("|");

  useEffect(() => {
    if (!marca) return;
    let vigente = true;
    const t = setTimeout(() => {
      const p = new URLSearchParams({ brand_id: marca, channel: canal, q: texto.trim() });
      if (cliente) p.set("customer_id", cliente);
      if (local) p.set("establishment_id", local);
      api<Producto[]>(`/v1/ped/productos?${p}`).then((f) => vigente && setRes({ clave, filas: f })).catch(() => vigente && setRes({ clave, filas: [] }));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [marca, canal, cliente, local, texto, clave]);

  if (!marca) return <p className="text-[13px] text-muted">Elige primero la marca del pedido.</p>;
  const filas = res?.clave === clave ? res.filas : null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, SKU o código de barras…" aria-label="Buscar producto"
          className="h-10 w-full rounded-[9px] border border-line bg-surface pr-3 pl-9 text-[13.5px] text-ink outline-none focus:border-primary" />
      </div>
      {filas === null ? <p className="text-[13px] text-muted">Buscando…</p> : filas.length === 0 ? (
        <p className="text-[13px] text-muted">No hay productos activos de esta marca con «{texto}». Solo se venden productos del catálogo.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {filas.map((p) => {
            const sinPrecio = p.precio === null;
            const ya = elegidos.includes(p.id);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 bg-surface px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-ink">{p.name}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    <span className="font-mono">{p.sku}</span>
                    <span>· {MODOS_VENTA[p.sale_mode] ?? p.sale_mode}{p.sale_mode === "UNIT_VARIABLE_WEIGHT" && p.nominal_weight_kg ? ` (~${kg(p.nominal_weight_kg)})` : ""}</span>
                    {p.corte && <span>· {p.corte}</span>}
                  </div>
                </div>
                <div className="text-right text-[12.5px]">
                  <div className="font-medium text-ink">{sinPrecio ? "Sin precio" : `${soles(p.precio)}${p.base === "KG" ? " /kg" : " c/u"}`}</div>
                  <div className={p.disponible > 0 ? "text-muted" : "text-bad"}>Stock {numero(p.disponible, p.sale_mode === "KG" ? 3 : 0)}{p.sale_mode === "KG" ? " kg" : ""}</div>
                </div>
                {onElegir && (
                  ya ? <Badge tone="ok">Agregado</Badge> : (
                    <Button size="sm" icon={Plus} disabled={sinPrecio} onClick={() => onElegir(p)} title={sinPrecio ? "Sin precio vigente en este canal" : "Agregar"}>Agregar</Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
