<?php

namespace App\Modulos\Per\Services;

use App\Models\User;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** PER-01 Puestos, PER-02 Ficha del trabajador (RN-PER-01) y PER-03 Condiciones de pago (RN-PER-02). */
final class Personal
{
    /* ---------------- Asignaciones vigentes ---------------- */

    public static function asignaciones(string $empleadoId, ?string $fecha = null): array
    {
        $f = $fecha ?? Base::hoy();

        return DB::table('employee_assignments')->where('employee_id', $empleadoId)->where('superseded', false)->where('valid_from', '<=', $f)
            ->where(fn ($w) => $w->whereNull('valid_to')->orWhere('valid_to', '>=', $f))->orderByDesc('is_primary')->orderByDesc('allocation_pct')->get()->all();
    }

    public static function principal(string $empleadoId, ?string $fecha = null): ?object
    {
        return self::asignaciones($empleadoId, $fecha)[0] ?? null;
    }

    public static function supervisorDe(string $empleadoId, ?string $fecha = null): ?string
    {
        return self::principal($empleadoId, $fecha)?->supervisor_employee_id;
    }

    /** Mapa empleado => [asignación principal + área del puesto] para una fecha (para listas grandes). */
    public static function mapa(?string $fecha = null): array
    {
        $f = $fecha ?? Base::hoy();
        $filas = DB::table('employee_assignments as a')->join('job_positions as p', 'p.id', '=', 'a.position_id')
            ->where('a.superseded', false)->where('a.valid_from', '<=', $f)->where(fn ($w) => $w->whereNull('a.valid_to')->orWhere('a.valid_to', '>=', $f))
            ->orderByDesc('a.is_primary')->orderByDesc('a.allocation_pct')
            ->get(['a.*', 'p.name as puesto', 'p.area', 'p.code as puesto_code']);
        $m = [];
        foreach ($filas as $a) {
            $m[$a->employee_id] ??= ['principal' => $a, 'todas' => []];
            $m[$a->employee_id]['todas'][] = $a;
        }

        return $m;
    }

    /* ---------------- Condiciones de pago ---------------- */

    public static function condicion(string $empleadoId, ?string $fecha = null): ?object
    {
        $f = $fecha ?? Base::hoy();

        return DB::table('employment_terms')->where('employee_id', $empleadoId)->where('valid_from', '<=', $f)
            ->where(fn ($w) => $w->whereNull('valid_to')->orWhere('valid_to', '>=', $f))->first();
    }

    /** Remuneración mensual vigente (equivalente: jornal × 26, hora × 208). Sin condición: el sueldo de MAE. */
    public static function remuneracion(string $empleadoId, ?string $fecha = null): float
    {
        $t = self::condicion($empleadoId, $fecha);
        if (! $t) {
            return (float) (DB::table('employees')->where('id', $empleadoId)->value('monthly_salary') ?? 0);
        }

        return Base::r(match ($t->pay_scheme) {
            'MONTHLY' => (float) $t->monthly_amount,
            'DAILY' => (float) $t->daily_rate * 26,
            default => (float) $t->hourly_rate * 208,
        });
    }

