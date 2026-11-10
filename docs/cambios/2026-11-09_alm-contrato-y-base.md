# ALM · Fase 1: contrato y base de datos (09/11/2026)

Primera tanda del módulo ALM. Todavía sin servicios ni pantallas: solo el contrato que usarán los demás módulos y las correcciones del esquema.

## Qué cambió
- **[docs/contratos.md](../contratos.md):** firma de `InventarioService` (mover, reversar, disponible, lotes FEFO, trasladar, devolver), `ReservasService` (reservar, liberar, liberar a mano, consumir), `TransferenciasService` con la interfaz de guía de remisión, `LotesService` y los eventos de ALM.
- **Migración `2026_11_09_000100_alm_restricciones_e_indices.php`** (solo tablas de ALM):
  - `CHECK (qty >= 0)` y `CHECK (reserved_qty >= 0)` en `stock_balances`; `CHECK (qty > 0)` en `stock_reservations`. **No** se puso `reserved_qty <= qty` (ver «Fila que viola RN-ALM-03»).
  - Índice único `stock_balances (tenant_id, warehouse_id, variant_id, COALESCE(lot_id, uuid cero))`: los 11 saldos sin lote cuentan como un lote más. Hoy no hay duplicados.
  - `REVOKE UPDATE, DELETE, TRUNCATE ON stock_movements FROM aycha_app`: el kardex es de solo inserción, como `lot_status_changes`.
  - `CHECK` del signo del kardex por tipo (entradas +, salidas −) y `CHECK` de estados con los valores de la spec (lote, tipo de movimiento, recepción, transferencia, conteo, merma, reserva, almacén, motivo). Hoy 0 filas los violan.
  - Únicos: número de recepción, transferencia, conteo y merma por empresa; código de motivo de merma por empresa. **Sin** único en `lots.code`: la demo repite 7 códigos (por ejemplo, L260825-C02).
  - Índices para FEFO (`lots (variant_id, qc_status, expiry_date)`), kardex por variante, almacén, lote, origen y tipo con fecha, reservas activas por pedido, una sola reserva activa por línea y saldo, y estados de las listas.
  - Columnas que el generador dejó obligatorias solo porque la demo siempre las traía, ahora opcionales: `lot_id` en reservas, mermas y líneas de conteo (hay productos sin lote), `counted_by` de la línea de conteo (nace sin contar), `notes` de merma y transferencia, `supplier_id` de la recepción (devolución de cliente o producción).
  - Columnas nuevas que piden las pantallas: `stock_receipts.void_reason`, `stock_receipt_lines.production_date`, `stock_reservations.released_by`, `stock_transfers.cancel_reason`, `stock_counts.notes`.
  - Tabla nueva `stock_expiry_alerts` (RN-ALM-15): una alerta por lote, día y tramo (`EXPIRED`, `D3`, `D7`), única por `(tenant_id, alert_date, lot_id)` para no duplicarla en el mismo día. Con `enable_tenant_rls` y de solo inserción.
- Verificado en local: `migrate:fresh --seed` siembra las mismas 48 444 filas, `rls_gaps` vacío, la migración se deshace y se vuelve a correr sobre la base sembrada, `aycha_app` recibe «permission denied» al hacer `UPDATE` o `DELETE` en `stock_movements`, y `php artisan test --testsuite=Feature`: 133 pruebas en verde.

## Decisión: columnas de texto del generador
| Columna | Hoy | Decisión |
|---|---|---|
| `stock_movements.reversal_of` | varchar, vacía en las 2 652 filas | **Migración:** pasa a uuid con FK a `stock_movements(id)`. Es la referencia del reverso (RN-ALM-01); como texto no se podía asegurar que apuntara a un movimiento real |
| `stock_count_lines.counted_weight_kg` | varchar, vacía en las 38 filas | **Migración:** pasa a `numeric(14,3)`, como `system_weight_kg`. Se compara y se resta al ajustar (RN-ALM-12) |
| `stock_movements."user"` | nombre en texto, en las 2 652 filas | **Se agrega `user_id` (uuid, FK a `users`) y se mantiene `"user"`** como foto del nombre en ese momento, igual que `closed_by` de los períodos. El servicio llena los dos. El historial sembrado queda con `user_id` vacío: el seeder corre después de las migraciones y la demo no trae el id (la migración sí lo completa por nombre en una base ya sembrada). No se cambia el seeder, que es de la base compartida |
| `lots.released_by` | nombre en texto («Calidad», «Inspección de recepción», personas) | **Se maneja en el servicio:** queda como nombre visible. Quién liberó, con su id, ya está en `lot_status_changes.changed_by` |

## Propuesta RN-ALM-01: función SQL `SECURITY DEFINER` (sin hacer, espera aprobación)

