# Contratos entre módulos

Regla del plan ([plan-de-sprints.md](plan-de-sprints.md), «contrato antes que código»): el dueño de un módulo que otros usan publica aquí la firma de sus servicios **antes** de construirlos. Quien los usa programa contra esta firma; si el dueño necesita cambiarla, lo anota aquí y avisa.

Convenciones para todos los contratos:
- Los servicios son clases `final` con métodos estáticos en `app/Modulos/<Mod>/Services/`. Reciben arreglos con las claves documentadas y el `User` que actúa.
- **Nunca** se pasa `tenant_id`: RLS y el contexto de la petición ya lo fijan.
- Cantidades, pesos y montos viajan como texto decimal (`"12.500"`) o número, y vuelven como texto decimal: no se redondea en el navegador.
- Una regla que bloquea lanza `RuleError` (`RuleError::fail('RN-ALM-03', '…')`); la API la responde como 422 `{ message, code }`.
- Cada método abre su propia `DB::transaction`. Si quien llama ya está dentro de una transacción (por ejemplo, PED al confirmar un pedido), el cambio de ALM queda dentro de la suya: si su pedido falla, el stock también se deshace.

---

## ALM · Almacenes, lotes, FEFO y movimientos de inventario

Dueño: ALM. Estado: **implementado** (servicios, API `/api/v1/alm` y pantallas ALM-01 a ALM-13, 10/11/2026).

**RN-ALM-01: toda escritura de `stock_balances` y `stock_movements` pasa por `InventarioService`.** Ningún otro módulo (ni otro servicio de ALM) escribe esas tablas. El kardex es de solo inserción: a `aycha_app` se le quitó `UPDATE`, `DELETE` y `TRUNCATE` sobre `stock_movements`, y se corrige con un reverso.

**RN-ALM-01 en la base (CA-ALM-08).** `aycha_app` ya no puede escribir `stock_balances` ni insertar en `stock_movements`: un `INSERT` o `UPDATE` directo falla con «permission denied» (SQLSTATE 42501). Solo se escriben con dos funciones `SECURITY DEFINER` que llama ALM:
- `alm_inventory_move(p_type, p_warehouse, p_variant, p_lot, p_qty, p_weight, p_unit_cost, p_reserved_delta, p_source_type, p_source_id, p_moved_at, p_reason, p_user_id, p_user_name, p_reversal_of, p_check_available DEFAULT false) → uuid`: crea o bloquea el saldo, valida RN-ALM-03 (y RN-ALM-09 con `p_check_available`), calcula el costo promedio, actualiza el saldo e inserta el kardex. `p_qty` va con signo. Las demás reglas (FEFO, lote liberado, período) las valida `InventarioService` antes de llamarla.
- `alm_reserve_adjust(p_balance, p_delta) → numeric`: sube o baja el reservado del saldo; al subir, nunca más que el saldo (RN-ALM-03).

Las funciones son del rol `aycha_alm_inventario` (sin login, sin `BYPASSRLS`, no es dueño de las tablas), así que RLS sigue filtrando por empresa dentro de ellas. Otro módulo **no** las llama: usa `InventarioService` o `ReservasService`.

Clases (`App\Modulos\Alm\Services`):

| Clase | Para qué | La usan |
|---|---|---|
| `InventarioService` | Mover stock (la acción única), reversar, consultar disponible y lotes FEFO, trasladar dentro del local, devolver stock | Todos: PED, POS, PRE, DEL; luego PRO, DES, CAL, COM, GRJ, CON |
| `ReservasService` | Reservar por FEFO, liberar y consumir reservas de un pedido | PED (confirmar, cancelar), PRE/DEL (despacho), POS |
| `TransferenciasService` | Transferencias entre almacenes y locales, con guía de remisión | ALM; FAC (guía) |
| `LotesService` | Estados del lote con historial | ALM; CAL (fase 2) |

### Datos que se repiten

