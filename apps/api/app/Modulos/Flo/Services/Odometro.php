<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** RN-FLO-04: el odómetro nunca baja respecto de su última lectura (jornada, carga o mantenimiento), salvo cambio de tablero. */
final class Odometro
{
    /** Última lectura hasta ese momento (la de un cambio de tablero reemplaza la base). */
    public static function ultima(string $vehiculoId, ?CarbonImmutable $hasta = null): ?object
    {
        return DB::table('vehicle_odometer_readings')->where('vehicle_id', $vehiculoId)
            ->when($hasta, fn ($q) => $q->where('read_at', '<=', $hasta))
            ->orderByDesc('read_at')->orderByRaw("source = 'RESET' DESC")->orderByDesc('created_at')->first();
    }

    /** Primera lectura posterior a ese momento (sin contar cambios de tablero). */
    public static function siguiente(string $vehiculoId, CarbonImmutable $despues): ?object
    {
        $reset = DB::table('vehicle_odometer_readings')->where('vehicle_id', $vehiculoId)->where('source', 'RESET')->where('read_at', '>', $despues)->min('read_at');

        return DB::table('vehicle_odometer_readings')->where('vehicle_id', $vehiculoId)->where('read_at', '>', $despues)->where('source', '<>', 'RESET')
            ->when($reset, fn ($q) => $q->where('read_at', '<', $reset))->orderBy('read_at')->first();
    }

    /** Odómetro actual: la última lectura, o el del vehículo si FLO aún no tiene ninguna. */
    public static function actual(object $v): float
    {
        // DEL también mueve vehicles.odometer_km al volver de una ruta: vale la mayor de las dos.
        $l = self::ultima($v->id);

        return max($l ? (float) $l->km : 0.0, (float) $v->odometer_km);
    }

    public static function exigir(object $v, mixed $km, CarbonImmutable $en): float
    {
        if ($km === null || $km === '' || ! is_numeric($km) || (float) $km < 0) {
            RuleError::fail('RN-FLO-04', 'Indica la lectura del odómetro en km.');
        }
        $k = round((float) $km, 1);
        $ultima = self::ultima($v->id, $en);
        $base = $ultima ? (float) $ultima->km : (DB::table('vehicle_odometer_readings')->where('vehicle_id', $v->id)->exists() ? null : (float) $v->odometer_km);
        if ($base !== null && $k < $base - 0.05) {
            $de = $ultima ? (Base::LECTURAS[$ultima->source] ?? $ultima->source).' del '.CarbonImmutable::parse($ultima->read_at)->setTimezone('America/Lima')->format('d/m/Y H:i') : 'registrada en el vehículo';
            RuleError::fail('RN-FLO-04', "El odómetro de {$v->plate} no puede bajar: la última lectura es ".Base::km($base)." km ({$de}) y registras ".Base::km($k).' km. Si se cambió el tablero, regístralo en la ficha del vehículo con motivo.');
        }
        $sig = self::siguiente($v->id, $en);
        if ($sig && $k > (float) $sig->km + 0.05) {
            RuleError::fail('RN-FLO-04', 'Hay una lectura posterior de '.Base::km((float) $sig->km).' km ('.CarbonImmutable::parse($sig->read_at)->setTimezone('America/Lima')->format('d/m/Y H:i').'): una lectura anterior no puede marcar más.');
        }

        return $k;
    }

    /** Guarda la lectura y, si es la más reciente, actualiza el odómetro del vehículo (lo usa DEL). */
    public static function registrar(object $v, float $km, CarbonImmutable $en, string $origen, ?string $origenId, ?User $u, array $extra = []): string
    {
        $id = DB::table('vehicle_odometer_readings')->insertGetId($extra + [
            'vehicle_id' => $v->id, 'read_at' => $en, 'km' => round($km, 1), 'source' => $origen, 'source_id' => $origenId, 'recorded_by' => $u?->id,
        ], 'id');
        $ultima = self::ultima($v->id);
        if ($ultima && $ultima->id === $id) {
            DB::table('vehicles')->where('id', $v->id)->update(['odometer_km' => round($km, 1), 'updated_at' => now()]);
        }

        return $id;
    }

    /** Cambio de tablero (flo.odometer.reset): la nueva lectura reemplaza la base, con motivo. */
    public static function cambioTablero(string $vehiculoId, array $d, User $u): object
    {
        if (! Access::can($u, 'flo.odometer.reset')) {
            abort(403, 'Registrar un cambio de tablero es de gerencia.');
        }

        return DB::transaction(function () use ($vehiculoId, $d, $u) {
            $v = Base::vehiculo($vehiculoId, $u, 'RN-FLO-04');
            DB::table('vehicles')->where('id', $v->id)->lockForUpdate()->first();
            $motivo = Base::texto($d['reason'] ?? null, 'RN-FLO-04', 'El cambio de tablero exige un motivo de al menos 10 caracteres.', 10, 500);
            if (! isset($d['km']) || ! is_numeric($d['km']) || (float) $d['km'] < 0) {
                RuleError::fail('RN-FLO-04', 'Indica la lectura del tablero nuevo.');
            }
            if (Jornadas::abiertaDe($v->id)) {
                RuleError::fail('RN-FLO-04', "{$v->plate} tiene una jornada abierta: registra el cambio de tablero cuando la cierre.");
            }
            $antes = self::actual($v);
            self::registrar($v, (float) $d['km'], Base::ahora(), 'RESET', null, $u, ['reason' => $motivo, 'previous_km' => $antes]);

            return DB::table('vehicles')->where('id', $v->id)->first();
        });
    }

    /** Historial de lecturas del vehículo (FLO-04). */
    public static function historial(string $vehiculoId, int $n = 30): array
    {
        return DB::table('vehicle_odometer_readings as r')->leftJoin('users as u', 'u.id', '=', 'r.recorded_by')->where('r.vehicle_id', $vehiculoId)
            ->orderByDesc('r.read_at')->limit($n)->get(['r.id', 'r.read_at', 'r.km', 'r.source', 'r.reason', 'r.previous_km', 'u.name as registro'])
            ->map(fn ($r) => array_replace((array) $r, ['origen' => Base::LECTURAS[$r->source] ?? $r->source, 'km' => (float) $r->km]))->all();
    }
}