    public static function guardarCondicion(array $d, User $u): array
    {
        $e = Base::trabajador($d['employee_id'] ?? null);
        $forma = $d['pay_scheme'] ?? null;
        if (! isset(Base::FORMAS[$forma])) {
            RuleError::fail('RN-PER-02', 'Elige la forma de pago.');
        }
        $campo = ['MONTHLY' => 'monthly_amount', 'DAILY' => 'daily_rate', 'HOURLY' => 'hourly_rate'][$forma];
        $monto = $d[$campo] ?? null;
        if ($monto === null || $monto === '' || ! is_numeric($monto) || (float) $monto < 0) {
            RuleError::fail('RN-PER-02', 'Indica el monto de '.mb_strtolower(Base::FORMAS[$forma]).'.');
        }
        $desde = $d['valid_from'] ?? null;
        $hasta = ($d['valid_to'] ?? null) ?: null;
        if (! $desde) {
            RuleError::fail('RN-PER-02', 'Indica desde cuándo rige.');
        }
        if ($hasta && $hasta < $desde) {
            RuleError::fail('RN-PER-02', 'La vigencia termina antes de empezar.');
        }
        $fuente = $d['payroll_source'] ?? Base::texto('per_payroll_source', 'AYNI_HR');
        if (! isset(Base::FUENTES[$fuente])) {
            RuleError::fail('RN-PER-18', 'Elige la fuente de planilla.');
        }

        return DB::transaction(function () use ($e, $forma, $campo, $monto, $desde, $hasta, $fuente, $d, $u) {
            $fin = $hasta ?? '9999-12-31';
            $choques = DB::table('employment_terms')->where('employee_id', $e->id)->where('valid_from', '<=', $fin)
                ->whereRaw("coalesce(valid_to, '9999-12-31'::date) >= ?", [$desde])->lockForUpdate()->get();
            if ($choques->isNotEmpty()) {
                $abierta = $choques->count() === 1 && $choques[0]->valid_to === null && $choques[0]->valid_from < $desde;
                if (! empty($d['close_previous']) && $abierta) {
                    DB::table('employment_terms')->where('id', $choques[0]->id)
                        ->update(['valid_to' => CarbonImmutable::parse($desde)->subDay()->toDateString(), 'updated_at' => now()]);
                } else {
                    $c = $choques[0];
                    RuleError::fail('RN-PER-02', 'Las condiciones se traslapan con la vigente desde el '.Base::fecha($c->valid_from)
                        .($c->valid_to ? ' hasta el '.Base::fecha($c->valid_to) : '').'. Ciérrala el día anterior o marca «Cerrar la condición vigente».');
                }
            }
            $id = DB::table('employment_terms')->insertGetId([
                'employee_id' => $e->id, 'pay_scheme' => $forma, $campo => Base::r($monto), 'payroll_source' => $fuente,
                'external_ref' => trim((string) ($d['external_ref'] ?? '')) ?: null, 'valid_from' => $desde, 'valid_to' => $hasta, 'created_by' => $u->id,
            ]);

            return (array) DB::table('employment_terms')->where('id', $id)->first();
        });
    }

    public static function condiciones(User $u): array
    {
        $vis = Base::visibles($u);
        $hoy = Base::hoy();
        $q = DB::table('employment_terms as t')->join('employees as e', 'e.id', '=', 't.employee_id')
            ->when($vis !== null, fn ($w) => $w->whereIn('t.employee_id', Base::veSueldos($u) ? $vis : array_filter([Base::yo($u)])))
            ->orderBy('e.full_name')->orderByDesc('t.valid_from')->get(['t.*', 'e.full_name']);
        $filas = $q->map(function ($t) use ($u, $hoy) {
            $monto = $t->monthly_amount ?? $t->daily_rate ?? $t->hourly_rate;

            return [
                'id' => $t->id, 'employee_id' => $t->employee_id, 'trabajador' => $t->full_name, 'pay_scheme' => $t->pay_scheme, 'forma' => Base::FORMAS[$t->pay_scheme],
                'monto' => Base::monto($u, $t->employee_id, $monto), 'payroll_source' => $t->payroll_source, 'fuente' => Base::FUENTES[$t->payroll_source],
                'external_ref' => $t->external_ref, 'valid_from' => $t->valid_from, 'valid_to' => $t->valid_to,
                'estado' => $t->valid_from > $hoy ? 'FUTURE' : ($t->valid_to && $t->valid_to < $hoy ? 'PAST' : 'CURRENT'),
            ];
        })->all();
        $vig = array_filter($filas, fn ($f) => $f['estado'] === 'CURRENT');
        $total = Base::veSueldos($u) ? Base::r(array_sum(array_map(fn ($f) => self::remuneracion($f['employee_id']), $vig))) : null;

        return ['data' => $filas, 'resumen' => [
            'vigentes' => count($vig), 'mensuales' => count(array_filter($vig, fn ($f) => $f['pay_scheme'] === 'MONTHLY')),
            'variables' => count(array_filter($vig, fn ($f) => $f['pay_scheme'] !== 'MONTHLY')), 'planilla_mensual' => $total,
            'fuente_defecto' => Base::texto('per_payroll_source', 'AYNI_HR'),
        ], 've_sueldos' => Base::veSueldos($u)];
    }

    /* ---------------- PER-01 Puestos ---------------- */

