# 06/11/2026 · PLT: Marcas y Series, y tablas legibles en el celular

## PLT-05 Marcas
- Tabla en el orden de los selectores, con color, qué vende, empresa que factura, nombre en WhatsApp, web y cuánto se usa (series, pedidos, comprobantes) y si tiene colores propios o usa los de la empresa (`ui_themes`, PLT-06). Filtros por empresa y estado.
- Crear y editar (permiso `plt.brand.manage`): código de 2 a 6 caracteres que no se repite ni cambia después; pie legal y nombre en WhatsApp obligatorios; color principal, leyendas del impreso y logo en el impreso. Al editar, el código se ve pero no se cambia. La ficha muestra el uso de la marca, sus series propias y sus colores.
- Logo (PNG, JPG o WEBP de hasta 1 MB): `POST/DELETE /v1/plt/marcas/{id}/logo`. Se guarda en el disco `local`, en `empresas/{tenant}/marcas/{código}.{ext}`; `logo_url` guarda el nombre del archivo. La imagen se lee con `GET /v1/plt/marcas/{id}/logo` (con el token; en la web, `apiImagen()`).
- Activar o desactivar varias a la vez: se marcan en la tabla y se usa la barra (`PUT /v1/plt/marcas/estado` con `ids` y `status`). Las separadas no se pueden marcar.
- Una marca inactiva no admite documentos nuevos: `App\Modulos\Plt\Services\Marcas::activa()` (RN-PLT-14). Una marca separada no se reactiva desde aquí.

## PLT-08 Series
- Cifras de cabecera, como en el prototipo: series (activas y electrónicas), serie más cargada (KPI-PLT-02: uso de la serie activa más cerca del tope), series que pasan el aviso (`plt_series_alert_pct`) y documentos numerados sin contar las series migradas (se descuenta `legacy_last_number`; una migrada sin ese dato y sobre 90 millones no se cuenta) y tabla con filtros por tipo, marca, local y estado, con barra de uso del rango.
- Crear (permiso `plt.series.manage`): formato SUNAT de las electrónicas (F001, B001, FC01/BC01, FD01/BD01, T001), internas de 2 a 4 caracteres, serie única, local y marca de la misma empresa (RN-PLT-04). Las notas de crédito y débito quedan ligadas a facturas o boletas según su letra.
- Ficha con los últimos números emitidos; activar o desactivar pide un motivo. También varias a la vez desde la tabla, con un mismo motivo (`PUT /v1/plt/series/estado` con `ids`, `status` y `reason`).
- **`App\Modulos\Plt\Services\Correlativo`** (RN-PLT-03): `emitir($serieId, fn ($serie, $numero) => …)` toma el número con bloqueo de la fila, en la misma transacción que guarda el documento; si la emisión falla, el número no se consume. Una serie desactivada o en 99 999 999 no numera (RN-PLT-20). Es lo que usan FAC, POS, ALM y COM para numerar.

## Reglas de negocio en la API
`RuleError` ya no antepone el código de la regla al mensaje: la pantalla muestra solo el mensaje y el código va en `code`.

## Tablas en el celular
`DataTable` muestra cada fila como tarjeta en pantallas angostas (como en erp-saas): título, estado y «dato: valor». Los filtros pasan a dos columnas y aparece «Ordenar por». Lo reciben todas las pantallas que usan la tabla.

## Marcar varias filas
`DataTable` recibe `selection={{ selected, onChange, actions, canSelect }}`: agrega casillas (en la tabla y en las tarjetas del celular), la casilla del encabezado marca la página y, con filas marcadas, aparece una barra con el número, los botones de `actions` y «Quitar selección». `canSelect` deja filas sin casilla.

## Filas por página
`useListado` recuerda en el navegador las filas por página que elige la persona, por pantalla (clave `aycha.porPagina:{ruta de la pantalla}|{ruta de la API}`). Al recargar se mantiene; en otro navegador vuelve al valor de la pantalla.

## Archivos en la API
`api()` acepta un `FormData` como `body` para subir archivos, y `apiImagen(ruta)` trae una imagen protegida como URL local para `<img>`.

## Pruebas
`tests/Feature/Modulos/PltMarcasSeriesTest.php`: listas, alta y edición de marcas, marca inactiva, permisos, formato y unicidad de series, correlativo sin saltos con una emisión fallida, serie desactivada, colores propios, estado de varias marcas y series a la vez, y subir, cambiar y quitar el logo. 41 pruebas en total.
