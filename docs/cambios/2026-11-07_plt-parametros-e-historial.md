# 07/11/2026 · PLT-10 Parámetros y PLT-11 Historial

## Migraciones (solo corrigen y agregan; no borran datos)
Correr: `php artisan migrate --database=pgsql_owner`.

- `2026_11_07_000100_plt_parametros_con_texto`: los valores de los parámetros eran `numeric`, pero 65 de los 271 son de sí/no, texto, hora, lista o JSON, y sus valores por defecto se habían perdido. Ahora `parameter_definitions.default_value`, `parameters.value` y `parameter_history.old_value/new_value` son texto (5.0000 queda como 5), y se recuperaron los valores por defecto y las opciones desde los datos del prototipo. Además: un solo valor por parámetro y ámbito (índice único), `parameter_history.changed_by_id` y el historial de solo inserción (RN-PLT-06).
- `2026_11_07_000200_plt_periodos_fecha_limite`: `accounting_periods.close_due_date`, la fecha límite de cierre que se guarda al cerrar (era un pendiente de PLT-09). Los meses ya cerrados se completaron con el día vigente (5). El seeder también la llena.

`Params::get()` sigue igual: devuelve texto y quien lo usa lo convierte (`(int)`, `(float)`).

## PLT-10 Parámetros
- Cifras: parámetros (y módulos), con valor propio, cambios registrados y los del módulo elegido.
- Elegir el módulo (el desplegable trae buscador) o buscar una clave o descripción en todos. La tabla muestra el valor que rige, de dónde sale (empresa o por defecto, y cuántos locales o marcas tienen el suyo), el rango y el valor por defecto. Las descripciones se muestran sin los códigos del prototipo.
- Ficha de cada parámetro: tipo, rango, para qué se puede fijar, valores propios y su historial. Con permiso (`plt.parameter.edit`; los `seg_*` también con `seg.policy.edit`): cambiar el valor para la empresa, un local o una marca (si la definición lo permite), con motivo; quitar un valor propio para que rija el más general.
- Reglas en `App\Modulos\Plt\Services\Parametros`: motivo mínimo (`plt_parameter_reason_min_length`, RN-PLT-06), valor según su tipo y rango (RN-PLT-11), ámbito permitido, no repetir el valor vigente, y el más específico gana (RN-PLT-12). Cada cambio emite `parameter.changed`.
- Las definiciones son de toda la plataforma: aquí solo se leen.

## PLT-11 Historial de parámetros
Cifras (cambios, parámetros distintos, personas y último cambio), tabla con búsqueda y filtros por módulo, clave, persona y ámbito, con el valor anterior y el nuevo ya formateados. Al abrir un cambio se ve la ficha del parámetro.

## API
`GET /v1/plt/parametros` (`?module=` o `?q=`), `GET /v1/plt/parametros/historial`, `GET /v1/plt/parametros/{clave}`, `PUT /v1/plt/parametros/{clave}`, `POST /v1/plt/parametros/{clave}/quitar`.

## Pruebas
`tests/Feature/Modulos/PltParametrosTest.php`: lista por módulo con su valor y los valores por defecto recuperados, cambio con motivo y rango, cambiar el día de cierre no reevalúa los meses cerrados, valor por marca y quitarlo, ámbito no permitido y permisos. 58 pruebas en total.
