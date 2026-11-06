# 06/11/2026 · PLT: servicio de períodos

Se adelanta lo que los demás módulos necesitan de PLT-09 Períodos, antes de su pantalla.

## `App\Modulos\Plt\Services\Periodos`
- `Periodos::abierto($fecha, $companyId)`: falla con `RuleError` RN-PLT-05 si el mes de esa fecha está cerrado para la empresa («El período agosto de 2026 está cerrado…»). Se llama dentro de la misma transacción que guarda el documento: bloquea el período en modo compartido, así un cierre al mismo tiempo no deja entrar un documento al mes recién cerrado.
- `Periodos::cerrado($fecha, $companyId)`: sí o no, sin fallar, para avisar en pantalla antes de guardar.
- `Periodos::nombre($fecha)`: «setiembre de 2026».
- La fecha puede ser `2026-09-30` o una fecha con hora; con hora, el mes se toma en hora de Lima.
- Cada empresa tiene sus propios meses. Un mes sin registro en `accounting_periods` cuenta como abierto.

## Quiénes lo usan
En el prototipo lo llaman al registrar: recepciones de almacén (ALM), comprobantes (FAC), caja (CAJ), compras (COM), consignación (CON), reparto (DEL), flota (FLO) y publicidad (ADS), entre otros.

## Pendiente para la pantalla PLT-09
Cerrar en orden (RN-PLT-17), reabrir con motivo sin meses posteriores cerrados (RN-PLT-18), historial de cierres y reaperturas (`accounting_period_events`) y los eventos `period.closed` y `period.reopened`.

## Pruebas
`tests/Feature/Modulos/PltPeriodosTest.php`: mes cerrado, mes abierto o sin registro, períodos por empresa y fecha con hora en hora de Lima.
