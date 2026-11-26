"use client";

import { PanelProduccion, PasoDeOrden } from "@/modulos/pro/comunes";

/** PRO-08 Registro de producción: producto principal, subproductos y merma pesados en balanza calibrada; crea el lote en cuarentena. */
export default function RegistroProduccion() {
  return <PasoDeOrden descripcion="Pesa lo producido en una balanza con la calibración vigente. El producto principal crea su lote en cuarentena hasta que Calidad lo libere; la merma lleva su motivo."
    panel={(f, r) => <PanelProduccion f={f} onCambio={r} />} />;
}
