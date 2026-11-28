# 01/12/2026 · PER Personal: puestos, asistencia con GPS y QR, adelantos, comisiones, pagos, supervisión y costo de personal (PER-01 a PER-15)

Va después de PRE, POS, FAC, DEL, CAJ, GAS, WEB y FLO (en ese orden). PER usa los trabajadores de MAE (`employees`), los centros de costo de PLT, los cobros de CAJ (`payments` y `payment_allocations`), los pedidos entregados de PED y DEL, las alertas de control de CRM, las alertas y multas de FLO y las cuentas de CAJ. No duplica nada: el trabajador sigue siendo `employees` y PER le agrega puesto, asignaciones y condiciones.

## Base de datos
Migración `2026_12_01_000100_per_personal.php`. 17 tablas nuevas, todas con RLS por empresa:

| Tabla | Para qué |
| --- | --- |
| `job_positions` | Puestos con área, local, funciones, rol sugerido y forma de pago habitual. |
| `employee_assignments` | Puesto, local, centro de costo con %, supervisor y vigencia. Deben sumar 100 % y tener una sola principal (RN-PER-01). |
| `employment_terms` | Sueldo mensual, jornal o tarifa por hora, con fuente de planilla. Sin traslapes por trabajador (restricción `EXCLUDE`, RN-PER-02). |
| `shifts` y `shift_assignments` | Turnos por local (con tolerancia y si cruzan medianoche) y la programación por día. |
| `establishment_qr_tokens` | Códigos QR del local que cambian cada minuto (RN-PER-04). |
| `attendance_marks` | Marcaciones con GPS, QR o manual. Solo inserción (RN-PER-06). Un reenvío desde el celular sin señal no se duplica (`offline_uuid`). |
| `attendance_days` | Consolidado del día: entrada, salida, minutos, tardanza, horas extra, no autorizadas, estado y justificación. |
| `leave_requests` | Permisos, vacaciones y descanso médico. |
| `salary_advances` | Adelantos. Uno abierto por persona; quien aprueba no es quien pide (RN-PER-09). |
| `commission_plans` y `commission_entries` | Planes de comisión sobre lo cobrado y de bono por entrega; los registros son de solo inserción y un cobro genera una sola comisión (RN-PER-10 a 13). |
| `staff_payouts` y `staff_payout_lines` | Liquidación por persona y período. El neto siempre es bruto menos descuentos (RN-PER-14). Un pago pagado o anulado ya no cambia. |
| `supervision_actions` | Alertas de control vinculadas al trabajador y su supervisor, con la acción tomada. Una vez cerrada no se edita (RN-PER-16). |
| `payroll_exchanges` y `payroll_cost_lines` | Importaciones del costo de planilla y exportaciones de variables (Ayni HR o el contador). |

Marcaciones, QR, días de asistencia y registros de comisión no van a la bitácora (alto volumen). El resto sí, con `audit.track`.

La migración también da acceso de lectura a PER a todos los roles internos (para que cada persona vea su app de marcación, sus adelantos, comisiones y pagos), sin tocar a Gerencia, Auditoría, clientes B2B ni soporte. En una base que ya tiene datos, la migración siembra la demo de PER. En una base nueva, la siembra el `DatabaseSeeder` (se agregó `PerDemoSeeder` después de `FloDemoSeeder`).

Después de `git pull`: `php artisan migrate --database=pgsql_owner`.

## Pantallas
- **PER-01 Puestos y funciones.**
- **PER-02 Ficha del trabajador:** lista con filtros y ficha con datos, condición de pago, asignaciones vigentes, programadas e historial. RR. HH. cambia la asignación (varios centros con %).
- **PER-03 Condiciones de pago:** nueva condición con vigencia; si se traslapa, ofrece cerrar la anterior.
- **PER-04 Turnos por local** y **PER-05 Programación de turnos:** semana por local, tocar un día para turno, descanso o sin turno, horas extra autorizadas y copiar la semana anterior.
- **PER-06 App · Marcación:** para el celular. Marca con GPS (radio del local) o leyendo el QR; foto opcional. Sin señal, guarda la marcación en el teléfono y la envía sola al volver (hasta 48 horas).
- **PER-07 QR del local:** pantalla para la tablet; el código cambia cada minuto y muestra las últimas marcaciones.
- **PER-08 Asistencia diaria:** día (con justificación, marcación manual y recalcular), resumen del mes y permisos y vacaciones.
- **PER-09 Adelantos:** pedir, aprobar, pagar y anular.
- **PER-10 Planes de comisión y bono:** con tramos; si el plan ya se usó, sus montos no se editan.
- **PER-11 Comisiones y bonos del período:** totales por persona, detalle por cobro o entrega y reversos.
- **PER-12 Pagos al personal:** generar al cierre, aprobar, liberar los retenidos, pagar y anular.
- **PER-13 Supervisión:** alertas de CRM, TEL, FLO y asistencia con la acción tomada.
- **PER-14 Costo de personal:** por área, local, marca, centro de costo y por pedido entregado; tendencia de 6 meses y Excel.
- **PER-15 Intercambio con Ayni HR:** importar el costo de planilla (Ayni HR o archivo del contador) y exportar las variables del mes.