**Línea de movimiento** (lo que devuelve cada salida o entrada):
```php
[
  'movement_id' => 'uuid',
  'warehouse_id' => 'uuid',
  'variant_id' => 'uuid',
  'lot_id' => 'uuid|null',
  'qty' => '-2.000',          // con signo: entradas +, salidas −
  'weight_kg' => '-1.840|null',
  'unit_cost' => '26.5000',
  'total_cost' => '-53.00',
  'bal_qty' => '4.000',        // saldo del almacén, variante y lote después del movimiento
]
```

**Tipos de movimiento** (`movement_type`): entradas `RECEIPT`, `RETURN`, `TRANSFER_IN`, `PRODUCTION_IN`, `CONSIGNMENT_RETURN`; salidas `SALE`, `TRANSFER_OUT`, `PRODUCTION_OUT`, `WASTE`, `CONSIGNMENT_OUT`; con signo libre `ADJUSTMENT` y `REVERSAL`. La base rechaza un signo que no corresponde al tipo.

**Origen** (`source_type`, `source_id`): quién causó el movimiento, para el kardex (ALM-03). Valores en uso: `SALES_ORDER`, `POS_SALE`, `STOCK_RECEIPT`, `STOCK_TRANSFER`, `STOCK_COUNT`, `STOCK_WASTE`, `LOT_RELEASE`, `PRODUCTION_ORDER`, `CONSIGNMENT_DELIVERY`, `CREDIT_NOTE`, `INTERNAL_USE`. Un módulo nuevo agrega el suyo aquí. `source_id` es uuid (o vacío).

---

### `InventarioService::mover(array $m, User $quien): array`

La acción única de inventario (en la spec, `InventoryService::move` / `alm_inventory_move`). Escribe el kardex y actualiza el saldo en la misma transacción, con la fila del saldo bloqueada dentro de `alm_inventory_move` (`SELECT … FOR UPDATE`).

Parámetros (`$m`):

| Clave | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `type` | string | sí | Uno de los tipos de arriba |
| `warehouse_id` | uuid | sí | |
| `variant_id` | uuid | sí | |
| `lot_id` | uuid | según producto | Obligatorio en entradas de un producto con `requires_lot`. En una **salida sin lote** de un producto con lote, se reparte por FEFO entre los lotes liberados del almacén (puede devolver varias líneas) |
| `qty` | decimal | sí | Positivo; el signo lo pone el tipo. `ADJUSTMENT` y `REVERSAL` aceptan signo |
| `weight_kg` | decimal | no | Peso real (peso variable). Al repartir por FEFO se prorratea |
| `unit_cost` | decimal | no | Solo entradas. Si falta, el costo promedio del saldo o el costo estándar de la variante. Las salidas salen siempre a costo promedio |
| `source_type`, `source_id` | string, uuid | sí, no | Origen para el kardex |
| `reason` | string | sí | Texto del kardex («Venta del mostrador», «Despacho P-001330») |
| `moved_at` | fecha y hora | no | Por defecto, ahora (Lima) |
| `from_reserved` | bool | no | La salida consume lo reservado (solo lo usa `ReservasService::consumir`) |
| `delivery_date` | fecha | no | Para FEFO: el lote debe tener vida a esa fecha (RN-ALM-04) |
| `company_id` | uuid | solo si el almacén no tiene local | Empresa cuyo período se valida (por ejemplo, el almacén de tránsito). Si el almacén tiene local, sale de su local |

Respuesta:
```php
['moves' => [ /* líneas de movimiento */ ], 'total_cost' => '53.00', 'unit_cost' => '26.5000']
```

Reglas que valida:
- **RN-ALM-01** tipo válido, cantidad mayor que cero, almacén y variante existentes y activos.
- **RN-ALM-02** `SALE`, `TRANSFER_OUT` y `CONSIGNMENT_OUT` solo con lote **liberado**; `SALE` solo desde un almacén con `allows_sale`. Las demás salidas (merma, ajuste, consumo de producción) también exigen lote liberado, salvo cuando las hace ALM sobre un lote en cuarentena o bloqueado (merma de un lote rechazado, ajuste de conteo).
- **RN-ALM-03** el saldo no queda negativo; una venta o salida que no sea `from_reserved` solo usa el **disponible** (saldo − reservado). La base además rechaza saldo o reservado negativos (`CHECK`).
- **RN-ALM-04** en salidas por FEFO: primero el lote liberado que vence antes y que tiene al menos `alm_min_days_left_on_delivery` días a la fecha de entrega. Un lote vencido no sale para venta ni transferencia.
- **RN-ALM-08** un producto con lote no se mueve sin lote (salvo la salida por FEFO), y el lote debe ser de la misma variante.
- **RN-ALM-09** lo reservado no se vende: falla si la venta toca stock reservado para pedidos.
- **RN-ALM-16** la fecha no puede caer en un período cerrado. Usa `Periodos::abierto()` de PLT (compara la fecha del mes, así que no depende del formato del texto de origen); la API responde con el código `RN-ALM-16`.

