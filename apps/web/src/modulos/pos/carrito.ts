"use client";

import { useSyncExternalStore } from "react";
import type { Cliente, LineaCarrito } from "./tipos";

/**
 * Carrito del mostrador compartido por Venta (POS-02), Ingreso de peso (POS-03) y Cobro (POS-04).
 * Vive en sessionStorage: si la cajera recarga la página no pierde la venta en curso.
 */
export type Carrito = { lineas: LineaCarrito[]; cliente: Cliente | null; doc_type: "RECEIPT" | "INVOICE" };

const CLAVE = "pos.carrito";
const VACIO: Carrito = { lineas: [], cliente: null, doc_type: "RECEIPT" };
const oyentes = new Set<() => void>();
let actual: Carrito | null = null;

function leer(): Carrito {
  if (actual) return actual;
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    actual = crudo ? { ...VACIO, ...(JSON.parse(crudo) as Carrito) } : VACIO;
  } catch {
    actual = VACIO;
  }
  return actual;
}

export function guardarCarrito(c: Carrito) {
  actual = c;
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(c));
  } catch {}
  oyentes.forEach((fn) => fn());
}

export function cambiarCarrito(fn: (c: Carrito) => Carrito) {
  guardarCarrito(fn(leer()));
}

export const vaciarCarrito = () => guardarCarrito({ ...VACIO });

const suscribir = (fn: () => void) => {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
};

export function useCarrito(): Carrito {
  return useSyncExternalStore(suscribir, leer, () => VACIO);
}

let siguiente = 0;
export const claveLinea = () => `${Date.now().toString(36)}-${(siguiente++).toString(36)}`;

/** Lo que se manda a /cotizar y /ventas. */
export const lineasApi = (ls: LineaCarrito[]) =>
  ls.map((l) => ({ variant_id: l.variant_id, qty: l.qty, weight_kg: l.weight_kg, weight_source: l.weight_source, barcode: l.barcode, override: l.override }));
