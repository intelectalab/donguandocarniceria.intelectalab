<?php

namespace App\Modulos\Ops\Services;

use App\Modulos\Equ\Permisos as PermisosEqu;
use App\Modulos\Plt\Services\Ruc;
use App\Modulos\Seg\Services\Usuarios;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Ramsey\Uuid\Uuid;

/**
 * OPS-02 Empresas, OPS-03 Ficha de la empresa y el alta de una empresa desde la consola.
 *
 * La consola no entra a los datos de negocio de una empresa (RN-OPS-06): lee las tablas de la plataforma
 * (tenants, subscriptions) y, de las tablas con RLS, solo lo que dan platform_tenant_usage() (totales de uso)
 * y platform_tenant_modules() (módulos encendidos).
 *
 * El alta corre en una sola transacción con la conexión normal de la aplicación: primero crea la fila de la
 * empresa (tabla global) y luego fija su contexto (app.tenant_id), así cada fila nueva pasa por RLS como la de
 * cualquier empresa. Crea la razón social, roles y permisos (los del sistema, de la misma plantilla que la demo),
 * los módulos de su plan (RN-SUS-08), su administrador invitado y la suscripción de prueba (RN-ONB-17,
 * RN-SUS-15). Las marcas, locales y lo demás los completa la empresa con su asistente (PLT-14).
 */
final class Empresas
{
    public const RUBROS = ['CARNICERIA' => 'Carnicería', 'DISTRIBUIDORA' => 'Distribuidora de carnes', 'AVICOLA' => 'Avícola',
        'CHARCUTERIA' => 'Charcutería', 'GOURMET' => 'Tienda gourmet', 'PLANTA' => 'Planta de proceso', 'OTRO' => 'Otro'];

    public const ESTADOS = ['TRIAL' => 'En prueba', 'ACTIVE' => 'Activa', 'PAST_DUE' => 'Con deuda', 'READ_ONLY' => 'Solo lectura',
        'SUSPENDED' => 'Suspendida', 'CANCELLED' => 'Cancelada'];

    /** Regímenes tributarios (los mismos que acepta PLT-03). */
    public const REGIMENES = ['MYPE' => 'Régimen MYPE Tributario', 'RER' => 'Régimen Especial (RER)', 'GENERAL' => 'Régimen General', 'NRUS' => 'Nuevo RUS'];

    /** Rol del administrador de la empresa nueva: el que ve todo y aprueba. */
    private const ROL_ADMIN = 'GERENTE';

    private const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    /* ------------------------------------------------------------------ OPS-02 */

    public static function lista(): array
    {
        $uso = collect(DB::select('SELECT * FROM platform_tenant_usage()'))->keyBy('tenant_id');
        $planes = DB::table('saas_plans')->get()->keyBy('code');
        $subs = DB::table('subscriptions')->where('status', '<>', 'CANCELLED')->get()->keyBy('tenant_id');
        $modulos = collect(DB::select('SELECT tenant_id, count(*) AS n FROM platform_tenant_modules() WHERE enabled GROUP BY tenant_id'))->pluck('n', 'tenant_id');

        return DB::table('tenants')->orderBy('name')->get()->map(function ($t) use ($uso, $planes, $subs, $modulos) {
            $s = $subs[$t->id] ?? null;
            $p = $s ? $planes[$s->plan_code] : null;
            $u = $uso[$t->id] ?? null;

            return [
                'id' => $t->id, 'name' => $t->name, 'short' => $t->short, 'ruc' => $t->ruc, 'tenant_status' => $t->status,
                'business_type' => $t->business_type, 'business_type_name' => self::RUBROS[$t->business_type] ?? null,
                'created_at' => $t->created_at,
                'plan_code' => $p->code ?? null, 'plan_name' => $p->name ?? null,
                // Sin suscripción: piloto o empresa interna, sin límites ni cobro (RN-SUS-21).
                'subscription_status' => $s->status ?? null, 'subscription_status_name' => $s ? self::ESTADOS[$s->status] : 'Sin suscripción',
                'days_in_status' => $s ? (int) now()->startOfDay()->diffInDays(Carbon::parse($s->status_changed_at)->startOfDay(), true) : null,
                'trial_ends_at' => $s->trial_ends_at ?? null,
                'mrr' => $s && in_array($s->status, ['ACTIVE', 'PAST_DUE'], true) ? (float) $p->price_pen : 0.0,
                'uso' => self::uso($u, $p),
                'modulos' => (int) ($modulos[$t->id] ?? 0),
                'last_login' => $u->last_login ?? null,
            ];
        })->all();
    }

