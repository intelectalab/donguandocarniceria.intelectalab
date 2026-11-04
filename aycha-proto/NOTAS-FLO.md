# NOTAS-FLO

- DEL no entra en el armado de prueba (`--only FLO,GAS,CAL`). FLO lee `delivery_routes`, `delivery_stops`, `delivery_costs` y `carrier_rates` si existen; si no, la «ruta» de una jornada son los pedidos del repartidor del día (`sales_orders.driver_user_id` + `delivery_date`) y el tercero del comparativo queda «sin datos». `G.flo.assignToRoute` usa `G.del.assign` si existe; si no, deja una jornada programada (`vehicle_trips` PLANNED).
- DEL ya llama `G.flo.assertVehicleOperable(vid, fecha)` y `G.flo.assertOdometer(vid, km)`; ambas existen.
- Gastos (RN-FLO-17): se crean con `G.gas.create` (borrador) o, sin GAS, con una fila mínima en `expenses`. Las cargas sembradas se anclan a los vales de combustible que siembra GAS (`gc-DEL-COMB`) y se enlazan por `expense_id`; mantenimientos, multa y alquiler/peajes también se enlazan a sus gastos de GAS cuando existen.
- Costo del conductor (RN-FLO-16): respaldo = `employees.monthly_salary` ÷ días hábiles del mes × jornadas en el vehículo, mientras PER no exponga el costo del personal. Multas descontadas: `traffic_fines.deduct_from_payout` (PER ya las lee en `buildPayout`).
- Temperatura (RN-FLO-14): los pedidos afectados quedan en `fleet_alerts.order_reviews` (no se agregan columnas a `sales_orders`); si CAL está activo se abre una no conformidad con `G.cal.createNC`.
- Se agregó en la siembra el auto alquilado BKZ-512 (SOAT vencido el 05/10/2026, D-FLO-01) para CA-FLO-04.
- Reloj de la demo del mapa en vivo: 10/10/2026 11:40 (avanza con las posiciones que envía la app).
