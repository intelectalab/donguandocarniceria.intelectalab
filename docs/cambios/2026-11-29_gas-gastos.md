# 29/11/2026 · GAS Gastos: registro con foto, aprobación por niveles, pagos, caja chica, contadora, reparto y reporte (GAS-01 a GAS-11)

Va después de DEL (`2026-11-28_del-reparto.md`): GAS usa los gastos del repartidor (`driver_expenses`) y los costos de reparto (`delivery_costs`) de DEL. CAJ (`2026_11_29_000200_caj_cajas_reglas.php`) puede ir antes o después: lee lo que GAS deja en `expenses` y `petty_cash_reports`, y GAS solo lee `cash_accounts`.

## Base de datos
Migración `2026_11_29_000100_gas_gastos_reglas.php`. Ajusta las tablas de gastos que ya existían, sin tablas nuevas. Sirve con la base vacía y con los datos de prueba ya cargados.
- **Reglas en la base (CHECK):** estados, tipos de comprobante, grupos, monedas, niveles de aprobación (0 a 3) y montos. `total = subtotal + igv + otros tributos`.
- **Únicos:** código de categoría, número de gasto y de rendición, un fondo activo por local, una rendición abierta por fondo y un solo gasto por cada gasto del repartidor.
- **RN-GAS-05 comprobante único:** el mismo RUC (o proveedor), tipo, serie y número no se registra dos veces, salvo que el anterior esté anulado.
- **Monto en soles:** un trigger calcula `amount_pen = total × tipo de cambio`. En soles el tipo de cambio es 1.
- **Columnas nuevas:**
  - `expenses`: RUC y razón social escritos a mano, enlace al gasto del repartidor, fecha de corrección y quién anuló.
  - `petty_cash_reports`: quién devolvió la rendición, cuándo y por qué.

Después de `git pull`: `php artisan migrate --database=pgsql_owner`.

## Pantallas
- **GAS-01 Registrar gasto:**
  - Foto del comprobante tomada con el celular y categoría con buscador.
  - Comprobante con serie, número, fecha y RUC; el RUC busca al proveedor.
  - Montos con botón «IGV 18 %».
  - Se elige si se paga por tesorería o con caja chica (solo si el local tiene fondo).
  - Lo que exige cada categoría aparece solo: vehículo, galones, repartidor, campaña o proveedor.
  - Se guarda como borrador o se envía a aprobación.
- **GAS-02 Mis gastos:** los propios con su estado; quien ve todos tiene la pestaña «Todos». La ficha muestra la foto, el historial, las aprobaciones, el costo de Delivery y el reparto.
- **GAS-03 Bandeja de aprobación:** lo que el usuario puede aprobar según su nivel. Nunca aparecen los gastos propios.
- **GAS-04 Por pagar y pagados:**
  - El pago sale de una cuenta de Caja y bancos.
  - Banco y billetera piden el número de operación.
  - Un recibo por honorarios se paga sin la retención.
- **GAS-05 Categorías** y **GAS-06 Reglas de aprobación** (por monto, y si hace falta por categoría o local).
- **GAS-07 Caja chica:** un fondo por local con su responsable, saldo, máximo por gasto, días sin rendir y la rendición abierta.
- **GAS-08 Rendición:**
  - El responsable la envía.
  - Administración la aprueba (no puede ser la misma persona que la envió) o la devuelve con motivo.
  - Al reponer se registra de qué cuenta sale el dinero.
- **GAS-09 Bandeja de la contadora:**
  - Confirma si el comprobante es válido, corrige la categoría o el centro de costo, o pide la corrección.
  - El botón «Traer gastos de ruta» copia los gastos del repartidor ya liquidados en Delivery.
- **GAS-10 Reparto entre centros de costo:** porcentajes por centro, marca y canal, con el monto de cada parte a la vista. Se define antes de aprobar.
- **GAS-11 Reporte:**
  - Agrupa por categoría, grupo, centro de costo, local, marca, canal o mes.
  - Muestra los KPI-GAS: total, % sin comprobante válido, tiempo de aprobación por nivel, pendientes y días sin rendir la caja chica.
  - Se exporta a Excel en 2 hojas: resumen y detalle.

Todas funcionan en el celular (390 px). El menú muestra el módulo completo a todos los roles con GAS. Si una pantalla no le toca al rol, se ve un aviso en lugar de un error.

## Reglas principales (`app/Modulos/Gas/Services`)
- `Gastos`: registrar, validar, enviar, corregir y anular.
  - Valida RN-GAS-01/02/03/05/06/09/10/11/13: foto, categoría, proveedor, comprobante único, fecha y periodo abierto, caja chica, honorarios y moneda.
- `Aprobaciones`: el nivel sale de la regla más específica; si no hay regla, de los topes S/ 300 y S/ 2,000 (RN-GAS-07). Nadie aprueba su propio gasto (RN-GAS-08).
  - Un gasto de caja chica aprobado queda pagado con el fondo.
  - Un gasto de reparto aprobado entra a Delivery como costo, sin IGV (RN-GAS-12).
- `Pagos`: pagar y revertir el pago.
- `CajaChica`: fondos, saldo, rendición (enviar, aprobar, devolver, reponer).
- `Contadora`: clasificar, observar y traer los gastos de ruta.
  - Los gastos con dinero propio del repartidor entran «por pagar».
  - Los pagados con el efectivo de la ruta entran ya pagados y sin cuenta, para que CAJ no los cuente dos veces.
  - El costo de Delivery que ya existía se enlaza, no se duplica.
- `Reparto`: al menos dos líneas que suman 100 %; la última absorbe el redondeo.
- `Configuracion`: categorías y reglas (las reglas activas del mismo alcance no se cruzan).
- `Reporte`: datos y KPI.
- En DEL solo se agregó `Del/Services/ParaGas.php`: los gastos del repartidor liquidados que faltan traer, y enlazar el costo de reparto al gasto. El resto de DEL no cambió.

## Permisos
- Registrar pide `gas.expense.create`.
- Aprobar pide `gas.expense.approve_area`, `approve_admin` o `approve_management` (niveles 1, 2 y 3).
- Pagar pide `gas.petty_cash.manage` o `gas.expense.approve_admin`.
- Configurar pide `gas.category.manage`.
- La bandeja de la contadora pide `gas.accounting.review`.
- El reporte pide `gas.expense.view_all` o `gas.accounting.review`.
- El responsable de un fondo ve su fondo y envía su rendición aunque no maneje la caja chica. Si no tiene acceso a Gastos, la pantalla de caja chica lo avisa.

## Pruebas
13 pruebas en `tests/Feature/Modulos/GasTest.php`:
- CA-GAS-01 a 08 y la rendición de caja chica.
- Reglas del registro.
- Pago, reverso y anulación.
- Gastos de ruta liquidada.
- Permisos y exportación.