Evento: `stock.moved` por cada línea (`movement_id`, `type`, `variant_id`, `warehouse_id`, `lot_id`, `qty`, `total_cost`).

### `InventarioService::reversar(string $movementId, string $motivo, User $quien): array`

Corrige un movimiento con su contrario (`REVERSAL`, `reversal_of` = el original). Un movimiento ya reversado no se reversa otra vez. Valida RN-ALM-03 (el reverso de una entrada no puede dejar el saldo negativo) y RN-ALM-16 (con la fecha de hoy). Respuesta: como `mover`.

### `InventarioService::disponible(string $variantId, ?string $warehouseId = null, ?string $lotId = null, bool $soloLiberado = true): array`

Solo lectura. `['qty' => '6.000', 'reserved_qty' => '2.000', 'available_qty' => '4.000', 'weight_kg' => '…']`. Con `soloLiberado`, cuenta solo lotes liberados y vigentes.

### `InventarioService::lotesDisponibles(string $variantId, array $donde): Collection`

Solo lectura. Lista FEFO de lo que se puede sacar. `$donde`: `establishment_id` (todos sus almacenes de venta por `pick_priority`) **o** `warehouse_id`; opcionales `delivery_date` (por defecto hoy) e `incluir_reservado` (bool).

Cada fila: `balance_id`, `warehouse_id`, `warehouse_code`, `lot_id`, `lot_code`, `expiry_date`, `days_left`, `qty`, `reserved_qty`, `available_qty`. Orden: vence antes, luego prioridad del almacén. Aplica RN-ALM-02 y RN-ALM-04 (solo liberados, con vida suficiente a la fecha de entrega).

### `InventarioService::trasladar(array $t, User $quien): array`

Traslado inmediato **dentro del mismo local** (cuarentena → cámara al liberar, cámara → mostrador, almacén → producción). Hace `TRANSFER_OUT` + `TRANSFER_IN` al mismo costo. `$t`: `from_warehouse_id`, `to_warehouse_id`, `variant_id`, `lot_id`, `qty`, `weight_kg`, `source_type`, `source_id`, `reason`. Si los almacenes son de locales distintos falla con **RN-ALM-10**: entre locales se usa `TransferenciasService`, que exige guía. Respuesta: `['out' => [líneas], 'in' => [líneas]]`.

### `InventarioService::devolver(string $sourceType, string $sourceId, string $motivo, User $quien, ?string $warehouseId = null, ?array $lineas = null): array`

Reingresa lo que salió por un origen (pedido no entregado, cancelado después de despachar, devolución en el mostrador). Busca las salidas `SALE` de ese origen que aún no se devolvieron y crea `RETURN` con el mismo lote y costo. Por defecto entra al almacén `RETURNS` del local de la salida; si el local no tiene, a su `COLD_ROOM`. El lote devuelto no pasa solo a la venta: el almacén de devoluciones no vende. `$lineas` (opcional) devuelve solo parte: `[['movement_id' => uuid, 'qty' => '1.000', 'weight_kg' => …]]`. Valida RN-ALM-03 (no se devuelve más de lo que salió) y RN-ALM-16. Respuesta: `['moves' => [líneas]]`.

---

### `ReservasService::reservar(array $pedido, User $quien): array`

Reserva por FEFO (RN-ALM-09) las líneas de un pedido confirmado. **Recibe líneas genéricas:** PED (que aún no existe) la llamará al confirmar; hoy se prueba con los pedidos de demo.

