<?php

namespace App\Modulos\Pre\Services;

use App\Models\User;
use App\Modulos\Ped\Services\Estados;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Olas de preparación (PRE-01, RN-PRE-02). Una ola junta los pedidos confirmados de un local, una
 * fecha y una franja (o una ruta). Al liberarla se emite wave.released, sus pedidos pasan a EN
 * PREPARACIÓN (PED) y cada pedido recibe su ruta y parada: la de DEL si ya existe; si no, una ruta
 * por zona y franja con las paradas en orden de cercanía desde el local (D-PRE-04).
 */
final class Olas
{
    public static function ola(string $id): object
    {
        $w = DB::table('picking_waves')->where('id', $id)->first();
        if (! $w) {
            abort(404, 'Ola no encontrada.');
        }

        return $w;
    }

    public static function visible(string $id, User $u): object
    {
        $w = self::ola($id);
        if (! Base::veLocal($u, $w->establishment_id)) {
            abort(404, 'Ola no encontrada.');
        }

        return $w;
    }

    private static function bloquear(string $id, User $u): object
    {
        $w = DB::table('picking_waves')->where('id', $id)->lockForUpdate()->first();
        if (! $w || ! Base::veLocal($u, $w->establishment_id)) {
            abort(404, 'Ola no encontrada.');
        }

        return $w;
    }

    /** Almacén de la ola: la cámara de frío de venta del local o, si no tiene, su almacén de venta principal. */
    public static function almacenDe(string $establecimiento): string
    {
        $w = DB::table('warehouses')->where('establishment_id', $establecimiento)->where('status', 'ACTIVE')->where('allows_sale', true)
            ->orderByRaw("CASE wh_type WHEN 'COLD_ROOM' THEN 0 WHEN 'MAIN' THEN 1 ELSE 2 END")->orderBy('pick_priority')->value('id');
        if (! $w) {
            RuleError::fail('RN-PRE-02', 'El local no tiene un almacén de venta activo para preparar pedidos.');
        }

        return $w;
    }

    /**
     * Crea la ola en borrador con los pedidos elegidos (y la libera si se pide).
     *
     * @param  array{establishment_id?: string, wave_date?: string, slot_from?: ?string, slot_to?: ?string, route_code?: ?string, order_ids: list<string>, liberar?: bool}  $d
     */
    public static function crear(array $d, User $u): object
    {
        return DB::transaction(function () use ($d, $u) {
            $ids = array_values(array_unique($d['order_ids'] ?? []));
            if (! $ids) {
                RuleError::fail('RN-PRE-02', 'Elige al menos un pedido para la ola.');
            }
            $tareas = [];
            $local = $d['establishment_id'] ?? null;
            foreach ($ids as $id) {
                $o = DB::table('sales_orders')->where('id', $id)->lockForUpdate()->first();
                if (! $o || ! Base::veTarea($o, $u)) {
                    RuleError::fail('RN-PRE-02', 'Uno de los pedidos elegidos no existe o no es de tus marcas y locales.');
                }
                $local ??= $o->establishment_id;
                if ($o->establishment_id !== $local) {
                    RuleError::fail('RN-PRE-02', "El pedido {$o->number} es de otro local: una ola es de un solo local.");
                }
                $t = Tareas::asegurar($o);
                if ($t->wave_id) {
                    $w0 = DB::table('picking_waves')->where('id', $t->wave_id)->first();
                    if ($w0 && ! in_array($w0->status, ['CANCELLED', 'CLOSED'], true)) {
                        RuleError::fail('RN-PRE-01', "El pedido {$o->number} ya está en la ola {$w0->number}.");
                    }
                }
                $tareas[] = [$t, $o];
            }
            if (! Base::veLocal($u, $local)) {
                RuleError::fail('RN-PRE-02', 'Ese local no está en tu alcance.');
            }
            [$t0, $o0] = $tareas[0];
            $id = DB::table('picking_waves')->insertGetId([
                'number' => Base::numeroOla(), 'establishment_id' => $local, 'warehouse_id' => self::almacenDe($local),
                'wave_date' => $d['wave_date'] ?? $o0->delivery_date ?? Base::hoy(),
                'slot_from' => $d['slot_from'] ?? $o0->slot_from, 'slot_to' => $d['slot_to'] ?? $o0->slot_to,
                'route_code' => isset($d['route_code']) && trim((string) $d['route_code']) !== '' ? mb_substr(mb_strtoupper(trim($d['route_code'])), 0, 40) : null,
                'status' => 'DRAFT', 'created_by' => $u->id,
            ], 'id');
            DB::table('picking_tasks')->whereIn('id', array_map(fn ($x) => $x[0]->id, $tareas))->update(['wave_id' => $id, 'updated_at' => now()]);
            Events::emit('wave.created', 'picking_waves', $id, ['orders' => count($tareas)]);

            if (! empty($d['liberar'])) {
                return self::liberar($id, $u);
            }

            return self::ola($id);
        });
    }

