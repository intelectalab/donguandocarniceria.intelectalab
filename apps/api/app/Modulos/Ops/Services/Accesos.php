<?php

namespace App\Modulos\Ops\Services;

use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use App\Modulos\Seg\Services\Sesiones;
use App\Support\Params;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Accesos de soporte: OPS-05 Solicitar acceso (consola), OPS-06 Sesión de soporte y OPS-14 Accesos de soporte (empresa).
 *  - RN-OPS-03: lo pide la consola y lo aprueba alguien de la empresa con ops.support_access.approve. Nace pendiente;
 *    solo se aprueba uno pendiente, y uno cerrado (rechazado, revocado, vencido, terminado o cancelado) no se reabre.
 *  - RN-OPS-02: dura lo que diga quien aprueba o ops_support_default_hours (8, de la empresa), nunca más de
 *    ops_support_max_hours (72, de la plataforma). No se amplía: se pide otro.
 *  - RN-OPS-04: es personal. Entra solo el usuario de plataforma al que se otorgó, con su usuario técnico en la empresa
 *    (user_type PLATFORM_SUPPORT), que ve solo los módulos del acceso: en solo lectura no modifica y sin exportación no
 *    exporta (lo corta el middleware «soporte»). Cada consulta, cambio y exportación queda en support_access_events.
 *  - RN-OPS-09: al cerrarse, el usuario técnico se desactiva y sus sesiones se cierran. Vencen solos (cada minuto).
 *  - RN-OPS-12: con ops_support_notify_admins, avisa a quienes aprueban al pedirse, aprobarse, usarse por primera vez
 *    y terminar.
 */
final class Accesos
{
    public const NIVELES = ['RO' => 'Solo lectura', 'RW' => 'Lectura y escritura'];

    public const ESTADOS = ['PENDING' => 'Por aprobar', 'ACTIVE' => 'Vigente', 'REJECTED' => 'Rechazado', 'REVOKED' => 'Revocado',
        'EXPIRED' => 'Vencido', 'FINISHED' => 'Terminado por soporte', 'CANCELLED' => 'Cancelado'];

    public const TIPO_USUARIO = 'PLATFORM_SUPPORT';

    /** Lo que no se registra como consulta del soporte: la sesión, la campana y la búsqueda del menú. */
    private const SIN_REGISTRO = ['api/v1/me', 'api/v1/me/notifications*', 'api/v1/tenant*', 'api/v1/auth/logout'];

    /* ------------------------------------------------------------------ OPS-05 la consola */

    public static function solicitar(array $quien, array $d): array
    {
        Consola::exigir($quien, $d['level'] === 'RW' ? 'access.request_rw' : 'access.request_ro');
        $tenant = DB::table('tenants')->where('id', $d['tenant_id'])->first();
        if (! $tenant || $tenant->status !== 'ACTIVE') {
            RuleError::fail('RN-OPS-03', 'La empresa no está activa: no se le puede pedir acceso.');
        }
        $max = self::maximo();
        if ($d['hours'] > $max) {
            RuleError::fail('RN-OPS-02', "Un acceso dura como máximo {$max} horas.");
        }
        if (! empty($d['ticket_id']) && ! DB::table('support_tickets')->where('id', $d['ticket_id'])->where('tenant_id', $tenant->id)->exists()) {
            RuleError::fail('RN-OPS-03', 'El ticket no es de esa empresa.');
        }
        $encendidos = self::modulosDe($tenant->id);
        $modulos = array_values(array_unique($d['modules'] ?? []));
        if ($fuera = array_diff($modulos, $encendidos)) {
            RuleError::fail('RN-OPS-03', 'La empresa no tiene esos módulos: '.implode(', ', $fuera).'.');
        }
        if (DB::table('support_accesses')->where('tenant_id', $tenant->id)->where('platform_user_id', $quien['id'])->whereIn('status', ['PENDING', 'ACTIVE'])->exists()) {
            RuleError::fail('RN-OPS-03', 'Ya tienes un acceso pendiente o vigente en esa empresa.');
        }

        $id = DB::table('support_accesses')->insertGetId([
            'tenant_id' => $tenant->id, 'ticket_id' => $d['ticket_id'] ?? null, 'platform_user_id' => $quien['id'], 'platform_user_name' => $quien['full_name'],
            'reason' => trim($d['reason']), 'level' => $d['level'], 'modules' => json_encode($modulos), 'can_export' => (bool) ($d['can_export'] ?? false),
            'suggested_hours' => $d['hours'], 'created_at' => now(), 'updated_at' => now(),
        ], 'id');
        self::evento($id, $tenant->id, 'REQUESTED', $quien['full_name'], detalle: mb_substr(trim($d['reason']), 0, 300));
        Consola::bitacora('ACCESS_REQUESTED', $quien, ['tenant' => $tenant->id, 'entity' => 'support_accesses', 'entity_id' => $id,
            'reason' => trim($d['reason']), 'detail' => ['nivel' => $d['level'], 'horas' => $d['hours'], 'exportar' => (bool) ($d['can_export'] ?? false), 'modulos' => $modulos]]);
        self::avisar($tenant->id, 'GestionCarnica pide acceso de soporte', "{$quien['full_name']} pide acceso de ".mb_strtolower(self::NIVELES[$d['level']])." por {$d['hours']} h: ".trim($d['reason']), solicitud: true);

        return self::detalle($id);
    }

