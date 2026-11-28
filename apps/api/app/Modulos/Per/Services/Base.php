<?php

namespace App\Modulos\Per\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Lo común de PER: nombres, parámetros, fechas en Lima, quién ve remuneraciones (RN-PER-19) y numeración. */
final class Base
{
    public const AREAS = ['PRODUCTION' => 'Producción', 'QUALITY' => 'Calidad', 'WAREHOUSE' => 'Almacén y preparación', 'DELIVERY' => 'Reparto', 'SALES' => 'Ventas',
        'MARKETING' => 'Marketing', 'ADMIN' => 'Administración', 'FINANCE' => 'Finanzas', 'HR' => 'RR. HH.', 'OTHER' => 'Otro'];

    public const FORMAS = ['MONTHLY' => 'Sueldo mensual', 'DAILY' => 'Jornal diario', 'HOURLY' => 'Tarifa por hora'];

    public const FUENTES = ['AYNI_HR' => 'Ayni HR (API)', 'ACCOUNTANT_FILE' => 'Archivo del contador', 'NONE' => 'Sin planilla (externo)'];

    public const MARCAS = ['IN' => 'Entrada', 'BREAK_OUT' => 'Salida a refrigerio', 'BREAK_IN' => 'Regreso de refrigerio', 'OUT' => 'Salida'];

    public const PERMISOS = ['VACATION' => 'Vacaciones', 'PERMISSION' => 'Permiso personal', 'MEDICAL' => 'Descanso médico'];

    public const ORIGENES = ['CRM_CONTROL_ALERT' => 'Alerta de control CRM', 'TEL_CALL' => 'Llamada (TEL)', 'FLO_ALERT' => 'Alerta de flota', 'FLO_FINE' => 'Multa de tránsito',
        'ATTENDANCE' => 'Asistencia', 'OTHER' => 'Otro'];

    public const ACCIONES = ['OBSERVATION' => 'Observación', 'VERBAL_WARNING' => 'Llamada de atención verbal', 'WRITTEN_WARNING' => 'Llamada de atención escrita',
        'TRAINING' => 'Capacitación', 'NO_ACTION' => 'Sin acción'];

    public const CONCEPTOS = ['COMMISSION' => 'Comisiones', 'DELIVERY_BONUS' => 'Bono por entrega', 'WAGE' => 'Jornales', 'BONUS' => 'Bono',
        'ADVANCE_DEDUCTION' => 'Descuento de adelanto', 'FINE_DEDUCTION' => 'Descuento de multa', 'OTHER_DEDUCTION' => 'Otro descuento'];

    public const DESCUENTOS = ['ADVANCE_DEDUCTION', 'FINE_DEDUCTION', 'OTHER_DEDUCTION'];

    /** Feriados nacionales del Perú (2026-2027). Los días de oficina en feriado no cuentan como falta. */
    public const FERIADOS = ['2026-01-01', '2026-04-02', '2026-04-03', '2026-05-01', '2026-06-07', '2026-06-29', '2026-07-23', '2026-07-28', '2026-07-29', '2026-08-06',
        '2026-08-30', '2026-10-08', '2026-11-01', '2026-12-08', '2026-12-09', '2026-12-25', '2027-01-01', '2027-03-25', '2027-03-26', '2027-05-01'];

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function ahora(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima');
    }

    public static function feriado(string $d): bool
    {
        return in_array($d, self::FERIADOS, true);
    }

    /** Primer día del mes de una fecha («2026-10-17» → «2026-10-01»). */
    public static function mes(?string $d = null): string
    {
        return substr($d ?? self::hoy(), 0, 7).'-01';
    }

    public static function finDeMes(string $mes): string
    {
        return CarbonImmutable::parse($mes)->endOfMonth()->toDateString();
    }

    public static function sumarMeses(string $mes, int $n): string
    {
        return CarbonImmutable::parse($mes)->startOfMonth()->addMonthsNoOverflow($n)->toDateString();
    }

    public static function mesValido(?string $m): string
    {
        if (! $m) {
            return self::mes();
        }
        if (! preg_match('/^\d{4}-\d{2}(-\d{2})?$/', $m)) {
            RuleError::fail('RN-PER-15', 'El mes no es válido.');
        }

        return substr($m, 0, 7).'-01';
    }