```php
$pedido = [
  'order_id' => 'uuid', 'order_number' => 'P-001330',
  'brand_id' => 'uuid', 'establishment_id' => 'uuid',
  'delivery_date' => '2026-11-10',
  'lines' => [ ['line_id' => 'uuid', 'variant_id' => 'uuid', 'qty' => '2.000', 'weight_kg' => null, 'lot_id' => null] ],
]
```
- Si el pedido ya tenía reservas activas, se liberan y se recalcula (sirve para editar un pedido confirmado).
- Una línea con `lot_id` reserva solo de ese lote.
- Reserva lo que haya: lo que falta vuelve en `short` y PED decide (KPI-ALM-07, quiebres de stock).

Respuesta:
```php
[
  'reservations' => [ ['reservation_id', 'line_id', 'balance_id', 'warehouse_id', 'lot_id', 'lot_code', 'expiry_date', 'qty', 'weight_kg'] ],
  'short' => [ ['line_id' => 'uuid', 'variant_id' => 'uuid', 'qty' => '1.000'] ],
]
```
Reglas: RN-ALM-02, RN-ALM-03 (la reserva no supera el saldo, con la fila bloqueada), RN-ALM-04 (vida mínima a la fecha de entrega), RN-ALM-08, RN-ALM-09.

`ReservasService::reservaAlConfirmar(?string $brandId = null): bool` dice si rige `alm_reserve_on_confirm`; PED lo consulta antes de llamar a `reservar`.

### `ReservasService::liberar(string $orderId, string $motivo, User $quien, ?array $lineIds = null): int`

Libera las reservas activas del pedido (o de esas líneas): al cancelar o al editar. Pasan a `RELEASED` con el motivo; baja `reserved_qty` del saldo. Devuelve cuántas liberó. Sin permiso especial: lo llama el sistema.

### `ReservasService::liberarManual(string $reservationId, string $motivo, User $quien): array`

ALM-10: liberación a mano. Exige el permiso `alm.reservation.release` y motivo (RN-ALM-09). Deja `released_by`. La línea del pedido queda sin stock reservado: lo que falta vuelve en la respuesta (`['reservation' => …, 'short' => […]]`).

### `ReservasService::consumir(string $orderId, User $quien, array $pesos = []): array`

Al despachar (PRE, DEL o POS): convierte las reservas activas del pedido en salidas `SALE` con `from_reserved` y las marca `CONSUMED`. `$pesos` (opcional): peso real por línea, `['line_id' => '1.840']`, que se prorratea entre sus reservas. Si un lote reservado dejó de estar liberado, falla con RN-ALM-02 y el pedido se debe volver a reservar. Respuesta: `['moves' => [líneas], 'stock_out' => [ ['line_id', 'warehouse_id', 'lot_id', 'qty', 'weight_kg', 'movement_ids'] ]]`.

---

### `TransferenciasService`

| Método | Qué hace | Reglas |
|---|---|---|
| `crear(array $t, User $quien)` | Borrador. `$t`: `from_warehouse_id`, `to_warehouse_id`, `notes`, `lines` (`variant_id`, `lot_id`, `qty`, `weight_kg`). `requires_guide` = los almacenes son de locales distintos | Permiso `alm.transfer.create`; RN-ALM-08 |
| `emitirGuia(string $id, User $quien, array $datos = [])` | Pide la guía de remisión (motivo 04, traslado entre establecimientos) al emisor de guías | RN-ALM-10 |
| `despachar(string $id, User $quien)` | Entre locales: sale a tránsito (`TRANSFER_OUT` origen + `TRANSFER_IN` tránsito) y queda `DISPATCHED`. En el mismo local: va directo al destino y queda `RECEIVED` | RN-ALM-10 (sin guía no sale), RN-ALM-02, 03, 04 |
| `recibir(string $id, array $recibido, User $quien)` | `$recibido`: por línea `line_id`, `received_qty`, `received_weight_kg`, `difference_reason`. Lo recibido pasa de tránsito al destino; la diferencia queda como merma con el motivo `TRAN` y la transferencia `RECEIVED_WITH_DIFF` | Permiso `alm.transfer.receive`; RN-ALM-11 (diferencia con motivo, no más de lo enviado) |
| `cancelar(string $id, string $motivo, User $quien)` | Solo un borrador | RN-ALM-10 |

