# ALM · Fases 2 y 3: servicios, API y pantallas (10/11/2026)

Sigue a [2026-11-09_alm-contrato-y-base.md](2026-11-09_alm-contrato-y-base.md). Con esto el módulo ALM queda completo: ALM-01 a ALM-13 con datos reales.

## Decisiones aprobadas en la Fase 1
- **RN-ALM-01 en la base:** función delgada `SECURITY DEFINER` con rol propio (la opción recomendada).
- **Fila que violaba RN-ALM-03:** se libera la reserva de P-001330 (opción a).
- **Guía de remisión sin FAC:** el número se escribe a mano (`GuiaRemisionManual`).

## Base de datos
- **Migración `2026_11_10_000100_alm_accion_unica_de_inventario.php`:**
  - Crea el rol `aycha_alm_inventario`: sin login, sin `BYPASSRLS` y sin ser dueño de las tablas, así que RLS sigue filtrando dentro de las funciones.
  - Crea las funciones `alm_inventory_move(…)` y `alm_reserve_adjust(…)`, que son de ese rol.
  - Le quita a `aycha_app` el `INSERT`, `UPDATE`, `DELETE` y `TRUNCATE` sobre `stock_balances` y el `INSERT` sobre `stock_movements`.
  - Firma y reglas en [docs/contratos.md](../contratos.md).
  - Un `INSERT` directo ahora falla con 42501, y la API lo responde como acceso denegado (CA-ALM-08).
  - **En el servidor:** quien migra debe tener `CREATEROLE`, o el rol se crea antes a mano. El rol no se borra con `migrate:fresh` ni con `down()`.
  - `SELECT … FOR UPDATE` también necesita el privilegio `UPDATE`. Por eso el bloqueo del saldo y la revisión del disponible (`p_check_available`) se hacen dentro de la función.
- **`AlmDemoSeeder`** (se llama desde `DatabaseSeeder` después de `PrototipoSeeder`):
  - Libera la reserva activa de P-001330 en el lote L261008-001, con el motivo «Stock insuficiente en la demo».
  - Baja el reservado de ese saldo, que queda 6 de 6.
  - No se agregó `CHECK (reserved_qty <= qty)`.

## API (`app/Modulos/Alm`, rutas en `routes/modulos/alm.php`, 47 rutas bajo `/api/v1/alm`)
- **Servicios:** `InventarioService`, `ReservasService`, `LotesService`, `RecepcionService`, `TransferenciasService` (con `Guias/EmisorGuiaRemision` y `GuiaRemisionManual`), `ConteosService`, `MermasService`, `AlertasService`, `KpiService` y `AlmacenesService`.
  - Los servicios con varias tablas trabajan dentro de `DB::transaction`.
  - Ninguno filtra por `tenant_id`: lo hace RLS.
- **Alcance:** las listas se filtran por los locales y marcas del usuario y por el selector de arriba (`site`, `brand`).
- **Costos:** solo se ven con `alm.stock.view_cost`; sin él, la API los manda vacíos.
- **RN-ALM-15:**
  - El comando `alm:alertas-vencimiento` corre todos los días a las 6:00, hora de Lima (`routes/console.php`).
  - Deja una alerta por lote y día en `stock_expiry_alerts`. Si corre dos veces el mismo día, no duplica.
  - Avisa al rol ALMACENERO y emite `stock.expiring`.
  - En ALM-11, «Avisar ahora» hace lo mismo a mano.
- **KPI-ALM-01 a 08** (`GET /alm/kpi`), con los desgloses pendientes:
  - 02: por motivo, línea y almacén.
  - 06: por proveedor.
  - 08: por almacén, marca y línea.

