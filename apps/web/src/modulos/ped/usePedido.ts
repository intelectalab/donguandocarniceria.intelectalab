"use client";

import { useCallback, useEffect, useState } from "react";
import { api, mensajeDe } from "@/lib/api";
import type { Detalle, Opciones } from "./tipos";

/** Carga el detalle de un pedido (PED-03) y lo deja recargar o reemplazar con la respuesta de una acción. */
export function usePedido(id: string) {
  const [estado, setEstado] = useState<{ id: string; datos?: Detalle; error?: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!id) return;
    let vigente = true;
    api<Detalle>(`/v1/ped/pedidos/${id}`)
      .then((d) => vigente && setEstado({ id, datos: d }))
      .catch((e) => vigente && setEstado({ id, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [id, version]);

  const recargar = useCallback(() => setVersion((n) => n + 1), []);
  const reemplazar = useCallback((d: Detalle) => setEstado({ id: d.pedido.id, datos: d }), []);
  const actual = estado?.id === id ? estado : null;

  return { detalle: actual?.datos ?? null, error: actual?.error ?? "", cargando: Boolean(id) && !actual, recargar, reemplazar };
}

let cache: Promise<Opciones> | null = null;

/** Marcas, locales, zonas, formas de pago, agencias y franjas (una sola vez por pantalla abierta). */
export function useOpciones() {
  const [op, setOp] = useState<Opciones | null>(null);
  useEffect(() => {
    let vigente = true;
    cache ??= api<Opciones>("/v1/ped/opciones").catch((e) => { cache = null; throw e; });
    cache.then((o) => vigente && setOp(o)).catch(() => {});
    return () => { vigente = false; };
  }, []);
  return op;
}
