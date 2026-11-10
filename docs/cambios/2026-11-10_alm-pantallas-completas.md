# ALM · Pantallas completas contra el prototipo (10/11/2026)

Sigue a [2026-11-10_alm-modulo.md](2026-11-10_alm-modulo.md). Se revisó cada pantalla contra `aycha-proto/src/modules/ALM.js` y la spec, y se agregó lo que faltaba. No hay migraciones nuevas.

## API (`PantallaController`, 13 rutas nuevas bajo `/api/v1/alm`)
- `GET /cifras/{01..13}`: las cifras de arriba de cada pantalla. Los montos van vacíos sin `alm.stock.view_cost`.
- `GET /temperaturas` y `GET /almacenes/{id}`: última lectura y lecturas fuera de rango por almacén. **Solo lectura** de `temperature_points` y `temperature_readings` (son de CAL).
- `GET /stock/{id}`: ficha del saldo con los pedidos que lo tienen reservado y su kardex.
- `GET /kardex/{id}`: ficha del movimiento con su documento de origen, «reverso de» y «reversado por». La lista del kardex trae ahora `document` (número de REC, TR, conteo, merma, pedido o lote).
- `GET /lotes/historial`: todos los cambios de estado de lotes.
- `GET /transito`: lo que hay en el almacén de tránsito.
- `GET /reservas/pedidos`, `GET /reservas/pedidos/{id}`, `GET /reservas/faltantes` y `POST /reservas/pedidos/{id}/reintentar`. El faltante se calcula con las líneas del pedido menos sus reservas activas o consumidas (no hay columna `stock_short`).
- `POST /alertas/{lote}/promocion`: avisa a MARKETING y a VENDEDORA (`stock.promo_suggested`).
- Listas con más columnas y filtros: marca y documento en el kardex; marca, línea, valor y con o sin stock en lotes; origen y quién recibió en recepciones; entre locales, contenido, diferencia y quién pidió o recibió en transferencias; cliente, estado del pedido y almacén en reservas; marca en alertas.

## Reglas nuevas
- **RN-ALM-02 al guardar un almacén:** cuarentena, tránsito, vehículo, devoluciones y producción no pueden marcarse como «vende» (como en el prototipo).
- **Reverso del kardex:** solo ingresos, ajustes y mermas. Una venta, un traslado o una producción se corrige desde su documento.
- **Alerta diaria (RN-ALM-15):** además del almacén, avisa a SUPERVISORA_VENTAS, como el prototipo.

## Web, pantalla por pantalla
- **ALM-01:** cifras (activas, cámaras, fuera de rango, valor); temperatura y lotes en cada almacén; «No vende»; vehículos agrupados; ficha con datos, lecturas de temperatura y botones Ver stock, Contar y Editar; el formulario no deja marcar «vende» en los tipos que no venden.
- **ALM-02:** cifras que llevan a ALM-10, ALM-11 y ALM-06; filtro y columna de marca; totales; `?wh=`; ficha del saldo con «reservado para», kardex y botones Ficha del lote, Transferir, Registrar merma y Bloquear lote (prellenados).
- **ALM-03:** cifras (movimientos, hoy, mermas y ajustes del mes); aviso de RN-ALM-01; filtro de marca; número del documento; ficha del movimiento; reverso solo donde corresponde.
- **ALM-04:** cifras (mes, por confirmar, KPI-ALM-06, límites de temperatura); filtro de origen; columnas T° del vehículo y quién recibió; control en vivo por línea con su código de regla; peso obligatorio si no es por unidad y nota obligatoria si se rechaza; «Guardar y confirmar»; enlace al lote creado; con origen Granja se elige sola la granja; solo almacenes que reciben.
- **ALM-05:** cifras que filtran; filtros de marca, línea y con o sin stock; columnas origen, producción, marca y valor; ficha con costo, peso recibido, kardex del lote e historial; `?lote=`.
- **ALM-06:** «Pendientes de liberar»; historial de todos los cambios de estado; al liberar desde cuarentena se sugiere el destino según la conservación; el aviso dice cuántos pedidos se volvieron a reservar.
- **ALM-07:** cifras (por despachar, en tránsito, con diferencia, guías del mes); filtro entre locales o mismo local; columnas contenido y diferencia; pasos en la ficha; lotes que salieron de verdad en cada línea; quién pidió, despachó y recibió; disponible por línea al crear; prellenado desde ALM-02.
- **ALM-08:** cifras (abiertos, por aprobar, exactitud KPI-ALM-05, ajustes del mes); columnas contó y aprobó; busca también por código de lote; `?nuevo=1&wh=` desde ALM-01.
- **ALM-09:** cifras (por aprobar con monto, del mes, KPI-ALM-02 y 03); barras del mes por motivo; columnas Foto y Registró; costo estimado y aviso de umbral al registrar; motivo del rechazo en la ficha; prellenado desde ALM-02 y ALM-11.
- **ALM-10:** cifras (pedidos, líneas y valor, con faltante, KPI-ALM-07); pestañas por pedido, por lote y almacén, y con faltante; cliente y estado del pedido; filtro de almacén; ficha del pedido con reservas e historial; «Reintentar reserva».
- **ALM-11:** cifras en soles por tramo y la ventana de alerta; columnas marca y estado; filtro de marca; botón Merma (prellenado) o Promoción por fila; la fila abre la ficha del lote; pestaña «Temperatura de cámaras» de solo lectura.
- **ALM-12:** cifras (en tránsito, valor, más antigua, lotes); columna contenido; botón Recibir; saldo del almacén de tránsito.
- **ALM-13:** cifras (activos, con foto, umbral por defecto); el motivo nuevo propone S/ 100.

## Pruebas
- `AlmTest`: 26 pruebas (5 nuevas: cifras y fichas, RN-ALM-02, reverso limitado, promoción y aviso a ventas).
- `php artisan test --testsuite=Feature`: **159 en verde**. `npm run typecheck` y `npm run lint` limpios.
- Las 13 pantallas revisadas a 390 px y 1440 px sin desborde horizontal ni errores.

## Pendiente de decisión
- **Registrar temperaturas desde ALM:** hoy solo se muestran. Las tablas son de CAL; registrar desde ALM espera la respuesta de Maximo.
