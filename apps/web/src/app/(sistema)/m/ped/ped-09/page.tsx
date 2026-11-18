"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FormCancelar } from "@/modulos/ped/Formularios";
import { PantallaAccion } from "@/modulos/ped/PantallaAccion";

/** PED-09 Cancelar o registrar no entrega: motivo del catálogo y nota si el motivo la exige (RN-PED-13). */
export default function Cancelar() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <PantallaAccion id={id} ruta="/m/ped/ped-09" estados={["DRAFT", "CONFIRMED", "IN_PREPARATION", "WEIGHED", "READY", "IN_ROUTE", "NOT_DELIVERED"]}
      tituloBuscar="Elige el pedido por cancelar o marcar como no entregado" vacio="No hay pedidos abiertos."
      form={(d, listo) => <FormCancelar d={d} onListo={listo} />} />
  );
}
