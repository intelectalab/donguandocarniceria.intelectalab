"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alert, PageHeader } from "@/components/ui";
import { SinPermiso, Vacio, useDatos, useOpciones, usePermisosGas } from "@/modulos/gas/comunes";
import { FormularioGasto } from "@/modulos/gas/Formulario";
import type { FichaGasto } from "@/modulos/gas/tipos";

/** GAS-01 Registrar gasto: desde el celular, con la foto del comprobante. Con ?id= corrige un borrador o un rechazado propio. */
export default function Registrar() {
  return <Suspense fallback={<Vacio>Cargando…</Vacio>}><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id");
  const p = usePermisosGas();
  const { datos: op, error, cargando } = useOpciones();
  const { datos: gasto, error: errorGasto, cargando: cargandoGasto } = useDatos<FichaGasto>(id ? `/v1/gas/gastos/${id}` : null);
  if (!p.crea) return <SinPermiso que="Tu rol no registra gastos." />;
  if (cargando || cargandoGasto) return <Vacio>Cargando…</Vacio>;
  if (error || !op) return <Alert tone="bad">{error || "No se pudieron cargar las opciones."}</Alert>;
  if (id && (errorGasto || !gasto)) return <Alert tone="bad">{errorGasto || "No se encontró el gasto."}</Alert>;
  if (gasto && !gasto.puede.editar) return <Alert tone="info">El gasto {gasto.number} ya está {gasto.estado.toLowerCase()}: no se cambia.</Alert>;
  return (
    <div className="space-y-4">
      <PageHeader description={gasto ? `Corrige el gasto ${gasto.number} y vuelve a enviarlo.` : "Toma la foto del comprobante, elige la categoría y escribe el total. Lo que pide cada categoría (vehículo, galones, repartidor, campaña) aparece solo."} />
      <FormularioGasto key={gasto?.id ?? "nuevo"} op={op} gasto={gasto} />
    </div>
  );
}
