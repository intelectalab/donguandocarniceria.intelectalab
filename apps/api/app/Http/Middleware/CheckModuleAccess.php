<?php

namespace App\Http\Middleware;

use App\Modulos\Seg\Services\Bitacora;
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
            // KPI-AUD-03: cada acceso denegado queda en la bitácora de accesos (AUD-03).
            Bitacora::registrar('MODULE_DISABLED', ['user' => $user, 'detail' => "Módulo {$module} apagado · {$request->method()} /{$request->path()}"], denegado: true);

            return response()->json(['message' => "RN-PLT-07: el módulo {$module} está apagado para tu empresa.", 'code' => 'MODULE_DISABLED'], 403);
        }
        if (! Access::module($user, $module, $action)) {
            Bitacora::registrar('PERMISSION_DENIED', ['user' => $user, 'detail' => "Sin acceso a {$module} ({$action}) · {$request->method()} /{$request->path()}"], denegado: true);

            return response()->json(['message' => "Tu rol no tiene acceso a {$module} ({$action}).", 'code' => 'MODULE_DENIED'], 403);
        }

        return $next($request);
    }
}