    /* ------------------------------------------------------------------ OPS-03 */

    public static function ficha(string $id): array
    {
        $t = DB::table('tenants')->where('id', $id)->first();
        if (! $t) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        $fila = collect(self::lista())->firstWhere('id', $id);
        $sub = DB::table('subscriptions')->where('tenant_id', $id)->orderByRaw("status = 'CANCELLED'")->orderByDesc('started_at')->first();
        $nombresModulo = DB::table('platform_modules')->pluck('name', 'code');

        return $fila + [
            'hostname' => $t->hostname, 'contact_name' => $t->contact_name, 'contact_email' => $t->contact_email, 'contact_phone' => $t->contact_phone,
            'dominios' => DB::table('tenant_hostnames')->where('tenant_id', $id)->orderByDesc('is_primary')->get(['hostname', 'is_primary', 'status']),
            'creada_por' => $t->created_by_platform_user ? DB::table('platform_users')->where('id', $t->created_by_platform_user)->value('full_name') : null,
            'suscripcion' => $sub ? [
                'id' => $sub->id, 'plan_code' => $sub->plan_code, 'status' => $sub->status, 'status_name' => self::ESTADOS[$sub->status],
                'started_at' => $sub->started_at, 'status_changed_at' => $sub->status_changed_at, 'trial_ends_at' => $sub->trial_ends_at,
                'trial_days_granted' => $sub->trial_days_granted,
                'historial' => DB::table('subscription_events')->where('subscription_id', $sub->id)->orderByDesc('occurred_at')
                    ->get(['event', 'from_status', 'to_status', 'reason', 'actor_name', 'actor_type', 'occurred_at']),
            ] : null,
            'modulos_encendidos' => collect(DB::select('SELECT module_code, phase, sus_source FROM platform_tenant_modules() WHERE tenant_id = ? AND enabled ORDER BY phase, module_code', [$id]))
                ->map(fn ($m) => (array) $m + ['name' => $nombresModulo[$m->module_code] ?? $m->module_code])->values(),
            'acciones_consola' => DB::table('platform_audit_log')->where('target_tenant_id', $id)->orderByDesc('occurred_at')->limit(50)
                ->get(['action', 'actor_name', 'reason', 'occurred_at']),
        ];
    }

    /** Opciones del formulario de alta: planes activos con sus límites y módulos, rubros y días de prueba. */
    public static function opcionesAlta(): array
    {
        $modulos = DB::table('saas_plan_modules')->get()->groupBy('plan_code');
        $total = DB::table('platform_modules')->count();

        return [
            'planes' => DB::table('saas_plans')->where('status', 'ACTIVE')->orderBy('sort_order')->get()->map(fn ($p) => [
                'code' => $p->code, 'name' => $p->name, 'description' => $p->description, 'price_pen' => (float) $p->price_pen,
                'users_max' => $p->users_max, 'brands_max' => $p->brands_max, 'sites_max' => $p->sites_max, 'is_featured' => $p->is_featured,
                'modulos' => $p->all_modules ? $total : count($modulos[$p->code] ?? []),
            ]),
            'regimenes' => collect(self::REGIMENES)->map(fn ($n, $c) => ['code' => $c, 'name' => $n])->values(),
            'rubros' => collect(self::RUBROS)->map(fn ($n, $c) => ['code' => $c, 'name' => $n])->values(),
            'prueba_dias' => (int) Consola::param('sus_trial_days_default', 14),
            'prueba_max' => (int) Consola::param('sus_trial_max_days', 30),
        ];
    }

    /* ------------------------------------------------------------------ alta */

