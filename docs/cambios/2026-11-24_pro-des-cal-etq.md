# PRO, DES, CAL y ETQ · Producción y calidad (24/11/2026)

Los cuatro módulos de producción y calidad, completos y con datos reales: **PRO** (órdenes de producción, 13 pantallas), **DES** (despiece y costeo conjunto, 9), **CAL** (calidad, 13) y **ETQ** (etiquetas, trazabilidad y retiro de lotes, 9), más la **página pública del QR** que abre el cliente sin iniciar sesión. Contratos publicados en [docs/contratos.md](../contratos.md) (secciones PRO, DES, CAL y ETQ). Sigue el mismo camino que ALM, REC y EQU.

## Base de datos
Cuatro migraciones nuevas. Las tablas salen de `tools/prototipo/generar_migraciones.py`, revisadas a mano: tipos y largos de verdad, números únicos por empresa, `CHECK` de estados y tipos, RLS y auditoría.

- **`2026_11_24_000100_pro_produccion.php`:** líneas de producción, órdenes, consumos, salidas, lecturas de puntos de control, personal y equipos de la orden.
  - **RN-PRO-01 en la base:** una orden `RECIPE` lleva su versión de receta y una `CUTTING` su plantilla de despiece.
  - **RN-PRO-11:** una lectura fuera de rango lleva su acción correctiva. **RN-PRO-14:** una orden anulada lleva su motivo.
  - Consumos y lecturas son de solo inserción: un consumo se corrige con un reverso en ALM y una lectura con otra lectura.
  - Las llaves foráneas que EQU (`equipment_usage.production_order_id`) y CAL dejaron pendientes ya apuntan a la orden.
- **`2026_11_24_000200_des_despiece.php`:** plantillas de despiece con sus líneas y precios de referencia. **RN-DES-08:** una sola plantilla activa por producto de entrada (índice parcial). Un solo precio activo por variante y fecha. El despiece en sí es una orden `CUTTING` de PRO.
- **`2026_11_24_000300_etq_etiquetas.php`:** plantillas, impresiones, tokens del QR, retiros, lotes del retiro y contactos.
  - **RN-ETQ-03:** una plantilla activa tiene los campos obligatorios (y `{{qr}}` si lleva QR). **RN-ETQ-04:** una reimpresión lleva motivo y apunta a la original. **RN-ETQ-12:** impresiones de solo inserción. **RN-ETQ-08:** un retiro cerrado lleva su resumen.
  - El token del QR es único en toda la plataforma. `etq_tenant_for_qr(token)` (del dueño, `SECURITY DEFINER`) devuelve solo la empresa del token; la página se arma después con RLS dentro de esa empresa.
- **`2026_11_24_000400_cal_restricciones_y_liberacion.php`:** las tablas de CAL existían desde el 03/11; esta migración pone sus reglas en la base.
  - **RN-CAL-01:** con CAL activo, el estado de calidad de un lote de producción o despiece solo cambia con una decisión de Calidad. Un `UPDATE` directo de `lots.qc_status` se rechaza. El retiro de ETQ pasa por la misma puerta.
  - **RN-PRO-05:** con CAL activo, un lote nuevo de producción entra en cuarentena aunque pida otro estado (queda en `requested_qc_status`).
  - **RN-CAL-16:** lecturas de temperatura y decisiones de solo inserción.
  - Tabla nueva `qc_schedule_tasks`: las tareas de limpieza y BPM del día (**RN-CAL-13**).
- **Datos de demo:** `prototipo-produccion.json.gz` trae producción, despiece y etiquetas del prototipo. `CalDemoSeeder` genera las tareas de limpieza desde el 01/10/2026.

## API (101 rutas nuevas bajo `/api/v1`, más la pública)
- **PRO** (`app/Modulos/Pro`, 21 rutas). `ProduccionService` y `PlanService`.
  - Consumo con FEFO. Para tomar otro lote que el sugerido hace falta un motivo, y un lote en cuarentena no se consume.
  - Producción pesada en una balanza calibrada (llama `EquiposService::exigirBalanza`). Personal y horas de equipo (llama `registrarUso`).
  - Cierre con balance, costo real y costo por kg, dentro de un periodo abierto. Plan semanal, requerimiento de insumos y tablero.
