"use client";

import { useCallback, useEffect, useState } from "react";
import { api, mensajeDe } from "@/lib/api";
import type { Contexto } from "./tipos";

/** Lo que el mostrador necesita al entrar: mi turno abierto, cajas, medios de pago, parámetros y permisos. */
export function useContexto() {
  const [estado, setEstado] = useState<{ datos?: Contexto; error?: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    api<Contexto>("/v1/pos/contexto")
      .then((d) => vigente && setEstado({ datos: d }))
      .catch((e) => vigente && setEstado({ error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [version]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  return { ctx: estado?.datos ?? null, error: estado?.error ?? "", cargando: !estado, recargar };
}
