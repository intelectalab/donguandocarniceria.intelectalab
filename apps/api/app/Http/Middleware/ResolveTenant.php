<?php

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Primera pieza de toda ruta de empresa: fija de qué empresa es la petición (app.tenant_id, RLS).
 * Va antes de auth:sanctum: el token y el usuario solo se encuentran dentro de su empresa.
 *  - Modo general (config aycha.tenant_por_dominio = false, por ahora): la empresa del token.
 *    Sin token (ingreso, recuperar contraseña) no hay empresa todavía: el controlador la busca
 *    por el correo (TenantContext::forEmail).
 *  - Modo por dominio: la empresa del dominio (X-Tenant-Host; en producción lo fija Nginx).
 */
class ResolveTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('aycha.tenant_por_dominio')) {
            $tenant = TenantContext::resolveToken($request->bearerToken());
            TenantContext::set($tenant && $tenant['status'] === 'ACTIVE' ? $tenant : null);
            if ($tenant && $tenant['status'] !== 'ACTIVE') {
                return $this->bloqueada();
            }
            $request->attributes->set('tenant_id', TenantContext::id());

            return $next($request);
        }

        $tenant = TenantContext::resolveHost($request->header('X-Tenant-Host') ?: $request->getHost());

        if (! $tenant) {
            TenantContext::set(null);

            return response()->json(['message' => 'No hay una empresa registrada para este dominio.', 'code' => 'TENANT_NOT_FOUND'], 404);
        }
        if ($tenant['status'] !== 'ACTIVE') {
            TenantContext::set(null);

            return $this->bloqueada();
        }

        TenantContext::set($tenant);
        $request->attributes->set('tenant_id', $tenant['id']);

        return $next($request);
    }

    private function bloqueada(): Response
    {
        return response()->json(['message' => 'Esta empresa no está activa. Comunícate con Aycha.', 'code' => 'TENANT_BLOCKED'], 403);
    }
}
