"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, StatusBadge, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { SUNAT, TIPOS_CORTO, type FilaComprobante } from "./tipos";

/** Tarjeta con título para agrupar datos en las pantallas de FAC. */
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

/** Texto de pantalla vacía o de carga. */
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
  const poner = useCallback((d: T) => url && setEstado({ url, datos: d }), [url]);
  const actual = estado && estado.url === url ? estado : null;
  return { datos: actual?.datos ?? null, error: actual?.error ?? "", cargando: Boolean(url) && !actual, recargar, poner };
}

/** Estado SUNAT del comprobante; si está anulado, lo dice aunque SUNAT lo haya aceptado. */
export function EstadoSunat({ sunat, status, revision }: { sunat: string; status?: string; revision?: boolean | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge status={sunat} labels={SUNAT} />
      {status === "VOIDED" && sunat !== "VOIDED" && <StatusBadge status="VOIDED" labels={{ VOIDED: ["Anulado", "neutral"] }} />}
      {revision && sunat === "PENDING" && <StatusBadge status="R" labels={{ R: ["Por revisar", "bad"] }} />}
    </span>
  );
}

/** Enlace al detalle del comprobante (FAC-04). */
export function AlComprobante({ id, children }: { id: string; children: ReactNode }) {
  return <Link href={`/m/fac/fac-04?id=${id}`} className="font-medium text-primary hover:underline">{children}</Link>;
}

const sinSuscripcion = () => () => {};

/**
 * Lo que va adentro se imprime solo (el comprobante en A4 o en 80 mm): se monta en el body y en pantalla no se ve.
 * Al imprimir se oculta el resto de la aplicación.
 */
export function Imprimible({ children, ancho }: { children: ReactNode; ancho: "A4" | "80" }) {
  const montado = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  if (!montado) return null;
  const pagina = ancho === "80" ? "@page { size: 80mm auto; margin: 3mm; }" : "@page { size: A4; margin: 12mm; }";
  return createPortal(
    <div className="fac-imprimir hidden print:block">
      <style>{`@media print { body > *:not(.fac-imprimir) { display: none !important; } body { background: #fff; } ${pagina} }`}</style>
      {children}
    </div>,
    document.body,
  );
}

/** Lista de facturas y boletas vigentes para elegir una (FAC-05 y FAC-06 sin ?id). */
export function ElegirComprobante({ ruta, vacio }: { ruta: string; vacio: string }) {
  const router = useRouter();
  const { marca, local } = useSesion();
  const lista = useListado<FilaComprobante>("/v1/fac/comprobantes", {
    orden: "-issue_date", filtros: { doc_type: "INVOICE,RECEIPT", status: "ISSUED", sunat_status: "PENDING,ACCEPTED,OBSERVED", brand: marca !== "ALL" ? marca : "", site: local !== "ALL" ? local : "" },
  });
  const columnas: Column<FilaComprobante>[] = [
    { key: "full_number", header: "Comprobante", sortable: true, cardTitle: true, render: (d) => <div><div className="font-medium">{d.full_number}</div><div className="text-[12px] text-muted">{TIPOS_CORTO[d.doc_type]} · {d.brand_name}</div></div> },
    { key: "issue_date", header: "Fecha", sortable: true, render: (d) => fecha(d.issue_date) },
    { key: "customer_name", header: "Cliente", sortable: true },
    { key: "total", header: "Total", align: "right", sortable: true, render: (d) => soles(d.total) },
    { key: "sunat_status", header: "SUNAT", render: (d) => <EstadoSunat sunat={d.sunat_status} status={d.status} /> },
  ];
  return <DataTable {...lista.tabla} columns={columnas} onRowClick={(d) => router.push(`${ruta}?id=${d.id}`)}
    search={{ ...lista.tabla.search, placeholder: "Número, cliente o documento…" }} empty={vacio} />;
}