## Web (`src/app/(sistema)/m/alm/alm-01` … `alm-13`, componentes en `src/modulos/alm`)
- Las 13 pantallas usan `useSesion`, `api()` y `useListado`, los componentes compartidos y solo colores del tema.
- Las acciones se ocultan con `puede('ALM', …)` y `can('alm.…')`.
- Las 13 se revisaron a 390 px y a 1440 px sin desborde horizontal ni errores en la consola.
- Se registró una merma completa desde el formulario (con lote) y llegó a la API con 201.
- **Qué tiene cada pantalla:**
  - ALM-01: árbol por local con tipo, temperatura, si vende y prioridad de salida.
  - ALM-02: stock con cifras y filtros por almacén, línea y estado del lote.
  - ALM-03: kardex con filtros y reverso.
  - ALM-04: recepción con control por línea.
  - ALM-05 y ALM-06: lotes, con la ficha del lote, el cambio de estado y su historial.
  - ALM-07 y ALM-12: transferencias, con guía, despacho y recepción con diferencias, y el stock en tránsito con su antigüedad.
  - ALM-08: conteo ciego, que busca la línea por código de barras o SKU.
  - ALM-09: mermas con foto (en el celular abre la cámara).
  - ALM-10: reservas, con la liberación a mano.
  - ALM-11: alertas y la pestaña Indicadores.
  - ALM-13: motivos de merma.

## Pruebas
- `tests/Feature/Modulos/AlmTest.php` tiene 22 pruebas:
  - CA-ALM-01 a CA-ALM-08.
  - RN-ALM-03, 04, 07, 08, 11, 13, 15 y 16.
  - Reverso, aislamiento entre empresas, alcance por local en escrituras, costos con permiso, liberación a mano y las pantallas con los datos de demo.
- `php artisan test --testsuite=Feature`: **155 pruebas en verde**. `php artisan test` sin suite sigue fallando porque falta `tests/Unit`; no es de ALM.
- `npm run typecheck` y `npm run lint` limpios.

## Decisiones para revisar
- **Merma bajo el umbral:** tampoco la aprueba quien la pidió. Sigue la regla del repositorio («quien pide no aprueba la merma»), que es más estricta que la spec, donde bajo el umbral se aprobaba sola.
- **Reverso del kardex:** pide `alm.count.approve`, el mismo permiso que aprueba ajustes. La spec no dice qué permiso; la decisión quedó escrita en la tabla «Permisos y alcance de ALM» de `docs/contratos.md`, junto con la de generar alertas a mano (edición del módulo).
- **Alcance por local:** ahora limita también las escrituras (ver «Ajustes tras la revisión»).
- **ADMIN_SISTEMA** no tiene acceso al módulo ALM en la matriz de PLT. No lo cambié.
- **Archivos compartidos tocados:** `routes/console.php` (una línea del horario), `DatabaseSeeder.php` (una línea) y `app/Console/Commands/AlmAlertasVencimiento.php` (nuevo).
- **Reservas sin PED:** `stock_reservations` tiene FK a `sales_orders` y `sales_order_lines`, así que hoy solo se reserva sobre los pedidos de demo. PED llamará a `ReservasService::reservar` con sus líneas.
- **Liberar lotes:** lo hace quien tenga `alm.lot.release` (hoy, el almacenero). Pasa a CALIDAD cuando exista CAL.

## Ajustes tras la revisión de PLT
- **Alcance por local en escrituras.** `InventarioService::almacen()` recibe al usuario y rechaza con `RN-ALM-01` un almacén de un local fuera de su alcance. Lo llaman con el usuario `mover`, `trasladar`, `RecepcionService` (crear y confirmar), `ConteosService::crear`, `MermasService::registrar` y el origen en `TransferenciasService::crear`. El destino de una transferencia y el almacén de tránsito no se restringen. Como toda salida y entrada pasa por `mover`, aprobar una merma, un conteo o recibir una transferencia de otro local también se rechaza.
  - En las pruebas, el almacenero pasa a ser `mtorres@donguando.pe` (Local 1): `irojas@donguando.pe` es el almacenero del Local 2 y las pruebas mueven almacenes del Local 1. Prueba nueva: `test_el_alcance_por_local_tambien_limita_las_escrituras`.
- **Foto de merma:** misma regla que los logos (PNG, JPG o WEBP, máximo 1 MB, sin SVG) y `X-Content-Type-Options: nosniff` al servirla. En ALM-09 el campo acepta solo esos tipos y lo dice en la ayuda. Si en el celular las fotos superan 1 MB, se puede subir el límite o reducir la imagen antes de enviarla; se decide con la primera prueba en campo.
- **Permisos de reverso y de generar alertas:** documentados en `docs/contratos.md` («Permisos y alcance de ALM»).

## Después (mejoras acordadas, no hechas)
- Stock mínimo con sugerencia de compra en ALM-02.
- Acciones de un clic desde ALM-11 (promoción, merma).
