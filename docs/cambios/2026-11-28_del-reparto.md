# 28/11/2026 · DEL Reparto: rutas, app del repartidor, seguimiento, liquidación, terceros, provincia y costo por entrega (DEL-01 a DEL-22)

Va después de PRE (`2026-11-27_pre-preparacion.md`): DEL usa las bolsas, la carga y el descuento de stock de PRE.

## Base de datos
Migración `2026_11_28_000100_del_reparto_reglas.php`. Solo ajusta las tablas de reparto que ya existían y agrega cuatro tablas nuevas. Es compatible con los datos de prueba:
- **Rutas (`delivery_routes`):** estados planificada, cargando, en ruta, de vuelta, liquidada y cancelada; modalidad propia, alquilada o de tercero; código único por día. RN-DEL-01 en la base: una ruta que salió tiene vehículo y repartidor, o empresa de delivery. El odómetro de vuelta no es menor que el de salida.
- **Paradas (`delivery_stops`):** el número de parada no se repite en la ruta y un pedido tiene una sola parada activa (RN-DEL-02). Estados y motivos de no entrega. Código de entrega de 4 dígitos que se genera al salir. Bolsas devueltas (sí o no, y cuándo) y fecha de reprogramación.
- **Eventos de la app (`delivery_events`):** solo se insertan. Llevan un id del teléfono único por empresa para no duplicarse al sincronizar (RN-DEL-06), quién lo registró, el monto y las fotos.
- **Enlace de seguimiento:** token único; `del_tracking_tenant()` devuelve solo la empresa del enlace (RN-DEL-08).
- **Tarifas, facturas de terceros, envíos a provincia y costos:** estados, bases y montos como número. RN-DEL-13: todo costo tiene al menos un destino; el combustible lleva vehículo, galones y vale.
- **Vehículos:** SOAT y revisión técnica pueden faltar (se avisa «sin registrar»); placa única.
- **Tablas nuevas:** `driver_expenses` (gastos del repartidor), `driver_messages` (mensajes a control), `support_requests` (pedidos de apoyo) y `external_handoffs` (derivación a motorizado externo).
- **`customer_addresses`:** cuándo se pidió la ubicación al cliente y la nota de la confirmación.

Después de `git pull`: `php artisan migrate --database=pgsql_owner`.

## Pantallas
- **DEL-01 Planificador:** pedidos de delivery del día por zona y franja, con mapa; crear la ruta (el orden sale del vecino más cercano desde el local).
- **DEL-02 Asignación:** propia o alquilada (vehículo y repartidor, pago por día, por entrega o por kg) o de tercero (empresa de delivery). No deja salir un vehículo con SOAT o revisión técnica vencidos.
- **DEL-03 Hoja de ruta:** carga por escaneo de las bolsas (de la última parada a la primera), reordenar, mover o quitar paradas, salida y vuelta con odómetro, aviso «va en camino» por WhatsApp, mapa, bitácora e impresión.
- **DEL-04 Mis rutas (app):** las rutas del repartidor con su avance y la siguiente parada; pedir apoyo.
- **DEL-05 Parada (app):** navegar, «Llegué», llamar o escribir, cobro contra entrega (efectivo, Yape, Plin o POS), entrega con foto y código del cliente (o firma), no entregado con motivo y foto, incidencias y derivación a motorizado externo.
- **DEL-06 Liquidación:** el efectivo esperado (cobros menos gastos pagados del efectivo) contra lo entregado; la diferencia lleva motivo y la aprueba otra persona.
- **DEL-07 Mapa:** última posición de cada repartidor, paradas hechas y atrasadas, entregas lejos del pin.
- **DEL-08 Enlaces de seguimiento:** por pedido; se anulan. La página pública es `/s/{token}` (sin sesión).
- **DEL-09 Empresas de delivery y tarifas:** por envío, por kg o por día, por zona o general, con vigencia.
- **DEL-10 Conciliación de facturas** de las empresas de delivery contra sus envíos del período.
- **DEL-11 Envíos a provincia:** agencia, embalaje, guía de remisión (la emite Comprobantes y aquí se enlaza), seguimiento, flete y empaque.
- **DEL-12 Vehículos:** propios y alquilados, SOAT, revisión técnica, kilometraje y mantenimiento del mes.
- **DEL-13 Costos de reparto**, **DEL-14 Costo por entrega** (corridas por mes, agrupado por zona, modalidad, vehículo, repartidor o ruta, con subsidio) y **DEL-15 Comparativo por zona** (propio contra tercero, con la sugerencia).
- **DEL-16 No entregados:** recibir las bolsas de vuelta (el stock regresa y la preparación se cierra) y reprogramar con fecha y franja nuevas.
- **DEL-17 Gastos de la ruta (app)**, **DEL-18 Ticket de entrega (app)**, **DEL-19 Calidad de direcciones**, **DEL-20 Apoyo y derivaciones**, **DEL-21 Mensajes a control (app)** con texto, audio o captura de pago, y **DEL-22 Mensajes** (control confirma la captura con el monto recibido).

