"use client";

import { Badge } from "@/components/ui";
import { kg, porcentaje } from "@/lib/formato";
import { PantallaDespiece } from "@/modulos/des/comunes";
import { PanelConsumo, PanelProduccion, Seccion, Tabla, pp } from "@/modulos/pro/comunes";
import { ROL_SALIDA } from "@/modulos/pro/tipos";

/** DES-04 Despiece en curso: canal que entra, cortes pesados contra su estándar y alerta del corte fuera de rango (RN-DES-03). */
export default function DespieceEnCurso() {
  return <PantallaDespiece estados="RELEASED,IN_PROGRESS" descripcion="Registra la canal que entra y pesa cada corte en la balanza calibrada. Si un corte se aleja de su estándar más de lo permitido, se avisa al momento."
    panel={(d, f, recargar) => <div className="space-y-4">
      <Seccion titulo="Avance por corte">
        <Tabla cabeza={["Corte", "Rol", "Pesado", "Real", "Estándar", "Desvío"]}
          filas={d.lines.map((l) => [l.name, ROL_SALIDA[l.role], kg(l.progress?.weight_kg ?? 0), porcentaje(l.progress?.actual_pct, 2), porcentaje(l.standard_yield_pct, 1),
            l.progress ? <Badge key="d" tone={l.progress.out_of_standard ? "bad" : "ok"}>{pp(l.progress.deviation_pp)}</Badge> : "—"])} />
      </Seccion>
      {f.consumptions.length === 0 && <PanelConsumo f={f} onCambio={recargar} />}
      <PanelProduccion f={f} onCambio={recargar} />
    </div>} />;
}