    /** RN-PRE-02: libera la ola. Sus pedidos pasan a EN PREPARACIÓN y reciben ruta y parada. */
    public static function liberar(string $id, User $u): object
    {
        return DB::transaction(function () use ($id, $u) {
            $w = self::bloquear($id, $u);
            if ($w->status !== 'DRAFT') {
                RuleError::fail('RN-PRE-02', "La ola {$w->number} ya está ".Base::ola($w->status).'.');
            }
            $tareas = DB::table('picking_tasks')->where('wave_id', $w->id)->where('status', '<>', 'CANCELLED')->get();
            if ($tareas->isEmpty()) {
                RuleError::fail('RN-PRE-02', "La ola {$w->number} no tiene pedidos.");
            }
            $pedidos = [];
            foreach ($tareas as $t) {
                $o = DB::table('sales_orders')->where('id', $t->order_id)->lockForUpdate()->first();
                if (! in_array($o->status, ['CONFIRMED', 'IN_PREPARATION'], true)) {
                    RuleError::fail('RN-PRE-01', "El pedido {$o->number} está ".Estados::nombre($o->status).': sácalo de la ola antes de liberarla.');
                }
                Tareas::asegurar($o);
                $pedidos[] = $o;
            }
            DB::table('picking_waves')->where('id', $w->id)->update(['status' => 'RELEASED', 'released_at' => now(), 'released_by' => $u->id, 'updated_at' => now()]);
            self::asignarRutas($w);
            Events::emit('wave.released', 'picking_waves', $w->id, ['number' => $w->number, 'order_ids' => array_map(fn ($o) => $o->id, $pedidos)]);
            foreach ($pedidos as $o) {
                if ($o->status === 'CONFIRMED') {
                    Estados::cambiar($o->id, 'IN_PREPARATION', "Ola {$w->number} liberada", $u);
                }
            }

            return self::ola($w->id);
        });
    }

    public static function cancelar(string $id, ?string $motivo, User $u): object
    {
        return DB::transaction(function () use ($id, $motivo, $u) {
            $w = self::bloquear($id, $u);
            if ($w->status !== 'DRAFT') {
                RuleError::fail('RN-PRE-02', 'Solo se cancela una ola en borrador: una liberada ya tiene pedidos en preparación.');
            }
            DB::table('picking_tasks')->where('wave_id', $w->id)->update(['wave_id' => null, 'updated_at' => now()]);
            DB::table('picking_waves')->where('id', $w->id)->update([
                'status' => 'CANCELLED', 'cancelled_at' => now(), 'cancel_reason' => $motivo ? mb_substr(trim($motivo), 0, 255) : null, 'updated_at' => now(),
            ]);

            return self::ola($w->id);
        });
    }

    /** Saca un pedido de una ola en borrador (vuelve a «sin ola»). */
    public static function quitar(string $id, string $taskId, User $u): object
    {
        return DB::transaction(function () use ($id, $taskId, $u) {
            $w = self::bloquear($id, $u);
            if ($w->status !== 'DRAFT') {
                RuleError::fail('RN-PRE-02', 'Solo se sacan pedidos de una ola en borrador.');
            }
            $n = DB::table('picking_tasks')->where('id', $taskId)->where('wave_id', $w->id)->update(['wave_id' => null, 'updated_at' => now()]);
            if (! $n) {
                RuleError::fail('RN-PRE-02', 'Ese pedido no está en la ola.');
            }

            return self::ola($w->id);
        });
    }

    /** Cierra la ola cuando todos sus pedidos están verificados o cargados. */
    public static function cerrar(string $id, User $u): object
    {
        return DB::transaction(function () use ($id, $u) {
            $w = self::bloquear($id, $u);
            if (in_array($w->status, ['DRAFT', 'CANCELLED', 'CLOSED'], true)) {
                RuleError::fail('RN-PRE-02', "La ola {$w->number} está ".Base::ola($w->status).': no se cierra.');
            }
            $faltan = DB::table('picking_tasks')->where('wave_id', $w->id)->whereNotIn('status', ['VERIFIED', 'LOADED', 'CANCELLED'])->pluck('order_number');
            if ($faltan->isNotEmpty()) {
                RuleError::fail('RN-PRE-09', 'Faltan verificar: '.$faltan->implode(', ').'.');
            }
            DB::table('picking_waves')->where('id', $w->id)->update(['status' => 'CLOSED', 'closed_at' => now(), 'closed_by' => $u->id, 'updated_at' => now()]);

            return self::ola($w->id);
        });
    }

    /** Estado de la ola según sus tareas (armando, embolsada, cargada). No toca borradores ni cerradas. */
    public static function recalcular(?string $id): void
    {
        $w = $id ? DB::table('picking_waves')->where('id', $id)->first() : null;
        if (! $w || in_array($w->status, ['DRAFT', 'CANCELLED', 'CLOSED'], true)) {
            return;
        }
        $st = DB::table('picking_tasks')->where('wave_id', $id)->where('status', '<>', 'CANCELLED')->pluck('status');
        $nuevo = match (true) {
            $st->isEmpty() => $w->status,
            $st->every(fn ($s) => $s === 'LOADED') => 'LOADED',
            $st->every(fn ($s) => in_array($s, ['PACKED', 'VERIFIED', 'LOADED'], true)) => 'PACKED',
            $st->contains(fn ($s) => $s !== 'PENDING') => 'PICKING',
            default => 'RELEASED',
        };
        if ($nuevo !== $w->status) {
            DB::table('picking_waves')->where('id', $id)->update(['status' => $nuevo, 'updated_at' => now()]);
        }
    }

