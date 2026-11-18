<?php

namespace App\Http\Middleware;

use App\Modulos\Seg\Services\Sesiones;
use App\Support\PasswordPolicy;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Después de auth:sanctum: fija app.user_id, corta las sesiones de usuarios que ya no están activos y, con la contraseña vencida, solo deja cambiarla. */
class SetUserContext
{
    /** Lo único que se puede usar mientras la contraseña está vencida. */
    private const CON_CLAVE_VENCIDA = ['api/v1/me', 'api/v1/me/password', 'api/v1/me/notifications*', 'api/v1/auth/logout', 'api/v1/seg/mi-cuenta', 'api/v1/seg/mi-cuenta/*'];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user->status !== 'ACTIVE') {
            Sesiones::cerrando('REVOKED', 'Usuario no activo', fn () => $user->currentAccessToken()?->delete());

            return response()->json(['message' => 'Tu usuario no está activo.', 'code' => 'USER_INACTIVE'], 401);
        }

        TenantContext::setUser($user->id);

        // RN-SEG-02: con la contraseña vencida (o si se le pidió cambiarla) solo puede ver su cuenta y
        // cambiarla; el resto de la API responde 403 hasta que la cambie.
        if (! $request->is(...self::CON_CLAVE_VENCIDA) && PasswordPolicy::debeCambiar($user)) {
            return response()->json(['message' => 'Tu contraseña venció: crea una nueva en Mi cuenta para seguir.', 'code' => 'PASSWORD_CHANGE_REQUIRED'], 403);
        }

        return $next($request);
    }
}
