<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Eventos entre módulos (G.events del prototipo; nombres en el mapa de módulos de la spec:
 * order.confirmed, document.issued, stock.moved…). Quedan en domain_events, de solo inserción,
 * con la empresa y el usuario del contexto. Se escriben en la misma transacción que el cambio:
 * si el cambio se deshace, el evento también.
 *   Events::emit('order.confirmed', 'sales_orders', $pedido->id, ['number' => $pedido->number]);
 *
 * Pendiente (INT): despachar a los suscriptores y al outbox. Mientras tanto, quien necesite
 * reaccionar lee domain_events.
 */
final class Events
{
    public static function emit(string $name, ?string $aggregateType = null, ?string $aggregateId = null, array $payload = []): void
    {
        DB::table('domain_events')->insert([
            'event_name' => $name,
            'aggregate_type' => $aggregateType,
            'aggregate_id' => $aggregateId,
            'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]);
    }
}
