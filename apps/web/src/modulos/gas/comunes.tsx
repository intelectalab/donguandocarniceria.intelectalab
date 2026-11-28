"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, StatusBadge, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BANDERAS, ESTADOS, type FilaGasto, type Opciones } from "./tipos";

/** Tarjeta con título para agrupar datos en las pantallas de GAS. */
export function Seccion({ titulo, acciones, children, className = "" }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      {(titulo || acciones) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-[14.5px] font-semibold text-ink">{titulo}</h2>}
          {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}

/** GET a la API con recarga. Sin url (null) no pide nada. */
export function useDatos<T>(url: string | null) {
  const [estado, setEstado] = useState<{ url: string; datos?: T; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!url) return;
    let vigente = true;
    api<T>(url).then((d) => vigente && setEstado({ url, datos: d })).catch((e) => vigente && setEstado({ url, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [url, version]);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  const actual = estado && estado.url === url ? estado : null;
  return { datos: actual?.datos ?? null, error: actual?.error ?? "", cargando: Boolean(url) && !actual, recargar };
}

export function useOpciones() {
  return useDatos<Opciones>("/v1/gas/opciones");
}

/** Permisos de GAS que usa cada pantalla. */
export function usePermisosGas() {
  const { can } = useSesion();
  const nivel = can("gas.expense.approve_management") ? 3 : can("gas.expense.approve_admin") ? 2 : can("gas.expense.approve_area") ? 1 : 0;
  return {
    crea: can("gas.expense.create"), nivel, aprueba: nivel > 0, veTodo: can("gas.expense.view_all") || can("gas.accounting.review") || can("gas.petty_cash.manage") || nivel > 0,
    paga: can("gas.petty_cash.manage") || can("gas.expense.approve_admin"), config: can("gas.category.manage"), cajaChica: can("gas.petty_cash.manage"),
    contadora: can("gas.accounting.review"), reporte: can("gas.expense.view_all") || can("gas.accounting.review"),
  };
}

/** Aviso cuando el rol entra a una pantalla que no le toca (el menú muestra el módulo completo). */
export function SinPermiso({ que }: { que: string }) {
  return <Alert tone="info" title="Esta pantalla no es de tu rol">{que} Si lo necesitas, pídelo a quien administra los roles.</Alert>;
}

export const EstadoGasto = ({ s }: { s: string }) => <StatusBadge status={s} labels={ESTADOS} />;
export const Bandera = ({ f }: { f: string | null }) => (f && f !== "OK" ? <StatusBadge status={f} labels={BANDERAS} /> : null);

/** Monto en soles; si fue en dólares, también el original. */
export function Monto({ g }: { g: Pick<FilaGasto, "amount_pen" | "currency" | "total"> }) {
  return (
    <span className="whitespace-nowrap">
      {soles(g.amount_pen)}
      {g.currency !== "PEN" && <span className="ml-1 text-[11.5px] text-muted">(US$ {g.total.toFixed(2)})</span>}
    </span>
  );
}

/** Columnas comunes de las listas de gastos. */
export function columnasGasto(extra: Column<FilaGasto>[] = [], sin: string[] = []): Column<FilaGasto>[] {
  const base: Column<FilaGasto>[] = [
    { key: "number", header: "Gasto", sortable: true, cardTitle: true, render: (g) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">{g.number}</span>
        <span className="line-clamp-1 text-[12px] text-muted">{g.description}</span>
      </span>
    ) },
    { key: "issue_date", header: "Fecha", sortable: true, render: (g) => fecha(g.issue_date) },
    { key: "categoria", header: "Categoría", hideOnMobile: true, render: (g) => g.categoria ?? "—" },
    { key: "comprobante", header: "Comprobante", hideOnMobile: true, render: (g) => (
      <span className="flex flex-col"><span>{g.documento}</span>{g.comprobante && <span className="text-[12px] text-muted">{g.comprobante}</span>}</span>
    ) },
    { key: "proveedor", header: "Proveedor", hideOnMobile: true, render: (g) => g.proveedor ?? "—" },
    { key: "registro", header: "Registró", hideOnMobile: true, render: (g) => g.registro ?? "—" },
    { key: "amount_pen", header: "Monto", sortable: true, align: "right", render: (g) => <Monto g={g} /> },
    { key: "status", header: "Estado", render: (g) => (
      <span className="inline-flex flex-wrap items-center justify-end gap-1"><EstadoGasto s={g.status} /><Bandera f={g.accounting_flag} /></span>
    ) },
  ];
  return [...base.filter((c) => !sin.includes(c.key)), ...extra];
}

export function AlGasto({ id, children }: { id: string; children: ReactNode }) {
  return <Link href={`/m/gas/gas-02?id=${id}`} className="font-medium text-primary hover:underline">{children}</Link>;
}
