# NOTAS-CNT

- Sin cambios en el núcleo. CNT usa `G.plt.closePeriod/reopenPeriod` si PLT está en el build; si no, actualiza `accounting_periods` y `accounting_period_events` y emite `period.closed/reopened`.
- Respaldos: si COM no está, la aprobación de PO_MISMATCH marca el comprobante como `APPROVED_DIFF`; si GAS no está, NO_VALID_RECEIPT solo marca la revisión; si PER no está, la planilla se calcula con `employees.monthly_salary` (fuente «archivo»).
- `G.cnt.toInbox` es el que COM ya busca para la bandeja (mismas columnas).
- Los asientos se generan al vuelo con los eventos `document.issued`, `payment.confirmed/reversed`, `purchase_document.registered`, `supplier_payment.registered`, `expense.approved`, `production_order.closed`, `stock.moved`; el costo de ventas es diario (botón «Generar asientos pendientes» en CNT-03).
- Migración ene–ago 2026 como asientos resumen mensuales (D-CNT-02). Valor de UIT 2026 cargado como dato de demostración por la contadora (RN-CNT-13).
