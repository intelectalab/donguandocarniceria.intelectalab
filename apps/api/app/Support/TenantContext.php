<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Contexto de la petición en Postgres. Las políticas RLS leen app.tenant_id; la bitácora y los
 * eventos leen app.user_id. Sin tenant fijado, ninguna tabla de negocio devuelve filas.
 *
 * Los trabajos en cola y los comandos que tocan datos de una empresa deben llamar a set()
 * antes de consultar: no heredan el contexto de la petición que los creó.
 */
final class TenantContext
{
    private const COLUMNAS = 'id, name, short, plan, status';

    private static ?array $tenant = null;

    public static function set(?array $tenant): void
    {
        self::$tenant = $tenant;
        DB::select("SELECT set_config('app.tenant_id', ?, false), set_config('app.user_id', '', false)", [$tenant['id'] ?? '']);
    }

    public static function setUser(?string $userId): void
    {
        DB::select("SELECT set_config('app.user_id', ?, false)", [$userId ?? '']);
    }

    public static function tenant(): ?array
    {
        return self::$tenant;
    }

    public static function id(): ?string
    {
        return self::$tenant['id'] ?? null;
    }

    /** tenants es global (sin RLS). */
    public static function find(?string $id): ?array
    {
        $row = $id ? DB::selectOne('SELECT '.self::COLUMNAS.' FROM tenants WHERE id = ?', [$id]) : null;

        return $row ? (array) $row : null;
    }

    /** Modo por dominio: la empresa del dominio (tenant_hostnames, global). */
    public static function resolveHost(string $host): ?array
    {
        $host = strtolower(preg_replace('/:\d+$/', '', trim($host)));
        $row = DB::selectOne(
            "SELECT t.id, t.name, t.short, t.plan, t.status
               FROM tenant_hostnames h JOIN tenants t ON t.id = h.tenant_id
              WHERE h.hostname = ? AND h.status = 'ACTIVE'",
            [$host]
        );

        return $row ? (array) $row : null;
    }

    /** Modo general: la empresa del token «id|texto» (solo el id; Sanctum valida el resto). */
    public static function resolveToken(?string $bearer): ?array
    {
        $id = $bearer && str_contains($bearer, '|') ? strtok($bearer, '|') : null;
        if (! $id || ! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            return null;
        }

        return self::find(DB::selectOne('SELECT auth_tenant_for_token(?) AS t', [$id])?->t);
    }

    /**
     * Modo general: recorre las empresas activas donde existe el correo, con su contexto fijado,
     * hasta que $fn devuelva algo. Con el contexto de dominio ya fijado, solo prueba esa empresa.
     */
    public static function forEmail(string $email, callable $fn): mixed
    {
        if (self::id()) {
            return $fn(self::$tenant);
        }
        $ids = array_column(DB::select('SELECT auth_tenants_for_email(?) AS t', [$email]), 't');
        foreach ($ids as $id) {
            self::set(self::find($id));
            if (($r = $fn(self::$tenant)) !== null) {
                return $r;
            }
        }
        self::set(null);

        return null;
    }
}