    public static function cancelar(string $id, array $quien): array
    {
        $a = self::fila($id);
        self::esSuyoOAdmin($a, $quien);
        if ($a->status !== 'PENDING') {
            RuleError::fail('RN-OPS-03', 'Solo se cancela un acceso por aprobar.');
        }
        self::cerrar($a, 'CANCELLED', 'CANCELLED', $quien['full_name'], 'Cancelado por soporte');
        Consola::bitacora('ACCESS_CANCELLED', $quien, ['tenant' => $a->tenant_id, 'entity' => 'support_accesses', 'entity_id' => $id, 'reason' => 'Pedido de acceso cancelado']);

        return self::detalle($id);
    }

    /** El soporte termina el acceso antes de que venza (ya no lo necesita). */
    public static function terminar(string $id, array $quien): array
    {
        $a = self::fila($id);
        self::esSuyoOAdmin($a, $quien);
        if ($a->status !== 'ACTIVE') {
            RuleError::fail('RN-OPS-03', 'El acceso no está vigente.');
        }
        self::cerrar($a, 'FINISHED', 'FINISHED', $quien['full_name'], 'Terminado por soporte');
        Consola::bitacora('ACCESS_FINISHED', $quien, ['tenant' => $a->tenant_id, 'entity' => 'support_accesses', 'entity_id' => $id, 'reason' => 'Acceso de soporte terminado']);

        return self::detalle($id);
    }

    /** OPS-06: sesión del soporte en la empresa, con el usuario técnico del acceso. Devuelve el token (vence con el acceso). */
    public static function entrar(string $id, array $quien, Request $request): array
    {
        $a = self::fila($id);
        if ($a->platform_user_id !== $quien['id']) {
            RuleError::fail('RN-OPS-04', 'El acceso es personal: solo entra la persona a la que se otorgó.');
        }
        if ($a->status !== 'ACTIVE' || now()->greaterThanOrEqualTo(Carbon::parse($a->expires_at))) {
            RuleError::fail('RN-OPS-04', 'El acceso no está vigente.');
        }
        $primera = $a->first_used_at === null;
        $token = self::enEmpresa($a->tenant_id, function () use ($a, $request) {
            $tecnico = User::find($a->tech_user_id);
            if (! $tecnico || $tecnico->status !== 'ACTIVE') {
                RuleError::fail('RN-OPS-04', 'El usuario de soporte de la empresa no está activo.');
            }
            $t = $tecnico->createToken('soporte', ['*'], Carbon::parse($a->expires_at));
            $t->accessToken->forceFill(['ip' => mb_substr((string) $request->ip(), 0, 40), 'device' => Bitacora::dispositivo((string) $request->userAgent())])->save();

            return $t->plainTextToken;
        });
        DB::table('support_accesses')->where('id', $id)->update(['first_used_at' => $a->first_used_at ?? now(), 'updated_at' => now()]);
        self::evento($id, $a->tenant_id, 'SESSION_STARTED', $quien['full_name'], ip: $request->ip());
        Consola::bitacora('ACCESS_SESSION_STARTED', $quien, ['tenant' => $a->tenant_id, 'entity' => 'support_accesses', 'entity_id' => $id, 'reason' => 'Entró a la empresa con el acceso de soporte']);
        if ($primera) {
            self::avisar($a->tenant_id, 'El soporte empezó a usar su acceso', "{$a->platform_user_name} entró con el acceso de ".mb_strtolower(self::NIVELES[$a->level]).'.');
        }

        return ['token' => $token, 'expires_at' => $a->expires_at];
    }

