<?php

namespace App\Modulos\Prs\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Lo común de PRS: nombres, parámetros (RN-PRS-07, 08 y 10), fechas del año presupuestal, semáforo, responsables y avisos. */
final class Base
{
    public const TIPOS = ['INCOME' => 'Ingreso', 'COST_OF_SALES' => 'Costo de ventas', 'EXPENSE' => 'Gasto'];

    public const COMPORTAMIENTOS = ['VARIABLE' => 'Variable', 'FIXED' => 'Fijo'];

    public const FUENTES = [
        'SALES' => 'Ventas aceptadas − notas de crédito (FAC)', 'COST_OF_SALES' => 'Costo de ventas de los comprobantes (FAC)',
        'EXPENSE_CATEGORY' => 'Categoría de gasto (GAS)', 'PAYROLL' => 'Personal (PER)', 'ACCOUNT' => 'Cuenta contable (CNT)',
    ];

    public const PERSONAL = ['PAYROLL' => 'Planilla y cargas', 'COMMISSION' => 'Comisiones de vendedoras', 'BONUS' => 'Bonos por entrega'];

    public const ESTADOS = ['DRAFT' => 'Borrador', 'SUBMITTED' => 'Por aprobar', 'APPROVED' => 'Aprobada · vigente', 'REJECTED' => 'Rechazada', 'SUPERSEDED' => 'Reemplazada'];

    public const ESTADOS_ALERTA = ['OPEN' => 'Abierta', 'ACK' => 'En seguimiento', 'CLOSED' => 'Cerrada', 'RESOLVED' => 'Resuelta'];

    public const ORIGENES = ['FAC' => 'Ventas (FAC)', 'GAS' => 'Gastos (GAS)', 'PER' => 'Personal (PER)', 'PER_EST' => 'Planilla estimada', 'CNT' => 'Contabilidad (CNT)', 'SNAPSHOT' => 'Real congelado al cierre'];

    /** RN-PRS-10 y RN-PRS-12: rol responsable de cada área de centro de costo. */
    public const ROL_DEL_AREA = [
        'PRODUCTION' => 'JEFE_PRODUCCION', 'QUALITY' => 'CALIDAD', 'WAREHOUSE' => 'JEFE_PRODUCCION', 'DELIVERY' => 'COORDINADOR_DELIVERY',
        'SALES' => 'SUPERVISORA_VENTAS', 'MARKETING' => 'MARKETING', 'ADMIN' => 'ADMINISTRACION', 'FINANCE' => 'CONTADORA', 'HR' => 'RRHH',
    ];

    public const EPS = 0.005;

    private static array $responsables = [];

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function ahora(): string
    {
        return CarbonImmutable::now('America/Lima')->format('Y-m-d\TH:i');
    }

    public static function r(mixed $n, int $d = 2): float
    {
        return round((float) $n, $d);
    }

    public static function soles(float $n, int $d = 0): string
    {
        return 'S/ '.number_format($n, $d, '.', ' ');
    }

    public static function pct(float $a, float $b): ?float
    {
        return abs($b) > self::EPS ? round($a / $b * 100, 1) : null;
    }

    public static function ambar(): float
    {
        return (float) (Params::get('prs_amber_pct') ?? 5);
    }

    public static function umbralAlerta(): float
    {
        return (float) (Params::get('prs_alert_pct') ?? 10);
    }

    public static function metodo(): string
    {
        return trim((string) (Params::get('prs_forecast_method') ?? 'LINEAR_DAYS'), "\" \t");
    }

    public static function mesInicio(): int
    {
        return max(1, min(12, (int) (Params::get('prs_fiscal_year_start_month') ?? 1)));
    }

    /** Los 12 meses (Y-m-01) del año presupuestal. */
    public static function meses(int $anio): array
    {
        $ini = CarbonImmutable::create($anio, self::mesInicio(), 1);

        return array_map(fn ($i) => $ini->addMonths($i)->toDateString(), range(0, 11));
    }

    public static function mes(string $fecha): string
    {
        return substr($fecha, 0, 7).'-01';
    }

    public static function finDeMes(string $mes): string
    {
        return CarbonImmutable::parse(self::mes($mes))->endOfMonth()->toDateString();
    }

    public static function diasDelMes(string $mes): int
    {
        return CarbonImmutable::parse(self::mes($mes))->daysInMonth;
    }

    /** Días transcurridos del mes al corte (0 si el mes aún no empieza; todos si ya terminó). */
    public static function transcurridos(string $mes, string $al): int
    {
        $m = self::mes($mes);
        if ($al < $m) {
            return 0;
        }

        return $al >= self::finDeMes($m) ? self::diasDelMes($m) : (int) substr($al, 8, 2);
    }

    public static function nombreMes(string $mes): string
    {
        $n = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

        return $n[(int) substr($mes, 5, 2) - 1].' de '.substr($mes, 0, 4);
    }

