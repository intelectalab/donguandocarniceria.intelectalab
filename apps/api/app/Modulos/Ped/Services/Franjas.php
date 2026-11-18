<?php

namespace App\Modulos\Ped\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Franjas de entrega por local y zona, con cupo y hora de corte (RN-PED-06, PED-06).
 * D-PED-02: 3 franjas por día (9–13, 13–17, 17–20) con 40 pedidos cada una.
 *   Franjas::validar($slotId, '2026-11-20', $usuario, $pedidoId);   // falla si está llena o pasó el corte
 *   Franjas::disponibles($localId, '2026-11-20', $zonaId);         // para elegir en el pedido
 */
final class Franjas
{
    /** Pedidos que ocupan la franja ese día (sin contar uno). */
    public static function ocupacion(string $slotId, string $fecha, ?string $menos = null): int
    {
        return DB::table('sales_orders')->where('slot_id', $slotId)->where('delivery_date', $fecha)
            ->whereIn('status', Pedidos::OCUPAN_FRANJA)->when($menos, fn ($q) => $q->where('id', '<>', $menos))->count();
    }

    /** RN-PED-06: no se confirma en una franja llena ni pasada su hora de corte, salvo ped.slot.override. */
    public static function validar(string $slotId, ?string $fecha, User $u, ?string $pedidoId = null): void
    {
        $s = DB::table('order_time_slots')->where('id', $slotId)->first();
        if (! $s || $s->status !== 'ACTIVE') {
            RuleError::fail('RN-PED-06', 'La franja ya no está activa: elige otra.');
        }
        if (! $fecha) {
            RuleError::fail('RN-PED-01', 'Elige la fecha de entrega.');
        }
        $dia = CarbonImmutable::parse($fecha, 'America/Lima');
        $hoy = CarbonImmutable::now('America/Lima')->startOfDay();
        if ($dia->lt($hoy)) {
            RuleError::fail('RN-PED-06', 'La fecha de entrega ya pasó: elige hoy o un día siguiente.');
        }
        if (! in_array($dia->dayOfWeek, array_map('intval', self::dias($s->weekdays)), true)) {
            RuleError::fail('RN-PED-06', "La franja {$s->name} no atiende ese día de la semana.");
        }
        $override = Access::can($u, 'ped.slot.override');
        // Dos pedidos a la vez no toman el último cupo.
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["ped:franja:{$slotId}:{$fecha}"]);
        if ($dia->equalTo($hoy) && CarbonImmutable::now('America/Lima')->format('H:i:s') >= $s->cutoff && ! $override) {
            RuleError::fail('RN-PED-06', 'Pasó la hora de corte de la franja '.self::texto($s).' ('.substr($s->cutoff, 0, 5).'): elige la siguiente franja o pide a la supervisora que lo autorice.');
        }
        $ocupados = self::ocupacion($slotId, $fecha, $pedidoId);
        if ($ocupados >= (int) $s->capacity && ! $override) {
            $local = DB::table('establishments')->where('id', $s->establishment_id)->value('name');
            RuleError::fail('RN-PED-06', 'La franja '.self::texto($s)." de {$local} está llena ({$ocupados} de ".(int) $s->capacity.'): elige otra franja.');
        }
    }

    /** Franjas activas del local para la fecha (y la zona, si tiene franjas propias), con su ocupación. */
    public static function disponibles(string $localId, string $fecha, ?string $zonaId = null): Collection
    {
        $dia = CarbonImmutable::parse($fecha, 'America/Lima');
        $hoy = CarbonImmutable::now('America/Lima');
        $todas = DB::table('order_time_slots')->where('establishment_id', $localId)->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->whereNull('zone_id')->when($zonaId, fn ($w) => $w->orWhere('zone_id', $zonaId)))
            ->orderBy('slot_from')->get()
            ->filter(fn ($s) => in_array($dia->dayOfWeek, array_map('intval', self::dias($s->weekdays)), true));

        return $todas->map(function ($s) use ($fecha, $dia, $hoy) {
            $n = self::ocupacion($s->id, $fecha);
            $corte = $dia->isSameDay($hoy) && $hoy->format('H:i:s') >= $s->cutoff;

            return ['id' => $s->id, 'name' => $s->name, 'slot_from' => substr($s->slot_from, 0, 5), 'slot_to' => substr($s->slot_to, 0, 5),
                'cutoff' => substr($s->cutoff, 0, 5), 'capacity' => (int) $s->capacity, 'ocupados' => $n, 'zone_id' => $s->zone_id,
                'llena' => $n >= (int) $s->capacity, 'paso_corte' => $corte || $dia->lt($hoy->startOfDay())];
        })->values();
    }

    /** PED-06: crear o editar una franja. */
    public static function guardar(?string $id, array $d): object
    {
        $desde = substr($d['slot_from'], 0, 5);
        $hasta = substr($d['slot_to'], 0, 5);
        $corte = substr($d['cutoff'], 0, 5);
        if ($hasta <= $desde) {
            RuleError::fail('RN-PED-06', 'La hora de fin debe ser mayor que la de inicio.');
        }
        if ($corte > $desde) {
            RuleError::fail('RN-PED-06', 'La hora de corte va antes del inicio de la franja.');
        }
        if ((int) $d['capacity'] < 1) {
            RuleError::fail('RN-PED-06', 'El cupo es de al menos 1 pedido.');
        }
        $dias = array_values(array_unique(array_map('intval', $d['weekdays'] ?? [])));
        if (! $dias) {
            RuleError::fail('RN-PED-06', 'Marca al menos un día de la semana.');
        }
        $repetida = DB::table('order_time_slots')->where('establishment_id', $d['establishment_id'])->where('slot_from', $desde)->where('status', 'ACTIVE')
            ->where(fn ($q) => empty($d['zone_id']) ? $q->whereNull('zone_id') : $q->where('zone_id', $d['zone_id']))
            ->when($id, fn ($q) => $q->where('id', '<>', $id))->exists();
        if ($repetida && ($d['status'] ?? 'ACTIVE') === 'ACTIVE') {
            RuleError::fail('RN-PED-06', "Ya hay una franja activa que empieza a las {$desde} en ese local y zona.");
        }
        $minutos = (strtotime($desde) - strtotime($corte)) / 60;
        $datos = [
            'establishment_id' => $d['establishment_id'], 'zone_id' => ($d['zone_id'] ?? null) ?: null,
            'name' => trim((string) ($d['name'] ?? '')) ?: "{$desde}–{$hasta}", 'slot_from' => $desde, 'slot_to' => $hasta, 'cutoff' => $corte,
            'capacity' => (int) $d['capacity'], 'weekdays' => json_encode($dias), 'status' => $d['status'] ?? 'ACTIVE', 'cutoff_minutes' => $minutos,
            'updated_at' => now(),
        ];
        if ($id) {
            DB::table('order_time_slots')->where('id', $id)->update($datos);
        } else {
            $id = DB::table('order_time_slots')->insertGetId($datos + ['created_at' => now()], 'id');
        }

        return DB::table('order_time_slots')->where('id', $id)->first();
    }

    public static function texto(object $s): string
    {
        return substr($s->slot_from, 0, 5).'–'.substr($s->slot_to, 0, 5);
    }

    public static function dias(mixed $json): array
    {
        $v = is_string($json) ? json_decode($json, true) : $json;

        return is_array($v) ? $v : [];
    }
}
