# 27/11/2026 · PRE Preparación con escaneo, bolsas numeradas y carga verificada (PRE-01 a PRE-12)

## Base de datos
Migración `2026_11_27_000100_pre_preparacion_reglas.php` (solo ajusta las tablas de preparación que ya existían; es compatible con los datos de prueba):
- **Olas (`picking_waves`):** nacen en borrador (`DRAFT`); estados borrador, liberada, en armado, embolsada, cargada, cerrada y cancelada; motivo y fecha de cancelación, quién cerró; número único por empresa.
- **Tareas (`picking_tasks`):** una sola tarea activa por pedido (índice único parcial, RN-PRE-01); tipo de bulto (bolsa, caja térmica, caja, cooler) y de 1 a 20 bultos; anulación con nota; `stock_error` cuando no se pudo descontar el stock (se reintenta).
- **Líneas (`picking_task_lines`):** faltante con quién lo pidió, quién lo aprobó (con FK a usuarios), cuándo y cuánto sale. Un faltante aprobado exige motivo y aprobador.
- **Bolsas (`shipment_parcels`):** código de etiqueta único por empresa, estados cerrada, cargada, entregada y devuelta, peso numérico.
- **Lecturas (`picking_scans`):** de armado (`PICK`) y de carga (`LOAD`), con su resultado (correcto, producto equivocado, pedido cruzado, ruta equivocada, lote no liberado, fuera de FEFO, exceso, etiqueta repetida, fuera de orden de carga, código desconocido), la autorización de la supervisora (`override_of`, `override_by`, `override_reason`), la bolsa y la ruta.
- **Errores de armado (`packing_errors`):** tipos y etapas permitidos, costo no negativo, responsable obligatorio si llegó al cliente, acción correctiva obligatoria al cerrar.

Después de `git pull`: `php artisan migrate --database=pgsql_owner`.

## Pantallas
- **PRE-01 Planificador de olas:** pedidos confirmados sin ola por local y franja; crear la ola en borrador o crearla y liberarla (los pedidos pasan a EN PREPARACIÓN con ruta y parada); sacar pedidos de un borrador, cancelar y cerrar olas.
- **PRE-02 Lista consolidada:** por producto, cantidad, kg estimados, cortes, lote sugerido por FEFO y ubicación (cámara, congeladora, mostrador); marca lo que no alcanza. Se imprime.
- **PRE-03 Lista por pedido:** ticket con dirección, nota, líneas, cortes, lote FEFO, bolsas sugeridas, ruta y parada, y las lecturas. Se imprime. La supervisora anula la tarea de un pedido cancelado (el stock vuelve al almacén) y reintenta el descuento de stock si falló.
- **PRE-04 Armado con escaneo (celular):** caja con el foco para la pistola lectora, cámara del celular donde el navegador lee códigos, lote en uso que se mantiene entre lecturas, peso y cantidad. Verde con pitido si corresponde; rojo con sonido, vibración y motivo si no. Avance por línea, faltante con motivo y autorización FEFO en el momento si quien arma es supervisora.
- **PRE-05 Pesado:** líneas por peso de la fecha u ola con estimado, real, diferencia y tolerancia; enlace a PED-07 cuando hay que avisar al cliente.
- **PRE-06 Bolsas y etiquetas:** cantidad y tipo de bulto; etiquetas «n de N» con pedido, cliente, ruta, parada y código de barras Code 128 que se escanea al cargar. Se imprimen (100 mm de ancho).
- **PRE-07 Verificación:** otra persona revisa línea por línea, cuenta las bolsas y toma la foto (cámara del celular). El pedido queda LISTO.
- **PRE-08 Carga del vehículo:** rutas del día con su avance; escaneo de cada bolsa con ruta correcta y orden inverso de paradas; muestra los pedidos de la ruta que aún no tienen bolsas.
- **PRE-09 Faltantes:** por aprobar, líneas incompletas y aprobados; la supervisora aprueba o rechaza.
- **PRE-10 Errores de armado:** lista con filtros por mes, estado, etapa y tipo; registrar y cerrar con acción correctiva; cifras del mes (KPI-PRE-03).
- **PRE-11 Tablero de preparación:** avance de las olas, atrasados, preparadores y los indicadores del mes KPI-PRE-01 a 07.
- **PRE-12 Autorizaciones FEFO:** lecturas bloqueadas por FEFO; autorizar o pedir el lote correcto.

## Reglas principales (`app/Modulos/Pre/Services`)
- `Olas`: crear (un local por ola, pedidos confirmados o en preparación, nunca de mostrador, un pedido en una sola ola), liberar (asigna ruta: la de DEL si ya existe; si no, una por zona y franja con paradas por vecino más cercano desde el local), cancelar, sacar, cerrar y recalcular el estado.
- `Escaneo`: reconoce etiqueta de balanza, lote, SKU o código de barras y aplica las reglas en orden: código desconocido, etiqueta repetida (RN-PRE-06), pedido cruzado o producto equivocado (RN-PRE-03), lote (RN-PRE-04), exceso, FEFO con autorización (RN-PRE-05) y peso. Al completar una línea por kg registra el peso en PED (`Pesos::registrar`). Al terminar el armado libera las reservas y descuenta el stock de los lotes escaneados.
- `Despacho`: bolsas sugeridas (una cada 6 kg o 4 unidades; caja térmica para congelados y provincia), etiquetas, verificación (foto, otra persona, bolsas contadas, aviso de peso dado; RN-PRE-09 y 13), rutas y carga (RN-PRE-08).
- `Errores` (RN-PRE-11) e `Indicadores` (tablero y KPI).
- PED no se modificó: PRE usa `Estados::cambiar` (EN PREPARACIÓN y LISTO) y `Pesos::registrar`.

## Pruebas
15 pruebas en `tests/Feature/Modulos/PreTest.php`: CA-PRE-01 a CA-PRE-09, RN-PRE-01, RN-PRE-08 (pedidos sin bolsas de paradas posteriores), RN-PRE-12 (dos casos), pedido cancelado después de armar, y las consultas de las pantallas.

## Verificado
- Las 15 pruebas de PRE y las 25 de PED pasan; `npm run typecheck` y `eslint` sin errores.
- En el navegador a 390 px, con pedidos nuevos para mañana: crear y liberar la ola, armar con lecturas correctas, código desconocido y fuera de FEFO, autorizar en PRE-12, faltante aprobado por la supervisora, bolsas con código de barras, verificación por otra persona con foto (quien armó no puede), carga bloqueada fuera de orden y luego cargada en orden. Sin errores de consola ni de la API y sin desplazamiento horizontal.

## A tener en cuenta
- Los lotes de prueba de octubre vencieron. Para probar el armado se usan los lotes nuevos de cuy congelado `DG-CUY-CNG` en CNG-L1 (`CZ-2026-0001` en adelante) y el caldo `DG-CAL-1L`.
- `pre_load_order_strict` (sí) bloquea la bolsa de una parada mientras falten bolsas de paradas posteriores de la misma ruta, también de pedidos que aún no se embolsan.
- Los eventos de dominio de PRE (`wave.released`, `picking_task.verified`, `order.loaded`) se graban en `domain_events`; aún no hay quien los despache.