    public static function puestos(): array
    {
        $hoy = Base::hoy();
        $n = DB::table('employee_assignments as a')->join('employees as e', 'e.id', '=', 'a.employee_id')->where('e.status', 'ACTIVE')
            ->where('a.is_primary', true)->where('a.superseded', false)->where('a.valid_from', '<=', $hoy)
            ->where(fn ($w) => $w->whereNull('a.valid_to')->orWhere('a.valid_to', '>=', $hoy))
            ->groupBy('a.position_id')->selectRaw('a.position_id, count(*) AS n')->pluck('n', 'position_id');

        return DB::table('job_positions as p')->leftJoin('establishments as s', 's.id', '=', 'p.establishment_id')->orderBy('p.area')->orderBy('p.name')
            ->get(['p.*', 's.short as local'])->map(fn ($p) => [
                'id' => $p->id, 'code' => $p->code, 'name' => $p->name, 'area' => $p->area, 'area_nombre' => Base::AREAS[$p->area] ?? $p->area,
                'establishment_id' => $p->establishment_id, 'local' => $p->local ?? 'Todos los locales', 'functions' => json_decode($p->functions, true) ?: [],
                'default_role' => $p->default_role, 'pay_scheme' => $p->pay_scheme, 'forma' => Base::FORMAS[$p->pay_scheme], 'status' => $p->status,
                'trabajadores' => (int) ($n[$p->id] ?? 0),
            ])->all();
    }

