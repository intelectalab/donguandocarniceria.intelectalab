# NOTAS-PRS (Presupuesto, fase 3)

- Real (RN-PRS-06), sin IGV: ventas y costo de `sales_documents` ACCEPTED (NC restan); gastos de `G.gas.rows()` (respaldo: `expenses` APPROVED/PAID por `net_pen`); personal de `G.per.costRows()` (respaldo: sueldo × 1,215 de `employees`, centro de costo por puesto, prorrateado en el mes en curso).
- Mapeo a cuenta contable (CNT) se guarda pero no aporta real mientras CNT no exista en el núcleo. Compras de COM entran solo vía costo de ventas o CNT.
- Meses cerrados usan el snapshot `budget_actuals` (última corrida). El seed congela ene–ago 2026 (ago con 2 corridas). `period.closed` congela el mes automáticamente.
- Responsable de centro de costo (RN-PRS-10/12): rol por `cost_centers.area` (MARKETING, COORDINADOR_DELIVERY, JEFE_PRODUCCION, SUPERVISORA_VENTAS, ADMINISTRACION, CONTADORA, RRHH, CALIDAD). Esos roles no tienen acceso a PRS en `G.ACCESS`; reciben la notificación.
- Con los datos del núcleo, la planilla (~S/ 85 000/mes) casi iguala las ventas sin IGV (~S/ 88 000/mes): el resultado presupuestado sale negativo. Es un efecto de los datos de ejemplo.