    public static function listaConsola(array $f): array
    {
        $q = DB::table('support_accesses as a')->join('tenants as t', 't.id', '=', 'a.tenant_id')->leftJoin('support_tickets as k', 'k.id', '=', 'a.ticket_id')
            ->select('a.*', 't.short as tenant_short', 'k.number as ticket_number', 'k.subject as ticket_subject');
        if (! empty($f['status'])) {
            $f['status'] === 'ABIERTOS' ? $q->whereIn('a.status', ['PENDING', 'ACTIVE']) : $q->where('a.status', $f['status']);
        }
        if (! empty($f['tenant'])) {
            $q->where('a.tenant_id', $f['tenant']);
        }
        $filas = $q->orderByRaw("CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END")->orderByDesc('a.created_at')->limit(300)->get();

        return $filas->map(fn ($a) => self::presentar($a))->all();
    }

    /** Datos para el formulario de pedido: empresas activas, sus módulos encendidos y el tope de horas. */
    public static function opciones(?string $tenant): array
    {
        return [
            'empresas' => DB::table('tenants')->where('status', 'ACTIVE')->orderBy('short')->get(['id', 'short']),
            'modulos' => $tenant ? self::modulosDe($tenant) : [],
            'tickets' => $tenant ? DB::table('support_tickets')->where('tenant_id', $tenant)->whereNotIn('status', ['CLOSED'])->orderByDesc('opened_at')->limit(50)->get(['id', 'number', 'subject']) : [],
            'max_horas' => self::maximo(),
            'niveles' => self::NIVELES,
        ];
    }

    public static function verConsola(string $id): array
    {
        return self::detalle($id, true);
    }

    /* ------------------------------------------------------------------ OPS-14 la empresa */

    public static function deLaEmpresa(User $u): array
    {
        $filas = DB::table('support_accesses as a')->leftJoin('support_tickets as k', 'k.id', '=', 'a.ticket_id')
            ->select('a.*', 'k.number as ticket_number', 'k.subject as ticket_subject')
            ->orderByRaw("CASE a.status WHEN 'PENDING' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END")->orderByDesc('a.created_at')->limit(100)->get();

        return [
            'data' => $filas->map(fn ($a) => self::presentar($a))->all(),
            'horas_por_defecto' => self::porDefecto(), 'max_horas' => self::maximo(),
        ];
    }

    /** Lo que hizo el soporte con el acceso (ops.support_access.view_log). */
    public static function verDeLaEmpresa(string $id, bool $conBitacora): array
    {
        return self::detalle($id, $conBitacora);
    }

    public static function aprobar(User $u, string $id, ?int $horas): array
    {
        $a = self::fila($id);
        if ($a->status !== 'PENDING') {
            RuleError::fail('RN-OPS-03', 'Solo se aprueba un acceso por aprobar.');
        }
        $horas ??= self::porDefecto();
        $max = self::maximo();
        if ($horas < 1 || $horas > $max) {
            RuleError::fail('RN-OPS-02', "Un acceso dura entre 1 y {$max} horas.");
        }
        $tecnico = self::usuarioTecnico($a);
        DB::table('support_accesses')->where('id', $id)->update([
            'status' => 'ACTIVE', 'hours' => $horas, 'expires_at' => now()->addHours($horas), 'decided_by' => $u->id, 'decided_by_name' => $u->name,
            'decided_at' => now(), 'tech_user_id' => $tecnico, 'updated_at' => now(),
        ]);
        self::evento($id, $a->tenant_id, 'APPROVED', $u->name, detalle: "Por {$horas} h");
        self::avisar($a->tenant_id, 'Acceso de soporte aprobado', "{$u->name} aprobó el acceso de {$a->platform_user_name} por {$horas} h.");

        return self::detalle($id);
    }

