"use client";

import { PanelControl, PasoDeOrden } from "@/modulos/pro/comunes";

/** PRO-07 Puntos de control: lecturas de temperatura, pH, Brix o vacío con su acción correctiva (RN-PRO-05). */
export default function PuntosDeControl() {
  return <PasoDeOrden descripcion="Registra cada lectura de los puntos de control de la receta. Una lectura fuera de rango exige la acción correctiva y avisa al jefe y a Calidad; en un punto crítico, el lote queda retenido."
    panel={(f, r) => <PanelControl f={f} onCambio={r} />} />;
}