**Hoy** RN-ALM-01 queda asegurada por la aplicación (un solo `InventarioService`) más el kardex de solo inserción en la base. `aycha_app` todavía puede hacer `INSERT` y `UPDATE` directos en `stock_balances` e `INSERT` en `stock_movements`. Por eso **CA-ALM-08** («un intento de insertar directamente en `stock_balances` se rechaza con RN-ALM-01») solo se cumple si la base lo rechaza.

**Propuesta:**
1. Función `alm_aplicar_movimiento(...)` en plpgsql, **delgada**: recibe un movimiento ya validado por `InventarioService` (almacén, variante, lote, cantidad con signo, peso, costo, origen, motivo, usuario), bloquea o crea el saldo, lo actualiza, inserta el kardex y devuelve la fila. Las reglas de negocio (FEFO, lote liberado, período, reservas) siguen en PHP, donde se prueban y se explican mejor.
2. `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON stock_balances FROM aycha_app` y `REVOKE INSERT ON stock_movements FROM aycha_app` (el `UPDATE`/`DELETE` ya está quitado). `GRANT EXECUTE` de la función solo a `aycha_app`.
3. Con eso, un `INSERT` directo falla con «permission denied» (SQLSTATE 42501), y la API lo traduce a `RN-ALM-01` para CA-ALM-08.

**Riesgo con RLS y cómo evitarlo:**
- Una función `SECURITY DEFINER` corre con los permisos de su dueño. Si su dueño es `aycha_owner` (dueño de las tablas) **RLS no se aplica** al dueño, y si el dueño es superusuario (en Docker, `POSTGRES_USER` lo es) tampoco. Un error en la función podría escribir o leer saldos de otra empresa.
- Mitigación propuesta: la función **no** es del dueño de las tablas. Se crea un rol sin login y sin `BYPASSRLS` (`aycha_alm_inventario`), con `INSERT/UPDATE` solo sobre `stock_balances` y `INSERT` sobre `stock_movements`, y ese rol es el dueño de la función. Así RLS sigue filtrando por `app_tenant_id()` dentro de la función, con su `WITH CHECK`.
- Además: `SET search_path = public, pg_temp` en la función (evita que otra sesión la desvíe con objetos propios), y validar dentro que almacén, variante y lote existan para `app_tenant_id()`.
- La bitácora y `app_user_id()` siguen funcionando: leen la configuración de la sesión, no el usuario de base.
- Costo: crear un rol en una migración exige `CREATEROLE` al usuario que migra; hay que confirmarlo en el servidor (`infrastructure/deploy`). El seeder no se afecta: corre como dueño.

**Alternativa más simple** si no conviene crear un rol: un trigger `BEFORE INSERT OR UPDATE OR DELETE` en `stock_balances` y `stock_movements` que falla con `RN-ALM-01` salvo que la transacción tenga `app.alm_gate = 'on'`, que solo pone `InventarioService`. Evita escrituras por error desde otro módulo y cumple CA-ALM-08, pero no es una barrera de seguridad (cualquier código puede poner esa variable).

**Recomendación:** la función delgada con rol propio. Si no se aprueba, el trigger; sin ninguno de los dos, CA-ALM-08 no se puede probar tal como está escrita.

## Fila que viola RN-ALM-03 (para decidir si se corrige en el seeder)
- Don Guando · Cámara de frío Local 1 (`CAM-L1`) · `DG-CUY-ENT` cuy entero · lote `L261008-001`: **saldo 6, reservado 8**.
- El reservado coincide con la suma de sus reservas activas: P-001330 (2), P-001318 (1), P-001305 (3) y P-001286 (2). P-001291 (2) ya está consumida: el saldo bajó con el despacho, pero las demás reservas no se recortaron.
- Opciones en el seeder (base compartida, por eso no lo toqué): **(a)** liberar una reserva activa de 2 (por ejemplo, P-001330, con motivo «Stock insuficiente en la demo»), que deja 6 de 6; o **(b)** subir el saldo a 8 con un movimiento de entrada en el kardex sembrado. Recomiendo (a): no inventa stock y deja el `CHECK (reserved_qty <= qty)` posible después.

## Otras observaciones
- `accounting_periods`: la fila rara `2026-9-01` es de Carnes Selectas y la base la guarda como `2026-09-01` (columna `date`). RN-ALM-16 usa `Periodos::abierto()` de PLT, que compara fechas: no depende de ese texto. Noviembre de 2026 no tiene fila y cuenta como abierto.
- El almacén de tránsito (`TRA`) no tiene local: para su período, `InventarioService::mover` recibe la empresa del origen (`company_id`).
- El local 2 no tiene almacén de devoluciones: `devolver` usa su cámara de frío, como el prototipo.
- `php artisan test` sin `--testsuite=Feature` falla porque no existe `tests/Unit` (el repo no la trae). No es de ALM; se puede arreglar con una carpeta vacía o quitando la suite de `phpunit.xml`.
