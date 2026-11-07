# 07/11/2026 · CAT-01 Productos

## Qué se hizo
- **API (`app/Modulos/Cat/`, `routes/modulos/cat.php`):**
  - `GET /api/v1/cat/productos`: lista paginada con búsqueda por código, nombre o SKU de una variante, y filtros `tipo` (SALE, INPUT, ALL), `brand_id`, `line`, `category_id`, `status`, `storage` y `web`. Cada producto trae marca, categoría, variantes activas, precio vigente de WhatsApp (mínimo y máximo), semáforo del registro sanitario y lotes bloqueados con stock.
  - `GET /api/v1/cat/productos/resumen`: cifras de cabecera (activos, variantes vendibles, cobertura de precios WhatsApp o KPI-CAT-01, registros por vencer o vencidos).
  - `GET /api/v1/cat/categorias`: categorías para el filtro.
  - Respeta el alcance por marca: la vendedora solo ve sus marcas.
- **Servicios que usarán otros módulos:**
  - `Precios::vigente($variantId, [...])` y `Precios::vigentes([...])`: precio vigente según RN-CAT-05 (listas activas y vigentes; marca, canal y tipo de cliente; menor prioridad; la más específica; tramo de cantidad mínima). Falta para CAT-07: lista asignada al cliente y la traza de por qué se descarta cada lista.
  - `RegistroSanitario::estado($producto)`: semáforo de RN-CAT-09 (vigente, aviso a `cat_sanitary_alert_days`, 30 días, vencido, sin registro, no requiere).
- **Web (`m/cat/cat-01`, `modulos/cat/tipos.ts`):** cifras, pestañas (venta, insumos, todos), aviso de variantes sin precio en WhatsApp, tabla con filtros y vista de celular. Un clic en una fila abre CAT-02 con `?id=`, que todavía es la ficha de la spec.

## Pruebas
`tests/Feature/Modulos/CatProductosTest.php` (7 pruebas): lista de venta e insumos, búsqueda por SKU, CA-CAT-07 (marca gourmet con sus 4 líneas), alcance de la vendedora, CA-CAT-02 (restaurante S/ 44, persona S/ 48), cambio de precio del cuy entero el 01/11, semáforo sanitario (CA-CAT-05) y cifras del resumen.

## Verificado
- Pruebas de la API: las 90 de `tests/Feature` pasan.
- `npm run typecheck` y `eslint` sin errores.
- En el navegador, como gerente: la pantalla carga sin errores y a 390 px se ve en tarjetas.

## Pendiente
- Ver «Servicios de CAT para otros módulos» al final de este archivo.

---

# 07/11/2026 · CAT-02 Ficha del producto

## Qué se hizo
- **API:** `GET /api/v1/cat/productos/{id}` (ficha con variantes, precios vigentes por lista, componentes del combo, lotes bloqueados e historial desde `audit.change_log`), `POST /api/v1/cat/productos`, `PUT /api/v1/cat/productos/{id}` y `PUT /api/v1/cat/productos/{id}/estado`. Crear y editar piden `cat.product.manage`.
- **Reglas (`Services/Productos.php`):** RN-CAT-01 (código único; con ventas no cambia de marca), RN-CAT-09 (DIGESA activo con número y vencimiento; vencido se despublica), RN-CAT-11 (al inactivar, sus variantes también), RN-CAT-13 (cambiar el IGV con ventas pide `cat.product.tax_change` y motivo; queda en el evento `product.tax_changed`), RN-PLT-14 (no se crea en una marca inactiva). Emite `product.changed`.
- **Web:** `m/cat/cat-02` (`?id=` el producto, `?nuevo=1` abre el alta) con datos, registro sanitario, pestañas de variantes, precios, componentes e historial; formulario `modulos/cat/ProductoForm.tsx` para crear, editar y copiar a otra marca.

## Pruebas
`CatFichaProductoTest.php` (6): ficha con variantes, precios y ventas; alta con la línea de su categoría y código único; DIGESA sin registro (RN-CAT-09); marca e IGV con ventas (RN-CAT-01 y 13); inactivar con sus variantes (RN-CAT-11); la vendedora consulta pero no edita ni ve otras marcas.

---

# 07/11/2026 · CAT-03 Variantes y cortes

