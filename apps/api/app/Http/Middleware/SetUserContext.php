<?php

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Después de auth:sanctum: fija app.user_id y corta las sesiones de usuarios que ya no están activos. */
class SetUserContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user->status !== 'ACTIVE') {
            $user->currentAccessToken()?->delete();

            return response()->json(['message' => 'Tu usuario no está activo.', 'code' => 'USER_INACTIVE'], 401);
        }

        TenantContext::setUser($user->id);

        return $next($request);
    }
}
