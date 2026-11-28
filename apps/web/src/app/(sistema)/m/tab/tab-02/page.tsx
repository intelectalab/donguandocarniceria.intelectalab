import { Tablero } from "@/modulos/tab/Tablero";

/** TAB-02 Tablero de ventas (D-TAB-02, RN-TAB-01, 02, 06 y 07). */
export default function TableroVentas() {
  return <Tablero codigo="VENTAS" descripcion="Pedidos y ventas por canal, número de WhatsApp, vendedora y franja; clientes nuevos y recurrentes, recompra y ventas por la web."
    quienes="Este tablero lo ven la Supervisora de ventas, las vendedoras, Marketing, Administración y Caja." />;
}