## Qué se hizo
- **API:** `GET /api/v1/cat/variantes` (filtros de producto, marca, modo, corte y estado; busca por SKU, nombre, código de barras o PLU), `GET variantes/resumen`, `GET variantes/{id}`, `POST variantes`, `PUT variantes/{id}`, `PUT variantes/{id}/estado`, `DELETE variantes/{id}` y `GET cortes` (con `?product_id=`, solo los cortes de su línea). Escribir pide `cat.product.manage`.
- **Reglas (`Services/Variantes.php`):** RN-CAT-01 (SKU y código de barras únicos), RN-CAT-02 (peso variable pide peso nominal), RN-CAT-03 (mínimo ≤ nominal ≤ máximo), RN-CAT-04 (PLU único entre las activas), RN-CAT-09 (no se publica con registro vencido), RN-CAT-11 (con movimientos no se borra; no se activa si el producto está inactivo). Marca, línea y "se vende" vienen del producto. Por unidad no guarda pesos.
- **Web:** `m/cat/cat-03` (`?product_id=` filtra, `&nueva=1` abre el alta) con cifras, tabla, detalle con precios vigentes y formulario `modulos/cat/VarianteForm.tsx` que muestra el estimado y la tolerancia mientras se escribe.

## Pruebas
`CatVariantesTest.php` (7): lista y búsqueda por PLU, alta con marca y línea del producto, reglas de peso, PLU único, borrar con y sin movimientos, producto inactivo y registro vencido, cortes por línea.

## Verificado
- Las 103 pruebas de `tests/Feature` pasan. `typecheck` y `eslint` sin errores.
- En el navegador como gerente: lista, detalle y edición sin errores de consola.

---

# 07/11/2026 · CAT-04 Tipos de corte

## Qué se hizo
- **API (`CorteController.php`):** `GET /api/v1/cat/tipos-corte` (todos, con cuántas variantes los usan), `POST /api/v1/cat/tipos-corte` y `PUT /api/v1/cat/tipos-corte/{id}`. Escribir pide `cat.product.manage`.
- **Reglas:** código único (mayúsculas, números y `_`), al menos una línea; no se inactiva un corte ni se le quita una línea mientras lo usen variantes activas (código `CAT-04`).
- **Web:** `m/cat/cat-04` con cifras, búsqueda, filtro por línea y formulario con las líneas como casillas.

## Pruebas
`CatCortesTest.php` (4): lista con líneas y uso; alta que solo se ofrece en su línea; código repetido y sin líneas; no inactivar ni quitar una línea en uso; la vendedora consulta pero no edita.

## Verificado
- Las 107 pruebas de `tests/Feature` pasan. `typecheck` y `eslint` sin errores. En el navegador, lista y edición sin errores.

---

# 07/11/2026 · CAT-05 Listas de precio y CAT-06 Precios de la lista

## Qué se hizo
- **API (`ListaController.php`, `Services/Listas.php`):**
  - CAT-05: `GET /api/v1/cat/listas`, `GET listas/{id}`, `POST listas`, `PUT listas/{id}`, `PUT listas/{id}/estado`, `POST listas/{id}/copiar` (borrador con ajuste en %) y `POST listas/{id}/programar` (nueva vigencia de toda la lista).
  - CAT-06: `GET listas/{id}/precios?cuando=NOW|FUTURE|PAST|ALL`, `POST listas/{id}/precios`, `PUT listas/{id}/precios/{item}/cerrar`, `POST listas/{id}/csv/vista` (vista previa) y `POST listas/{id}/csv` (aplica).
  - Escribir pide `cat.price.manage`. Quien ve solo algunas marcas ve sus listas y las de todas las marcas, pero solo edita las de su marca.
- **Reglas:** RN-CAT-05 (código único, vigencia coherente, marca activa), RN-CAT-06 (sin vigencias superpuestas por variante y cantidad mínima; al cambiar se cierra la anterior el día previo y se guarda el precio anterior), RN-CAT-01 (la variante es de la marca de la lista). Cada cambio emite `price.changed`.
- **Web:** `m/cat/cat-05` (cifras, tabla, ficha con activar, copiar, programar y editar; formulario `ListaForm.tsx`) y `m/cat/cat-06` (`?lista=`, pestañas vigentes, programados, históricos y todos; agregar, cambiar, cerrar e importar CSV con vista previa). `modulos/cat/Dialogo.tsx` es el modal corto que usan ambas.

## Pruebas
`CatListasTest.php` (6): conteos y alcance de la vendedora, alta con código y vigencia, CA-CAT-03 (superposición rechazada y cierre de la anterior), copia con +10 % y programación, CSV con vista previa (SKU inexistente, otra marca, precio inválido) y cierre de vigencia.

## Verificado
- Las 113 pruebas de `tests/Feature` pasan. `typecheck` y `eslint` sin errores. En el navegador: listas, ficha, precios y vista previa del CSV sin errores.

---

# 07/11/2026 · CAT-07 Simulador de precio

