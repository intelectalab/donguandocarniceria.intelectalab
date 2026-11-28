# 28/11/2026 · FAC Comprobantes electrónicos y guía de remisión (FAC-01 a FAC-12)

Facturas, boletas, notas de crédito y débito y guías de remisión con el RUC de la empresa, para todas las marcas y canales. Cada marca emite con su serie (F001, B001…) y su plantilla impresa; el envío a SUNAT pasa por una cola con reintentos. FAC no duplica lo que ya hacía el Mostrador: POS ahora emite con el mismo emisor de FAC.

## Base de datos
Migración `2026_11_28_000100_fac_comprobantes_reglas.php` (solo ajusta tablas que ya existían):
- **`sales_documents`:** tipos, estados SUNAT, condición de pago y tipo de documento del comprador permitidos; valor de venta + IGV = total (RN-FAC-01); el crédito tiene vencimiento (RN-FAC-13); la nota tiene comprobante y motivo; el anulado tiene motivo. Columnas nuevas: `summary_pending`, `reissue_of`, `reissued_by`, `restocked_warehouse_id`, `credit_days`, `issued_by_name` y `source` (POS, ORDER, DIRECT o NOTE; se rellena en los existentes).
- **En la base, aunque falle la API** (disparador `fac_comprobante_inmutable`): un comprobante no se borra; enviado o aceptado ya no cambia sus datos (RN-FAC-03); un anulado no vuelve a emitido (RN-FAC-10). Sus líneas tampoco cambian una vez enviado (`fac_lineas_inmutables`).
- **`einvoice_submissions`:** resultado permitido, cada intento es de un comprobante, una guía o un resumen; columnas `manual` y `requested_by_name`.
- **`sunat_daily_summaries`:** tipo RC (resumen de boletas) o RA (comunicación de baja), estados, identificador único, `last_error` y `created_by_name`. Sus líneas: alta o baja, un documento una vez por resumen.
- **`dispatch_guides`:** estados, modalidad, transporte público con transportista y privado con vehículo y conductor, inicio no antes de la emisión, peso y bultos mayores que 0, número único, anulación con motivo (`needs_review`, `void_reason`, `voided_at`, `voided_by`) y disparador `fac_guia_inmutable`.

Después de `git pull`: `php artisan migrate --database=pgsql_owner`. Se revierte con `migrate:rollback`.

## Pantallas
- **FAC-01 Comprobantes:** lista con tipo, estado SUNAT, estado, origen y fechas; marca y local del selector de arriba; cifras de ventas, notas, por enviar y rechazados; Excel.
- **FAC-02 Emitir desde el pedido:** pedidos listos o entregados que pidieron comprobante y no lo tienen (marca los de más de 24 h). Sugiere factura o boleta según el cliente, muestra la serie de la marca y el local, importe con el peso real, delivery como servicio, crédito con días, boleta a nombre de otra persona.
- **FAC-03 Emisión directa:** sin pedido; productos del catálogo con su precio de lista o líneas libres (servicio o ajuste), afectación del IGV, fecha (hoy o un día de un período abierto) y crédito.
- **FAC-04 Detalle:** cabecera, líneas, IGV, adquirente congelado, pedido, cobros, envíos y respuestas; representación impresa en A4 y 80 mm con logo, QR, hash e importe en letras; XML y CDR; reenviar, reemitir (rechazado), anular, notas y guía.
- **FAC-05 Nota de crédito:** motivo del catálogo 09; por línea (devolución, descuento por ítem, diferencia de peso con el peso real) o por monto; no pasa el disponible (RN-FAC-08); reingreso al almacén de devoluciones con el mismo lote cuando viene de un pedido.
- **FAC-06 Nota de débito:** motivo del catálogo 10 y monto.
- **FAC-07 Cola de envío:** pendientes, por revisar y rechazados (comprobantes y guías), intentos, próximo intento y última respuesta; reenvío manual y «Procesar la cola ahora»; últimos 20 envíos.
- **FAC-08 Resumen diario y bajas:** boletas por informar (si `fac_receipt_summary_mode = SUMMARY`), armar el resumen del día, enviar (ticket) y consultar; detalle con sus documentos.
- **FAC-09 Guía de remisión:** desde el pedido o el comprobante (motivo 01), desde la transferencia de ALM (motivo 04) o directa (otros motivos); transporte público o privado, partida, llegada, peso, bultos y bienes; detalle, impresión, reenvío y anulación.
- **FAC-10 Series:** por tipo, marca y local, con el correlativo siguiente, uso y último emitido; crear (formato SUNAT, reglas de PLT-08) y activar o desactivar con motivo.
- **FAC-11 Plantillas impresas:** por marca, mostrar el logo, pie legal (obligatorio y con el RUC, RN-FAC-16) y leyendas, con vista previa A4 y 80 mm sobre un comprobante real.
- **FAC-12 Comprobantes del período:** resumen del mes por tipo, marca y estado SUNAT; ventas, notas, neto, IGV, mediana de aceptación, % rechazados, pendientes de más de 24 h y entregados sin comprobante; Excel con resumen y detalle (registro de ventas).