**La guía depende de FAC, que aún no existe.** ALM define la interfaz y un respaldo simple:

```php
namespace App\Modulos\Alm\Services\Guias;

interface EmisorGuiaRemision
{
    /**
     * Emite (o registra) la guía de remisión de una transferencia entre locales.
     * @param  object  $transferencia  fila de stock_transfers
     * @param  array   $lineas         filas de stock_transfer_lines
     * @param  array   $datos          lo que pide el emisor (por ejemplo, el número de una guía ya emitida)
     * @return array{series: string, number: string, full_number: string, issued_at: string}
     */
    public function emitir(object $transferencia, array $lineas, array $datos = []): array;
}
```
- **Respaldo de la Fase 1 (`GuiaRemisionManual`):** el almacenero registra el número de la GRE que emitió fuera del sistema (portal de SUNAT), con el formato `T001-00000031`. No toma números de la serie `DISPATCH_GUIDE` (T001, T002) para no chocar con FAC cuando emita guías electrónicas reales.
- **Cuando llegue FAC:** registra su implementación en su `ServiceProvider` (`$this->app->bind(EmisorGuiaRemision::class, …)`) y ALM la usa sin cambios. FAC emite `guide.issued`; con el respaldo, lo emite ALM.

### `LotesService::cambiarEstado(string $lotId, string $estado, ?string $motivo, User $quien, array $opciones = []): array`

ALM-06. Flujo: `QUARANTINE → RELEASED | BLOCKED | REJECTED`; `RELEASED → BLOCKED | RECALLED`; `BLOCKED → RELEASED | REJECTED | RECALLED`; `REJECTED` y `RECALLED` ya no cambian.
- Liberar exige `alm.lot.release` (en la Fase 1 libera el almacenero, D-ALM-01; pasa a CALIDAD cuando CAL esté activo). Bloquear, rechazar o retirar exige `alm.lot.block` y motivo (RN-ALM-07). Un lote vencido no se libera (RN-ALM-04).
- Cada cambio queda en `lot_status_changes` (solo inserción).
- `$opciones['mover_a']`: al liberar, traslada su saldo de cuarentena a ese almacén del mismo local.
- Si un lote deja de estar liberado y tiene reservas activas, esos pedidos se vuelven a reservar por FEFO; la respuesta trae `rereserved` (números de pedido).
- Eventos: `lot.released`, `lot.blocked` (también al rechazar), `lot.recalled`.

### Eventos que emite ALM

| Evento | Cuándo | Datos |
|---|---|---|
| `stock.moved` | Cada línea de kardex | `movement_id`, `type`, `variant_id`, `warehouse_id`, `lot_id`, `qty`, `total_cost` |
| `lot.released`, `lot.blocked`, `lot.recalled` | Cambio de estado del lote | `lot_id`, `code`, `from`, `to`, `reason` |
| `guide.issued` | Guía registrada con el respaldo (sin FAC) | `transfer_id`, `full_number`, `reason_code` = `04`, `source` = `ALM` |
| `stock.expiring` | Alerta diaria de vencimiento (RN-ALM-15) | `date`, `d3`, `d7`, `expired`, `value_pen` |
| `stock.low` | Mejora posterior (stock mínimo) | `variant_id`, `warehouse_id`, `available_qty`, `min_qty` |

### Permisos y alcance de ALM

Las rutas de escritura exigen el módulo con la acción (`modulo:ALM,C` o `,E`) y, cuando la spec lo nombra, el permiso. Donde el permiso depende del estado o del dato, lo valida el servicio y responde 422 con el código de la regla.

