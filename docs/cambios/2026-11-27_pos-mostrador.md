# 27/11/2026 · POS Mostrador (POS-01 a POS-12)

La cajera vende por peso en el mostrador del local, emite boleta o factura al instante, cobra con efectivo, tarjeta, Yape, Plin o saldo a favor (también mezclados) y cierra el turno con arqueo por medio de pago. No hay un segundo inventario ni una segunda caja: la venta sale del almacén de la caja (ALM), crea su pedido (PED) y cobra al cliente de CLI.

## Base de datos
Migración `2026_11_27_000100_pos_turnos_y_reglas.php` (solo ajusta las tablas que ya existían: `pos_terminals`, `pos_shifts`, `pos_shift_counts` y `pos_cash_movements`):
- **Cajas:** código único por empresa; local, almacén y serie de boleta obligatorios; modo de balanza `MANUAL`, `SCALE` o `LABEL`; estado activa o inactiva.
- **Turnos:** estados abierto, cerrado y aprobado; fondo no negativo; un turno cerrado tiene sus cifras de cierre; quien aprueba no es la cajera (RN-POS-08). Columnas nuevas `closed_by_name`, `approval_note` y `over_limit`.
- **En la base, aunque falle la API:** una caja y una cajera tienen como máximo un turno abierto (RN-POS-01 y RN-POS-02, índices únicos parciales); un turno cerrado no se reabre y su arqueo no se cambia (disparador `pos_turno_cerrado`, RN-POS-07); los turnos no se borran y los conteos no se editan ni se borran.
- **Movimientos de caja:** tipos `CASH_IN`, `CASH_OUT`, `DEPOSIT`, `PETTY_EXPENSE` y `REFUND`, monto mayor que 0 y enlace a la nota de crédito en las devoluciones.

Después de `git pull`: `php artisan migrate --database=pgsql_owner`. Se revierte con `migrate:rollback`.

## Pantallas
- **POS-01 Abrir turno:** elige la caja (las ocupadas dicen por quién), cuenta el fondo por denominación y abre. Muestra los turnos abiertos del local y avisa si alguno quedó abierto desde otro día.
- **POS-02 Venta:** pantalla táctil. Buscador, lector de código de barras o etiqueta de balanza, accesos rápidos por línea (cuy, conejo, aves, embutidos…), productos con precio de la caja y stock de la exhibidora, carrito con peso y precio por kg, cliente opcional, boleta o factura y total por marca. En el celular, una barra fija lleva al total. El carrito no se pierde al recargar.
- **POS-03 Ingreso de peso:** teclado con 3 decimales, rango aceptado de la variante (por unidad en peso variable), unidades, aviso si está fuera de rango y aceptación con permiso de supervisora (RN-POS-04). En modo etiqueta lee el peso del código (RN-POS-06). En modo balanza conectada lo dice con honestidad: la balanza aún no está integrada y se digita el peso.
- **POS-04 Cobro:** medios mezclados; efectivo con vuelto y montos rápidos; tarjeta con operación, marca y 4 dígitos; Yape o Plin con operación; saldo a favor solo con cliente identificado. Solo el efectivo puede pasar del total.
- **POS-05 Comprobante:** boleta, factura o nota de crédito en el ancho de 80 mm, con logo y color de la marca, RUC, QR, hash, leyendas y pie de la marca. Imprime en la ticketera, abre WhatsApp con el resumen o lo envía por correo; reintenta el envío al OSE si quedó en cola.
- **POS-06 Ingresos y retiros:** retiro a caja fuerte, depósito, gasto menor e ingreso de sencillo con motivo. Sobre el límite (`pos_cash_out_approval_above`) autoriza la supervisora con su correo y contraseña (RN-POS-09). Muestra el efectivo esperado del turno.
- **POS-07 Cerrar turno:** efectivo contado por denominación; tarjeta según el cierre del POS; Yape y Plin según los avisos. Diferencia por medio en vivo y motivo obligatorio si hay diferencia (RN-POS-07). Si pasa el límite avisa a la supervisora. La supervisora puede cerrar un turno que la cajera dejó abierto.
- **POS-08 Aprobación de cierre:** turnos por aprobar, aprobados y abiertos; arqueo por medio, denominaciones, movimientos e historial de diferencias de la cajera; aprueba con nota (RN-POS-08).
- **POS-09 Devolución:** comprobantes del mostrador de hoy; líneas con unidades o peso devuelto (RN-POS-13); por el mismo medio (efectivo sale del turno abierto) o como saldo a favor; motivo. Emite la nota de crédito y el producto vuelve al almacén de devoluciones (`DEV-L1`).
- **POS-10 Ventas del turno:** tickets con medio, comprobante y estado SUNAT; cifras del turno; reimpresión, reintento al OSE y devolución.
- **POS-11 Cajas registradoras:** local, almacén, caja de efectivo, cuenta del adquirente, series de boleta y factura, modo de balanza, lista de precios y estado. No se desactiva ni se cambia de local una caja con turno abierto.
- **POS-12 Pedidos por recoger:** pedidos LISTO con recojo en el local; busca por número o celular; cobra el saldo, emite el comprobante y entrega. Si cuadra, el pedido se cierra; si el cliente pagó de más, se entrega y el saldo se decide en PED-12.

