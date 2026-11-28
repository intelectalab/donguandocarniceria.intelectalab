# 01/12/2026 · PRS Presupuesto: presupuesto anual con versiones y aprobación, real frente a presupuesto con semáforo, proyección de cierre y alertas (PRS-01 a PRS-10)

Va después de PRE, POS, FAC, DEL, CAJ, GAS, WEB y FLO (en ese orden). PRS no duplica nada: el real sale de las ventas de FAC (`sales_documents`), de los gastos de GAS (`expenses` y su reparto por centro de costo) y del personal de PER. Los gastos de flota se ven con su carga de combustible, mantenimiento, multa o costo de FLO.

## Base de datos
Migración `2026_12_01_000500_prs_presupuesto.php`. Ocho tablas nuevas, todas con RLS por empresa y bitácora (`audit.track`):

| Tabla | Para qué |
| --- | --- |
| `budget_concepts` | Plan de conceptos presupuestales en árbol (grupos y conceptos): ingreso, costo de ventas o gasto; fijo o variable. |
| `budget_concept_mappings` | De dónde sale el real de cada concepto: ventas, costo de ventas, categoría de gasto, tipo de costo de personal o cuenta contable. Un origen activo va a un solo concepto (RN-PRS-02). |
| `budgets` | Un presupuesto por empresa y año (RN-PRS-01). |
| `budget_versions` | Versiones: borrador, por aprobar, aprobada, rechazada, reemplazada. Una sola aprobada por presupuesto. Quien aprueba no puede ser quien la creó o la envió (RN-PRS-05). Historial en `history`. |
| `budget_lines` | Importe por concepto, mes y dimensión (marca, local, centro de costo). Sin duplicados (RN-PRS-13). Un trigger impide cambiar líneas de una versión enviada o aprobada (RN-PRS-04). |
| `budget_actuals` | Real congelado de los meses cerrados, por corrida. Solo inserción (RN-PRS-09). |
| `budget_forecasts` | Proyecciones de cierre guardadas. Solo inserción. |
| `budget_alerts` | Alertas de desviación. Una abierta por versión, mes y línea (RN-PRS-10). |

También: función `budget_traffic_light` (semáforo RN-PRS-07) y vista `budget_vs_actual_v`.

En una base que ya tiene datos, la migración siembra la demo de PRS. En una base nueva la siembra el `DatabaseSeeder` (se agregó `PrsDemoSeeder` al final).

Después de `git pull`: `php artisan migrate --database=pgsql_owner`.

### DatabaseSeeder
El zip de FLO traía un `DatabaseSeeder.php` sin la línea de WEB (`WebDemoSeeder`). PRS la vuelve a poner, llama a `PerDemoSeeder` si PER está instalado (antes de PRS, para que la demo de PRS use su planilla) y agrega `PrsDemoSeeder` al final.

## Reglas principales
- **Real sin IGV (RN-PRS-06):** ventas aceptadas (las notas de crédito restan), costo de ventas, gastos aprobados o pagados (por su reparto entre centros de costo) y personal. Personal usa `CostoPersonal::filasDelMes` de PER (planilla, comisiones y bonos) si PER está instalado y migrado; si no, estima sueldo × 1,215 por empleado.
- **Mapeo a cuenta contable (CNT):** se guarda, pero no aporta real mientras CNT no exista.
- **Meses cerrados (RN-PRS-09):** usan el real congelado (la última corrida). Si un mes ya terminó y no tiene corrida, se congela solo la primera vez que alguien lo consulta. «Recalcular» congela una corrida nueva con motivo; la anterior queda guardada.
- **Semáforo (RN-PRS-07):** verde hasta el 100 % del presupuesto, ámbar hasta el 105 % y rojo después (parámetro `prs_amber_pct`, 5 por defecto). En ingresos es al revés: verde desde el 100 %, ámbar desde el 95 % y rojo por debajo. En el mes en curso usa la proyección.
- **Proyección de cierre (RN-PRS-08):** real a la fecha más lo que falta del mes; los fijos se completan con su presupuesto y los variables al ritmo diario.
- **Alertas (RN-PRS-10):** si la proyección de una línea de gasto pasa el 10 % (`prs_alert_pct`), se abre la alerta y se avisa al responsable del centro de costo (por su área) y a Gerencia. Si vuelve al rango, queda resuelta.
- **Alcance (RN-PRS-12):** Gerencia, Administración, la Contadora y Auditoría ven todo. Los roles de área (Marketing, Delivery, Producción, Ventas, RR. HH., Calidad) no tienen acceso al módulo, como dice la spec: reciben la notificación con las cifras.

## Pantallas
- **PRS-01 Presupuestos:** años, versiones y totales. «Nuevo presupuesto» desde el real del año anterior, desde la versión aprobada o vacío.
- **PRS-02 Conceptos presupuestales:** árbol de conceptos y sus mapeos.
- **PRS-03 Elaborar presupuesto:** matriz concepto × mes con edición por celda o por fila (12 meses).
- **PRS-04 Importar o copiar:** desde Excel (plantilla), desde otra versión con % de ajuste o desde el real.
- **PRS-05 Enviar y aprobar:** enviar, aprobar o rechazar, diferencias con la vigente e historial.
- **PRS-06 Real frente a presupuesto:** por concepto, marca, local o centro de costo, del mes o acumulado, con semáforo y Excel.
- **PRS-07 Detalle del real:** los documentos, gastos y planillas que forman el real de un concepto, con su enlace de flota.
- **PRS-08 Proyección de cierre:** proyección por línea, guardar la proyección y generar las alertas.
- **PRS-09 Comparativo de versiones:** dos versiones lado a lado por concepto y mes.
- **PRS-10 Alertas de desviación:** alertas con responsable y comentarios, y semáforo por centro de costo.

Todas se usan a 390 px.

## Demo
`PrsDemoSeeder`: 28 conceptos en 8 grupos con 30 mapeos; presupuesto 2026 con v1 reemplazada, v2 aprobada y v3 por aprobar; real congelado de enero a agosto (agosto con 2 corridas); presupuesto 2027 v1 en borrador; alertas de setiembre (al 30/09) y octubre (al 10/10) con comentarios.

Con los datos de ejemplo, la planilla casi iguala las ventas sin IGV, así que el resultado presupuestado sale negativo. Es un efecto de la demo, no un error.

## Pruebas
`tests/Feature/Modulos/PrsTest.php`: 11 pruebas (CA-PRS-01 a 07, reglas de líneas y envío, pantallas, alcance por rol y recalcular). Pasan con PER instalado y sin PER.
