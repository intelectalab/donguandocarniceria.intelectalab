<?php

namespace App\Http\Middleware;

use App\Support\Access;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Ruta que exige un permiso especial de la spec: ->middleware('permiso:ped.discount.approve'). */
class CheckPermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        if (! Access::can($request->user(), $permission)) {
            return response()->json(['message' => "No tienes el permiso {$permission}.", 'code' => 'PERMISSION_DENIED'], 403);
        }

        return $next($request);
    }
}
