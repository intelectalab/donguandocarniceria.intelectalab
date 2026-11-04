<?php

namespace App\Http\Middleware;

use App\Support\Access;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rutas de un módulo: ->middleware('modulo:PED') para leer, ->middleware('modulo:PED,C') para crear.
 * Un módulo apagado para la empresa se bloquea con RN-PLT-07 aunque el rol tenga acceso.
 */
class CheckModuleAccess
{
    public function handle(Request $request, Closure $next, string $module, string $action = 'L'): Response
    {
        $user = $request->user();

        if (! in_array($module, Access::for($user)['enabled_modules'], true)) {
            return response()->json(['message' => "RN-PLT-07: el módulo {$module} está apagado para tu empresa.", 'code' => 'MODULE_DISABLED'], 403);
        }
        if (! Access::module($user, $module, $action)) {
            return response()->json(['message' => "Tu rol no tiene acceso a {$module} ({$action}).", 'code' => 'MODULE_DENIED'], 403);
        }

        return $next($request);
    }
}