| Acción | Permiso | Dónde se valida |
|---|---|---|
| Crear o editar almacenes (ALM-01) | `alm.warehouse.manage` | ruta |
| Recepciones: crear, editar, confirmar, anular (ALM-04) | `alm.receipt.create` | ruta y `RecepcionService` |
| Liberar un lote (ALM-06) | `alm.lot.release` | `LotesService` |
| Bloquear, rechazar o retirar un lote (ALM-06) | `alm.lot.block` + motivo | `LotesService` |
| Transferencias: crear, guía, despachar, cancelar (ALM-07) | `alm.transfer.create` | ruta y `TransferenciasService` |
| Recibir una transferencia (ALM-07) | `alm.transfer.receive` | ruta y `TransferenciasService` |
| Conteos: abrir, contar, cerrar, cancelar (ALM-08) | edición del módulo | ruta |
| Aprobar un conteo y ajustar (ALM-08) | `alm.count.approve`, distinto de quien contó | ruta y `ConteosService` |
| **Reversar un movimiento del kardex (ALM-03)** | `alm.count.approve` | ruta. Decisión de ALM: un reverso es un ajuste del kardex y la spec no le asigna permiso propio; lo aprueba quien aprueba ajustes |
| Registrar una merma (ALM-09) | creación del módulo (+ foto si el motivo la exige) | ruta y `MermasService` |
| Aprobar o rechazar una merma (ALM-09) | distinto de quien la pidió; sobre el umbral del motivo, `alm.waste.approve` | `MermasService` |
| Motivos de merma (ALM-13) | `alm.waste.approve` | ruta |
| Liberar una reserva a mano (ALM-10) | `alm.reservation.release` + motivo | ruta y `ReservasService` |
| **Generar las alertas de vencimiento a mano (ALM-11)** | edición del módulo | ruta. Solo inserta alertas del día (no duplica) y avisa; no mueve stock, por eso no pide permiso propio |
| Ver costos en stock, kardex y KPI | `alm.stock.view_cost` | controladores: sin él, los campos de costo van vacíos |

**Alcance por local y marca** (`user_scopes`; sin filas = todo): limita las listas **y las escrituras**. `InventarioService::almacen($id, $quien)` rechaza con `RN-ALM-01` un almacén de un local al que el usuario no tiene alcance, y por ahí pasan `mover`, `trasladar`, recepciones, conteos, mermas y el origen de una transferencia (el destino puede ser de otro local: para eso es la transferencia). El almacén de tránsito, que no tiene local, lo usa cualquiera. RLS separa empresas; el alcance separa locales dentro de la empresa.

**Foto de merma:** PNG, JPG o WEBP de hasta 1 MB (la misma regla que los logos, `App\Support\Logos`), en el disco privado `local` dentro de la carpeta del cliente; se sirve con sesión y `nosniff`.

### Pendientes del contrato
- **PED:** llamará a `reservar` al confirmar (si `reservaAlConfirmar`), a `liberar` al cancelar y a `devolver` si el pedido ya había salido. Hoy `stock_reservations.order_id` y `order_line_id` tienen FK a `sales_orders` y `sales_order_lines`: las líneas son genéricas en la firma, pero deben existir en esas tablas.
- **FAC:** implementa `EmisorGuiaRemision`.
- **CAL (fase 2):** la liberación de lotes pasa al permiso de CALIDAD.

---

## REC · Recetas y formulación

Dueño: REC. Estado: **implementado** (12/11/2026). Lo usarán PRO (orden de producción, PRO-05), CAL (ficha técnica y registro sanitario) y CAT.

**REC es el único que escribe** `recipes`, `recipe_versions`, `recipe_ingredients`, `recipe_steps`, `recipe_control_points` y `food_additives`. Los demás leen o llaman a `RecetasService` (`App\Modulos\Rec\Services`). REC solo **lee** `stock_balances` (costo promedio vigente); no mueve stock.

### `RecetasService::vigente(string $recipeId): ?object`
La versión `APPROVED` de la receta (RN-REC-01: hay una sola), o `null`. PRO la toma al crear la orden.