## Qué se hizo
- **API:** `GET /api/v1/cat/simulador?variant_id=&canal=&tipo_cliente=&fecha=&cantidad=[&cliente_id=]` (`SimuladorController.php`). Devuelve el precio elegido, la traza de cada lista de la marca en orden (por qué aplica o no), el peso e importe estimados (RN-CAT-02), si admite descuento (RN-CAT-10) y el aviso de cantidad mínima o múltiplo (RN-CAT-07).
- **`Precios::simular()`:** misma regla que `Precios::vigente()` (RN-CAT-05) más la traza; con `cliente_id`, la lista asignada al cliente va primero.
- **Web:** `m/cat/cat-07` (`?variant_id=` la preselecciona). Recalcula al cambiar cualquier dato del caso.

## Pruebas
`CatSimuladorTest.php` (3): CA-CAT-02 (restaurante S/ 44, persona S/ 48 y por qué se descarta la de restaurantes), CA-CAT-01 (2 u × 0,900 kg; S/ 75,60 antes del 01/11 y S/ 79,20 después), coincide con el precio vigente de CAT-03 y avisa RN-CAT-07.

---

# 07/11/2026 · CAT-08 Combos

## Qué se hizo
- **API (`ComboController.php`, `Services/Combos.php`):** `GET /api/v1/cat/combos` (componentes, revisión RN-CAT-08, importe por componente con el precio WhatsApp, stock disponible y cuántos combos alcanzan), `POST /api/v1/cat/combos` (crea producto COMBO, variante por unidad y su precio en las listas generales activas de la marca; B2B con 10 % menos), `POST combos/{id}/componentes`, `PUT combos/{id}/componentes/{componente}` y `DELETE combos/{id}/componentes/{componente}`. Escribir pide `cat.product.manage`.
- **Reglas RN-CAT-08:** un combo no contiene otro combo; los componentes son variantes vendibles activas de la misma marca; no se repiten; el reparto no pasa de 100 % y el combo solo queda válido cuando suma 100 %. `Combos::desglose()` reparte cantidad, peso e importe por componente para PED, POS y FAC.
- **Stock disponible:** almacenes de venta activos, lotes liberados y sin vencer, menos lo reservado. Con la fecha de la demo (07/11) los lotes sembrados del cuy ya vencieron, por eso el pack familiar muestra 0 combos.
- **Web:** `m/cat/cat-08` con una tarjeta por combo, su tabla de componentes y totales, alta de combo y de componentes.

## Pruebas
`CatCombosTest.php` (3): pack familiar con reparto, importes y stock; CA-CAT-06 (otro combo rechazado, repetido, más de 100 %, peso estimado con el nominal, editar y quitar); la vendedora consulta pero no arma combos.

---

# 07/11/2026 · CAT-09 Publicación web

## Qué se hizo
- **API (`WebController.php`, `Services/Web.php`):** `GET /api/v1/cat/web` (productos de venta con sus variantes, stock publicable, registro sanitario y sincronización, más el resumen con KPI-CAT-02), `PUT /api/v1/cat/web/{id}/publicar`, `PUT /api/v1/cat/web/{id}` (título, descripción, imagen y variantes publicadas) y `POST /api/v1/cat/web/{id}/enviar`. Escribir pide `cat.product.publish_web`.
- **Reglas:** RN-CAT-09 (vencido o sin registro no se publica), RN-CAT-11 (solo productos activos). Todo cambio deja el producto pendiente de envío y emite `product.changed`, que escuchará WEB para enviarlo a WooCommerce. Mientras WEB no exista, «Enviar» lo marca sincronizado con la fecha y hora.
- **Web:** `m/cat/cat-09` con cifras, filtros por tienda, publicación y sincronización, y el formulario de datos web.

## Pruebas
`CatWebTest.php` (4): lista y resumen, RN-CAT-09 con la mermelada vencida, retirar deja pendiente y enviar lo sincroniza, guardar título y variantes, la vendedora no publica.

---

# 07/11/2026 · CAT-10 Registros sanitarios

## Qué se hizo
- **API (`SanitarioController.php`):** `GET /api/v1/cat/sanitarios` (productos SENASA o DIGESA con semáforo, vencidos primero, y resumen), `PUT /api/v1/cat/sanitarios/{id}` (registrar o renovar; opcionalmente activar el producto), `POST /api/v1/cat/sanitarios/{id}/certificado` (PDF, JPG o PNG de hasta 5 MB) y `GET /api/v1/cat/sanitarios/{id}/certificado`. Escribir pide `cat.sanitary.manage`.
- **Reglas RN-CAT-09:** el vencimiento de una renovación debe ser futuro; semáforo a `cat_sanitary_alert_days` (o los días propios del producto), 30 y 0 días. El certificado va al disco privado en `empresas/{tenant}/certificados/`.
- **Web:** `m/cat/cat-10` con cifras, filtros por marca, autoridad y semáforo, ver certificado y formulario de renovación.

