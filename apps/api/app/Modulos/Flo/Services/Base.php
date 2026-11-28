<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/** Lo común de FLO: nombres, parámetros, fechas en Lima, alcance por local, numeración, avisos y ficha de cada vehículo. */
final class Base
{
    public const TIPOS = ['MOTO' => 'Moto', 'CAR' => 'Auto', 'VAN' => 'Furgoneta', 'TRUCK' => 'Camión', 'BICYCLE' => 'Bicicleta'];

    public const MODALIDAD = ['OWN' => 'Propio', 'RENTED' => 'Alquilado'];

    /** Rendimiento y tanque por tipo cuando el vehículo aún no tiene ficha técnica. */
    public const KMPG = ['MOTO' => 70, 'VAN' => 30, 'CAR' => 38, 'TRUCK' => 16, 'BICYCLE' => 1];

    public const TANQUE = ['MOTO' => 3, 'VAN' => 18, 'CAR' => 11.5, 'TRUCK' => 40, 'BICYCLE' => 1];

    /** [nombre, dueño (VEHICLE o EMPLOYEE), exige vencimiento]. */
    public const DOCUMENTOS = [
        'SOAT' => ['SOAT', 'VEHICLE', true], 'TECH_INSPECTION' => ['Revisión técnica', 'VEHICLE', true], 'PROPERTY_CARD' => ['Tarjeta de propiedad', 'VEHICLE', false],
        'RENTAL_CONTRACT' => ['Contrato de alquiler', 'VEHICLE', true], 'INSURANCE_POLICY' => ['Póliza de seguro vehicular', 'VEHICLE', false],
        'DRIVER_LICENSE' => ['Licencia de conducir', 'EMPLOYEE', true],
    ];

    public const ALERTAS = ['FUEL_EFFICIENCY' => 'Rendimiento', 'MAINTENANCE' => 'Mantenimiento', 'DOCUMENT' => 'Documento', 'TEMPERATURE' => 'Temperatura',
        'GPS_SILENT' => 'GPS silencioso', 'ODOMETER' => 'Odómetro y km', 'SPEED' => 'Velocidad'];

    public const COSTOS = ['RENT' => 'Alquiler', 'TOLL' => 'Peaje', 'PARKING' => 'Cochera y estacionamiento', 'INSURANCE' => 'Seguro', 'TAX' => 'Impuesto vehicular',
        'WASH' => 'Lavado y desinfección', 'TIRES' => 'Llantas', 'OTHER' => 'Otro'];

    public const ENTIDADES = ['SAT' => 'SAT Lima', 'PNP' => 'Policía Nacional (PNP)', 'ATU' => 'ATU', 'MUNI' => 'Municipalidad distrital', 'SUTRAN' => 'SUTRAN'];

    public const LECTURAS = ['INITIAL' => 'Lectura inicial', 'TRIP_START' => 'Inicio de jornada', 'TRIP_END' => 'Cierre de jornada', 'FUEL' => 'Carga de combustible',
        'MAINTENANCE' => 'Mantenimiento', 'RESET' => 'Cambio de tablero', 'MANUAL' => 'Lectura manual'];

    /** Checklist de la jornada (FLO-15): la caja térmica solo en motos y refrigerados. */
    public const CHECKLIST = ['lights' => 'Luces delanteras, de freno y direccionales', 'tires' => 'Llantas (presión y desgaste)', 'brakes' => 'Frenos',
        'thermal_box' => 'Caja térmica limpia y cerrada', 'documents' => 'SOAT y tarjeta de propiedad a bordo'];

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function ahora(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima');
    }

    /** Fecha u hora recibida (ISO o «2026-11-26 10:30») en hora de Lima. */
    public static function momento(mixed $v, ?string $regla = null, string $falta = 'Indica la fecha y hora.'): CarbonImmutable
    {
        if ($v === null || $v === '') {
            if ($regla) {
                RuleError::fail($regla, $falta);
            }

            return self::ahora();
        }
        try {
            return CarbonImmutable::parse((string) $v, 'America/Lima')->setTimezone('America/Lima');
        } catch (\Throwable) {
            RuleError::fail($regla ?? 'RN-FLO-01', 'La fecha y hora no es válida.');
        }
    }

    public static function r(mixed $n, int $d = 2): float
    {
        return round((float) $n, $d);
    }

    public static function num(string $clave, float $defecto): float
    {
        $v = Params::get($clave);

        return $v === null || $v === '' || ! is_numeric($v) ? $defecto : (float) $v;
    }

    /** RN-FLO-13: días de aviso de vencimiento, de mayor a menor (30, 15 y 7). */
    public static function diasAviso(): array
    {
        $v = Params::get('flo_doc_alert_days');
        $l = is_string($v) ? json_decode($v, true) : $v;
        $l = is_array($l) && $l ? array_map('intval', $l) : [30, 15, 7];
        rsort($l);

        return array_values($l);
    }

    public static function fecha(?string $d): string
    {
        return $d ? CarbonImmutable::parse(substr($d, 0, 10))->format('d/m/Y') : '—';
    }

    public static function hora(CarbonImmutable|string|null $t): string
    {
        if (! $t) {
            return '—';
        }

        return ($t instanceof CarbonImmutable ? $t : CarbonImmutable::parse($t))->setTimezone('America/Lima')->format('H:i');
    }

    public static function km(float $n, int $d = 0): string
    {
        return number_format($n, $d, ',', '.');
    }

    public static function soles(float $n): string
    {
        return 'S/ '.number_format($n, 2, '.', ',');
    }

