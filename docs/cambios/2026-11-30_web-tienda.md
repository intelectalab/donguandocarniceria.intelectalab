# 30/11/2026 · WEB Tienda WooCommerce y pasarela Mercado Pago (WEB-01 a WEB-08)

Va después de PRE, POS, FAC, DEL, CAJ y GAS (`2026-11-27_pre-preparacion.md` a `2026-11-29_gas-gastos.md`). WEB no duplica nada de otros módulos:
- los pedidos web se crean en PED;
- los cobros de Mercado Pago se registran en CAJ;
- los precios salen de CAT, el stock de ALM y los clientes de CLI;
- las notas de crédito se emiten en FAC.

Los webhooks entran por el receptor público de INT (`/api/hooks/{token}`), y WEB instala ahí sus procesadores.

## Base de datos
Migración `2026_11_30_000100_web_tienda_reglas.php`. Solo ajusta tablas que ya existían y es compatible con los datos de prueba.
- **RN-WEB-02:** un pedido externo entra una sola vez por tienda, con un índice único `(store_id, external_order_id)`.
- **Mapeos:** un SKU se mapea una sola vez por tienda, sin distinguir mayúsculas.
- **Transacciones de la pasarela:** son únicas por proveedor y pago, así que los reintentos del webhook no las duplican.
- **Validaciones:** estados, margen de seguridad y montos válidos (CHECK).
- **Columnas nuevas:**
  - `web_order_inbox.overrides`: el celular corregido, sin tocar lo recibido;
  - `poll_hits`, `last_polled_at` y `last_duplicate_at`;
  - `web_product_mappings.previous_variant_id` y `last_catalog_at`;
  - `gateway_transactions.reverse_error`.
- **Acceso al módulo:** los roles con un permiso de WEB reciben el módulo WEB en lectura para poder abrir sus pantallas. Son ADMIN_SISTEMA, ADMINISTRACION y MARKETING; no se toca a GERENTE.
- **Datos de prueba:** la misma corrección corre en una base nueva desde `WebDemoSeeder`, que `DatabaseSeeder` llama después de `EquDemoSeeder`.

Después de `git pull`: `php artisan migrate --database=pgsql_owner`.

## Pantallas
- **WEB-01 Tiendas:** cada tienda con lo siguiente:
  - marca, marcas que vende, lista de precios, local y almacenes de stock;
  - margen de seguridad, vendedora por defecto y qué sincroniza;
  - conectores de WooCommerce y Mercado Pago (las credenciales viven cifradas en INT y nunca vuelven al navegador);
  - probar la conexión y activar o desactivar con motivo.
- **WEB-02 Mapeo de productos:** cada SKU de WooCommerce con su variante del catálogo, el precio y el stock vigentes y los últimos enviados, y lo que está pendiente. Desde aquí se vincula, se desvincula con motivo, se publica o retira, y se crea en la web lo que el catálogo tiene y la tienda no.
- **WEB-03 Sincronización:** la última corrida de catálogo, precios, stock y pedidos por tienda, con «Correr» y el detalle por ítem.
- **WEB-04 Bandeja de pedidos web:** cada pedido recibido con lo siguiente:
  - su origen (webhook o consulta de respaldo), el pedido creado, el pago, los reenvíos y el error;
  - cifras del día y KPI-WEB-01 (sin intervención).
  - Hay un simulador de pedidos con plantillas (normal, SKU sin mapeo, celular inválido, sin pin y dos marcas) que solo funciona con conectores de prueba.
  - La vendedora, que no tiene WEB-05, ve el detalle en un panel y completa el pin desde ahí.
- **WEB-05 Resolver error:** la lista de pedidos con error o sin pin. Cada error tiene su acción:
  - **SKU sin mapeo o producto inactivo:** vincular el SKU;
  - **Celular inválido:** corregir el celular y reprocesar;
  - **Dirección sin pin:** marcar el pin en el mapa (o escribir latitud y longitud), usar la ubicación que el cliente envió por el enlace, o pedirla por WhatsApp con un enlace nuevo (CLI-07);
  - **Cualquier error:** reprocesar sin duplicar, o ignorar con motivo.
