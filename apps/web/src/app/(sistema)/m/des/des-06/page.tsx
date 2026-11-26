"use client";

import { Alert } from "@/components/ui";
import { PantallaDespiece } from "@/modulos/des/comunes";
import { PanelCierre, Seccion, TablaCosteo } from "@/modulos/pro/comunes";

/** DES-06 Costeo conjunto: el costo de la canal, la mano de obra y los equipos se reparte entre los cortes por su valor de mercado (RN-DES-04, RN-DES-06). */
export default function CosteoConjunto() {
  return <PantallaDespiece descripcion="Los subproductos se valoran a su VNR y el resto del costo se reparte entre los cortes principales según peso × precio de referencia. El redondeo va al corte de mayor valor."
    panel={(d, f, recargar) => <div className="space-y-4">
      {d.costing ? <Seccion titulo="Reparto del costo"><TablaCosteo c={d.costing} /></Seccion> : <Alert tone="info">Ver el costeo requiere el permiso de costos.</Alert>}
      {f.order.status !== "CLOSED" && <PanelCierre f={f} onCambio={recargar} />}
    </div>} />;
}
