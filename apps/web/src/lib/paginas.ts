"use client";

import { useState } from "react";

/** Respuesta paginada de la API (App\Support\Paginas y Listado). */
export type Pagina<T> = { data: T[]; current_page: number; last_page: number; per_page: number; total: number };

type Meta = Pick<Pagina<unknown>, "current_page" | "last_page" | "total" | "per_page">;

/**
 * Página y filas por página de una lista paginada en el servidor:
 *   const pag = usePagina(JSON.stringify(filtros));
 *   api(`/lista?${q}&${pag.qs}`) … <DataTable pagination={pag.props(respuesta)} />
 * Cuando cambia la clave (los filtros), vuelve sola a la primera página.
 */
export function usePagina(clave = "", porPagina = 25) {
  const [p, setP] = useState({ page: 1, per_page: porPagina, clave });
  const page = p.clave === clave ? p.page : 1;

  return {
    qs: `page=${page}&per_page=${p.per_page}`,
    props: (r?: Meta | null) => (r ? {
      page: r.current_page, lastPage: r.last_page, total: r.total, perPage: r.per_page,
      onPageChange: (n: number) => setP((x) => ({ ...x, page: n, clave })),
      onPerPageChange: (n: number) => setP({ page: 1, per_page: n, clave }),
    } : undefined),
  };
}

/** Paginación en el navegador de una lista ya cargada (y filtrada): devuelve las filas de la página y las props. */
export function usePaginaLocal<T>(filas: T[], clave = "", porPagina = 25) {
  const [p, setP] = useState({ page: 1, per_page: porPagina, clave });
  const ultima = Math.max(1, Math.ceil(filas.length / p.per_page));
  const page = Math.min(p.clave === clave ? p.page : 1, ultima);

  return {
    filas: filas.slice((page - 1) * p.per_page, page * p.per_page),
    props: {
      page, lastPage: ultima, total: filas.length, perPage: p.per_page,
      onPageChange: (n: number) => setP((x) => ({ ...x, page: n, clave })),
      onPerPageChange: (n: number) => setP({ page: 1, per_page: n, clave }),
    },
  };
}