    /** @return array{id: string, codigo: string, admin_email: string} */
    public static function alta(array $d, array $quien): array
    {
        Consola::exigir($quien, 'tenant.create');
        $ruc = trim($d['ruc']);
        if ($problema = Ruc::problema($ruc)) {
            RuleError::fail('RN-ONB-01', $problema);
        }
        $db = DB::connection();
        // RN-ONB-02: un RUC, una empresa en toda la plataforma.
        if (DB::selectOne('SELECT platform_ruc_in_use(?) AS si', [$ruc])->si) {
            RuleError::fail('RN-ONB-02', 'Ese RUC ya es cliente de la plataforma: no se crea otra empresa. Revisa la empresa existente.');
        }
        $plan = $db->table('saas_plans')->where('code', $d['plan_code'])->where('status', 'ACTIVE')->first();
        if (! $plan) {
            RuleError::fail('RN-SUS-05', 'Elige un plan activo.');
        }
        $maxPrueba = (int) Consola::param('sus_trial_max_days', 30);
        $diasPrueba = (int) ($d['trial_days'] ?? Consola::param('sus_trial_days_default', 14));
        if ($diasPrueba < 1 || $diasPrueba > $maxPrueba) {
            RuleError::fail('RN-SUS-15', "La prueba dura entre 1 y {$maxPrueba} días.");
        }
        $dominio = isset($d['hostname']) && trim($d['hostname']) !== '' ? mb_strtolower(trim($d['hostname'])) : null;
        if ($dominio && $db->table('tenant_hostnames')->where('hostname', $dominio)->exists()) {
            RuleError::fail('RN-PLT-15', 'Ese dominio ya lo usa otra empresa.');
        }
        $email = mb_strtolower(trim($d['admin_email']));
        $codigo = self::codigo();

        try {
            $id = $db->transaction(function () use ($db, $d, $ruc, $plan, $diasPrueba, $dominio, $email, $codigo, $quien) {
                $id = (string) Uuid::uuid4();
                $ahora = now();
                $actor = 'Consola: '.$quien['full_name'];
                // tenants es de solo lectura para la aplicación: la fila la crea platform_create_tenant().
                $db->select('SELECT platform_create_tenant(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                    $id, mb_strtoupper(trim($d['legal_name'])), trim($d['trade_name']), $plan->code, $dominio ?? Str::slug($d['trade_name']).'.gestioncarnica',
                    $ruc, $d['business_type'], trim($d['admin_name']), $email, $d['admin_phone'] ?? null, $quien['id'],
                ]);
                // Desde aquí, todo lo que se crea es de la empresa nueva y pasa por RLS.
                TenantContext::set(TenantContext::find($id));
                if ($dominio) {
                    $db->table('tenant_hostnames')->insert(['tenant_id' => $id, 'hostname' => $dominio, 'is_primary' => true, 'status' => 'ACTIVE', 'created_at' => $ahora]);
                }
                $db->table('tenant_branding')->insert(['tenant_id' => $id, 'changed_by' => $actor, 'created_at' => $ahora]);
                $db->table('companies')->insert([
                    'tenant_id' => $id, 'legal_name' => mb_strtoupper(trim($d['legal_name'])), 'ruc' => $ruc, 'trade_name' => trim($d['trade_name']),
                    'tax_regime' => $d['tax_regime'], 'fiscal_address' => trim($d['fiscal_address']), 'status' => 'ACTIVE',
                    'default_currency' => 'PEN', 'timezone' => 'America/Lima', 'created_at' => $ahora,
                ]);

                $roles = self::rolesYPermisos($db, $id);
                self::modulosDelPlan($db, $id, $plan, $actor);

                // Administrador de la empresa: invitado, con el código para crear su contraseña (como SEG-08).
                $usuario = (string) Uuid::uuid4();
                $db->table('users')->insert([
                    'id' => $usuario, 'tenant_id' => $id, 'name' => trim($d['admin_name']), 'email' => $email, 'role' => self::ROL_ADMIN, 'status' => 'INVITED',
                    'password' => Hash::make(Str::random(40)), 'failed_logins' => 0, 'invited_at' => $ahora, 'created_at' => $ahora,
                ]);
                $db->table('user_roles')->insert(['tenant_id' => $id, 'user_id' => $usuario, 'role_id' => $roles[self::ROL_ADMIN], 'created_at' => $ahora]);
                $db->table('password_reset_tokens')->insert([
                    'tenant_id' => $id, 'user_id' => $usuario, 'token_hash' => Hash::make($codigo), 'kind' => 'INVITE',
                    'expires_at' => $ahora->copy()->addHours(Usuarios::INVITACION_HORAS), 'requested_at' => $ahora, 'requested_ip' => request()?->ip(), 'created_at' => $ahora,
                ]);

                // Suscripción de prueba y su primer evento (RN-SUS-04, RN-SUS-15).
                $sub = (string) Uuid::uuid4();
                $db->table('subscriptions')->insert([
                    'id' => $sub, 'tenant_id' => $id, 'plan_code' => $plan->code, 'status' => 'TRIAL', 'trial_ends_at' => $ahora->copy()->addDays($diasPrueba)->endOfDay(),
                    'trial_days_granted' => $diasPrueba, 'started_at' => $ahora, 'status_changed_at' => $ahora, 'created_by' => $quien['id'], 'created_at' => $ahora, 'updated_at' => $ahora,
                ]);
                $db->table('subscription_events')->insert([
                    'subscription_id' => $sub, 'tenant_id' => $id, 'event' => 'CREATED', 'to_status' => 'TRIAL',
                    'reason' => "Alta desde la consola con el plan {$plan->name} y {$diasPrueba} días de prueba", 'actor_type' => 'PLATFORM_USER',
                    'actor_id' => $quien['id'], 'actor_name' => $quien['full_name'], 'detail' => json_encode(['plan' => $plan->code, 'trial_days' => $diasPrueba]), 'occurred_at' => $ahora,
                ]);

                return $id;
            });
        } finally {
            TenantContext::set(null);   // la consola vuelve a no tener empresa
        }

