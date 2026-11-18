# 18/11/2026 · PED Pedidos de todos los canales (PED-01 a PED-14)

## Base de datos
Migración `2026_11_18_000300_ped_restricciones_y_reglas.php` (solo ajusta las tablas que ya creó `2026_11_03_000900_ped_pedidos.php`):
- Valores por defecto de las cifras del pedido y estados permitidos: borrador, confirmado, en preparación, pesado, listo, en ruta, entregado, no entregado, cerrado y cancelado (RN-PED-03).
- **CA-PED-11 en la base:** un pedido confirmado (o más allá) no puede quedar sin cliente, forma de pago, dirección o local de recojo, fecha y franja o agencia, según cómo se entrega (RN-PED-01). Los importados quedan fuera y salen en la vista «Importados incompletos».
- Columnas nuevas en `sales_orders`: `needs_stock` (confirmado sin stock con permiso, RN-PED-17), `last_activity_at`, `cancel_note` y `balance_note`. Estado de peso «aviso requerido» (RN-PED-05).
- Una sola aprobación de descuento pendiente por pedido, una franja no se repite en el mismo local, zona y hora (PED-06), código de motivo único y límites de descuento entre 0 y 100 %.

Después de `git pull`: `php artisan migrate --database=pgsql_owner`.

## Pantallas
- **PED-01 Pedidos:** lista por estado, fecha de entrega, franja, marca, canal, zona y vendedora; cifras y alertas (borradores con datos faltantes, aviso de peso, descuentos por aprobar); pestañas Activos, Para hoy, Borradores, Aviso de peso, Importados incompletos, Cerrados, Cancelados; exportación a Excel.
- **PED-02 Nuevo pedido:** pensado para el celular. Busca al cliente por celular o lo crea con alta rápida, nueva dirección con pin en el mapa, tipo de entrega (delivery, recojo, mostrador, provincia), fecha y franja con cupo y corte, productos del catálogo (sin texto libre, RN-PED-02), comprobante, pago adelantado, descuento con el límite del rol a la vista, datos de origen (número de WhatsApp, anuncio). La lista de lo que falta se actualiza mientras se escribe. «Guardar borrador» o «Guardar y confirmar».
- **PED-03 Detalle del pedido:** datos, productos con peso estimado y real, totales, pagos, comprobantes, historial, reprogramaciones, avisos y descuentos. Acciones según el estado: confirmar, volver a borrador, siguiente estado, registrar pesos, reprogramar, cancelar o no entrega, saldo y cierre.
- **PED-04 Selector de productos:** busca por nombre, SKU o código de barras; corte, modo de venta, precio vigente del canal y stock del local.
- **PED-05 Confirmación con el cliente:** el resumen en un solo mensaje (RN-PED-12), copiar o abrir en WhatsApp, y registrar cuándo y por qué canal confirmó.
- **PED-06 Franjas de entrega:** calendario de 7 días por local y zona con ocupación (verde, amarillo, rojo); al pulsar una celda, sus pedidos. Crear y editar franjas (cupo, hora de corte, días).
- **PED-07 Diferencia de peso:** pedidos pesados fuera de la tolerancia, línea por línea; mensaje sugerido editable; aviso por WhatsApp o llamada; respuesta del cliente. Desde la tercera plantilla por WhatsApp pide `crm.template.send_extra` (RN-CRM-07).
- **PED-08 Reprogramar:** nueva fecha y franja con motivo; pasado el tope (`ped_max_reschedules`) la hace solo la supervisora (RN-PED-14).
- **PED-09 Cancelar o no entrega:** motivo del catálogo y nota si el motivo la exige (RN-PED-13). Cancelar un confirmado pide `ped.order.cancel` y libera las reservas.
- **PED-10 Aprobación de descuentos:** pendientes, aprobados y rechazados. Quien pidió no aprueba; rechazar pide motivo (RN-PED-11).
- **PED-11 Pedidos de provincia:** agencia, destino, embalaje térmico, guía de remisión y seguimiento. Sin guía y seguimiento no sale a ruta (RN-PED-08).
- **PED-12 Saldo del pedido:** diferencia entre lo pagado y el total final: saldo a favor, devolución, cobro contra entrega, enlace de pago o condonar un saldo pequeño. Sin decidir el saldo no se cierra (RN-PED-15, RN-PED-19).
- **PED-13 Motivos y límites:** motivos de cancelación y no entrega, y límite de descuento por rol y marca.
- **PED-14 Tablero del día:** pedidos por franja y estado, confirmados sin preparar pasada la hora de corte, en ruta (se refresca cada minuto); y las cifras del mes (KPI-PED-01 a 10).

## Reglas principales (`app/Modulos/Ped/Services`)
- `Pedidos`: guardar borrador, líneas con precio vigente (`Precios::vigente`), recálculo con tarifa de la zona (`Zonas::tarifa`), lista de faltantes y confirmar (cliente que puede comprar, franja con cupo, reservas de stock).
- `Estados`: transiciones permitidas, cancelar, no entrega, reprogramar, saldo, cerrar y vencer borradores.
- `Franjas`, `Descuentos`, `Pesos` (peso real y aviso) y `Mensajes` (textos para el cliente y enlace de WhatsApp).
- Comando `php artisan ped:vencer-borradores` (cancela los borradores viejos, RN-PED-18). Además se ejecuta solo al abrir la lista de pedidos, como mucho una vez cada 10 minutos por empresa. No se agregó a la programación de tareas.

## Pruebas
22 pruebas en `tests/Feature/Modulos/PedTest.php`: CA-PED-01 a CA-PED-11 y RN-PED-03, 06, 08, 11, 12, 13, 14 y 18, más las consultas de las pantallas.

## Verificado
- Las 22 pruebas pasan; `npm run typecheck` y `eslint` sin errores.
- En el navegador como gerente, a 390 px de ancho: las 14 pantallas cargan sin errores de consola ni de la API y sin desplazamiento horizontal.

## A tener en cuenta
- Los lotes de stock de los datos de prueba vencieron en octubre: una vendedora no puede confirmar porque no hay stock (RN-PED-17). Para probar, entrar como gerente, que confirma sin stock.
