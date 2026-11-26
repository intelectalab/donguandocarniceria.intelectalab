"use client";

import { useState } from "react";
import { Image as Imagen } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui";
import { apiImagen } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { Sub } from "@/modulos/canales/comunes";
import { ESTADO_RECLAMO, RESOLUCION, type Reclamo } from "./tipos";

/** Detalle de un reclamo: descripción, fotos, respuesta y resolución (B2B-10 y portal B2B-16). */
export function DetalleReclamo({ c, base }: { c: Reclamo; base: string }) {
  const [fotos, setFotos] = useState<Record<number, string | null>>({});
  return (
    <div className="space-y-3 text-[13.5px]">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} labels={ESTADO_RECLAMO} /><Badge tone="neutral">{c.type_label}</Badge>
        {c.late && ["OPEN", "IN_REVIEW"].includes(c.status) && <Badge tone="bad">Fuera de plazo</Badge>}
        <span className="text-muted">Abierto {fechaHora(c.opened_at)} · responder hasta {fechaHora(c.due_at)}</span></div>
      <p className="whitespace-pre-line">{c.description}</p>
      <p className="text-muted">{c.order_number ? `Pedido ${c.order_number}` : "Sin pedido"}{c.document_number ? ` · comprobante ${c.document_number}` : ""}</p>
      {c.photo_urls.length > 0 && <ul className="grid grid-cols-4 gap-2">{c.photo_urls.map((_, i) => <li key={i} className="overflow-hidden rounded-lg border border-line bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- foto del reclamo (URL local del navegador). */}
        {fotos[i] ? <img src={fotos[i]!} alt={`Foto ${i + 1} del reclamo`} className="aspect-square w-full object-cover" />
          : <button type="button" className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 text-[12px] text-muted"
            onClick={async () => setFotos({ ...fotos, [i]: await apiImagen(`${base}/${c.id}/foto/${i}`) })}><Imagen size={18} />{fotos[i] === null ? "Sin archivo" : `Foto ${i + 1}`}</button>}
      </li>)}</ul>}
      {c.response && <div className="rounded-lg bg-surface-2 p-3"><p className="text-[12px] text-muted">Respuesta{c.first_response_at ? ` · ${fechaHora(c.first_response_at)}` : ""}</p><p className="whitespace-pre-line">{c.response}</p></div>}
      {c.resolution && <div className="rounded-lg border border-ok/30 bg-ok-soft p-3"><p className="font-semibold">{RESOLUCION[c.resolution]}{c.credit_note_number ? ` ${c.credit_note_number} por ${soles(c.credit_amount)}` : ""}</p>
        {c.resolution_note && <p>{c.resolution_note}</p>}<Sub>{fecha(c.resolved_at)}</Sub></div>}
    </div>
  );
}