- **WEB-06 Pagos de la pasarela:** cada transacción de Mercado Pago con lo siguiente:
  - monto, comisión e IGV, neto y fecha de liberación;
  - el pedido y el cobro creado en Caja (CAJ-03), y su estado de conciliación (se concilia en Caja);
  - registrar a mano un cobro aprobado que no entró solo;
  - avisar al cliente un rechazo por WhatsApp;
  - las notas de crédito preparadas tras un reembolso, con el enlace para emitirlas en FAC-05.
  - Incluye un simulador de pagos (aprobado, pendiente, en revisión, rechazado, reembolso y contracargo).
- **WEB-07 Eventos de webhook:** lo que mandaron WooCommerce y Mercado Pago: cabeceras y cuerpo crudo, firma, repetidos, resultado, enlaces al pedido o pago y reprocesar.
- **WEB-08 Stock publicado:** por SKU, saldo, reservado, no usable, disponible, margen y publicado. El detalle muestra los lotes, y hay un botón «Enviar stock ahora».

## Reglas principales (`app/Modulos/Web/Services`)
- **`Bandeja`:** registrar, procesar, reprocesar, ignorar, corregir el celular, marcar el pin y crear el enlace.
  - Un carrito con varias marcas se divide en un pedido por marca (D-WEB-01) con el mismo pago.
  - El descuento web se reparte entre los pedidos (RN-WEB-08).
  - Un pedido sin stock queda en borrador con el motivo en el historial.
- **`Pagos`:** la notificación de Mercado Pago se verifica con su API.
  - **Aprobado con el mismo monto:** se registra el cobro en CAJ con la cuenta pasarela, la comisión y el IGV, se aplica a los pedidos y se confirman (RN-WEB-06).
  - **Pendiente:** no confirma nada.
  - **Rechazo:** avisa a la vendedora.
  - **Reembolso o contracargo:** revierte el cobro en CAJ, prepara la nota de crédito para FAC y avisa a administración (RN-WEB-09).
  - Los pendientes vencidos se cierran solos.
- **`Sincronizacion`:**
  - catálogo, precios y stock hacia WooCommerce (RN-WEB-05);
  - consulta de respaldo de pedidos de las últimas 24 h, con reintentos automáticos hasta `web_order_retry_max` (RN-WEB-04);
  - numeración `WS-000001`.
- **Comando y programación:** `php artisan web:sincronizar` corre cada minuto (`routes/console.php`). Envía el stock cada `web_stock_sync_minutes` y después de cada venta, el catálogo tras un cambio en CAT, los precios cada hora y la consulta de pedidos cada 15 minutos.
- **`Procesadores`:** instala en INT los procesadores de webhooks WOOCOMMERCE y MERCADOPAGO y las corridas WOO_STOCK_SYNC y WOO_CATALOG_SYNC (`AppServiceProvider`).
- **`Simulador`:** solo con conectores SANDBOX o FAKE (RN-INT-01). Firma el cuerpo con el secreto del endpoint y lo manda por el receptor de INT, igual que un webhook real.

## Integración con los otros módulos
- **INT:**
  - `Int/Services/Adaptadores.php` marca como instalados los adaptadores de WooCommerce y Mercado Pago, que viven en `Web/Services/Proveedores`.
  - En `IntTest` cambiaron dos comprobaciones que suponían a WEB sin instalar. La de «webhook sin procesador» quita el procesador de Mercado Pago solo dentro de esa prueba. La corrida de catálogo en producción ya no dice NO_INSTALADO.