- **DES** (`app/Modulos/Des`, 15 rutas). `DespieceService`.
  - Plantillas con versión: se activan solo si suman 100 %.
  - Precios de referencia. Balance de masa con tolerancia: pasarlo exige `des.mass_balance.override`.
  - Costeo conjunto por valor neto de realización, con alerta por corte fuera de estándar.
  - Informes por corte, operario, proveedor y especie.
- **CAL** (`app/Modulos/Cal`, 43 rutas). `CalidadService`.
  - Checklists con versión, programación e inspecciones (un ítem crítico no conforme da FAIL).
  - Puntos y lecturas de temperatura, con excursiones y la aprobación del vehículo.
  - Lotes por liberar: quien registró el lote o supervisó su orden no lo libera.
  - No conformidades con acciones. Registros sanitarios: un producto DIGESA sin registro vigente no se libera ni se etiqueta.
  - Reclamos y limpieza.
  - **Comando `cal:diario`** (06:20, hora de Lima): crea las tareas del día, marca las incumplidas y avisa de los puntos sin lectura y de los registros por vencer.
- **ETQ** (`app/Modulos/Etq`, 22 rutas más la pública). `EtiquetasService`.
  - Vista previa e impresión con precio de la lista del canal por el peso real. La impresión genera el payload ZPL, ESC/POS o PDF, con EAN-13 y QR.
  - Reimpresión con motivo. Trazabilidad hacia atrás y hacia adelante.
  - Retiro: vista previa del alcance, inicio (bloquea el stock y arma la lista de clientes), contactos con el aviso de WhatsApp, y cierre.
  - **Ruta pública** `GET /api/v1/publico/lotes/{token}`, fuera de la sesión y con límite de 60 por minuto. Nunca devuelve precio, costo, cliente ni pedido.
- **Ajustes al terminar la web:**
  - `GET /cal/opciones` trae los clientes, para registrar un reclamo.
  - La ficha del reclamo trae las notas de crédito del cliente, para resolver con nota de crédito.
  - `GET /etq/lotes/{id}/qr` da el enlace y los datos públicos del lote para la vista interna (ETQ-08).
- Eventos nuevos:
  - PRO: `production_order.created`, `.voided` y `.closed`, y `lot.produced`.
  - DES: `cutting_template.activated` y `cutting.costed`.
  - CAL: `qc_inspection.done`, `lot.quality_decided`, `nonconformity.opened` y `.closed`, y `sanitary_registration.registered`.
  - ETQ: `label.printed` y `label.reprinted`.

### Cambios en módulos que ya existían
- **ALM, `LotesService`:**
  - `cambiarEstado()` acepta `decision_calidad` (lo usan CAL y el retiro de ETQ, que ya validaron su permiso) y `retiro`, que deja pasar de cuarentena a retirado.
  - Con CAL activo, desde ALM un lote de producción responde RN-CAL-01.
  - Nuevo `fijarCosto()`: el costo final del lote producido.
  - `crear()` guarda la orden, el supervisor, los lotes padre y el estado pedido.
- **`AlmTest`:** se ajustó una prueba al mensaje nuevo.
- **`PrototipoSeeder`:** lee el segundo archivo de datos y traduce los ids que vienen dentro de JSON (genealogía del lote y empaques de la receta).

## Web
- **PRO** (`src/app/(sistema)/m/pro/pro-01` … `pro-13`, piezas en `src/modulos/pro`):
  - Líneas, plan semanal (desde una fila se crea la orden), requerimiento de insumos y órdenes con su semáforo.
  - Nueva orden, y un paso por pantalla para el operario en la tableta o el celular: consumo, puntos de control, producción, personal y equipos, y cierre.
  - Ficha de la orden, tablero y anulación.
- **DES** (`des-01` … `des-09`): plantillas y su editor con versiones, precios de referencia, despiece en curso, balance, costeo conjunto, cortes, proveedores y tablero.
- **CAL** (`cal-01` … `cal-13`): checklists, programación, inspección para responder en el celular, puntos y lecturas de temperatura, excursiones, lotes por liberar, no conformidades, acciones, registros sanitarios, reclamos, limpieza y tablero.
- **ETQ** (`etq-01` … `etq-09`, piezas en `src/modulos/etq`):
  - Plantillas con vista previa en vivo y aviso de campos que faltan.
  - Impresión: buscador de lotes, peso, vista previa con QR real y el bloqueo si el lote no se etiqueta.
  - Historial con reimpresión y trazabilidad en árbol, exportable a PDF.
  - Retiros: lista, nuevo retiro con su alcance, y seguimiento con el aviso de WhatsApp listo para enviar.
  - Vista del QR con la página dentro de un marco de celular, y tablero.