Todas funcionan en el celular (390 px). Cada rol ve solo las pantallas que le tocan (`menu.json`): el personal ve su ficha, la marcación, su asistencia, adelantos, comisiones y pagos; los supervisores además la programación, el QR y la supervisión; la contadora además el costo y el intercambio.

## Reglas principales (`app/Modulos/Per/Services`)
- `Personal`: puestos, asignaciones (RN-PER-01) y condiciones de pago (RN-PER-02).
- `Asistencia`:
  - marcación con GPS dentro del radio (fuera queda inválida, RN-PER-03);
  - QR vigente del mismo local (RN-PER-04);
  - manual solo con `per.attendance.approve` y por otra persona (RN-PER-05);
  - consolidado del día con tardanza pasada la tolerancia, turnos que cruzan medianoche y horas extra solo si se autorizaron (RN-PER-07/08);
  - permisos y vacaciones.
- `Comisiones`: comisión sobre lo cobrado sin IGV, una por cobro; reverso en el período abierto si el cobro se anula; bono por pedido entregado; cierre del período el día 5 del mes siguiente (RN-PER-10 a 13). Como el sistema no despacha eventos, `procesar()` revisa cobros y entregas y es idempotente (lo protegen índices únicos).
- `Adelantos`: tope del 30 % de la remuneración mensual (parámetro), uno abierto por persona (RN-PER-09).
- `Pagos`: comisiones, bonos, jornales y tarifa por hora (menos lo no autorizado), descuentos de adelantos y multas de FLO; se retiene si hay alertas graves abiertas (RN-PER-20); quien aprueba no es quien paga.
- `Supervision`: vincula alertas de CRM, TEL y FLO al trabajador y su supervisor; la acción cierra el caso y actualiza la alerta de CRM (RN-PER-16).
- `CostoPersonal`: planilla importada o estimada (condición × 1,215), comisiones y bonos, repartidos por los % de centro de costo; costo por pedido entregado con ventas, almacén y reparto. `filasDelMes($mes, $hasta)` da las filas para PRS.
- `Intercambio`: importa por DNI sueldo, aportes y provisiones; exporta asistencia y conceptos variables. Mientras el conector de Ayni HR (INT) no esté activo, la importación desde Ayni HR se simula con las condiciones de pago y queda marcada como simulada.
- Datos personales y sueldos solo los ve quien tiene `per.employee.view_salary` o la propia persona (RN-PER-19, Ley 29733).

## Permisos
- Marcar asistencia propia: `per.attendance.mark` (todos).
- Puestos, asignaciones y condiciones: `per.employee.manage`. Ver sueldos: `per.employee.view_salary`.
- Aprobar marcaciones manuales, justificaciones, horas extra y permisos: `per.attendance.approve`.
- Adelantos: `per.advance.approve`. Planes y comisiones: `per.commission.manage`. Pagos: `per.payout.approve`.
- Supervisión: `per.supervision.manage`. Intercambio de planilla: `per.payroll.exchange`.

## Pruebas
13 pruebas en `tests/Feature/Modulos/PerTest.php`:
- CA-PER-01 a 09.
- Asignaciones que suman 100 % y condiciones sin traslape, marcación manual por otra persona, pago retenido por alertas y su aprobación, y pantallas por rol.

## Demo
- 23 puestos, asignaciones de 37 personas (6 en varios centros de costo) y condiciones (Julio con jornal, Teodoro por hora, Ana con aumento).
- Programación y asistencia desde el 01/09/2026 hasta hoy, con marcaciones reales por QR y GPS en los últimos 14 días, una marcación manual y una con GPS a 250 m (inválida).
- Comisiones y bonos de septiembre y octubre (con reversos). En PER-11 elige **Octubre de 2026**.
- Pagos: septiembre pagado y octubre por aprobar; en cada mes uno queda retenido por alertas graves.
- Planilla importada de agosto a octubre (la de Ayni HR, simulada) y variables de septiembre exportadas.
