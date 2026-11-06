"use client";

import { useState } from "react";

/**
 * Filas marcadas de un DataTable, guardando cada fila (no solo su id) para saber, por ejemplo,
 * si las marcadas están activas aunque sean de otra página.
 *   const sel = useSeleccion(lista.filas);
 *   <DataTable selection={{ selected: sel.ids, onChange: sel.cambiar, actions: … }} />
 *   const hayActivas = sel.filas.some((f) => f.status === "ACTIVE");
 */
export function useSeleccion<T extends { id: string }>(visibles: T[]) {
  const [marcadas, setMarcadas] = useState<Map<string, T>>(() => new Map());

  function cambiar(ids: string[]) {
    setMarcadas((antes) => new Map(ids.flatMap((id) => {
      const fila = antes.get(id) ?? visibles.find((f) => f.id === id);
      return fila ? [[id, fila] as const] : [];
    })));
  }

  return {
    ids: [...marcadas.keys()],
    filas: [...marcadas.values()],
    cambiar,
    limpiar: () => setMarcadas(new Map()),
  };
}