## Reglas principales (`app/Modulos/Fac/Services`)
- `Emision`: serie de la marca y el local (RN-FAC-02 y 07), comprador congelado, factura con RUC válido (RN-FAC-04), boleta sobre el tope con documento (RN-FAC-05), IGV por línea con el redondeo en la línea mayor, período abierto (RN-FAC-17), crédito con vencimiento (RN-FAC-13), pedido facturable solo listo o entregado y pesado (RN-FAC-14). `registrar()` es el emisor común de FAC y POS.
- `Envios`: envío al proveedor (`fac_einvoice_provider`, FAKE en la demo), reintentos con `fac_retry_backoff_minutes` y `fac_max_send_attempts`, revisión al agotarlos con aviso a ADMINISTRACION (RN-FAC-06). Comando `fac:procesar-cola`, programado cada minuto.
- `Notas`: catálogos 09 y 10, mismo cliente, disponible por línea y total, diferencia de peso (RN-FAC-15) y reingreso con ALM.
- `Resumenes`: anular (RN-FAC-10; no si tiene nota o cobro confirmado), resumen diario de boletas (RN-FAC-09), envío y consulta del ticket, reemisión de un rechazado con número nuevo.
- `Guias`: motivos habilitados, 01 enlazado a pedido o comprobante, 04 solo entre locales de la misma empresa con la transferencia, transporte y licencia (RN-FAC-11), serie T### del local (RN-FAC-12).
- `Consultas` (lista, ficha, XML UBL 2.1, CDR, período) y `Plantillas`.

## Contratos con otros módulos
- **POS:** `Pos\Services\Comprobantes::emitir` ahora llama a `Fac\Services\Emision::registrar` (misma serie, IGV, correlativo y evento `document.issued`) y `Pos\Services\Ose::enviar` delega en `Fac\Services\Envios::enviar`. Las pantallas de POS no cambian. Lo devuelto por línea (`sales_documents.returned`, forma `{línea: {qty, amount}}`) es el mismo campo para POS-09 y FAC-05: no se devuelve dos veces lo mismo.
- **ALM:** `AppServiceProvider` enlaza `Alm\Services\Guias\EmisorGuiaRemision` con `Fac\Services\GuiaElectronicaFac`. La guía de una transferencia entre locales es la GRE electrónica de FAC; si se registra el número de una guía emitida fuera del sistema, ALM la guarda como antes.
- **CAJ (aún no construido):** el cobro del pedido se enlaza al comprobante en `payment_allocations.document_id`; el saldo queda en `sales_documents.balance`.
- Eventos: `document.issued`, `document.accepted`, `document.rejected`, `document.voided`, `credit_note.issued`, `debit_note.issued`, `guide.issued` y `guide.voided`.

## Pruebas
23 pruebas en `tests/Feature/Modulos/FacTest.php`: CA-FAC-01 a CA-FAC-08, RN-FAC-04, 06, 07, 09, 10, 12, 13, 14, 15 y 17, devolución con reingreso (y la forma compartida con POS-09), reemisión, emisor común con POS, series, plantillas y que todas las pantallas respondan.

## Verificado
- FacTest, PosTest, PreTest, AlmTest y PedTest pasan. La suite completa da 442 pruebas bien y los mismos 2 fallos que ya existían y no tienen relación (MaeTest «ficha con alcance…» y OpsTest «corrida sin emisor…», de la facturación de la consola).
- La migración aplica, se revierte y vuelve a aplicar.
- `npm run typecheck` y `npm run lint` sin errores.
- En el navegador como gerente, a 390 px y 1280 px, las 12 pantallas cargan sin errores de consola ni de la API y sin desplazamiento horizontal. Recorrido: factura directa con producto y servicio, impreso A4 y 80 mm (la impresión sale sola, sin el resto de la pantalla), nota de crédito por ítem, boleta desde un pedido, anulación que va al resumen del día, envío y consulta del resumen, guía de la transferencia TR-0004 con transporte privado, procesar la cola, nueva serie, guardar plantilla y Excel del período.

## A tener en cuenta
- El proveedor electrónico de la demo es de prueba (`fac_einvoice_provider = FAKE`): acepta, rechaza una factura sin RUC válido y una nota cuyo comprobante fue rechazado, y su CDR es simulado. El conector real llega con INT.
- La cola necesita el programador de Laravel (`php artisan schedule:work` en desarrollo, cron en el servidor). Sin él, «Procesar la cola ahora» en FAC-07 hace lo mismo.
- Las boletas van una por una (`fac_receipt_summary_mode = INDIVIDUAL`). Con `SUMMARY` se informan en el resumen diario de FAC-08.
- Los períodos de enero a agosto de 2026 están cerrados: no se emite con fecha de esos meses.
- Los comprobantes de prueba antiguos no tienen hora de emisión ni nombre de marca guardado: la lista usa la fecha y el nombre actual de la marca.
