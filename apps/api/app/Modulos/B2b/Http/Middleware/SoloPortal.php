<?php

namespace App\Modulos\B2b\Http\Middleware;

use App\Modulos\B2b\Services\Portal;
use App\Support\Access;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rutas del portal B2B: exige b2b.portal.access y una cuenta de portal activa; fija el cliente de la
 * cuenta en la petición (portal_account) para que todo se filtre por él (RN-B2B-12, CA-B2B-04).
 */
class SoloPortal
{
    public function handle(Request $request, Closure $next): Response
    {
        $u = $request->user();
        $cuenta = $u ? Portal::cuentaDe($u) : null;
        if (! $u || ! Access::can($u, 'b2b.portal.access') || ! $cuenta) {
            return response()->json(['message' => 'No tienes acceso al portal de clientes.', 'code' => 'PERMISSION_DENIED'], 403);
        }
        $request->attributes->set('portal_account', $cuenta);

        return $next($request);
    }
}