- **Página pública del QR** (`src/app/l/[token]`):
  - Se arma en el servidor, sin sesión y sin caché, para que un retiro se vea al momento. `proxy.ts` la deja abierta con o sin sesión.
  - Si el lote está en retiro, lo primero que se ve es «No consumas este producto»; si ya venció, lo dice.
  - Si viene de la granja: «De nuestra granja a tu mesa».
- Las 46 pantallas revisadas a 1440 px y 390 px, sin errores en la consola ni scroll horizontal. Capturas en `pro-cal/capturas/`.

## Pruebas
- `ProTest` (15), `DesTest` (9), `CalTest` (14) y `EtqTest` (9). Una prueba por criterio CA-PRO-01 a 08, CA-DES-01 a 05, CA-CAL-01 a 08 y CA-ETQ-01 a 06, más reglas sueltas, alcance por local y la API de cada pantalla.
- `php artisan test --testsuite=Feature`: **240 pruebas en verde** (2363 aserciones). `npm run typecheck` y `npm run lint` limpios.

## Decisiones para revisar
- **Costo del lote producido:**
  - El ingreso `PRODUCTION_IN` queda con el costo provisional. Al cerrar la orden, solo `lots.unit_cost` toma el costo final.
  - El ajuste de valorización del stock queda para CNT.
- **Equipos del prototipo** se remapearon a los de EQU. Las horas de equipo de la orden se copian a `equipment_usage` solo para registros nuevos, para no duplicar los sembrados.
- **PRO-03 Requerimiento** es de solo lectura: la orden de compra (COM-03) todavía no existe.
- **Stock de seguridad** del plan semanal: sale de las ventas de los últimos 28 días.
- **Archivos** (fotos, evidencias, certificados): se guarda la ruta, sin subida real.
- **Impresoras:** se genera el payload ZPL, ESC/POS o PDF. No hay conexión real con la impresora.
- **WhatsApp del retiro:** es un enlace `wa.me` con el mensaje armado desde la plantilla `etq_recall_whatsapp_template`. No se envía solo: quien contacta lo abre y luego registra el resultado.
- **Rechazo del lote:** el destino (decomiso, devolución, reproceso) solo se registra; no mueve stock.
- **Lote retenido por una no conformidad crítica:** sigue retenido aunque la no conformidad se cierre. Calidad lo libera con una decisión.
- **Excursión de temperatura:** una lectura dentro de rango marca su fin, pero sigue abierta hasta que se cierra con la acción.
- **Turnos de tareas:** una programación «por turno» crea una tarea de mañana y una de tarde.
- **RN-CAL-15** (vehículo fuera de rango) queda expuesta en `cargaPermitida()` para PRE, que todavía no existe.
- **Peso de productos por unidad:**
  - Si la variante no tiene peso nominal, se toma del nombre («500 g»).
  - El peso real se exige solo para productos por kg o de peso variable.
- **Numeración de retiros:** `RC-AAAA-NNN`.
- **Página pública:**
  - Muestra lotes liberados o retirados. Uno en cuarentena, retenido o rechazado responde «lote no disponible».
  - La API la deja en caché del navegador 5 minutos. La página de Next no usa caché, pero un teléfono que ya la abrió puede tardar hasta 5 minutos en ver el retiro.
- **CONTADORA** tiene `pro.cost.view` pero no tiene el módulo PRO en la matriz. No cambié la matriz.

## Pendientes
- `temperature_excursions.lots_exposed` todavía guarda ids del prototipo (`lot-smbm`) que el seeder no traduce: el cierre de esas excursiones de demo no encuentra sus lotes. Hay que agregarlo a la traducción de JSON del `PrototipoSeeder`.
- COM-03 (orden de compra desde el requerimiento) y PRE (verificar la carga con `cargaPermitida()`).
- Los datos de demo son de octubre de 2026: los tableros abren en el mes actual, vacío. Para verlos con datos, elige octubre (`?month=2026-10`).
