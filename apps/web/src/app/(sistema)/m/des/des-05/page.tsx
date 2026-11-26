"use client";

import { kg } from "@/lib/formato";
import { PantallaDespiece } from "@/modulos/des/comunes";
import { BalanceMasa, Seccion, Tabla } from "@/modulos/pro/comunes";
import { ROL_SALIDA } from "@/modulos/pro/tipos";

/** DES-05 Balance de masa: entrada = cortes + subproductos + merma, dentro de la tolerancia de la plantilla (RN-DES-05). */
export default function BalanceDeMasa() {
  return <PantallaDespiece descripcion="Lo que entra debe salir como cortes, subproductos o merma. Si la diferencia pasa la tolerancia de la plantilla, el despiece no se cierra sin la aprobación del jefe."
    panel={(d) => <div className="grid gap-4 lg:grid-cols-2">
      <Seccion titulo="Balance"><BalanceMasa b={d.mass_balance} /></Seccion>
      <Seccion titulo="Kg por corte">
        <Tabla cabeza={["Corte", "Rol", "Kg"]} filas={d.lines.map((l) => [l.name, ROL_SALIDA[l.role], kg(l.weighed.reduce((s, w) => s + Number(w.weight_kg ?? w.qty ?? 0), 0))])} />
      </Seccion>
    </div>} />;
}