    public static function guardarPuesto(?string $id, array $d, User $u): array
    {
        $code = strtoupper(Base::obligatorio($d['code'] ?? '', 'RN-PER-01', 'Indica el código del puesto.', 1, 20));
        $name = Base::obligatorio($d['name'] ?? '', 'RN-PER-01', 'Indica el nombre del puesto.', 2, 120);
        if (! isset(Base::AREAS[$d['area'] ?? ''])) {
            RuleError::fail('RN-PER-01', 'Elige el área del puesto.');
        }
        if (! isset(Base::FORMAS[$d['pay_scheme'] ?? 'MONTHLY'])) {
            RuleError::fail('RN-PER-01', 'Elige la forma de pago habitual.');
        }
        $funciones = array_values(array_filter(array_map(fn ($f) => mb_substr(trim((string) $f), 0, 200), (array) ($d['functions'] ?? []))));
        if (DB::table('job_positions')->whereRaw('upper(code) = ?', [$code])->when($id, fn ($w) => $w->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-PER-01', "Ya existe un puesto con el código {$code}.");
        }
        $rol = ($d['default_role'] ?? null) ?: null;
        if ($rol && ! DB::table('roles')->where('code', $rol)->exists()) {
            RuleError::fail('RN-PER-01', 'El rol sugerido no existe.');
        }
        $fila = ['code' => $code, 'name' => $name, 'area' => $d['area'], 'establishment_id' => ($d['establishment_id'] ?? null) ?: null,
            'functions' => json_encode($funciones, JSON_UNESCAPED_UNICODE), 'default_role' => $rol, 'pay_scheme' => $d['pay_scheme'] ?? 'MONTHLY',
            'status' => ($d['status'] ?? 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'];
        if ($id) {
            if (! DB::table('job_positions')->where('id', $id)->exists()) {
                abort(404, 'No se encontró el puesto.');
            }
            if ($fila['status'] === 'INACTIVE' && ($n = collect(self::puestos())->firstWhere('id', $id)['trabajadores'] ?? 0) > 0) {
                RuleError::fail('RN-PER-01', "El puesto tiene {$n} trabajador(es) vigente(s): cámbialos de puesto antes de desactivarlo.");
            }
            DB::table('job_positions')->where('id', $id)->update($fila + ['updated_at' => now()]);
        } else {
            $id = DB::table('job_positions')->insertGetId($fila);
        }

        return collect(self::puestos())->firstWhere('id', $id);
    }

    /* ---------------- PER-02 Ficha del trabajador ---------------- */

    public static function lista(User $u): array
    {
        $vis = Base::visibles($u);
        $mapa = self::mapa();
        $usuarios = DB::table('users as u')->whereNotNull('u.employee_id')->where('u.status', 'ACTIVE')->orderBy('u.created_at')->get(['u.employee_id', 'u.email', 'u.role'])
            ->groupBy('employee_id');
        $ve = Base::veSueldos($u);
        $yo = Base::yo($u);
        $centros = DB::table('cost_centers')->pluck('code', 'id');
        $locales = DB::table('establishments')->pluck('short', 'id');
        $nombres = DB::table('employees')->pluck('full_name', 'id');
        $filas = DB::table('employees')->where('status', 'ACTIVE')->when($vis !== null, fn ($w) => $w->whereIn('id', $vis))->orderBy('full_name')->get()
            ->map(function ($e) use ($mapa, $usuarios, $ve, $yo, $centros, $locales, $nombres) {
                $a = $mapa[$e->id] ?? null;
                $p = $a['principal'] ?? null;
                $usr = $usuarios[$e->id][0] ?? null;
                $propio = $e->id === $yo;

                return [
                    'id' => $e->id, 'full_name' => $e->full_name, 'doc_number' => $ve || $propio ? $e->doc_number : '••••'.substr((string) $e->doc_number, -2),
                    'puesto' => $p?->puesto ?? $e->position, 'area' => $p?->area ?? 'OTHER', 'area_nombre' => Base::AREAS[$p?->area ?? 'OTHER'],
                    'establishment_id' => $p?->establishment_id ?? $e->establishment_id, 'local' => $locales[$p?->establishment_id ?? $e->establishment_id] ?? '—',
                    'centros' => implode(' · ', array_map(fn ($x) => ($centros[$x->cost_center_id] ?? '?').' '.rtrim(rtrim(number_format((float) $x->allocation_pct, 2, '.', ''), '0'), '.').' %', $a['todas'] ?? [])),
                    'n_centros' => count($a['todas'] ?? []), 'supervisor' => $p?->supervisor_employee_id ? ($nombres[$p->supervisor_employee_id] ?? null) : null,
                    'usuario' => $usr?->email, 'rol' => $usr?->role, 'status' => $e->status, 'sin_asignacion' => $p === null, 'hire_date' => $e->hire_date,
                ];
            })->all();

        return ['data' => $filas, 've_sueldos' => $ve, 'resumen' => [
            'activos' => count($filas), 'sin_asignacion' => count(array_filter($filas, fn ($f) => $f['sin_asignacion'])),
            'varios_centros' => count(array_filter($filas, fn ($f) => $f['n_centros'] > 1)), 'sin_usuario' => count(array_filter($filas, fn ($f) => ! $f['usuario'])),
            'por_local' => array_count_values(array_map(fn ($f) => $f['local'], $filas)),
        ]];
    }

    public static function ficha(string $id, User $u): array
    {
        $e = Base::trabajador($id);
        if (! Base::puedeVer($u, $id)) {
            RuleError::fail('RN-PER-19', 'Solo ves tu propia ficha y la de tu equipo (Ley 29733).');
        }
        $ve = Base::veSueldos($u) || $id === Base::yo($u);
        $hoy = Base::hoy();
        $mes = Base::mes();
        $as = DB::table('employee_assignments as a')->join('job_positions as p', 'p.id', '=', 'a.position_id')->join('establishments as s', 's.id', '=', 'a.establishment_id')
            ->join('cost_centers as c', 'c.id', '=', 'a.cost_center_id')->leftJoin('employees as sup', 'sup.id', '=', 'a.supervisor_employee_id')
            ->where('a.employee_id', $id)->orderByDesc('a.valid_from')->orderByDesc('a.is_primary')
            ->get(['a.*', 'p.name as puesto', 'p.area', 's.short as local', 'c.code as centro', 'c.name as centro_nombre', 'sup.full_name as supervisor']);
        $vig = $as->filter(fn ($a) => ! $a->superseded && $a->valid_from <= $hoy && (! $a->valid_to || $a->valid_to >= $hoy))->values();
        $t = self::condicion($id);
        $usr = Base::usuarioDe($id);
        $dias = DB::table('attendance_days')->where('employee_id', $id)->whereBetween('work_date', [$mes, $hoy])->get();
        $tot = Comisiones::totales($mes, $id);

        return [
            'id' => $e->id, 'full_name' => $e->full_name, 'status' => $e->status, 'hire_date' => $e->hire_date,
            'doc_type' => $e->doc_type, 'doc_number' => $ve ? $e->doc_number : null, 'phone' => $ve ? $e->phone : null, 'email' => $ve ? $e->email : null,
            'usuario' => $usr ? ['email' => $usr->email, 'role' => $usr->role] : null,
            'puesto' => $vig[0]->puesto ?? $e->position, 'area' => Base::AREAS[$vig[0]->area ?? 'OTHER'], 'local' => $vig[0]->local ?? null, 'supervisor' => $vig[0]->supervisor ?? null,
            'asignaciones' => $vig->map(fn ($a) => self::asig($a))->all(),
            'programadas' => $as->filter(fn ($a) => ! $a->superseded && $a->valid_from > $hoy)->map(fn ($a) => self::asig($a))->values()->all(),
            'historial' => $as->filter(fn ($a) => $a->superseded || ($a->valid_to && $a->valid_to < $hoy))->map(fn ($a) => self::asig($a))->values()->all(),
            'condicion' => $t ? ['forma' => Base::FORMAS[$t->pay_scheme], 'pay_scheme' => $t->pay_scheme, 'fuente' => Base::FUENTES[$t->payroll_source],
                'remuneracion' => $ve ? self::remuneracion($id) : null, 'desde' => $t->valid_from, 'external_ref' => $ve ? $t->external_ref : null] : null,
            've_sueldos' => $ve, 'puede_gestionar' => Base::gestiona($u),
            'asistencia_mes' => ['trabajados' => $dias->whereIn('status', ['PRESENT', 'LATE'])->count(), 'tardanzas' => $dias->where('late_minutes', '>', 0)->count(),
                'min_tardanza' => (int) $dias->sum('late_minutes'), 'faltas' => $dias->where('status', 'ABSENT')->count(), 'horas_extra' => Base::r($dias->sum('overtime_minutes') / 60, 1)],
            'comisiones_mes' => ['neta' => $ve ? $tot['neta'] : null, 'bonos' => $ve ? $tot['bonos'] : null, 'entregas' => $tot['entregas']],
            'alertas_graves' => Supervision::gravesAbiertas($id),
        ];
    }

    private static function asig(object $a): array
    {
        return ['id' => $a->id, 'position_id' => $a->position_id, 'puesto' => $a->puesto, 'establishment_id' => $a->establishment_id, 'local' => $a->local,
            'cost_center_id' => $a->cost_center_id, 'centro' => $a->centro.' · '.$a->centro_nombre, 'supervisor_employee_id' => $a->supervisor_employee_id,
            'supervisor' => $a->supervisor, 'allocation_pct' => (float) $a->allocation_pct, 'is_primary' => (bool) $a->is_primary,
            'valid_from' => $a->valid_from, 'valid_to' => $a->superseded ? null : $a->valid_to, 'reemplazada' => (bool) $a->superseded];
    }

    /**
     * RN-PER-01: cambia las asignaciones desde una fecha. Un puesto y un local principal; centros de costo que suman 100 %.
     * Las vigentes se cierran el día anterior (o se marcan reemplazadas si empezaban ese mismo día o después).
     */
    public static function asignar(string $empleadoId, array $filas, ?string $desde, User $u): array
    {
        $e = Base::trabajador($empleadoId);
        if (! $filas) {
            RuleError::fail('RN-PER-01', 'Un trabajador activo tiene al menos una asignación con puesto y local.');
        }
        if (! $desde) {
            RuleError::fail('RN-PER-01', 'Indica desde cuándo rige.');
        }
        $suma = Base::r(array_sum(array_map(fn ($f) => (float) ($f['allocation_pct'] ?? 0), $filas)));
        if (abs($suma - 100) > 0.001) {
            RuleError::fail('RN-PER-01', 'Las asignaciones a centros de costo suman '.rtrim(rtrim(number_format($suma, 2, ',', ''), '0'), ',').' % y deben sumar 100 % en cada fecha.');
        }
        foreach ($filas as $f) {
            if (empty($f['position_id']) || empty($f['establishment_id']) || empty($f['cost_center_id'])) {
                RuleError::fail('RN-PER-01', 'Cada asignación lleva puesto, local y centro de costo.');
            }
            if ((float) ($f['allocation_pct'] ?? 0) <= 0) {
                RuleError::fail('RN-PER-01', 'Cada centro de costo lleva un porcentaje mayor que cero.');
            }
            if (($f['supervisor_employee_id'] ?? null) === $e->id) {
                RuleError::fail('RN-PER-01', 'Nadie es su propio supervisor.');
            }
            \App\Modulos\Plt\Services\CentrosCosto::activo($f['cost_center_id']);
        }
        if (count(array_filter($filas, fn ($f) => ! empty($f['is_primary']))) !== 1) {
            RuleError::fail('RN-PER-01', 'Marca exactamente una asignación como principal (puesto y local principal).');
        }
        $principal = array_values(array_filter($filas, fn ($f) => ! empty($f['is_primary'])))[0];
        foreach ($filas as $f) {
            if ($f['position_id'] !== $principal['position_id'] || $f['establishment_id'] !== $principal['establishment_id']) {
                RuleError::fail('RN-PER-01', 'El puesto y el local son los de la asignación principal; las demás filas solo reparten el costo en otros centros de costo.');
            }
        }

        return DB::transaction(function () use ($e, $filas, $desde, $u) {
            $ant = CarbonImmutable::parse($desde)->subDay()->toDateString();
            foreach (DB::table('employee_assignments')->where('employee_id', $e->id)->where('superseded', false)
                ->where(fn ($w) => $w->whereNull('valid_to')->orWhere('valid_to', '>=', $desde))->lockForUpdate()->get() as $a) {
                DB::table('employee_assignments')->where('id', $a->id)->update($a->valid_from >= $desde
                    ? ['superseded' => true, 'valid_to' => $ant, 'updated_at' => now()]
                    : ['valid_to' => $ant, 'updated_at' => now()]);
            }
            foreach ($filas as $f) {
                DB::table('employee_assignments')->insert([
                    'employee_id' => $e->id, 'position_id' => $f['position_id'], 'establishment_id' => $f['establishment_id'], 'cost_center_id' => $f['cost_center_id'],
                    'supervisor_employee_id' => ($f['supervisor_employee_id'] ?? null) ?: null, 'allocation_pct' => Base::r($f['allocation_pct']),
                    'is_primary' => ! empty($f['is_primary']), 'valid_from' => $desde, 'created_by' => $u->id,
                ]);
            }

            return self::ficha($e->id, $u);
        });
    }

    /** Opciones de los formularios de PER (puestos, locales, centros, trabajadores, turnos, cuentas). */
    public static function opciones(User $u): array
    {
        $vis = Base::visibles($u);

        return [
            'puestos' => DB::table('job_positions')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'code', 'name', 'area', 'establishment_id'])->all(),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'short', 'name', 'lat', 'lng'])->all(),
            'centros' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'area'])->all(),
            'trabajadores' => DB::table('employees')->where('status', 'ACTIVE')->when($vis !== null, fn ($w) => $w->whereIn('id', $vis))->orderBy('full_name')->get(['id', 'full_name'])->all(),
            'supervisores' => DB::table('employees')->where('status', 'ACTIVE')->orderBy('full_name')->get(['id', 'full_name'])->all(),
            'turnos' => DB::table('shifts as s')->join('establishments as e', 'e.id', '=', 's.establishment_id')->where('s.status', 'ACTIVE')->orderBy('e.code')->orderBy('s.start_time')
                ->get(['s.id', 's.code', 's.name', 's.establishment_id', 's.start_time', 's.end_time', 'e.short as local'])->all(),
            'cuentas' => DB::table('cash_accounts')->where('status', 'ACTIVE')->whereIn('account_type', ['BANK', 'WALLET', 'PETTY_CASH'])->orderBy('code')->get(['id', 'code', 'name'])->all(),
            'marcas' => DB::table('brands')->orderBy('name')->get(['id', 'name'])->all(),
            'roles' => DB::table('roles')->where('status', 'ACTIVE')->whereNotIn('code', ['CLIENTE_B2B', 'SOPORTE_PLATAFORMA'])->orderBy('name')->get(['code', 'name'])->all(),
            'yo' => Base::yo($u), 'hoy' => Base::hoy(),
            'permisos' => [
                've_sueldos' => Base::veSueldos($u), 'gestiona' => Base::gestiona($u),
                'aprueba_asistencia' => \App\Support\Access::can($u, 'per.attendance.approve'),
                'aprueba_adelantos' => \App\Support\Access::can($u, 'per.advance.approve'),
                'comisiones' => \App\Support\Access::can($u, 'per.commission.manage'),
                'aprueba_pagos' => \App\Support\Access::can($u, 'per.payout.approve'),
                'supervision' => \App\Support\Access::can($u, 'per.supervision.manage'),
                'intercambio' => \App\Support\Access::can($u, 'per.payroll.exchange'),
                'marca' => \App\Support\Access::can($u, 'per.attendance.mark'),
            ],
            'parametros' => [
                'radio_m' => Base::num('per_geofence_radius_m', 100), 'qr_segundos' => Base::num('per_qr_rotation_seconds', 60),
                'tolerancia' => Base::num('per_late_tolerance_minutes', 10), 'adelanto_pct' => Base::num('per_advance_max_pct', 30),
                'bono' => Base::num('per_delivery_bonus_amount', 1.5), 'cierre_dia' => Base::num('per_commission_close_day', 5),
                'retener' => Base::sino('per_block_commission_on_open_alerts', true), 'fuente' => Base::texto('per_payroll_source', 'AYNI_HR'),
            ],
        ];
    }
}
