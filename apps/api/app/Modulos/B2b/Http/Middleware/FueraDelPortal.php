<?php

namespace App\Modulos\B2b\Http\Middleware;

use App\Modulos\B2b\Services\Portal;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rutas internas de CON, B2B y CMP: un usuario del portal B2B (tipo B2B_CUSTOMER o con cuenta de portal)
 * no entra aunque su rol tenga lectura del módulo. Solo usa /api/v1/b2b/portal/* (RN-B2B-12).
 */
class FueraDelPortal
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user() && Portal::esUsuarioDelPortal($request->user())) {
            return response()->json(['message' => 'Esta sección es del personal de la empresa. Entra por el portal de clientes.', 'code' => 'PORTAL_ONLY'], 403);
        }

        return $next($request);
    }
}
