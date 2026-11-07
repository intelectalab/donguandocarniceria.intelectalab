# 06/11/2026 · PLT: servicio de períodos y PLT-09 Períodos

Se adelanta lo que los demás módulos necesitan de PLT-09 Períodos, antes de su pantalla.

## `App\Modulos\Plt\Services\Periodos`
- `Periodos::abierto($fecha, $companyId)`: falla con `RuleError` RN-PLT-05 si el mes de esa fecha está cerrado para la empresa («El período agosto de 2026 está cerrado…»). Se llama dentro de la misma transacción que guarda el documento: bloquea el período en modo compartido, así un cierre al mismo tiempo no deja entrar un documento al mes recién cerrado.
- `Periodos::cerrado($fecha, $companyId)`: sí o no, sin fallar, para avisar en pantalla antes de guardar.
- `Periodos::nombre($fecha)`: «setiembre de 2026».
- La fecha puede ser `2026-09-30` o una fecha con hora; con hora, el mes se toma en hora de Lima.
- Cada empresa tiene sus propios meses. Un mes sin registro en `accounting_periods` cuenta como abierto.

## Quiénes lo usan
En el prototipo lo llaman al registrar: recepciones de almacén (ALM), comprobantes (FAC), caja (CAJ), compras (COM), consignación (CON), reparto (DEL), flota (FLO) y publicidad (ADS), entre otros.

## PLT-09 Períodos
- Cifras de cabecera: meses cerrados, cerrados a tiempo (KPI-PLT-01: hasta el día `plt_period_close_day` del mes siguiente), el siguiente mes pendiente de cierre con su meta y si Contabilidad (CNT) está encendida.
- Calendario de meses de la empresa, desde el primero registrado hasta el mes en curso. Un mes sin registro sale abierto; al cerrarlo se crea.
- Cerrar (`plt.period.close`: gerencia, administración, sistemas y contadora): solo meses terminados y en orden (RN-PLT-17), con nota opcional. Reabrir (`plt.period.reopen`: sin administración): con motivo y sin meses posteriores cerrados (RN-PLT-18).
- Cada cierre y reapertura queda en `accounting_period_events` y emite `period.closed` o `period.reopened`. Historial por mes y de todos los meses, con filtro por acción.
- API: `GET /v1/plt/periodos`, `GET /v1/plt/periodos/historial`, `POST /v1/plt/periodos/cerrar`, `POST /v1/plt/periodos/{id}/reabrir`. Las reglas están en `Periodos::cerrar()` y `Periodos::reabrir()`, para que CNT las reuse.
- `Cifra` (cifras de cabecera) pasa a `components/ui`; `confirmAction` acepta un motivo opcional (`reason: { optional: true }`).

## Pruebas
`tests/Feature/Modulos/PltPeriodosTest.php`: mes cerrado, mes abierto o sin registro, períodos por empresa, fecha con hora en hora de Lima, lista con sus cifras, cierre en orden y reapertura con motivo, y permisos de cierre y reapertura. 48 pruebas en total.