## Pruebas
`CatSanitariosTest.php` (4): orden y semáforo (mermelada vencida, paté sin registro), CA-CAT-05 (renovar a 60 días queda ámbar y activa el producto; vencimiento pasado rechazado), subir y descargar el certificado (y rechazar otro tipo de archivo), la vendedora no renueva.

---

# 07/11/2026 · CAT-11 Etiquetas de balanza

## Qué se hizo
- **`Services/Balanza.php`:** `Balanza::leer($codigo)` (EAN-13 con prefijo, dígito de control, PLU y peso en gramos o precio en céntimos según `cat_scale_barcode_layout`), `Balanza::armar($plu, $valor)` y `Balanza::problemaFormato()`. Lo usarán POS y ALM.
- **API (`EtiquetaController.php`):** `GET /api/v1/cat/etiquetas` (formato y variantes con PLU), `POST etiquetas/leer` (más el precio de mostrador, el importe y si el peso por unidad está fuera de rango, RN-CAT-03), `POST etiquetas/generar` y `PUT etiquetas/formato` (con motivo; queda en el historial de parámetros de PLT; pide `cat.product.manage`).
- **Web:** `m/cat/cat-11` con el formato, la prueba de lectura, la etiqueta de prueba con su código de barras (`modulos/cat/Ean13.tsx`) y la tabla de PLU.

## Pruebas
`CatEtiquetasTest.php` (4): CA-CAT-04 (2012345012509 → PLU 12345 y 1,250 kg; con el último dígito cambiado es inválida), etiqueta del cuy con precio, importe y fuera de rango, cambio de formato a precio en céntimos y superposición rechazada, la vendedora prueba pero no cambia el formato.

---

# 07/11/2026 · CAT-12 Historial de precios

## Qué se hizo
- **API (`HistorialController.php`):** `GET /api/v1/cat/historial` (paginado; filtros `list_id`, `variant_id`, `tipo=CHANGE|FIRST`, `desde`, `hasta`; busca por SKU, variante, lista o usuario) y `GET /api/v1/cat/historial/resumen`. Cada vigencia de `price_list_items` es historia: el precio anterior es el de la misma lista, variante y tramo (ventana `lag`), con la variación en %.
- **Web:** `m/cat/cat-12` (`?variant_id=` filtra) con cifras, filtros por lista y tipo, y los programados marcados.

## Pruebas
`CatHistorialTest.php` (2): el cuy entero en WhatsApp pasa de S/ 42 a S/ 44 (+4,8 %) el 01/11; un cambio nuevo aparece programado con su motivo; la vendedora solo ve su marca.

---

# Servicios de CAT para otros módulos

| Servicio | Para qué | Quién lo usa |
|---|---|---|
| `Precios::vigente($variantId, ['canal', 'tipo_cliente', 'fecha', 'cantidad', 'marca'])` y `Precios::vigentes([...])` | Precio vigente según RN-CAT-05. Devuelve `price`, `basis`, `list_id`, `list_code`, `list_name`, `min_qty`, `reason`, o `null` (sin precio no se vende en ese canal). | PED, POS, WEB, CRM |
| `Precios::simular($variantId, [... , 'cliente_id'])` | Lo mismo con la traza de cada lista evaluada; con cliente, su lista asignada va primero. | CAT-07, soporte |
| `Combos::desglose($comboId, $qty, $total)` | Cantidad, peso e importe por componente (RN-CAT-08) para el stock y el comprobante. | PED, POS, FAC, ALM |
| `Combos::stock([...])` | Stock disponible para vender (almacenes de venta, lotes liberados sin vencer, menos reservado). | WEB, PED |
| `Balanza::leer($codigo)` y `Balanza::armar($plu, $valor)` | Etiqueta EAN-13 prefijo 2 según `cat_scale_barcode_layout` (RN-CAT-12). | POS, ALM |
| `RegistroSanitario::estado($producto)` | Semáforo del registro sanitario (RN-CAT-09). | PED, WEB |
| `Variantes::toleranciaPorDefecto($marca)` | Tolerancia de peso por defecto (`ped_weight_tolerance_pct`). | PED |

Eventos que emite CAT: `product.changed` (producto, variante, combo o datos web), `product.tax_changed` (RN-CAT-13) y `price.changed` (listas y precios).