    public static function nombreMes(string $mes): string
    {
        $n = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

        return $n[(int) substr($mes, 5, 2) - 1].' de '.substr($mes, 0, 4);
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

    public static function sino(string $clave, bool $defecto): bool
    {
        $v = Params::get($clave);

        return $v === null || $v === '' ? $defecto : in_array(strtolower(trim((string) $v, '" ')), ['true', '1', 'si', 'sí', 'yes'], true);
    }

    public static function texto(string $clave, string $defecto): string
    {
        $v = Params::get($clave);

        return $v === null || $v === '' ? $defecto : trim((string) $v, '" ');
    }

    public static function soles(float $n): string
    {
        return 'S/ '.number_format($n, 2, '.', ',');
    }

    public static function fecha(?string $d): string
    {
        return $d ? CarbonImmutable::parse(substr($d, 0, 10))->format('d/m/Y') : '—';
    }

    public static function hora(?string $t): string
    {
        return $t ? CarbonImmutable::parse($t)->setTimezone('America/Lima')->format('H:i') : '—';
    }

    /** Hora local de Lima «HH:MM» → minutos del día. */
    public static function minutos(string $hhmm): int
    {
        [$h, $m] = array_map('intval', explode(':', substr($hhmm, 0, 5)));

        return $h * 60 + $m;
    }

    /** Distancia en metros entre dos puntos (haversine). */
    public static function metros(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return 6371000.0 * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /** RN-PER-19: remuneraciones y datos personales solo para RR. HH., gerencia y administración. */
    public static function veSueldos(User $u): bool
    {
        return Access::can($u, 'per.employee.view_salary');
    }

    public static function gestiona(User $u): bool
    {
        return Access::can($u, 'per.employee.manage');
    }

    /** Trabajador (employees.id) del usuario. */
    public static function yo(User $u): ?string
    {
        return $u->employee_id ?: null;
    }

    public static function empleadoDe(?string $userId): ?string
    {
        return $userId ? DB::table('users')->where('id', $userId)->value('employee_id') : null;
    }

    public static function usuarioDe(?string $empleadoId): ?object
    {
        return $empleadoId ? DB::table('users')->where('employee_id', $empleadoId)->where('status', 'ACTIVE')->orderBy('created_at')->first(['id', 'name', 'email', 'role']) : null;
    }

    public static function nombre(?string $empleadoId): ?string
    {
        return $empleadoId ? DB::table('employees')->where('id', $empleadoId)->value('full_name') : null;
    }

    public static function trabajador(?string $id): object
    {
        $e = $id ? DB::table('employees')->where('id', $id)->first() : null;
        if (! $e) {
            abort(404, 'No se encontró el trabajador.');
        }

        return $e;
    }

    /**
     * ¿Puede ver la ficha de ese trabajador? RR. HH., gerencia y administración ven todo; el supervisor ve a su equipo;
     * cada uno se ve a sí mismo (RN-PER-19). Las remuneraciones las decide veSueldos().
     */
    public static function puedeVer(User $u, string $empleadoId): bool
    {
        if (self::veSueldos($u) || self::gestiona($u) || Access::module($u, 'PER', 'E') || $empleadoId === self::yo($u)) {
            return true;
        }
        $yo = self::yo($u);

        return $yo !== null && Personal::supervisorDe($empleadoId) === $yo;
    }

    /** Trabajadores que el usuario puede ver en las listas (null = todos). */
    public static function visibles(User $u): ?array
    {
        if (self::veSueldos($u) || self::gestiona($u) || Access::module($u, 'PER', 'E') || Access::can($u, 'per.attendance.approve')
            || Access::can($u, 'per.payroll.exchange') || Access::can($u, 'per.supervision.manage')) {
            return null;
        }
        $yo = self::yo($u);
        if (! $yo) {
            return [];
        }
        $hoy = self::hoy();
        $equipo = DB::table('employee_assignments')->where('supervisor_employee_id', $yo)->where('valid_from', '<=', $hoy)
            ->where(fn ($w) => $w->whereNull('valid_to')->orWhere('valid_to', '>=', $hoy))->pluck('employee_id')->all();

        return array_values(array_unique([$yo, ...$equipo]));
    }

    /** Monto visible según RN-PER-19 (null si está reservado). */
    public static function monto(User $u, ?string $empleadoId, mixed $valor): ?float
    {
        if ($valor === null) {
            return null;
        }

        return self::veSueldos($u) || ($empleadoId && $empleadoId === self::yo($u)) ? self::r($valor) : null;
    }

    /** Siguiente correlativo «AD-00001» por empresa, con candado de la transacción. */
    public static function numero(string $tabla, string $prefijo, int $digitos = 5): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["per:{$tabla}:".DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $n = strlen($prefijo) + 1;
        $max = DB::table($tabla)->where('number', 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, {$n}), '\\D', '', 'g'), '')::int) AS n")->value('n');

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
            'module' => 'PER', 'type' => 'SYSTEM', 'at' => now(), 'in_app' => true,
        ]);
    }

    public static function obligatorio(mixed $v, string $regla, string $mensaje, int $min = 1, int $max = 500): string
    {
        $t = trim((string) $v);
        if (mb_strlen($t) < $min) {
            RuleError::fail($regla, $mensaje);
        }

        return mb_substr($t, 0, $max);
    }
}