La app del repartidor funciona sin señal: cada acción se guarda en el teléfono con su foto y se envía al volver la conexión; el servidor la registra una sola vez aunque llegue dos veces. El audio se graba en WAV y se envía con señal.

## Reglas principales (`app/Modulos/Del/Services`)
- `Rutas` (armar, asignar, cargar, salir, volver), `App` (acciones del repartidor y sincronización), `Seguimiento`, `Liquidaciones`, `Costos`, `Terceros`, `Provincia`, `Vehiculos`, `Extras` (gastos, mensajes, apoyo, derivación, ticket, direcciones), `NoEntregados` y `Consultas` (lo que muestran las pantallas).
- En PRE solo se agregó `Pre/Services/Reparto.php`, lo que DEL usa de PRE: la tarea y las bolsas toman la ruta y parada de DEL (así la carga en orden inverso sigue el orden de DEL), carga por escaneo, bolsas entregadas o devueltas, y `liberar` (cuando vuelven las bolsas de un no entregado, cierra la tarea para que se prepare de nuevo al reprogramarlo). El resto de PRE no cambió.
- PED no se modificó: DEL usa `Estados::cambiar`, `Estados::noEntregado` y `Estados::reprogramar`.
- Los cobros en ruta se registran en `payments`. La imputación al comprobante (`payment_allocations`) se hace solo si el pedido ya tiene su comprobante emitido.

## Permisos
- Leer DEL pide el módulo. Cada acción pide además su permiso de la spec: `del.route.plan` (coordinación), `del.route.drive` (repartidor, solo sus rutas), `del.tracking.view`, `del.carrier.manage`, `del.carrier_invoice.reconcile`, `del.province.manage`, `del.vehicle.manage`, `del.cost.view` y `del.cost.manage`.
- Conciliación y costos se abren con su permiso aunque el rol no tenga el módulo (administración, contadora). `/v1/del/opciones` se abre con el módulo o con uno de esos permisos.
- La liquidación la registra quien tiene DEL con «editar» (coordinación o gerencia) y la aprueba otra persona con «aprobar». El repartidor no registra la suya (RN-CAJ-10). Cuando exista CAJ, la caja tomará este paso.
- Las fotos, firmas y audios se abren con un enlace temporal (`POST /v1/del/archivos/{id}/enlace`), solo si son de una ruta que el usuario ve.

## Pruebas
14 pruebas en `tests/Feature/Modulos/DelTest.php`: CA-DEL-01 a CA-DEL-10, RN-DEL-02, 05, 07 y 10, mensajes con captura, apoyo, derivación, ticket (también sincronizado dos veces), enlaces de fotos, pedir ubicación, opciones por rol y vehículos.

## Verificado
- Las 14 pruebas de DEL pasan. En la suite completa, las únicas 2 que fallan (MaeTest «ficha con alcance…» y OpsTest «corrida sin emisor…») también fallan sin DEL: dependen de la fecha.
- `npm run typecheck` y `npm run lint` sin errores.
- En el navegador a 390 px, con pedidos nuevos para mañana preparados en PRE: las 22 pantallas como coordinación, gerencia y repartidor, sin errores de la API y sin desplazamiento horizontal. Recorrido completo: carga por escaneo y salida, llegada, cobro en efectivo, entrega con foto y código, no entregado con foto, gasto, mensaje y respuesta, mensaje sin señal que se envía al volver, bolsas recibidas, reprogramación (el pedido vuelve a CONFIRMADO para el día siguiente) y la página pública de seguimiento.

## A tener en cuenta
- Hay que fusionar PRE antes que DEL.
- Los lotes de prueba de octubre vencieron. Para probar con pedidos nuevos se usan los lotes nuevos (ver la nota de PRE).
- Mientras CRM no envíe plantillas, los avisos al cliente («va en camino», pedir ubicación, ticket) salen por un enlace de WhatsApp que abre quien atiende.
- Los mensajes a «Cobranza» los ve quien tiene DEL; cuando exista CAJ, la caja los verá en su bandeja.
- Parámetros opcionales (si no están, se usan estos valores): `del_pod_max_distance_m` (300), `del_position_interval_s` (120), `del_doc_alert_days` (15) y `del_carrier_tolerance_pen` (2).
