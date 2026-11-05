"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Inbox, Search } from "lucide-react";
import { Button } from "./Button";

export type Column<T> = {
  /** Identificador de la columna; si es ordenable, también el campo de la API (o usa sortKey). */
  key: string;
  header: string;
  /** Qué mostrar en la celda. Sin render, se muestra row[key]. */
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  /** Campo de ?sort= cuando no coincide con key. */
  sortKey?: string;
  align?: "left" | "right" | "center";
  /** Se oculta en celular (menos de 768 px). */
  hideOnMobile?: boolean;
  className?: string;
};

export type PaginationProps = {
  page: number;
  lastPage: number;
  total: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  /** Clave única de cada fila (por defecto row.id). */
  rowKey?: (row: T) => string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** Texto o contenido cuando no hay filas. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Caja de búsqueda sobre la tabla. */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  /** Orden actual: 'campo' o '-campo'. */
  sort?: string;
  /** Recibe el nuevo orden; "" pide volver al orden inicial. */
  onSortChange?: (sort: string) => void;
  pagination?: PaginationProps;
  /** Filtros y botones a la derecha de la búsqueda. */
  toolbar?: ReactNode;
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" };

/**
 * Tabla con búsqueda, orden, páginas y estados de carga, error y vacío. Con useListado:
 *   const lista = useListado<Local>("/v1/plt/locales");
 *   <DataTable {...lista.tabla} columns={columnas} onRowClick={editar} toolbar={<Button …/>} />
 */
export function DataTable<T>({
  columns, rows, rowKey = (r) => String((r as { id?: string }).id), loading, error, onRetry, empty = "No hay registros.",
  onRowClick, search, sort, onSortChange, pagination, toolbar,
}: Props<T>) {
  const campoOrden = sort?.replace(/^-/, "");
  const descendente = sort?.startsWith("-");

  function ordenar(col: Column<T>) {
    const campo = col.sortKey ?? col.key;
    // ascendente → descendente → sin orden propio (vuelve al orden inicial de la lista)
    if (campoOrden !== campo) onSortChange?.(campo);
    else onSortChange?.(descendente ? "" : `-${campo}`);
  }

  const sinDatos = !loading && !error && rows.length === 0;
  const primeraCarga = loading && rows.length === 0;

  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface shadow-card">
      {(search || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          {search && (
            <label className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
              <span className="sr-only">Buscar</span>
              <Search size={15} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input type="search" value={search.value} onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder ?? "Buscar…"}
                className="h-9 w-full rounded-[9px] border border-line bg-bg pr-3 pl-9 text-[13.5px] text-ink outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)]" />
            </label>
          )}
          {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {error ? (
        <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <p className="max-w-[52ch] text-[13.5px] text-bad">{error}</p>
          {onRetry && <Button size="sm" onClick={onRetry}>Reintentar</Button>}
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-2/60">
                {columns.map((col) => {
                  const campo = col.sortKey ?? col.key;
                  const activo = col.sortable && campoOrden === campo;
                  const Flecha = !activo ? ArrowUpDown : descendente ? ArrowDown : ArrowUp;
                  return (
                    <th key={col.key} scope="col" aria-sort={activo ? (descendente ? "descending" : "ascending") : undefined}
                      className={`px-3 py-2.5 text-[12px] font-semibold tracking-wide whitespace-nowrap text-muted uppercase ${ALIGN[col.align ?? "left"]} ${col.hideOnMobile ? "hidden md:table-cell" : ""}`}>
                      {col.sortable && onSortChange ? (
                        <button type="button" onClick={() => ordenar(col)}
                          className={`inline-flex cursor-pointer items-center gap-1 uppercase hover:text-ink ${activo ? "text-ink" : ""}`}>
                          {col.header}<Flecha size={13} aria-hidden="true" className={activo ? "" : "opacity-50"} />
                        </button>
                      ) : col.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className={loading && !primeraCarga ? "opacity-60 transition-opacity" : ""}>
              {primeraCarga ? (
                [1, 2, 3, 4, 5].map((n) => (
                  <tr key={n} className="border-b border-line last:border-0">
                    {columns.map((col) => (
                      <td key={col.key} className={`px-3 py-3 ${col.hideOnMobile ? "hidden md:table-cell" : ""}`}>
                        <div className="h-3.5 animate-pulse rounded bg-surface-2" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.map((row) => (
                <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onRowClick(row)) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={`border-b border-line last:border-0 ${onRowClick ? "cursor-pointer outline-none hover:bg-surface-2/60 focus-visible:bg-primary-soft" : ""}`}>
                  {columns.map((col) => (
                    <td key={col.key} className={`px-3 py-2.5 align-middle text-ink ${ALIGN[col.align ?? "left"]} ${col.align === "right" ? "tabular-nums" : ""} ${col.hideOnMobile ? "hidden md:table-cell" : ""} ${col.className ?? ""}`}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sinDatos && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[13.5px] text-muted">
              <Inbox size={26} aria-hidden="true" />
              {typeof empty === "string" ? <p>{search?.value ? "Ninguno coincide con la búsqueda." : empty}</p> : empty}
            </div>
          )}
        </div>
      )}

      {pagination && !error && pagination.total > 0 && <Pagination {...pagination} />}
    </div>
  );
}

/** Páginas a mostrar: la primera, la última y dos a cada lado de la actual, con «…» en los saltos. */
function paginas(actual: number, ultima: number): (number | "…")[] {
  const cerca = [...new Set([1, ultima, ...Array.from({ length: 5 }, (_, k) => actual - 2 + k)])]
    .filter((n) => n >= 1 && n <= ultima).sort((a, b) => a - b);
  return cerca.flatMap((n, k) => {
    const previa = cerca[k - 1];
    if (previa === undefined || n - previa === 1) return [n];
    return n - previa === 2 ? [previa + 1, n] : ["…" as const, n];
  });
}

const NAV = "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface";

/** Paginador (mismo diseño que erp-saas): «Mostrando 1 a 25 de 31», filas por página y páginas numeradas. */
export function Pagination({ page, lastPage, total, perPage, onPageChange, onPerPageChange }: PaginationProps) {
  const ultima = Math.max(lastPage, 1);
  const desde = total === 0 ? 0 : (page - 1) * perPage + 1;
  const hasta = Math.min(page * perPage, total);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 sm:flex-row sm:px-5">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <p className="text-[13px] text-muted">
          Mostrando <span className="font-medium text-ink">{desde}</span> a <span className="font-medium text-ink">{hasta}</span> de{" "}
          <span className="font-medium text-ink">{total}</span>
        </p>
        {onPerPageChange && (
          <label className="flex items-center gap-2 border-l border-line pl-4 text-[13px] text-muted">
            Filas por página:
            <select value={perPage} onChange={(e) => onPerPageChange(Number(e.target.value))}
              className="cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-[13px] text-ink outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)]">
              {[...new Set([10, 25, 50, 100, perPage])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>

      <nav aria-label="Paginación" className="flex items-center gap-1.5">
        <button type="button" onClick={() => onPageChange(1)} disabled={page <= 1} title="Primera página" aria-label="Primera página" className={`${NAV} hidden sm:flex`}>
          <ChevronsLeft size={16} />
        </button>
        <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} title="Página anterior" aria-label="Página anterior" className={NAV}>
          <ChevronLeft size={16} />
        </button>
        {paginas(page, ultima).map((n, k) => n === "…" ? (
          <span key={`dots-${k}`} className="flex size-9 items-center justify-center text-[13px] font-medium text-muted">…</span>
        ) : (
          <button key={n} type="button" onClick={() => onPageChange(n)} aria-current={n === page ? "page" : undefined}
            className={`flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border text-[13px] font-semibold tabular-nums transition-colors ${n === page
              ? "border-primary bg-primary text-primary-ink shadow-xs"
              : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
            {n}
          </button>
        ))}
        <button type="button" onClick={() => onPageChange(Math.min(ultima, page + 1))} disabled={page >= ultima} title="Página siguiente" aria-label="Página siguiente" className={NAV}>
          <ChevronRight size={16} />
        </button>
        <button type="button" onClick={() => onPageChange(ultima)} disabled={page >= ultima} title="Última página" aria-label="Última página" className={`${NAV} hidden sm:flex`}>
          <ChevronsRight size={16} />
        </button>
      </nav>
    </div>
  );
}
