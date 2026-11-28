import { Tablero } from "@/modulos/tab/Tablero";

/** TAB-01 Tablero de gerencia (D-TAB-02, RN-TAB-01, 02, 06 y 07). */
export default function TableroGerencia() {
  return <Tablero codigo="GERENCIA" descripcion="Ventas cobradas por marca y canal, pedidos, ticket promedio, costo por entrega, error de armado, gastos frente a meta y alertas de control, con el semáforo de cada uno. Un mes congelado se lee de su corrida; el mes en curso se calcula en vivo."
    quienes="Este tablero lo ven Gerencia, Administración, la Contadora y Auditoría." />;
}
