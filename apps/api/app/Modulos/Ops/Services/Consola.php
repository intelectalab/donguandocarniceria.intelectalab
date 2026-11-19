<?php

namespace App\Modulos\Ops\Services;

use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Piezas comunes de la consola de Intelectalab: parámetros de plataforma, roles y lo que puede hacer cada uno
 * (RN-OPS-10), y la bitácora de la consola (RN-OPS-05 y RN-OPS-11). El usuario de la consola es una fila de
 * platform_users (array), nunca un usuario de empresa.
 */
final class Consola
{
    public const ROLES = [
        'PLATFORM_ADMIN' => 'Administrador de plataforma',
        'BILLING' => 'Cobranza',
        'SUPPORT_L1' => 'Soporte nivel 1',
        'SUPPORT_L2' => 'Soporte nivel 2',
        'ENGINEER' => 'Ingeniería',
        'READ_ONLY' => 'Solo consulta',
    ];

    public const ESTADOS = ['INVITED' => 'Invitado', 'ACTIVE' => 'Activo', 'LOCKED' => 'Bloqueado', 'DISABLED' => 'De baja'];

    /** RN-OPS-10: lo que hace cada rol. «*» es todo. */
    private const PUEDE = [
        'PLATFORM_ADMIN' => ['*'],
        'BILLING' => ['tenant.status', 'plans.manage', 'metrics.freeze'],
        'SUPPORT_L1' => ['ticket.manage', 'access.request_ro'],
        'SUPPORT_L2' => ['ticket.manage', 'access.request_ro', 'access.request_rw', 'reprocess'],
        'ENGINEER' => ['health.record', 'incident.manage', 'access.request_ro', 'access.request_rw', 'announce.manage', 'ticket.manage'],
        'READ_ONLY' => [],
    ];

    private const ACCION = ['users.manage' => 'administrar usuarios de plataforma', 'params.manage' => 'cambiar parámetros de plataforma',
        'tenant.status' => 'cambiar el estado de una suscripción ni suspender o reactivar empresas', 'tenant.create' => 'dar de alta empresas',
        'plans.manage' => 'administrar planes, pruebas ni descuentos', 'catalogs.import' => 'importar catálogos globales'];

    /** Dominios de correo permitidos para las cuentas de la consola (parámetro de plataforma; vacío = cualquiera). */
    public static function dominios(): array
    {
        return array_values(array_filter((array) self::param('ops_platform_email_domains', ['intelectalab.com'])));
    }

    public static function param(string $key, mixed $porDefecto = null): mixed
    {
        $v = DB::table('platform_parameters')->where('key', $key)->value('value');

        return $v === null ? $porDefecto : json_decode($v, true);
    }

    public static function puede(array $usuario, string $accion): bool
    {
        return ($usuario['status'] ?? null) === 'ACTIVE'
            && collect(self::PUEDE[$usuario['role']] ?? [])->contains(fn ($c) => $c === '*' || $c === $accion);
    }

    public static function exigir(array $usuario, string $accion): void
    {
        if (! self::puede($usuario, $accion)) {
            $quienes = collect(self::PUEDE)->filter(fn ($caps) => in_array('*', $caps, true) || in_array($accion, $caps, true))
                ->keys()->map(fn ($r) => self::ROLES[$r])->join(', ');
            RuleError::fail('RN-OPS-10', 'Tu rol ('.self::ROLES[$usuario['role']].') no puede '.(self::ACCION[$accion] ?? $accion).". Pueden: {$quienes}.");
        }
    }

    /** Toda acción de la consola queda aquí (solo inserción). $usuario null = el sistema o un intento sin cuenta. */
    public static function bitacora(string $accion, ?array $usuario, array $datos = []): void
    {
        DB::table('platform_audit_log')->insert([
            'platform_user_id' => $usuario['id'] ?? null,
            'actor_name' => $usuario['full_name'] ?? ($datos['actor'] ?? 'Sistema'),
            'action' => $accion,
            'target_tenant_id' => $datos['tenant'] ?? null,
            'entity' => $datos['entity'] ?? null,
            'entity_id' => $datos['entity_id'] ?? null,
            'reason' => isset($datos['reason']) ? mb_substr($datos['reason'], 0, 300) : null,
            'ip' => mb_substr((string) request()?->ip(), 0, 45) ?: null,
            'detail' => json_encode($datos['detail'] ?? (object) [], JSON_UNESCAPED_UNICODE),
            'occurred_at' => now(),
        ]);
    }

    /** RN-OPS-16: ¿la IP está en la lista? Acepta IP exacta o red CIDR (IPv4). Lista vacía = todas. */
    public static function ipPermitida(?string $ip, array $lista): bool
    {
        if (! $lista) {
            return true;
        }
        $n = $ip ? ip2long($ip) : false;
        if ($n === false) {
            return false;
        }
        foreach ($lista as $red) {
            [$base, $bits] = array_pad(explode('/', (string) $red), 2, '32');
            $b = ip2long($base);
            $bits = max(0, min(32, (int) $bits));
            $mascara = $bits === 0 ? 0 : (~0 << (32 - $bits)) & 0xFFFFFFFF;
            if ($b !== false && ($n & $mascara) === ($b & $mascara)) {
                return true;
            }
        }

        return false;
    }
}