    /** Distancia en km entre dos puntos (haversine). */
    public static function distancia(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return 6371.0 * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /** Locales del usuario (vacío = todos). */
    public static function locales(User $u): array
    {
        return Access::for($u)['establishments'];
    }

    public static function alcance(Builder $q, User $u, string $col = 'v.establishment_id'): Builder
    {
        $l = self::locales($u);

        return $q->when($l, fn ($w) => $w->whereIn($col, $l));
    }

    /** ¿Está FLO encendido para la empresa? (lo usa DEL antes de llamar a FLO). */
    public static function activo(?User $u): bool
    {
        return $u !== null && in_array('FLO', Access::for($u)['enabled_modules'], true);
    }

    /** D-FLO-04: solo se rastrean los vehículos propios y alquilados de la empresa (los de terceros no usan la app). */
    public static function flota(?User $u = null): Builder
    {
        $q = DB::table('vehicles as v')->whereIn('v.ownership', ['OWN', 'RENTED'])->where('v.vehicle_type', '<>', 'BICYCLE');

        return $u ? self::alcance($q, $u) : $q;
    }

    /** Vehículo de la flota visible para el usuario, o 404. */
    public static function vehiculo(?string $id, ?User $u = null, string $regla = 'RN-FLO-11'): object
    {
        if (! $id) {
            RuleError::fail($regla, 'Elige el vehículo.');
        }
        $v = self::flota($u)->where('v.id', $id)->first(['v.*']);
        if (! $v) {
            abort(404, 'No se encontró el vehículo.');
        }

        return $v;
    }

    /** Ficha técnica; si aún no tiene, los valores por tipo (sin guardar). */
    public static function perfil(object $v): object
    {
        $p = DB::table('vehicle_profiles')->where('vehicle_id', $v->id)->first();
        if ($p) {
            $p->virtual = false;

            return $p;
        }

        return (object) [
            'id' => null, 'vehicle_id' => $v->id, 'internal_code' => $v->plate, 'make' => null, 'model' => null, 'year' => null, 'color' => null,
            'tank_capacity_gal' => self::TANQUE[$v->vehicle_type] ?? 10, 'expected_km_per_gal' => self::KMPG[$v->vehicle_type] ?? 40,
            'temp_mode' => $v->refrigerated ? 'CHILLED' : null, 'temp_min_c' => $v->refrigerated ? 0 : null, 'temp_max_c' => $v->refrigerated ? 4 : null,
            'gps_source' => 'APP_ANDROID', 'gps_device_id' => null, 'temp_sensor_id' => null, 'purchase_date' => null, 'purchase_cost' => null,
            'residual_value' => null, 'useful_life_months' => null, 'op_status' => 'ACTIVE', 'notes' => null, 'virtual' => true,
        ];
    }

    /** «MOT-01 · MTA-123». */
    public static function etiqueta(object $v): string
    {
        $c = DB::table('vehicle_profiles')->where('vehicle_id', $v->id)->value('internal_code');

        return $c && $c !== $v->plate ? "{$c} · {$v->plate}" : $v->plate;
    }

    /** Rango de temperatura del vehículo (null si no es refrigerado). RN-FLO-14: por defecto 0 a 4 °C; congelado −18 °C o menos. */
    public static function rango(object $v, ?object $p = null): ?array
    {
        $p ??= self::perfil($v);
        if (! $v->refrigerated && $p->temp_min_c === null && $p->temp_max_c === null) {
            return null;
        }
        if ($p->temp_mode === 'FROZEN') {
            return ['min' => null, 'max' => $p->temp_max_c !== null ? (float) $p->temp_max_c : -18.0];
        }

        return ['min' => $p->temp_min_c !== null ? (float) $p->temp_min_c : 0.0, 'max' => $p->temp_max_c !== null ? (float) $p->temp_max_c : 4.0];
    }

    public static function empleadoDe(?string $userId): ?string
    {
        return $userId ? DB::table('users')->where('id', $userId)->value('employee_id') : null;
    }

    public static function nombre(?string $userId): ?string
    {
        return $userId ? DB::table('users')->where('id', $userId)->value('name') : null;
    }

    /** Siguiente correlativo «JR-000001» por empresa, con candado de la transacción. */
    public static function numero(string $tabla, string $prefijo, int $digitos = 5, string $col = 'number'): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["flo:{$tabla}:".DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $n = strlen($prefijo) + 1;
        $max = DB::table($tabla)->where($col, 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr({$col}, {$n}), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return $prefijo.str_pad((string) (((int) $max) + 1), $digitos, '0', STR_PAD_LEFT);
    }

    /** Aviso en el centro de notificaciones, a un rol o a una persona. */
    public static function avisar(array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'warn'): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id])),
            'tone' => $tono, 'severity' => match ($tono) {
                'bad' => 'CRITICAL', 'warn' => 'WARNING', 'ok' => 'OK', default => 'INFO'
            },
            'module' => 'FLO', 'type' => 'ORDERS', 'at' => now(), 'in_app' => true,
        ]);
    }

    /** Texto obligatorio con largo mínimo. */
    public static function texto(mixed $v, string $regla, string $mensaje, int $min = 1, int $max = 2000): string
    {
        $t = trim((string) $v);
        if (mb_strlen($t) < $min) {
            RuleError::fail($regla, $mensaje);
        }

        return mb_substr($t, 0, $max);
    }

    public static function decimal(mixed $v): ?float
    {
        return $v === null || $v === '' || ! is_numeric($v) ? null : (float) $v;
    }
}