- **CAJ:** `Caj/Services/ParaWeb.php` (nuevo) da la cuenta pasarela, marca el cobro como de la web con su comisión y lee su estado de conciliación. Los cobros se registran con `Cobros::registrar` y se revierten con `Cobros::revertir`. No se escribe directo en tablas de CAJ.
- **PED:** los pedidos se crean, recalculan y confirman con los servicios de PED. `Ped/Services/ParaWeb.php` (nuevo) agrega lo que `Pedidos::guardar` no recibe: el enlace del pedido con su tienda y su registro de la bandeja, el delivery que no se vuelve a cobrar en los pedidos de un mismo carrito dividido (D-WEB-01) y el descuento «Precio web» ya aprobado (RN-WEB-08).
- **CLI:** los clientes se crean con los servicios de CLI, y el enlace de ubicación es el de CLI-07. `Cli/Services/ParaWeb.php` (nuevo) guarda la dirección web «por completar» (sin pin, D-WEB-02), porque `Direcciones::guardar` exige el pin, y lee la ubicación que el cliente envió por el enlace.
- **FAC:** WEB solo prepara la nota de crédito y la muestra como emitida cuando FAC-05 la emite.
- **CAT y ALM:** solo lectura de precios, lotes y reservas.
- **FLO:** sin cambios.

## Permisos
- **Leer:** las pantallas piden el módulo WEB. La vendedora ve WEB-04 y WEB-08.
- **Por acción:**
  - `web.store.manage`: tiendas;
  - `web.mapping.manage`: mapeo;
  - `web.sync.run`: correr y simuladores;
  - `web.inbox.resolve`: reprocesar, ignorar y corregir el celular;
  - `int.webhook.reprocess`: reprocesar eventos.
- **Sin permiso extra:** marcar el pin, usar la ubicación recibida, el enlace al cliente y avisar del rechazo solo piden el módulo.
- **Cobro manual:** registrarlo pide CAJ «crear» o WEB «editar».

## Pruebas
20 pruebas en `tests/Feature/Modulos/WebTest.php`:
- CA-WEB-01 a CA-WEB-05;
- firma inválida;
- RN-WEB-04 (reintentos), RN-WEB-05 (corrida de stock y caída del proveedor), RN-WEB-06 (pago automático, rechazo y vencimiento), RN-WEB-07 (pin) y RN-WEB-09 (reembolso);
- D-WEB-01 (carrito con dos marcas) con RN-WEB-08 (descuento);
- todas las listas para 5 roles, permisos, edición de tienda y la programación.

## Verificado
- **Pruebas:** las 20 de WEB y las 14 de INT pasan. En la suite completa, las únicas 2 que fallan (MaeTest «ficha con alcance…» y OpsTest «corrida sin emisor…») ya fallaban antes: dependen de la fecha.
- **Código:** `npm run typecheck` y `npm run lint` sin errores.
- **Navegador:** a 390 px y en escritorio, las 8 pantallas como gerencia, marketing, supervisora y vendedora (solo WEB-04 y WEB-08), sin errores de la API y sin desplazamiento horizontal.
- **Recorrido en staging:**
  - pedido simulado por webhook firmado → pedido creado;
  - pago aprobado simulado → cobro CB- en Caja con comisión e IGV, aplicado al pedido;
  - pin marcado por la vendedora; celular corregido por la supervisora y reprocesado.

## A tener en cuenta
- Hay que fusionar PRE, POS, FAC, DEL, CAJ y GAS antes que WEB.
- donguando.com usa conectores de producción con credenciales de ejemplo: «Probar», «Correr» o «Enviar stock ahora» contra esa tienda fallan hasta cargar las credenciales reales en INT. Para demostrar, usa staging.donguando.com (sandbox) y los simuladores.
- Los lotes de prueba vencieron en octubre: un pedido web de prueba con pago aprobado puede quedar en borrador por falta de stock (el motivo queda en el historial). Se confirma en Pedidos.
- El mapa de WEB-05 necesita internet; sin mapa se escriben la latitud y la longitud.
