import { Tablero } from "@/modulos/tab/Tablero";

/** TAB-03 Tablero de la supervisora (D-TAB-02, RN-TAB-01, 02, 06 y 07). */
export default function TableroSupervisora() {
  return <Tablero codigo="SUPERVISORA" descripcion="Ventas cobradas por vendedora, alertas de control, clientes y, si Telefonía está encendida, llamadas atendidas, perdidas y devoluciones a tiempo."
    quienes="Este tablero lo ve la Supervisora de ventas." />;
}
