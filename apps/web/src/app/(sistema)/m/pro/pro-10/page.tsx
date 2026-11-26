"use client";

import { PanelCierre, PasoDeOrden } from "@/modulos/pro/comunes";

/** PRO-10 Cierre de la orden: rendimiento, merma y costo; los desvíos fuera de tolerancia piden su motivo (RN-PRO-06, RN-PRO-07). */
export default function CierreOrden() {
  return <PasoDeOrden descripcion="Revisa el rendimiento, la merma y el costo antes de cerrar. Si el rendimiento se aleja de lo esperado o la merma pasa el máximo de la línea, escribe el motivo."
    panel={(f, r) => <PanelCierre f={f} onCambio={r} />} />;
}
