"use client";

import { useCallback, useEffect, useState } from "react";
import { api, mensajeDe, type Pagina } from "./api";

type Opciones = {
  /** Filas por página (la API acepta hasta 100). */
  porPagina?: number;
  /** Orden inicial: 'campo' o '-campo' (descendente). Sin él, el de la API. */
  orden?: string;
  /** Filtros extra que van en la URL: { status: 'ACTIVE', brand: marca }. Los vacíos no se envían. */
  filtros?: Record<string, string | number | boolean | null | undefined>;
};

/**
 * Lista paginada de la API (App\Support\Listado): búsqueda con espera de 300 ms, orden y páginas.
 * Devuelve `tabla`, lista para pasar a <DataTable {...lista.tabla} columns={...} />.
 *   const lista = useListado<Empresa>("/v1/plt/empresas", { orden: "legal_name" });
 *   lista.recargar()  // después de crear o editar
 */
export function useListado<T>(ruta: string, { porPagina = 25, orden = "", filtros = {} }: Opciones = {}) {
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState(porPagina);
  const [sort, setSort] = useState(orden);
  const [version, setVersion] = useState(0);
  const [resultado, setResultado] = useState<{ clave: string; datos?: Pagina<T>; error?: string } | null>(null);

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setQ(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const params = new URLSearchParams({ page: String(pagina), per_page: String(tamano) });
  if (q) params.set("q", q);
  if (sort) params.set("sort", sort);
  for (const [k, v] of Object.entries(filtros)) if (v !== null && v !== undefined && v !== "") params.set(k, String(v));
  const url = `${ruta}${ruta.includes("?") ? "&" : "?"}${params}`;
  const clave = `${url}#${version}`;

  useEffect(() => {
    let vigente = true;
    api<Pagina<T>>(url)
      .then((datos) => vigente && setResultado({ clave, datos }))
      .catch((err) => vigente && setResultado({ clave, error: mensajeDe(err) }));
    return () => {
      vigente = false;
    };
  }, [url, clave]);

  // Mientras llega la respuesta de la petición actual se siguen mostrando los datos anteriores.
  const cargando = resultado?.clave !== clave;
  const datos = resultado?.datos;

  const buscar = useCallback((texto: string) => {
    setBusqueda(texto);
    setPagina(1);
  }, []);
  // "" vuelve al orden con que empezó la lista. Si la columna es la del orden inicial, solo cambia de sentido.
  const ordenar = useCallback((campo: string) => {
    setSort((actual) => {
      if (campo) return campo;
      const inicial = orden.replace(/^-/, "");
      return inicial && inicial === actual.replace(/^-/, "") ? (actual.startsWith("-") ? inicial : `-${inicial}`) : orden;
    });
    setPagina(1);
  }, [orden]);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  return {
    filas: datos?.data ?? [],
    total: datos?.total ?? 0,
    cargando,
    error: cargando ? undefined : resultado?.error,
    recargar,
    /** Props para <DataTable>. */
    tabla: {
      rows: datos?.data ?? [],
      loading: cargando,
      error: cargando ? undefined : resultado?.error,
      onRetry: recargar,
      search: { value: busqueda, onChange: buscar },
      sort,
      onSortChange: ordenar,
      pagination: {
        page: datos?.current_page ?? pagina,
        lastPage: datos?.last_page ?? 1,
        total: datos?.total ?? 0,
        perPage: tamano,
        onPageChange: setPagina,
        onPerPageChange: (n: number) => {
          setTamano(n);
          setPagina(1);
        },
      },
    },
  };
}
