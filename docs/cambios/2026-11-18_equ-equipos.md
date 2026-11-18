# EQU · Equipos, calibración y mantenimiento (18/11/2026)

Módulo EQU completo: EQU-01 a EQU-09 con datos reales, sobre las tablas que ya existían (`equipment`, `equipment_calibrations`, `maintenance_plans`, `maintenance_orders`). Contrato publicado en [docs/contratos.md](../contratos.md) (sección EQU).

## Base de datos
- **Migración `2026_11_18_000100_equ_restricciones_y_uso.php`:**
  - `CHECK` de categorías (se suma `THERMOMETER`), estados del equipo (`ACTIVE`, `OUT_OF_SERVICE`, `RETIRED`), resultado de calibración, tipo y estado de orden, urgencia y motivo de fuera de servicio (`CORRECTIVE`, `CALIBRATION`, `MANUAL`).
  - **RN-EQU-01 en la base:** toda balanza exige calibración. **RN-EQU-02:** calibración con certificado, archivo y vigencia posterior a la fecha. **RN-EQU-06:** total de la orden = repuestos + mano de obra + servicio externo. Plan con frecuencia en días o en horas.
  - Únicos por empresa: código y QR del equipo, número de orden; **una sola orden abierta por plan** (índice parcial, evita preventivas duplicadas).
  - **RN-EQU-12 en la base:** las calibraciones no se editan ni se borran (`REVOKE UPDATE, DELETE` a `aycha_app`). Una corrección es una calibración nueva.
  - Tabla nueva `equipment_usage` (horas por orden de producción, con su costo), con RLS y auditoría.
  - Columnas nuevas: `equipment.notes`, quién registró la calibración, quién terminó y quién anuló la orden. El horómetro pasa a 1 decimal.
- `EquDemoSeeder` siembra 179 registros de uso de los últimos meses (lo que hacía el prototipo), para que EQU-08 y el tablero tengan datos.

## API (`app/Modulos/Equ`, rutas en `routes/modulos/equ.php`, 28 rutas bajo `/api/v1/equ`)
- `EquiposService` con las reglas RN-EQU-01 a 12. Controladores: `EquipoController`, `CalibracionController`, `PlanController`, `OrdenController` y `UsoController`.
- **Reporte de falla (RN-EQU-05):** abre la orden correctiva y deja el equipo fuera de servicio; si ya tiene una correctiva abierta, el reporte se suma a ella. Avisa al jefe de producción.
- **Calibración no conforme (RN-EQU-10):** deja el equipo fuera de servicio; vuelve a activo solo con una nueva calibración conforme.
- **Terminar la orden:** suma costos, valida que el periodo esté abierto, carga el costo al centro de costo del equipo, mueve la próxima fecha del plan y devuelve el equipo a servicio si no queda otra correctiva.
- **Comando `equ:diario`** (todos los días a las 06:10, hora de Lima): crea las preventivas que tocan (RN-EQU-07), avisa las vencidas hace más de `equ_preventive_overdue_days` y las calibraciones que vencen en `equ_calibration_alert_days` (RN-EQU-08), sin repetir avisos.
- Eventos `equipment.out_of_service`, `equipment.back_in_service`, `equipment.calibrated`, `maintenance_order.opened`, `maintenance_order.closed` y `maintenance_order.preventive_created`.

## Web (`src/app/(sistema)/m/equ/equ-01` … `equ-09`, piezas en `src/modulos/equ`)
- EQU-01: equipos con cifras, filtros por categoría, estado y «uso hoy», QR de cada equipo (se amplía e imprime) y formulario de nuevo equipo.
- EQU-02: ficha del equipo con calibraciones, órdenes, planes, uso y su QR; editar, fijar la carga por hora (con sugerida de 90 días) y abrir orden.
- EQU-03: calibraciones con registro (vigencia sugerida por categoría). EQU-04: calendario de calibraciones y balanzas no aptas.
- EQU-05: planes preventivos con su estado (al día, toca, vencido) y «Generar preventivas». EQU-06: órdenes con la ficha, iniciar, terminar con costos y anular.
- EQU-07: reporte de falla pensado para el celular. **El QR del equipo abre esta pantalla con el equipo ya elegido**; se describe la falla y se toma la foto.
- EQU-08: horas por orden de producción y lectura de horómetro, solo con equipos aptos. EQU-09: tablero con KPI-EQU-01 a 04, costos por local, equipo y mes, y la lista de balanzas.
- Revisadas a 1440 px y 390 px sin desborde ni errores en la consola.

## Pruebas
- `tests/Feature/Modulos/EquTest.php`: 17 pruebas. CA-EQU-01 a 05, RN-EQU-05 a 12, reporte de falla de un operario por QR, KPIs con los datos de demo, aislamiento entre empresas y las pantallas.
- `php artisan test --testsuite=Feature`: 192 pruebas en verde. `npm run typecheck` y `npm run lint` limpios.

## Decisiones para revisar
- **CAJERO** tiene `equ.failure.report` pero no tiene el módulo EQU en la matriz de accesos, así que hoy no entra a EQU-07. No cambié la matriz.
- **Termómetros:** se agregó la categoría `THERMOMETER` (la spec los calibra pero no los listaba como categoría).
- **QR:** codifica la dirección de EQU-07 con el código del equipo. Se agregó la librería `qrcode-generator` (web, sin servidor).
- **Fotos y certificados:** se guarda la ruta del archivo; la subida real queda para cuando haya almacenamiento de archivos.
- **Balanza del lote o de la venta:** EQU expone `exigirBalanza()`; la columna que guarda la balanza la agrega ALM o PRO cuando la use.
- **PRO:** registrará las horas con `registrarUso()` y agregará la llave foránea de `equipment_usage.production_order_id`.
- **Servicio externo:** la orden guarda el proveedor y el monto; la compra o el gasto va por COM o GAS.
