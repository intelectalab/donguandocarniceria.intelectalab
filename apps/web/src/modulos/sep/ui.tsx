"use client";

// Piezas de pantalla de SEP: los componentes compartidos de @/components/ui más tarjetas y tablas
// simples con el mismo estilo (borde line, fondo surface, sombra card) y un acceso corto a la API.
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes, HTMLAttributes } from "react";
import { api as llamar, ApiError, mensajeDe } from "@/lib/api";

export * from "@/components/ui";
export { ApiError, mensajeDe };

/** Acceso corto a la API de SEP: rutas relativas a /api/v1. */
export const api = {
  get: <T,>(path: string) => llamar<T>(`/v1${path}`),
  post: <T,>(path: string, body?: unknown) => llamar<T>(`/v1${path}`, { method: "POST", body: body ?? {} }),
  put: <T,>(path: string, body?: unknown) => llamar<T>(`/v1${path}`, { method: "PUT", body: body ?? {} }),
};

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-xl border border-line bg-surface shadow-card ${className}`}>{children}</section>;
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Tr({ children, className = "", ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`border-b border-line last:border-b-0 ${className}`} {...rest}>
      {children}
    </tr>
  );
}

export function Th({ children, className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`bg-surface-alt px-3 py-2 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-3 py-2 align-top ${className}`} {...rest}>
      {children}
    </td>
  );
}
