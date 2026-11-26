"use client";

import { FileDown } from "lucide-react";
import { Button } from "@/components/ui";
import { descargar } from "@/modulos/canales/comunes";

/** Botones de descarga de un comprobante en el portal: PDF, XML y constancia de SUNAT. */
export function Descargas({ id, numero, aceptado }: { id: string; numero: string; aceptado: boolean }) {
  return (
    <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
      {(["PDF", "XML", "CDR"] as const).map((t) => (
        <Button key={t} size="sm" variant="ghost" icon={FileDown} disabled={!aceptado} title={aceptado ? undefined : "Disponible cuando SUNAT lo acepte"}
          onClick={() => descargar(`/v1/b2b/portal/comprobantes/${id}/${t}`, `${numero}.${t === "PDF" ? "pdf" : t === "XML" ? "xml" : "zip"}`)}>{t}</Button>
      ))}
    </div>
  );
}
