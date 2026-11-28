import { Tablero } from "@/modulos/tab/Tablero";

/** TAB-05 Tablero de almacén y preparación (D-TAB-02, RN-TAB-01, 02, 06 y 07). */
export default function TableroAlmacen() {
  return <Tablero codigo="ALMACEN" descripcion="Pedidos por preparar por franja, preparados por hora-persona, errores bloqueados y escapados, listos a tiempo, desviación de peso y los indicadores del almacén."
    quienes="Este tablero lo ven Almacén, Preparación, el Jefe de producción y Calidad." />;
}