    /* ------------------------------------------------------------- rutas y paradas */

    public static function zona(object $o): string
    {
        if ($o->fulfillment === 'PICKUP' || $o->fulfillment === 'COUNTER') {
            $e = DB::table('establishments')->where('id', $o->pickup_establishment_id ?? $o->establishment_id)->value('code');

            return 'RECOJO-'.($e ?? 'LOCAL');
        }
        if ($o->fulfillment === 'PROVINCE_SHIPPING') {
            return 'PROVINCIA';
        }

        return $o->zone_id ? (DB::table('delivery_zones')->where('id', $o->zone_id)->value('code') ?? 'SIN-ZONA') : 'SIN-ZONA';
    }

    public static function clave(object $o, string $codigo): string
    {
        return mb_substr(($o->delivery_date ?? '').'|'.substr((string) $o->slot_from, 0, 5).'|'.$codigo, 0, 80);
    }

    /** Ruta y parada que ya armó DEL para el pedido, si existe. */
    public static function paradaDel(string $orderId): ?array
    {
        $s = DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')->where('s.order_id', $orderId)
            ->whereNotIn('s.status', ['CANCELLED', 'RESCHEDULED', 'FAILED'])->orderByDesc('s.created_at')->first(['r.id', 'r.code', 's.seq']);

        return $s ? ['route_id' => $s->id, 'route_code' => mb_substr($s->code, 0, 40), 'stop_seq' => (int) $s->seq, 'route_key' => 'DEL:'.$s->id] : null;
    }

    /** Ruta y parada para una tarea suelta (al embolsar sin ola con ruta). */
    public static function rutaDe(object $t): array
    {
        $o = DB::table('sales_orders')->where('id', $t->order_id)->first();
        if ($d = self::paradaDel($o->id)) {
            return $d;
        }
        $codigo = self::zona($o);
        $clave = self::clave($o, $codigo);
        $seq = (int) DB::table('picking_tasks')->where('route_key', $clave)->where('status', '<>', 'CANCELLED')->max('stop_seq') + 1;

        return ['route_id' => null, 'route_code' => $codigo, 'stop_seq' => $seq, 'route_key' => $clave];
    }

    private static function asignarRutas(object $w): void
    {
        $tareas = DB::table('picking_tasks as t')->join('sales_orders as o', 'o.id', '=', 't.order_id')
            ->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')
            ->where('t.wave_id', $w->id)->where('t.status', '<>', 'CANCELLED')
            ->get(['t.id', 't.route_key', 'o.id as order_id', 'o.fulfillment', 'o.pickup_establishment_id', 'o.establishment_id', 'o.zone_id',
                'o.delivery_date', 'o.slot_from', 'a.lat', 'a.lng']);
        $libres = [];
        foreach ($tareas as $t) {
            if ($d = self::paradaDel($t->order_id)) {
                DB::table('picking_tasks')->where('id', $t->id)->update($d + ['updated_at' => now()]);
            } elseif (! $t->route_key) {
                $libres[self::zona($t)][] = $t;
            }
        }
        $local = DB::table('establishments')->where('id', $w->establishment_id)->first(['lat', 'lng']);
        foreach ($libres as $codigo => $ts) {
            // Con un código de ruta en la ola, todos sus pedidos van a esa ruta.
            $codigo = $w->route_code ?: $codigo;
            $clave = self::clave($ts[0], $codigo);
            $seq = (int) DB::table('picking_tasks')->where('route_key', $clave)->where('status', '<>', 'CANCELLED')->max('stop_seq');
            $actual = ['lat' => $local->lat ?? null, 'lng' => $local->lng ?? null];
            while ($ts) {
                usort($ts, fn ($a, $b) => self::km($actual, $a) <=> self::km($actual, $b));
                $t = array_shift($ts);
                $seq++;
                DB::table('picking_tasks')->where('id', $t->id)->update([
                    'route_id' => null, 'route_code' => mb_substr($codigo, 0, 40), 'stop_seq' => $seq, 'route_key' => $clave, 'updated_at' => now(),
                ]);
                if ($t->lat !== null) {
                    $actual = ['lat' => $t->lat, 'lng' => $t->lng];
                }
            }
        }
    }

    /** Distancia aproximada en km (sin coordenadas, al final). */
    private static function km(array $a, object $b): float
    {
        if ($a['lat'] === null || $b->lat === null) {
            return 9999;
        }
        $x = ((float) $b->lng - (float) $a['lng']) * cos(deg2rad(((float) $a['lat'] + (float) $b->lat) / 2));
        $y = (float) $b->lat - (float) $a['lat'];

        return sqrt($x * $x + $y * $y) * 111.32;
    }
}
