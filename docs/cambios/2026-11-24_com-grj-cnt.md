# COM, GRJ y CNT · Compras, granja y contabilidad (24/11/2026)

Tres módulos completos con datos reales: COM-01 a COM-12 (compras y cuentas por pagar), GRJ-01 a GRJ-07 (integración con la granja relacionada) y CNT-01 a CNT-16 (contabilidad). Contratos publicados en [docs/contratos.md](../contratos.md) (secciones COM, GRJ y CNT).

## Base de datos
- **Migraciones `2026_11_24_300100` a `300500`:**
  - COM: `purchase_requisitions`, `supplier_catalog`, `purchase_orders` y líneas, `purchase_receipts` y líneas, `purchase_documents` y líneas, `supplier_payments` y `supplier_payment_allocations`.
  - GRJ: `farm_links`, `farm_product_mappings`, `farm_dispatches` y líneas, `farm_reconciliations`.
  - CNT: `gl_accounts`, `journal_rules` y líneas, `journal_entries` y `journal_lines`, `accountant_inbox_items`, `sire_proposals` y líneas, `sire_submissions`, `cnt_fiscal_years`, `ledger_exports`, `bank_reconciliations` y `bank_statement_lines`, `period_close_tasks`, `payroll_journal_imports`, `fs_templates` y líneas.
  - `300400` enlaza las tablas entre módulos y `300500` agrega restricciones: estados, únicos por empresa (comprobante del proveedor, documento de la granja, número de asiento), un vínculo con la granja por día y el **trigger que impide cambiar un asiento aprobado** (se corrige con una reversa).
  - Todas con RLS y auditoría.
- **Datos de demostración** en `database/seeders/data/prototipo-com-grj-cnt.json.gz`, los del prototipo, centrados en **octubre de 2026**.

## API (`app/Modulos/Com`, `Grj` y `Cnt`; 51, 21 y 64 rutas)
- **COM:**
  - Proveedores con estado SUNAT y cambio de cuenta bancaria con doble control.
  - Catálogo con historial de precios.
  - Requerimientos que se agrupan en órdenes; órdenes con aprobación por umbral.
  - Recepción con balanza apta, temperatura y lote en cuarentena.
  - Comprobantes con control de duplicados, tipo de cambio y cruce de tres vías.
  - Cuentas por pagar con antigüedad, pagos con reversa, evaluación de proveedores y tablero.
- **GRJ:**
  - Vínculo NTI o factura con vigencia por día, y asistente de cambio a factura.
  - Mapeo de ítems de la granja.
  - Ingreso idempotente de envíos.
  - Recepción con tolerancia del 1 % y disputa con acuerdo.
  - Conciliación mensual y tablero.
- **CNT:**
  - Plan de cuentas y reglas por origen con versiones.
  - Motor de asientos que llaman COM y GRJ al registrar.
  - Bandeja de la contadora: la practicante clasifica y la contadora aprueba o devuelve.
  - SIRE de compras y ventas con su cruce y envíos.
  - Libros según el régimen del año, conciliación bancaria y cierre mensual con tareas verificadas.
  - Estados financieros, balance, mayor, planilla y tablero.
- Los mensajes al usuario no llevan códigos internos; la regla va en el campo `code` de la respuesta.

## Web (`src/app/(sistema)/m/com`, `grj` y `cnt`; piezas en `src/modulos/com`, `grj` y `cnt`)
- **35 pantallas.** Cada una lleva sus cifras arriba, que filtran la lista al tocarlas, y sus filtros. Las fichas y formularios van en paneles laterales.
- **Selector de mes** en las pantallas por período, que también aceptan `?month=AAAA-MM` en la dirección. Los tableros enlazan a la pantalla de cada indicador con el mes elegido.
- **CNT:**
  - La ficha del asiento (`modulos/cnt/Asiento.tsx`) se usa en asientos, asiento manual, bandeja, mayor y planilla. Trae enviar, aprobar, anular, reversar y corregir líneas.
  - SIRE de compras y de ventas comparten `modulos/cnt/Sire.tsx`. Se importa el archivo, se pega el contenido o se usa el ejemplo del mes.
- Los textos antiguos de los datos pasan por `limpio()` y `texto()` antes de mostrarse, para que no aparezcan códigos internos.
- Revisadas a 1440 px y 390 px: sin desborde horizontal, sin errores en la consola y sin códigos internos a la vista.
- `lib/modulos.json`: las descripciones de COM-12, GRJ-07 y CNT-16 ya no dicen «KPI-…», sino los indicadores.

## Pruebas
- `tests/Feature/Modulos/ComTest.php` (12), `GrjTest.php` (7) y `CntTest.php` (14). Cubren:
  - los criterios de aceptación de los tres módulos;
  - el recorrido completo de compra, recepción, comprobante, cruce, pago y asiento;
  - envío de la granja, disputa y conciliación;
  - bancos, libros, planilla, reglas, bandeja y reversa;
  - permisos, que todas las pantallas respondan y el aislamiento entre empresas.

## Decisiones para revisar
- **Lotes de compra en cuarentena:** todo lo recibido entra en cuarentena y lo libera Calidad, también lo de la granja.
- **SUNAT sin conector:** la consulta del RUC solo valida el formato y deja el estado como «sin consultar». El estado real lo fija Compras a mano. El SIRE se trabaja con archivos importados.
- **Envíos de la granja:** entran por `POST /api/v1/grj/envios` con sesión y permiso. El webhook público y firmado queda para INT. En GRJ-01 el conector figura como «Simulado».
- **Motor de asientos:** ya genera ventas, cobros, compras, NTI, gastos, pagos a proveedores y planilla. Todavía **no genera** costo de ventas, consumos, producción, ajustes de inventario, transferencias ni comisiones. Las reglas existen, pero ALM, PRO y VEN aún no llaman a `alRegistrar`. Los de los datos de demostración vienen del prototipo.
- **Cierre, tarea «Producción e inventario cerrados»:** revisa las órdenes de producción solo si existe la tabla `production_orders` (PRO aún no está).
- **Planilla:** la vista previa se arma con los trabajadores activos y su sueldo. La importación de Ayni HR se marca como fuente, pero no hay conector.
- **Régimen de libros:** sale de los ingresos de las cuentas 70 y 75 del año frente a 300 UIT. La contadora carga y confirma la UIT de cada año.
- **Textos de datos antiguos:** se limpiaron los textos de la semilla. En una base ya sembrada, los asientos aprobados conservan su historia anterior (el trigger no deja cambiarlos), y la web la muestra limpia. Con `migrate:fresh --seed` quedan limpios también en la base.
- **Fechas de la demostración:** los datos son de octubre de 2026. Las pantallas abren en el mes actual; para ver datos, elige octubre.

## Resultado de las verificaciones
- `php artisan test --testsuite=Feature`: **226 pruebas en verde** (2366 aserciones).
- `npm run typecheck`: limpio. `npx eslint` sobre las pantallas y piezas de COM, GRJ y CNT: sin errores ni avisos.
- Las 35 pantallas abiertas en el navegador a 1440 px y 390 px con la contadora: sin desborde, sin errores de consola y sin códigos internos en pantalla.