    public static function rechazar(User $u, string $id, string $motivo): array
    {
        $a = self::fila($id);
        if ($a->status !== 'PENDING') {
            RuleError::fail('RN-OPS-03', 'Solo se rechaza un acceso por aprobar.');
        }
        DB::table('support_accesses')->where('id', $id)->update(['decided_by' => $u->id, 'decided_by_name' => $u->name, 'decided_at' => now(), 'decision_reason' => mb_substr(trim($motivo), 0, 300)]);
        self::cerrar($a, 'REJECTED', 'REJECTED', $u->name, trim($motivo), avisar: false);

        return self::detalle($id);
    }

    public static function revocar(User $u, string $id, ?string $motivo): array
    {
        $a = self::fila($id);
        if ($a->status !== 'ACTIVE') {
            RuleError::fail('RN-OPS-03', 'Solo se revoca un acceso vigente.');
        }
        self::cerrar($a, 'REVOKED', 'REVOKED', $u->name, $motivo ? trim($motivo) : 'Revocado por la empresa');

        return self::detalle($id);
    }

    /* ------------------------------------------------------------------ OPS-06 la sesión (middleware y /me) */

    /** El acceso vigente de un usuario técnico (o null: entonces no puede hacer nada). */
    public static function vigenteDe(User $tecnico): ?object
    {
        return DB::table('support_accesses')->where('tech_user_id', $tecnico->id)->where('status', 'ACTIVE')->where('expires_at', '>', now())->first();
    }

    /** Lo que ve /me de una sesión de soporte: la franja con nivel, exportación y cuánto le queda. */
    public static function paraMe(User $u): ?array
    {
        if ($u->user_type !== self::TIPO_USUARIO || ! ($a = self::vigenteDe($u))) {
            return null;
        }

        return ['level' => $a->level, 'level_name' => self::NIVELES[$a->level], 'can_export' => (bool) $a->can_export, 'expires_at' => $a->expires_at,
            'platform_user_name' => $a->platform_user_name];
    }

    /** Módulos y letras del usuario técnico para Access: solo los del acceso (todos los encendidos si no se eligieron). */
    public static function accesoTecnico(User $u): array
    {
        $a = self::vigenteDe($u);
        if (! $a) {
            return [];
        }
        $letras = $a->level === 'RW' ? 'CLE' : 'L';
        $modulos = json_decode($a->modules, true) ?: ['*'];

        return array_fill_keys($modulos, $letras);
    }

    /** RN-OPS-04: cada consulta, cambio, exportación o intento rechazado del soporte. */
    public static function registrar(object $a, Request $request, int $estado, ?string $tipo = null, ?string $detalle = null): void
    {
        if (! $tipo && $request->is(...self::SIN_REGISTRO)) {
            return;
        }
        $tipo ??= $request->isMethodSafe() ? 'READ' : 'WRITE';
        self::evento($a->id, $a->tenant_id, $tipo, $a->platform_user_name, $request->method(), mb_substr('/'.$request->path(), 0, 300), $estado, $detalle, $request->ip());
    }

    /** RN-OPS-09: tarea de cada minuto. Devuelve cuántos vencieron. */
    public static function vencer(): int
    {
        TenantContext::platform();
        $n = 0;
        foreach (DB::table('support_accesses')->where('status', 'ACTIVE')->where('expires_at', '<=', now())->get() as $a) {
            self::cerrar($a, 'EXPIRED', 'EXPIRED', 'Sistema', 'Venció el plazo del acceso');
            $n++;
        }
        TenantContext::set(null);

        return $n;
    }

    /* ------------------------------------------------------------------ internos */

