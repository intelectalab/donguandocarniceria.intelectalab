"use client";

import { PanelConsumo, PasoDeOrden } from "@/modulos/pro/comunes";

/** PRO-06 Consumo de insumos: teórico contra real y el lote que sugiere FEFO; cambiar el lote lo autoriza el jefe (RN-PRO-03). */
export default function Consumo() {
  return <PasoDeOrden descripcion="Escanea o escribe el lote de cada insumo y su peso. El sistema sugiere el lote que vence primero; usar otro lo autoriza el jefe de producción con su motivo."
    panel={(f, r) => <PanelConsumo f={f} onCambio={r} />} />;
}
