"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, Button, StatusBadge } from "@/components/ui";
import { fecha, soles } from "@/lib/formato";
import { BuscarPedido } from "./BuscarPedido";
import { Seccion, Vacio } from "./Seccion";
import { usePedido } from "./usePedido";
import { ESTADOS, franjaTexto, type Detalle } from "./tipos";

/**
 * Pantallas de una sola acción sobre un pedido (PED-08, PED-09): sin ?id muestra el buscador de
 * pedidos en los estados dados; con ?id muestra el resumen del pedido y el formulario.
 */
export function PantallaAccion({ id, ruta, estados, tituloBuscar, vacio, form }: {
  id: string; ruta: string; estados: string[]; tituloBuscar: string; vacio: string;
  form: (d: Detalle, listo: (r: Detalle) => void) => ReactNode;
}) {
  const router = useRouter();
  if (!id) {
    return (
      <Seccion titulo={tituloBuscar}>
        <BuscarPedido estados={estados} vacio={vacio} onElegir={(x) => router.push(`${ruta}?id=${x}`)} />
      </Seccion>
    );
  }
  return <ConPedido id={id} ruta={ruta} form={form} />;
}

function ConPedido({ id, ruta, form }: { id: string; ruta: string; form: (d: Detalle, listo: (r: Detalle) => void) => ReactNode }) {
  const router = useRouter();
  const { detalle: d, error, cargando, reemplazar } = usePedido(id);
  if (cargando) return <Vacio>Cargando el pedido…</Vacio>;
  if (error || !d) return <Alert tone="bad">{error || "No se encontró el pedido."}</Alert>;
  const o = d.pedido;
  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(ruta)}>Otro pedido</Button>
        <Button variant="ghost" onClick={() => router.push(`/m/ped/ped-03?id=${o.id}`)}>Ver detalle</Button>
      </div>
      <Seccion>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <div>
            <div className="flex items-center gap-2"><span className="font-semibold text-ink">{o.number}</span><StatusBadge status={o.status} labels={ESTADOS} /></div>
            <div className="text-[12.5px] text-muted">
              {d.cliente ? d.cliente.trade_name || d.cliente.full_name : ""} · {d.marca?.name} · {fecha(o.delivery_date)} {franjaTexto(o.slot_from, o.slot_to)}{d.zona ? ` · ${d.zona.name}` : ""}
            </div>
          </div>
          <span className="text-[14px] font-semibold text-ink">{soles(o.final_total ?? o.estimated_total)}</span>
        </div>
        {form(d, reemplazar)}
      </Seccion>
    </div>
  );
}