    /** RN-PRS-07: semáforo de un %. */
    public static function semaforo(?float $pct, string $tipo): ?string
    {
        if ($pct === null) {
            return null;
        }
        $a = self::ambar();
        if ($tipo === 'INCOME') {
            return $pct >= 100 ? 'GREEN' : ($pct >= 100 - $a ? 'AMBER' : 'RED');
        }

        return $pct <= 100 ? 'GREEN' : ($pct <= 100 + $a ? 'AMBER' : 'RED');
    }

    /** Semáforo de un valor frente a su presupuesto (sin presupuesto: un gasto con real es rojo). */
    public static function semaforoDe(float $presupuesto, float $valor, string $tipo): ?string
    {
        if (abs($presupuesto) <= self::EPS) {
            return $tipo === 'INCOME' ? 'GREEN' : ($valor > self::EPS ? 'RED' : 'GREEN');
        }

        return self::semaforo(self::pct($valor, $presupuesto), $tipo);
    }

    /** RN-PRS-08: real a la fecha / días transcurridos × días del mes; los fijos usan su presupuesto (o el real si ya lo pasó). */
    public static function proyeccion(float $real, float $presupuesto, int $transcurridos, int $dias, bool $fijo): float
    {
        if ($fijo) {
            return self::r(max($presupuesto, $real));
        }
        if ($transcurridos <= 0) {
            return self::r($presupuesto);
        }
        if (self::metodo() !== 'LINEAR_DAYS') {
            return self::r(max($real, $presupuesto));
        }

        return self::r($real / $transcurridos * $dias);
    }

    public static function veTodo(User $u): bool
    {
        return Access::can($u, 'prs.report.view_all');
    }

    /** Usuario responsable de un centro de costo: la primera persona activa con el rol de su área. */
    public static function responsable(?string $centroId): ?string
    {
        if (! $centroId) {
            return null;
        }
        $cache = &self::$responsables;
        $clave = (TenantContext::id() ?? '').'|'.$centroId;
        if (array_key_exists($clave, $cache)) {
            return $cache[$clave];
        }
        $area = DB::table('cost_centers')->where('id', $centroId)->value('area');
        $rol = self::ROL_DEL_AREA[$area] ?? null;

        return $cache[$clave] = $rol ? DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('r.code', $rol)->where('u.status', 'ACTIVE')->orderBy('u.name')->value('u.id') : null;
    }

    /**
     * RN-PRS-12: sin prs.report.view_all solo se ven las líneas de los centros de costo de los que la persona es responsable
     * (por su rol) y de sus marcas de alcance. Devuelve null si ve todo, o la lista de centros y marcas que puede ver.
     */
    public static function alcance(User $u): ?array
    {
        $a = Access::for($u);
        if (self::veTodo($u) && ! $a['brands']) {
            return null;
        }
        $centros = null;
        if (! self::veTodo($u)) {
            $areas = array_keys(array_intersect(self::ROL_DEL_AREA, $a['roles']));
            $centros = $areas ? DB::table('cost_centers')->whereIn('area', $areas)->pluck('id')->all() : [];
        }

        return ['centros' => $centros, 'marcas' => $a['brands']];
    }

    /** Si una fila (línea, real o alerta) entra en el alcance. */
    public static function visible(?array $alcance, array|object $fila): bool
    {
        if ($alcance === null) {
            return true;
        }
        $f = (array) $fila;
        if ($alcance['centros'] !== null && (! ($f['cost_center_id'] ?? null) || ! in_array($f['cost_center_id'], $alcance['centros'], true))) {
            return false;
        }

        return ! $alcance['marcas'] || ! ($f['brand_id'] ?? null) || in_array($f['brand_id'], $alcance['marcas'], true);
    }

    /** Línea del historial de la versión (jsonb). */
    public static function historia(?string $actual, ?User $u, string $accion, ?string $nota = null, ?string $quien = null): string
    {
        $h = json_decode($actual ?? '[]', true) ?: [];
        $h[] = array_filter(['at' => self::ahora(), 'user' => $quien ?? $u?->name, 'action' => $accion, 'note' => $nota]);

        return json_encode(array_slice($h, -80), JSON_UNESCAPED_UNICODE);
    }

    /** Aviso en la campana: a una persona (user_id) o a un rol (role). */
    public static function avisar(array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'info', ?string $tipo = 'APPROVALS'): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id])),
            'tone' => $tono, 'severity' => match ($tono) {
                'bad' => 'CRITICAL', 'warn' => 'WARNING', 'ok' => 'OK', default => 'INFO'
            },
            'module' => 'PRS', 'type' => $tipo, 'at' => now(), 'in_app' => true,
        ]);
    }

    /** Empresa del presupuesto por defecto: la que ya tiene presupuestos o centros de costo; si no, la primera. */
    public static function empresaPorDefecto(): ?string
    {
        return DB::table('budgets')->orderByDesc('year')->value('company_id')
            ?? DB::table('cost_centers')->whereNotNull('company_id')->groupBy('company_id')->orderByRaw('count(*) DESC')->value('company_id')
            ?? DB::table('companies')->orderBy('created_at')->orderBy('id')->value('id');
    }
}
