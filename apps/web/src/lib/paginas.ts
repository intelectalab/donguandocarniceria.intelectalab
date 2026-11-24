"use client";

import { useState } from "react";

/** Respuesta paginada de la API (App\Support\Paginas y Listado). */
export type Pagina<T> = { data: T[]; current_page: number; last_page: number; per_page: number; total: number };

type Meta = Pick<Pagina<unknown>, "current_page" | "last_page" | "total" | "per_page">;

/** Valor de una fila para ordenar en el navegador (texto o número; vacío va al final). */
type Valor = string | number | null | undefined;

/**
 * Página y filas por página de una lista paginada en el servidor:
 *   const pag = usePagina(JSON.stringify(filtros));
 *   api(`/lista?${q}&${pag.qs}`) … <DataTable pagination={pag.props(respuesta)} />
 * Cuando cambia la clave (los filtros), vuelve sola a la primera página.
 */
export function usePagina(clave = "", porPagina = 25, ordenInicial = "") {
  const [p, setP] = useState({ page: 1, per_page: porPagina, clave });
  const [sort, setSort] = useState(ordenInicial);
  const page = p.clave === clave ? p.page : 1;

  return {
    qs: `page=${page}&per_page=${p.per_page}${sort ? `&sort=${encodeURIComponent(sort)}` : ""}`,
    /** Para el DataTable: <DataTable {...pag.orden} … /> ordena en el servidor (?sort=campo o -campo). */
    orden: { sort, onSortChange: (s: string) => { setSort(s); setP((x) => ({ ...x, page: 1, clave })); } },
    props: (r?: Meta | null) => (r ? {
      page: r.current_page, lastPage: r.last_page, total: r.total, perPage: r.per_page,
      onPageChange: (n: number) => setP((x) => ({ ...x, page: n, clave })),
      onPerPageChange: (n: number) => setP({ page: 1, per_page: n, clave }),
    } : undefined),
  };
}

/**
 * Orden por columna en el navegador para listas ya cargadas, antes de paginarlas:
 *   const ord = useOrdenLocal(filas, { nombre: (f) => f.name, mrr: (f) => f.mrr });
 *   const pag = usePaginaLocal(ord.filas, clave);  <DataTable {...ord.orden} … />
 * Las columnas usan sortable y su key (o sortKey) igual a la clave de `valores`.
 */
export function useOrdenLocal<T>(filas: T[], valores: Record<string, (f: T) => Valor>, inicial = "") {
  const [sort, setSort] = useState(inicial);
  const campo = sort.replace(/^-/, "");
  const signo = sort.startsWith("-") ? -1 : 1;
  const valor = valores[campo];
  const ordenadas = valor ? [...filas].sort((a, b) => {
    const x = valor(a), y = valor(b);
    if (x === y) return 0;
    if (x === null || x === undefined || x === "") return 1;
    if (y === null || y === undefined || y === "") return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true, sensitivity: "base" })) * signo;
  }) : filas;
  return { filas: ordenadas, orden: { sort, onSortChange: setSort } };
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
