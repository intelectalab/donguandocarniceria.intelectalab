"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FormReprogramar } from "@/modulos/ped/Formularios";
import { PantallaAccion } from "@/modulos/ped/PantallaAccion";

/** PED-08 Reprogramar: nueva fecha y franja con motivo; el tope de reprogramaciones lo pasa solo la supervisora (RN-PED-14). */
export default function Reprogramar() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <PantallaAccion id={id} ruta="/m/ped/ped-08" estados={["CONFIRMED", "NOT_DELIVERED"]} tituloBuscar="Elige el pedido por reprogramar"
      vacio="No hay pedidos confirmados ni no entregados." form={(d, listo) => <FormReprogramar d={d} onListo={listo} />} />
  );
}
