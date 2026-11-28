"use client";

import type { ReactNode } from "react";
import { Badge, StatusBadge, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, soles } from "@/lib/formato";
import { Avance, Seccion, Vacio, useDatos } from "@/modulos/pre/comunes";
import { hoyLima, sumarDias } from "@/modulos/pre/tipos";
import { DOC_TONO, RUTA, type Opciones, type RutaResumen } from "./tipos";

export { Avance, Seccion, Vacio, useDatos, hoyLima, sumarDias };

/** Opciones de los formularios de DEL (locales, franjas, vehículos, repartidores, empresas y catálogos). */
export function useOpciones(fecha?: string) {
  return useDatos<Opciones>(`/v1/del/opciones${fecha ? `?fecha=${fecha}` : ""}`);
}

/** Tarjeta de una ruta: código, estado, asignación, avance de paradas y de la carga, y avisos. */
export function TarjetaRuta({ r, onClick, children }: { r: RutaResumen; onClick?: () => void; children?: ReactNode }) {
  const cuerpo = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-ink">{r.code}</span>
          <span className="block text-[12.5px] text-muted">{[r.local, r.franja].filter(Boolean).join(" · ") || "Sin franja"}</span>
        </span>
        <StatusBadge status={r.status} labels={RUTA} />
      </span>
      <span className="mt-2 block text-[13px] text-ink">
        {r.mode === "THIRD_PARTY" ? (r.empresa ?? "Sin empresa") : [r.plate ?? "Sin vehículo", r.repartidor ?? "sin repartidor"].join(" · ")}
      </span>
      <span className="mt-1 block text-[12.5px] text-muted">
        {r.paradas} parada(s) · {kg(r.kg)} · por cobrar {soles(r.cobrar)}{r.bolsas ? ` · ${r.cargadas}/${r.bolsas} bolsas cargadas` : ""}
      </span>
      {r.paradas > 0 && ["IN_ROUTE", "RETURNED", "SETTLED"].includes(r.status) && (
        <span className="mt-2 block"><Avance valor={(r.hechas / r.paradas) * 100} /></span>
      )}
      {r.avisos.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {r.avisos.map((a) => <Badge key={a.msg} tone={DOC_TONO(a.level)}>{a.msg}</Badge>)}
        </span>
      )}
    </>
  );
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      {onClick ? <button type="button" onClick={onClick} className="block w-full cursor-pointer text-left">{cuerpo}</button> : cuerpo}
      {children && <div className="mt-3 border-t border-line pt-3">{children}</div>}
    </div>
  );
}

/** Fila de dato: etiqueta y valor alineados. */
export function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13.5px]">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{children}</span>
    </div>
  );
}

/** Botón que abre una foto, firma o audio del reparto con su enlace temporal. */
export function VerArchivo({ id, texto = "Ver foto" }: { id: string; texto?: string }) {
  return (
    <button type="button" className="cursor-pointer text-[12.5px] font-medium text-primary underline" onClick={async () => {
      try {
        const r = await api<{ url: string }>(`/v1/del/archivos/${id}/enlace`, { method: "POST" });
        window.open(r.url, "_blank", "noopener");
      } catch (x) { toast.error(mensajeDe(x)); }
    }}>{texto}</button>
  );
}