### `RecetasService::escalar(string $versionId, mixed $kgDeseados): array`
RN-REC-08. `factor = kg deseados / kg base de salida`; cada ingrediente = kg base × factor, redondeado a 3 decimales. Respuesta:
```php
[
  'version_id' => 'uuid', 'recipe_id' => 'uuid', 'version' => 2, 'base_output_kg' => '10.000', 'target_kg' => '25.000', 'factor' => '2.500000',
  'lines' => [ ['seq' => 1, 'variant_id' => 'uuid', 'sku' => 'MP-CER-REC', 'name' => '…', 'base_kg' => '7.2000', 'kg' => '18.000',
                'tolerance_pct' => '2.00', 'tolerance_kg' => '0.360', 'is_additive' => false] ],
  'packaging' => [ ['variant_id' => 'uuid', 'per' => 'UNIT|KG', 'qty' => '…'] ],   // por kg: qty × kg deseados
  'total_kg' => '25.843',
]
```
No valida el estado: quien llama decide (PRO usa solo la vigente). En la API: `GET /api/v1/rec/versiones/{id}/escalado?kg=25`, que también ve el operario (D-REC-02).

### `RecetasService::costo(string $versionId, array $costos = []): array`
RN-REC-09. `Σ (kg × costo promedio vigente) / kg base`. El costo promedio sale de los saldos de ALM con stock (`Σ qty × avg_cost / Σ qty`); sin stock, el `std_cost` de la variante. `$costos` (`[variant_id => costo]`) fija algunos costos para simular. Respuesta: `['rows' => [...], 'total' => '153.70', 'per_kg' => '15.3700']`.

### Otras lecturas
`rendimiento($versionId)` (RN-REC-11, % a 2 decimales), `totalKg($versionId)`, `alergenos($versionId)` (RN-REC-07), `validar($versionId)` (las validaciones de aprobación: `[{code, level: ok|warn|error, msg}]`).

### Escrituras (las usan las pantallas de REC)
`crearReceta`, `editarReceta`, `nuevaVersion`, `guardarVersion`, `borrarBorrador`, `enviar`, `devolver`, `aprobar`, `guardarIngrediente`, `guardarPaso`, `moverPaso`, `guardarPunto`, `quitar`, `guardarAditivo`, `recalcularCostos`. Cada una abre su `DB::transaction`.

**Reglas que valida:** RN-REC-01 a RN-REC-12. RN-REC-01 y RN-REC-03 también están en la base: índice único parcial de una sola versión `APPROVED` (y una sola en curso) por receta, y un disparador que rechaza cambiar o borrar ingredientes, pasos y puntos de control de una versión aprobada o retirada, y cambiar su contenido (solo se permite retirarla y guardar el recálculo del costo). El disparador responde `RN-REC-03: …` y el servicio lo convierte en `RuleError`.

### Eventos que emite REC
| Evento | Cuándo | Datos |
|---|---|---|
| `recipe_version.submitted` | Enviar a revisión | `recipe_id`, `version` |
| `recipe_version.approved` | Aprobar | `recipe_id`, `version`, `previous_version_id`, `allergens` |
| `recipe.cost_variation` | Recalcular costos con al menos un aviso | `versions`, `alerts` |

Avisos (`notifications`): a CALIDAD al enviar a revisión, al autor al devolverla y a JEFE_PRODUCCION cuando el costo varía más de `rec_cost_alert_pct`.

### Permisos y alcance de REC
| Acción | Exige |
|---|---|
| Ver recetas, versiones, ingredientes, pasos, puntos, aditivos y ficha | módulo REC (L) y además `rec.version.edit`, `rec.version.approve` o `rec.cost.view` (o ser AUDITOR). Sin eso responde 403 `D-REC-02`: el operario ve solo el escalado |
| Crear y editar recetas y versiones en borrador | `rec.version.edit` |
| Aprobar | `rec.version.approve` y no ser el autor (RN-REC-02) |
| Devolver a borrador | `rec.version.edit` o `rec.version.approve`, con comentario |
| Catálogo de aditivos | `rec.version.approve` o `rec.version.edit` |
| Ver costos (REC-09 y los campos de costo) | `rec.cost.view`; sin él, los campos van vacíos |

**Alcance por marca:** las listas y fichas se filtran por las marcas del usuario (`user_scopes`); escribir en una receta de otra marca se rechaza.

### Pendientes del contrato
- **PRO:** tomará `vigente()` y `escalar()` en PRO-05 y registrará las lecturas de los puntos de control (KPI-REC-03).
- **CAL:** el registro sanitario de la ficha técnica hoy se lee de `sanitary_registrations` o del producto.