    /** Cierra un acceso: estado final, usuario técnico desactivado y sus sesiones cerradas (RN-OPS-09). */
    private static function cerrar(object $a, string $estado, string $evento, string $actor, string $motivo, bool $avisar = true): void
    {
        DB::table('support_accesses')->where('id', $a->id)->update(['status' => $estado, 'ended_at' => now(), 'ended_by_name' => mb_substr($actor, 0, 120),
            'end_reason' => mb_substr($motivo, 0, 300), 'updated_at' => now()]);
        if ($a->tech_user_id) {
            self::enEmpresa($a->tenant_id, function () use ($a, $motivo) {
                $otro = DB::table('support_accesses')->where('tech_user_id', $a->tech_user_id)->where('id', '!=', $a->id)->where('status', 'ACTIVE')->exists();
                if (! $otro && ($u = User::find($a->tech_user_id))) {
                    Sesiones::cerrando('REVOKED', 'Acceso de soporte cerrado', fn () => $u->tokens()->delete());
                    $u->forceFill(['status' => 'INACTIVE', 'deactivated_at' => now(), 'deactivated_reason' => mb_substr("Acceso de soporte: {$motivo}", 0, 255)])->save();
                }
            });
        }
        self::evento($a->id, $a->tenant_id, $evento, $actor, detalle: mb_substr($motivo, 0, 300));
        if ($avisar && $a->status === 'ACTIVE') {
            self::avisar($a->tenant_id, 'Terminó un acceso de soporte', "El acceso de {$a->platform_user_name} terminó: ".mb_strtolower(self::ESTADOS[$estado]).'.');
        }
    }

    /** El usuario técnico de esa persona del soporte en la empresa: se crea la primera vez y se activa al aprobar. */
    private static function usuarioTecnico(object $a): string
    {
        return self::enEmpresa($a->tenant_id, function () use ($a) {
            $p = DB::table('platform_users')->where('id', $a->platform_user_id)->first(['email', 'full_name']);
            [$local, $dominio] = explode('@', $p->email, 2);
            $correo = mb_strtolower("{$local}+soporte@{$dominio}");
            $u = User::where('email', $correo)->first();
            if ($u && $u->user_type !== self::TIPO_USUARIO) {
                RuleError::fail('RN-OPS-04', 'La empresa ya tiene un usuario con el correo del soporte.');
            }
            $u ??= new User;
            $u->forceFill([
                'name' => mb_substr("Soporte GestionCarnica · {$p->full_name}", 0, 120), 'email' => $correo, 'role' => 'SOPORTE_PLATAFORMA',
                'user_type' => self::TIPO_USUARIO, 'status' => 'ACTIVE', 'password' => $u->password ?? Hash::make(Str::random(64)),
                'failed_logins' => 0, 'twofa_enabled' => false, 'must_change_password' => false, 'password_changed_at' => now(),
                'deactivated_at' => null, 'deactivated_reason' => null,
            ])->save();

            return $u->id;
        });
    }

    /** Corre $fn con el contexto de la empresa y vuelve al que había (consola o la misma empresa). */
    private static function enEmpresa(string $tenantId, \Closure $fn): mixed
    {
        $antes = TenantContext::id();
        $plataforma = DB::selectOne("SELECT current_setting('app.platform', true) = 'on' AS si")->si;
        if ($antes === $tenantId) {
            return $fn();
        }
        TenantContext::set(TenantContext::find($tenantId));
        try {
            return $fn();
        } finally {
            $plataforma ? TenantContext::platform() : TenantContext::set($antes ? TenantContext::find($antes) : null);
        }
    }

    private static function evento(string $acceso, string $tenant, string $tipo, string $actor, ?string $metodo = null, ?string $ruta = null, ?int $estado = null,
        ?string $detalle = null, ?string $ip = null): void
    {
        DB::table('support_access_events')->insert(['access_id' => $acceso, 'tenant_id' => $tenant, 'kind' => $tipo, 'actor_name' => mb_substr($actor, 0, 120),
            'method' => $metodo, 'path' => $ruta, 'status_code' => $estado, 'detail' => $detalle, 'ip' => $ip ? mb_substr($ip, 0, 45) : null, 'at' => now()]);
    }

