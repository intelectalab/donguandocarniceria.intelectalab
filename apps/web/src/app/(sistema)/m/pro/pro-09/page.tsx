"use client";

import { PanelPersonal, PasoDeOrden } from "@/modulos/pro/comunes";

/** PRO-09 Personal y equipos: horas por persona y por equipo, que entran al costo de la orden. */
export default function PersonalYEquipos() {
  return <PasoDeOrden descripcion="Horas de cada persona y de cada equipo en la orden. Un equipo fuera de servicio o con la calibración vencida no se puede registrar."
    panel={(f, r) => <PanelPersonal f={f} onCambio={r} />} />;
}
