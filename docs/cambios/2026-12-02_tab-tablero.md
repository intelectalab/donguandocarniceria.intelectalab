# 02/12/2026 · TAB Tablero e indicadores: tableros por rol con semáforo, catálogo, metas, cierre mensual y detalle con exportación (TAB-01 a TAB-10)

Va al final, después de PRE, POS, FAC, DEL, CAJ, GAS, WEB, FLO, PER y PRS: TAB lee los datos de todos. No duplica nada: cada indicador se calcula desde las tablas de su módulo.

## Base de datos
Las tablas de TAB ya venían en la base (`kpi_definitions`, `kpi_targets`, `kpi_snapshot_runs`, `kpi_snapshots`, `dashboards`, `dashboard_widgets`). La migración `2026_12_02_000100_tab_tablero_reglas.php` les agrega las reglas:

- **Corridas (RN-TAB-03):** número de corrida único por mes, estado `RUNNING`, `OK` o `FAILED`, el período siempre es el día 1. Los valores congelados siguen siendo de solo inserción para la aplicación.
- **Metas sin solapes (RN-TAB-05):** restricción de exclusión `kpi_targets_rn_tab_05_no_overlap` (mismo indicador, marca y local con fechas cruzadas no entra).
- **Catálogo:** corrige unidad y sentido de unos 25 indicadores del prototipo (por ejemplo DEL-02 en %, DEL-08 en soles, PER-06 en minutos).
- **Funciones:** `kpi_semaphore` (RN-TAB-04), `kpi_register` (RN-TAB-08, idempotente por código) y `tab_seed_dashboards()` (arma los 6 tableros por rol con los indicadores de cada módulo). Vista `v_kpi_latest`.
- Da lectura de TAB a Administración, Almacén, Preparación y Administración del sistema.
- En una base con datos congela octubre de 2026 como lo habría hecho la tarea del día 3 (la demo). En una base nueva lo hace `TabDemoSeeder`, al final del `DatabaseSeeder`.

## Cómo se calcula
- `app/Modulos/Tab/Calculadores`: unos 100 indicadores de PED, CLI, POS, WEB, CRM, DEL, CAJ, FLO, PRE, ALM, GAS, FAC, PER, PRS y TAB. Los de módulos que aún no existen (ADS, CTL, TEL, CNT…) salen «Sin cálculo» en el mes en curso, pero sus meses congelados del prototipo se siguen viendo.
- **RN-TAB-01:** un mes congelado se lee de su última corrida correcta; el mes en curso se calcula en vivo con caché de `tab_cache_minutes` (15). El botón «Actualizar» borra la caché.
- **RN-TAB-04:** semáforo con la meta vigente más específica (marca y local, marca, local o general) y su tolerancia (`tab_default_tolerance_pct`, 10 %).
- **RN-TAB-06:** cada rol ve su tablero; con alcance limitado se calcula solo con su marca o local, y pedir otro se rechaza.
- **RN-TAB-07:** un indicador de un módulo apagado (por ejemplo TEL) no se calcula, no se congela ni se muestra. Al encender el módulo aparece solo.
- **RN-TAB-10:** `php artisan tab:congelar` corre cada día a las 02:00 (en `routes/console.php`) y solo actúa el día `tab_snapshot_day` (3): congela el mes anterior si no estaba congelado. Una corrida fallida queda `FAILED` y no reemplaza a la anterior. Avisa a Gerencia y Administración.
- **RN-TAB-09:** las exportaciones a Excel quedan en la bitácora (`REPORT_EXPORTED`). El detalle no lleva datos personales de clientes. El PDF se saca con «Imprimir o PDF» del navegador.

## Pantallas
- **TAB-01 a TAB-06:** gerencia, ventas, supervisora, delivery, almacén y marketing. Tarjetas con semáforo, meta y cambio frente al mes anterior; la fórmula sale al pasar el cursor y al tocar se baja al detalle con los mismos filtros. Gráficos propios de cada tablero y tabla con todos sus indicadores. Usan la marca y el local del selector de arriba.
- **TAB-07 Catálogo:** todos los indicadores; activar o desactivar, roles que lo ven, pantalla de detalle, decimales y frecuencia (`tab.kpi.manage`).
- **TAB-08 Metas:** metas por indicador, marca y local con vigencia y tolerancia, vista previa del semáforo y metas propuestas desde el real del último mes congelado (D-TAB-01).
- **TAB-09 Cierre:** meses con su corrida vigente; congelar un mes terminado o recalcularlo con motivo de al menos 10 caracteres (`tab.snapshot.run`).
- **TAB-10 Detalle:** valor, tendencia de 6 meses con meta, corridas del mes y las filas que lo forman (por ejemplo, del costo por entrega a las rutas con su costo y entregas). Excel e impresión.

## Pruebas
`tests/Feature/Modulos/TabTest.php`: 12 pruebas, una por CA-TAB-01 a 06 y las reglas RN-TAB-01, 05, 06, 07, 09 y 10.