    /**
     * RN-OPS-12: aviso en la campana a quienes aprueban accesos (gerencia y roles con ops.support_access.approve).
     * El pedido se avisa siempre (alguien tiene que aprobarlo); lo demás, según ops_support_notify_admins.
     */
    private static function avisar(string $tenant, string $titulo, string $texto, bool $solicitud = false): void
    {
        self::enEmpresa($tenant, function () use ($titulo, $texto, $solicitud) {
            $avisar = Params::get('ops_support_notify_admins');
            if (! $solicitud && in_array($avisar, [false, 'false', '0', 0], true)) {
                return;
            }
            $ids = DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')->join('users', 'users.id', '=', 'user_roles.user_id')
                ->where('users.status', 'ACTIVE')->where('roles.status', 'ACTIVE')
                ->where(fn ($w) => $w->where('roles.code', 'GERENTE')->orWhereExists(fn ($e) => $e->from('role_permissions')
                    ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
                    ->whereColumn('role_permissions.role_id', 'roles.id')->where('permissions.code', 'ops.support_access.approve')))
                ->distinct()->pluck('users.id');
            $filas = $ids->map(fn ($id) => ['user_id' => $id, 'module' => 'OPS', 'tone' => $solicitud ? 'warn' : 'info', 'at' => now(), 'title' => $titulo,
                'body' => mb_substr($texto, 0, 240), 'ref' => json_encode(['href' => '/soporte?tab=accesos'])])->all();
            if ($filas) {
                DB::table('notifications')->insert($filas);
            }
        });
    }

    private static function esSuyoOAdmin(object $a, array $quien): void
    {
        if ($a->platform_user_id !== $quien['id'] && $quien['role'] !== 'PLATFORM_ADMIN') {
            RuleError::fail('RN-OPS-10', 'Solo quien pidió el acceso o un administrador de plataforma.');
        }
    }

    private static function fila(string $id): object
    {
        return DB::table('support_accesses')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    private static function detalle(string $id, bool $conBitacora = false): array
    {
        $a = DB::table('support_accesses as a')->leftJoin('support_tickets as k', 'k.id', '=', 'a.ticket_id')->where('a.id', $id)
            ->select('a.*', 'k.number as ticket_number', 'k.subject as ticket_subject')->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        $a->tenant_short = DB::table('tenants')->where('id', $a->tenant_id)->value('short');

        return self::presentar($a) + [
            'eventos' => $conBitacora ? DB::table('support_access_events')->where('access_id', $id)->orderByDesc('at')->limit(500)
                ->get(['kind', 'actor_name', 'method', 'path', 'status_code', 'detail', 'at']) : null,
            'resumen' => DB::table('support_access_events')->where('access_id', $id)->whereIn('kind', ['READ', 'WRITE', 'EXPORT', 'DENIED'])
                ->selectRaw('kind, count(*) AS n')->groupBy('kind')->pluck('n', 'kind'),
        ];
    }

    private static function presentar(object $a): array
    {
        return [
            'id' => $a->id, 'tenant_id' => $a->tenant_id, 'tenant_short' => $a->tenant_short ?? null, 'ticket_id' => $a->ticket_id,
            'ticket_number' => $a->ticket_number ?? null, 'ticket_subject' => $a->ticket_subject ?? null,
            'platform_user_id' => $a->platform_user_id, 'platform_user_name' => $a->platform_user_name, 'reason' => $a->reason,
            'level' => $a->level, 'level_name' => self::NIVELES[$a->level], 'modules' => json_decode($a->modules, true), 'can_export' => (bool) $a->can_export,
            'suggested_hours' => $a->suggested_hours, 'hours' => $a->hours, 'status' => $a->status, 'status_name' => self::ESTADOS[$a->status],
            'decided_by_name' => $a->decided_by_name, 'decided_at' => $a->decided_at, 'decision_reason' => $a->decision_reason,
            'expires_at' => $a->expires_at, 'first_used_at' => $a->first_used_at, 'ended_at' => $a->ended_at, 'ended_by_name' => $a->ended_by_name,
            'end_reason' => $a->end_reason, 'created_at' => $a->created_at,
        ];
    }

    /** @return string[] */
    private static function modulosDe(string $tenant): array
    {
        return array_column(DB::select('SELECT module_code FROM platform_tenant_modules() WHERE tenant_id = ? AND enabled ORDER BY module_code', [$tenant]), 'module_code');
    }

    private static function maximo(): int
    {
        return (int) Consola::param('ops_support_max_hours', 72);
    }

    private static function porDefecto(): int
    {
        return min(max((int) (Params::get('ops_support_default_hours') ?? 8), 1), self::maximo());
    }
}
