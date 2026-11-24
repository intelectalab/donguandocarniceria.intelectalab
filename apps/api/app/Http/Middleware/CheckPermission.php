<?php

namespace App\Http\Middleware;

use App\Modulos\Seg\Services\Bitacora;
use App\Support\Access;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ruta que exige un permiso especial de la spec: ->middleware('permiso:ped.discount.approve').
 * Con varios separados por | basta uno: ->middleware('permiso:equ.failure.report|equ.maintenance.manage').
 */
class CheckPermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $permisos = explode('|', $permission);
        foreach ($permisos as $p) {
            if (Access::can($request->user(), $p)) {
                return $next($request);
            }
        }
        // El mensaje dice qué acción falta, sin el código interno del permiso.
        $accion = DB::table('permissions')->where('code', $permisos[0])->value('description');
        // KPI-AUD-03: cada acceso denegado queda en la bitácora de accesos (AUD-03).
        Bitacora::registrar('PERMISSION_DENIED', ['user' => $request->user(),
            'detail' => ($accion ? 'Sin permiso para: '.mb_strtolower($accion) : 'Sin permiso').' · '.$request->method().' /'.$request->path()], denegado: true);

        return response()->json([
            'message' => $accion ? 'No tienes permiso para esta acción: '.mb_strtolower(mb_substr($accion, 0, 1)).mb_substr($accion, 1).'.' : 'No tienes permiso para esta acción.',
            'code' => 'PERMISSION_DENIED', 'permission' => $permission,
        ], 403);
    }
}
