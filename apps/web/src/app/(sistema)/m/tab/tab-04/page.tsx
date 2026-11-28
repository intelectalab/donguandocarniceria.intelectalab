import { Tablero } from "@/modulos/tab/Tablero";

/** TAB-04 Tablero de delivery (D-TAB-02, RN-TAB-01, 02, 06 y 07). */
export default function TableroDelivery() {
  return <Tablero codigo="DELIVERY" descripcion="Entregas, a tiempo, no entregados, costo por entrega, por kg y por zona y modalidad, subsidio, descuadres de caja, vehículos y documentos por vencer."
    quienes="Este tablero lo ven el Coordinador de delivery y Administración, solo con los locales de su alcance." />;
}