        Consola::bitacora('TENANT_CREATED', $quien, ['tenant' => $id, 'entity' => 'tenants', 'entity_id' => $id, 'reason' => 'Alta de empresa desde la consola',
            'detail' => ['ruc' => $ruc, 'plan' => $plan->code, 'trial_days' => $diasPrueba, 'admin' => $email]]);
        $horas = Usuarios::INVITACION_HORAS;
        Mail::raw(
            "Hola {$d['admin_name']}:\n\nTu empresa {$d['trade_name']} ya tiene su cuenta en GestionCarnica, con {$diasPrueba} días de prueba del plan {$plan->name}.\n"
            ."Entra a «Olvidé mi contraseña», elige «Ya tengo un código» y usa el código {$codigo} con tu correo {$email} para crear tu contraseña.\n"
            ."Al ingresar, el asistente te guía para registrar tus marcas, locales y lo demás. El código vence en {$horas} horas.",
            fn ($m) => $m->to($email)->subject('Tu cuenta de GestionCarnica está lista')
        );

        return ['id' => $id, 'codigo' => $codigo, 'admin_email' => $email];
    }

    /* ------------------------------------------------------------------ internos */

    /** Usado y límite por cada límite del plan (sin plan: sin límite). */
    private static function uso(?object $u, ?object $p): array
    {
        $fila = fn (string $clave, string $nombre, ?int $limite) => ['clave' => $clave, 'nombre' => $nombre, 'usado' => (int) ($u->{$clave.'_active'} ?? 0),
            'limite' => $limite, 'pct' => $limite ? round(((int) ($u->{$clave.'_active'} ?? 0)) * 100 / $limite, 1) : null];

        return [
            $fila('users', 'Usuarios', $p->users_max ?? null),
            $fila('brands', 'Marcas', $p->brands_max ?? null),
            $fila('sites', 'Locales', $p->sites_max ?? null),
        ];
    }

    /**
     * Roles del sistema, permisos, permisos por rol y acceso por módulo: la misma plantilla de la que salen las
     * empresas de demo (database/seeders/data/prototipo.json.gz, los de Don Guando). Devuelve código => id del rol.
     */
    private static function rolesYPermisos($db, string $tenant): array
    {
        static $plantilla = null;
        $plantilla ??= json_decode(gzdecode(file_get_contents(database_path('seeders/data/prototipo.json.gz'))), true);
        $de = fn (string $t) => array_values(array_filter($plantilla['tenants'][$t], fn ($r) => $r['tenant'] === 'DG'));
        $ahora = now();

        $roles = [];
        foreach ($de('roles') as $r) {
            $roles[$r['id']] = (string) Uuid::uuid4();
            $db->table('roles')->insert(['id' => $roles[$r['id']], 'tenant_id' => $tenant, 'code' => $r['code'], 'name' => $r['name'],
                'is_system' => (bool) ($r['is_system'] ?? true), 'description' => $r['description'] ?? null, 'requires_mfa' => (bool) ($r['requires_mfa'] ?? false),
                'scope_mode' => $r['scope_mode'] ?? 'ALL', 'phase' => $r['phase'] ?? null, 'status' => $r['status'] ?? 'ACTIVE', 'source' => 'SYSTEM', 'created_at' => $ahora]);
        }
        $permisos = [];
        foreach (array_chunk($de('permissions'), 200) as $lote) {
            $filas = [];
            foreach ($lote as $p) {
                $permisos[$p['id']] = (string) Uuid::uuid4();
                $filas[] = ['id' => $permisos[$p['id']], 'tenant_id' => $tenant, 'code' => $p['code'], 'module_code' => $p['module_code'],
                    'description' => $p['description'], 'everyone' => (bool) ($p['everyone'] ?? false), 'created_at' => $ahora];
            }
            $db->table('permissions')->insert($filas);
        }
        $filas = [];
        foreach ($de('role_permissions') as $rp) {
            if (isset($roles[$rp['role_id']], $permisos[$rp['permission_id']])) {
                $filas[] = ['tenant_id' => $tenant, 'role_id' => $roles[$rp['role_id']], 'permission_id' => $permisos[$rp['permission_id']], 'created_at' => $ahora];
            }
        }
        foreach (array_chunk($filas, 500) as $lote) {
            $db->table('role_permissions')->insert($lote);
        }
        $porCodigo = [];
        foreach ($de('roles') as $r) {
            $porCodigo[$r['code']] = $roles[$r['id']];
        }
        $filas = [];
        foreach ($plantilla['access'] as $codigo => $matriz) {
            if (! isset($porCodigo[$codigo])) {
                continue;
            }
            foreach ($matriz === '*' ? ['*' => 'CLEA'] : $matriz as $modulo => $acciones) {
                $filas[] = ['tenant_id' => $tenant, 'role_id' => $porCodigo[$codigo], 'module_code' => $modulo, 'actions' => $acciones, 'created_at' => $ahora];
            }
        }
        foreach (array_chunk($filas, 500) as $lote) {
            $db->table('role_module_access')->insert($lote);
        }
        // Permisos que los módulos agregaron después de la plantilla (por ahora, los propios de EQU).
        foreach (PermisosEqu::NUEVOS as $codigo => [$descripcion, $paraRoles]) {
            $pid = (string) Uuid::uuid4();
            $db->table('permissions')->insert(['id' => $pid, 'tenant_id' => $tenant, 'code' => $codigo, 'module_code' => 'EQU', 'description' => $descripcion, 'created_at' => $ahora]);
            foreach ($paraRoles as $rol) {
                if (isset($porCodigo[$rol])) {
                    $db->table('role_permissions')->insert(['tenant_id' => $tenant, 'role_id' => $porCodigo[$rol], 'permission_id' => $pid, 'created_at' => $ahora]);
                }
            }
        }

        return $porCodigo;
    }

    /** RN-SUS-08: enciende los módulos del núcleo y los del plan; los demás quedan apagados. */
    private static function modulosDelPlan($db, string $tenant, object $plan, string $actor): void
    {
        $delPlan = $plan->all_modules ? null : $db->table('saas_plan_modules')->where('plan_code', $plan->code)->pluck('module_code')->all();
        $ahora = now();
        $filas = [];
        foreach ($db->table('platform_modules')->orderBy('sort_order')->get() as $m) {
            $encendido = $m->is_core || $delPlan === null || in_array($m->code, $delPlan, true);
            $filas[] = ['tenant_id' => $tenant, 'module_code' => $m->code, 'phase' => $m->phase, 'enabled' => $encendido, 'changed_at' => $ahora,
                'changed_by' => mb_substr($actor, 0, 80), 'reason' => $encendido ? "Incluido en el plan {$plan->name}" : "No incluido en el plan {$plan->name}",
                'sus_source' => $m->is_core ? 'CORE' : ($encendido ? 'PLAN' : null), 'enabled_at' => $encendido ? $ahora : null, 'created_at' => $ahora];
        }
        $db->table('tenant_modules')->insert($filas);
    }

    private static function codigo(): string
    {
        $c = '';
        for ($i = 0; $i < 6; $i++) {
            $c .= self::ALFABETO[random_int(0, strlen(self::ALFABETO) - 1)];
        }

        return $c;
    }
}
