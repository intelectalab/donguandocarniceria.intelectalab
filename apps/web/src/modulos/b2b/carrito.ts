"use client";

import { useSyncExternalStore } from "react";

// Carrito del portal B2B: se guarda en este navegador mientras la persona arma el pedido (B2B-12 → B2B-13).
export type ItemCarrito = { variant_id: string; name: string; sku: string; sale_mode: string; price: number; basis: string; qty: number; nominal_kg: number | null; cut_notes: string };

/** Importe estimado de una línea: por kilo se usa el peso nominal de la unidad. */
export const importe = (x: Pick<ItemCarrito, "price" | "basis" | "sale_mode" | "qty" | "nominal_kg">) =>
  x.price * (x.basis === "KG" ? (x.sale_mode === "KG" ? x.qty : x.qty * (x.nominal_kg ?? 1)) : x.qty);

const CLAVE = "aycha.b2b.carrito";
const oyentes = new Set<() => void>();
let cache: { raw: string | null; items: ItemCarrito[] } = { raw: null, items: [] };

function leer(): ItemCarrito[] {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(CLAVE); } catch { raw = null; }
  if (raw !== cache.raw) {
    try { cache = { raw, items: raw ? (JSON.parse(raw) as ItemCarrito[]) : [] }; } catch { cache = { raw, items: [] }; }
  }
  return cache.items;
}
function escribir(items: ItemCarrito[]) {
  try { window.localStorage.setItem(CLAVE, JSON.stringify(items)); } catch { /* sin almacenamiento: vale mientras la página esté abierta */ }
  cache = { raw: JSON.stringify(items), items };
  oyentes.forEach((f) => f());
}
const vacio: ItemCarrito[] = [];

export function useCarrito() {
  const items = useSyncExternalStore((f) => { oyentes.add(f); return () => oyentes.delete(f); }, leer, () => vacio);
  return {
    items,
    poner: (it: ItemCarrito) => escribir(it.qty > 0 ? [...items.filter((x) => x.variant_id !== it.variant_id), it] : items.filter((x) => x.variant_id !== it.variant_id)),
    cambiar: (id: string, cambio: Partial<ItemCarrito>) => escribir(items.map((x) => (x.variant_id === id ? { ...x, ...cambio } : x)).filter((x) => x.qty > 0)),
    reemplazar: escribir,
    vaciar: () => escribir([]),
    total: items.reduce((a, x) => a + importe(x), 0),
  };
}
