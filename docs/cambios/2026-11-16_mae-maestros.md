# 16/11/2026 · MAE Maestros comunes: base, servicios y primeras tandas de pantallas

Se avanza por tandas: **tanda 1** MAE-01, 02 y 10 (trabajadores), **tanda 2** MAE-03 y 04 (medios de pago y comisiones) , **tanda 3** MAE-05 (tipo de cambio) y **tanda 4** MAE-06 y 07 (unidades y catálogos SUNAT). Siguen MAE-08 y 09 (ubigeo y entidades financieras). La API de todas ya está hecha y probada.

## Base de datos
Migración `2026_11_16_000200_mae_restricciones_y_reglas.php` (después de `git pull`: `php artisan migrate --database=pgsql_owner`):
- `employees`: el estado `TERMINATED` pasa a `INACTIVE` con fecha de cese (la de desactivación de su usuario si no tenía una). Sueldo y celular opcionales. CHECK de estado, tipo y formato de documento (DNI 8 dígitos; CE y pasaporte 6 a 15 letras o números), activo ⇔ sin fecha de cese, y documento único por empresa (RN-MAE-01).
- `users`: un solo usuario vigente (activo, bloqueado o invitado) por trabajador (RN-MAE-13).
- `payment_methods`: motivo del último cambio, CHECK de estado y plazo de abono de 0 a 60 días, código único.
- `payment_method_fees`: CHECK de montos y una restricción de exclusión que impide vigencias cruzadas del mismo medio (RN-MAE-05).
- `exchange_rates`: compra y venta mayores que cero, compra ≤ venta, único por fecha y moneda (RN-MAE-06).
- `units`: decimales de 0 a 6, factor `numeric(18,6)` y una sola conversión por par en cualquier sentido (RN-MAE-09).
- Índices únicos en los catálogos globales: SUNAT (catálogo y código), ubigeo y entidades financieras.

## Servicios para otros módulos (`app/Modulos/Mae/Services`)
- `Trabajadores::activo($id)`: falla si está de baja (RN-MAE-02); úsenlo PED, DEL, CAJ y PER antes de asignar rutas, cajas o tareas.
- `Trabajadores::darDeBaja(...)`: fecha y motivo; desactiva su usuario, cierra sesiones y revoca dispositivos.
- `MediosDePago::validarCobro($medio, $referencia)`: exige el número de operación cuando el medio lo pide (RN-MAE-04).
- `MediosDePago::comision($medio, $fecha, $monto)`: comisión vigente, IGV y neto (RN-MAE-05).
- `TiposDeCambio::para($fecha, $moneda)`: el del día o el último publicado dentro de 7 días; si no hay, el documento no se graba (RN-MAE-07). `aSoles(...)` convierte.
- `Unidades::convertir(...)` y `validarDecimales(...)` (RN-MAE-09 y 10). `Unidades::sunatVigente(...)` (RN-MAE-12).

## Tareas programadas y comandos
- `mae:cargar-tipo-cambio`: días hábiles a las 09:00 de Lima, 3 intentos; si falla avisa a Administración una vez por día (RN-MAE-14). Hasta que INT traiga el conector de SUNAT la fuente es `SinConector` y el tipo de cambio se carga a mano.
- `mae:importar-global {sunat|ubigeo|entidades} {archivo}`: lo usa el operador de la plataforma para actualizar los catálogos globales (RN-MAE-11).

## Pantallas
- **MAE-01 Trabajadores:** cifras, filtros por local, cargo y estado, usuario vinculado de cada uno. El sueldo nunca se muestra.
- **MAE-02 Ficha del trabajador:** datos y antigüedad; usuario vinculado con rol, marcas, locales (sin asignados = todos, como lo aplica Access) y segundo factor; «Editar», «Vincular usuario» (trae el actual y no ofrece usuarios de Intelectalab ni de clientes B2B) y «Dar de baja» con fecha y motivo. **Historia** al pie: alta, cambios, baja y vínculos, con antes y después, en hora de Lima, desde la última alta; solo con `aud.record_history.view`, sin sueldo y con documento, celular y correo enmascarados sin `aud.export.personal_data`.
- **MAE-10 Importar trabajadores:** modelo en Excel, subir Excel o CSV, o pegar; validación fila por fila y se graban solo las válidas.
- **MAE-03 Medios de pago:** los 7 medios, configurar y activar o desactivar con motivo, «Validar un cobro».
- **MAE-04 Comisiones:** simulador «cobro de S/ 100,00 el día X», comisión efectiva del mes por medio, historial por vigencia (por medio y la más nueva primero; columnas ordenables) y «Nueva comisión».
- **MAE-05 Tipo de cambio:** cifras de lo aplicable hoy y de la cobertura del mes; calendario con compra y venta por día, origen, días hábiles sin carga en rojo con la venta que se usa (RN-MAE-07), feriados y corregidos; detalle del día con «Cargar de SUNAT», «Registrar a mano» o «Corregir» con motivo (RN-MAE-08); consulta «¿qué tipo de cambio usa un documento?»; cargas manuales y correcciones paginadas (`GET /v1/mae/tipo-cambio/registros`, con búsqueda, tipo y rango de fechas). La contadora la ve en su menú por `mae.exchange_rate.edit` (`POR_PERMISO` en `lib/modulos.ts`).
- **MAE-06 Unidades y conversiones:** unidades con código SUNAT, tipo, decimales, origen (sistema o propia) y si están en el catálogo 03; conversiones con su inversa calculada; calculadora; «Nueva conversión» y «Nueva unidad» (propia de la empresa: código vigente del catálogo 03 que no use, `POST /v1/mae/unidades`, permiso `mae.unit.manage`). Columnas ordenables.
- **MAE-07 Catálogos SUNAT:** pestañas por catálogo, búsqueda, vigencia y «¿Se puede usar este código?» (RN-MAE-12). Sin importar desde la pantalla: los catálogos son globales y los actualiza Intelectalab con `mae:importar-global`. Columnas ordenables.

## Importar desde Excel (también en CLI-12)
`App\Support\Importar` y el componente `ArchivoImportar`, como en erp-saas: plantilla `.xlsx` con los colores de la empresa, instrucciones, ejemplos, filas en formato texto y listas desplegables; acepta `.xlsx`, `.xls` o `.csv` de hasta 2 MB, reconoce las columnas por su título en cualquier orden, salta las filas «#» y convierte las fechas de Excel. Lee solo las filas que se pueden importar y no calcula fórmulas. Rutas `GET …/importar/plantilla` y `POST …/importar/archivo` en MAE y CLI, con su permiso y límite por minuto.

## Otros
- Seguridad: reactivar un usuario de un trabajador de baja se bloquea (RN-MAE-02), y vincular cuenta solo usuarios vigentes (RN-MAE-13).
- La API ya no responde 500 cuando llega una llamada sin sesión que no pide JSON: responde 401.

## Pruebas
`tests/Feature/Modulos/MaeTest.php` (14: CA-MAE-01 a 06, RN-MAE-01 y 13, ficha e historia, importación con CSV y con Excel, tipo de cambio, carga automática, permisos y aislamiento) y una nueva en `CliImportacionTest`. Suite completa: 273 correctas.

## Pendiente
- Pantallas MAE-08 y 09.
- Contrato de los servicios de MAE en `docs/contratos.md`.
