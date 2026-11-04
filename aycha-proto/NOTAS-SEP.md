# NOTAS-SEP · Separación de marcas (fase 4)

Implementado solo en `src/modules/SEP.js`. Lo que toca a otros módulos o al núcleo:

- **Disparadores (RN-SEP-05/06)** como envoltorios dentro del módulo, igual que hace SUS:
  - `G.docs.issue` elige la serie de la empresa vigente a la fecha (`G.sep.companyFor`) y rechaza con RN-SEP-05 una empresa o serie de otro RUC. Las notas siguen la empresa del comprobante que corrigen.
  - `G.db.insert('sales_documents')` estampa o valida `company_id`; `G.db.insert('sales_orders')` y `G.orders.create` llaman a `G.sep.assertOrderBrand` (RN-SEP-06).
  - `G.fac.issue`: `assertSeries` de FAC compara la serie con `'co-dg'` fijo (RN-FAC-02). Cuando la marca ya emite con otro RUC, el envoltorio emite por `G.docs.issue` y luego llama a `G.fac.send`. **Pendiente en FAC:** cambiar `'co-dg'` por `G.sep.companyFor(brand_id, fecha)` en `assertSeries`, `issueGuide` y los resúmenes diarios.
- **Columnas agregadas** con `G.db.update`: `brands.separated_at` y `brands.separation_id`. También se anotan `document_series.created_by_separation_id`/`closed_reason`, `sales_documents.separation_id` (factura de traspaso) y `assigned_to` (cesión de cuentas por cobrar), y `warehouses.company_id` en los almacenes del RUC nuevo.
- **G.ACCESS** del núcleo no le da acceso a SEP a CONTADORA ni a ADMINISTRACION (solo lectura por `'*'`). Las acciones del módulo se controlan con los permisos especiales de la spec (`G.can('sep.…')`); la contadora prepara por permiso pero no ve el menú. Sugerencia: `CONTADORA: { SEP: 'CLE' }`, `ADMINISTRACION: { SEP: 'CLE' }`.
- **Respaldo de dependencias**: sin FAC, la guía usa la serie T001/T002 y se escribe en `dispatch_guides`; sin AUD, la exportación se registra en `data_exports` con los mismos campos que usa AUD; sin INT, el acta se escribe en `file_attachments`; sin DEL, la validación de rutas lee `delivery_routes` vacía.
- `G.SPEC.SEP` no trae las decisiones: los valores por defecto D-SEP-01…04 están en el módulo.
- Stock al corte = saldo actual − movimientos posteriores al corte (la carga inicial `INITIAL_LOAD` cuenta como saldo de apertura).