## Reglas principales (`app/Modulos/Pos/Services`)
- `Cajas`: alcance por local, validación de almacén, cuentas y series, medios de pago del mostrador y el cliente «Clientes varios (mostrador)».
- `Turnos`: abrir, esperado por medio, movimientos con autorización, cerrar con arqueo y aprobar.
- `Mostrador`: productos con precio y stock, peso (RN-POS-04), etiqueta (RN-POS-06), cotización y venta. Una venta crea un pedido por marca (canal mostrador), la salida de stock (`source_type = POS_SALE`), el comprobante y el cobro, y deja el pedido cerrado.
- `Cobros`: valida los pagos (RN-CAJ-01 a 04 y 08, RN-POS-11) y los registra.
- `Comprobantes` y `Ose`: series, IGV, correlativo, emisión y envío al OSE con cola de reintentos (RN-POS-12).
- `Devoluciones` y `Recojos`.

## Contrato con FAC y CAJ (mientras no existan)
FAC (facturación) y CAJ (caja y cobranzas) aún no están construidos. Mientras tanto POS escribe directamente en sus tablas con la misma forma que usarán ellos, para que al llegar solo cambie quién escribe:
- `sales_documents` y `sales_document_lines`: boleta, factura y nota de crédito (código 07) con `pos_shift_id`, `pos_terminal_id` y `pos_ticket`. En la nota: `related_document_id`, `refund_mode`, `refund_method` y `refund_status`.
- `einvoice_submissions`: cada intento de envío. Con `fac_einvoice_provider = FAKE` (la demo) el OSE de prueba acepta; con otro proveedor queda `PENDING` con reintentos (`fac_retry_backoff_minutes`, `fac_max_send_attempts`) y pasa a revisión al agotarlos.
- `payments` y `payment_allocations`: cobros numerados `CB-xxxxxx`, con la comisión de la tarjeta. El saldo a favor usado va a `customer_balance_movements` (`APPLIED`) y el devuelto como saldo (`CREDIT_NOTE`).
- Eventos: `pos.shift.opened`, `pos.shift.closed`, `pos.shift.approved`, `pos.cash.moved`, `pos.sale.completed`, `pos.refund.issued`, `pos.pickup.delivered`, `pos.terminal.created` y `pos.terminal.updated`; además `document.issued`, `document.accepted`, `payment.registered` y `order.closed`.
- Cuando existan FAC y CAJ, `Comprobantes::emitir`, `Ose::enviar` y `Cobros::registrar` se reemplazan por sus servicios; las pantallas no cambian.

## Pruebas
16 pruebas en `tests/Feature/Modulos/PosTest.php`: CA-POS-01 a CA-POS-06 y venta sin turno, venta con dos marcas, factura con RUC y boleta grande con DNI, saldo a favor, autorización de retiros, aviso por diferencia grande, devolución, OSE caído, recojo y validación de cajas.

## Verificado
- Las 16 pruebas de POS pasan. La suite completa da 404 pruebas bien y 2 fallos que ya existían y no tienen relación (MaeTest «ficha con alcance…» y OpsTest «corrida sin emisor…»).
- La migración aplica, se revierte y vuelve a aplicar.
- `npm run typecheck` y `npm run lint` sin errores.
- En el navegador, como cajera, supervisora y gerente, a 390 px y 1280 px: las 12 pantallas cargan sin errores de consola ni de la API y sin desplazamiento horizontal. Recorrido completo: abrir turno, vender conejo por peso y caldo, cobrar en efectivo con vuelto, ticket; retiro con autorización; devolución con nota de crédito; cierre con arqueo; aprobación; entrega de un pedido por recoger; nueva caja.

## A tener en cuenta
- Los lotes de prueba de los productos por peso vencieron en octubre: para vender conejo, cuy o cortes primero hay que recibir stock en la exhibidora (ALM-04). Caldos, despensa y gourmet tienen lotes vigentes.
- El turno de prueba `TUR-00003` de Jorge Salas está abierto desde el 10/10: al entrar sale el aviso de turno de otro día. Ciérralo en POS-07 o abre otro en una caja nueva.
- Los roles ADMINISTRACION y ADMIN_SISTEMA no tienen acceso al módulo POS en la matriz de roles: no ven Cajas registradoras. Si deben configurarlas, hay que darles el módulo en SEG.
- La balanza conectada (modo `SCALE`) aún no tiene integración con el equipo: se digita el peso.
