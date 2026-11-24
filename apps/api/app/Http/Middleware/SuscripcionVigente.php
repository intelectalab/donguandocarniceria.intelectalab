<?php

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * RN-SUS-07: una empresa en solo lectura (READ_ONLY) o con la suscripción cancelada no registra nada (402). Puede
 * consultar y exportar (peticiones GET), cambiar su contraseña y cerrar sesión. La suspensión total la corta antes
 * ResolveTenant (tenants.status). Una empresa sin suscripción (piloto o interna) no tiene bloqueos (RN-SUS-21).
 */
class SuscripcionVigente
{
    /** Lo que se puede hacer en solo lectura aunque no sea una consulta. */
    private const PERMITIDO = ['api/v1/auth/logout', 'api/v1/me/password', 'api/v1/me/notifications*', 'api/v1/seg/mi-cuenta*', 'api/v1/soporte/*', 'api/v1/suscripcion*'];

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethodSafe() || $request->is(...self::PERMITIDO) || ! TenantContext::id()) {
            return $next($request);
        }
        $estado = DB::table('subscriptions')->where('tenant_id', TenantContext::id())
            ->orderByRaw("status = 'CANCELLED'")->orderByDesc('started_at')->value('status');
        if (in_array($estado, ['READ_ONLY', 'CANCELLED'], true)) {
            return response()->json([
                'message' => $estado === 'CANCELLED'
                    ? 'La suscripción de tu empresa está cancelada: puedes consultar y exportar tus datos, pero no registrar nada nuevo.'
                    : 'Tu empresa está en solo lectura por un pago pendiente: puedes consultar y exportar, pero no registrar nada nuevo.',
                'code' => 'RN-SUS-07',
            ], 402);
        }

        return $next($request);
    }
}
