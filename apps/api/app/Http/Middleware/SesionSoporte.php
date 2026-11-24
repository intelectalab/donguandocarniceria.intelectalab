<?php

namespace App\Http\Middleware;

use App\Modulos\Ops\Services\Accesos;
use App\Modulos\Seg\Services\Sesiones;
use App\Support\Access;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * OPS-06 Sesión de soporte (RN-OPS-04): si quien llama es el usuario técnico del soporte, actúa solo dentro de un
 * acceso vigente, en los módulos del acceso, sin modificar si es de solo lectura y sin exportar si no se permitió.
 * Todo queda en la bitácora del acceso, también lo rechazado. Para cualquier otro usuario no hace nada.
 */
class SesionSoporte
{
    /** Lo que el soporte puede hacer aunque sea de solo lectura. */
    private const SIEMPRE = ['api/v1/auth/logout', 'api/v1/me/notifications*'];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user || $user->user_type !== Accesos::TIPO_USUARIO) {
            return $next($request);
        }
        $a = Accesos::vigenteDe($user);
        if (! $a) {
            Sesiones::cerrando('REVOKED', 'Acceso de soporte no vigente', fn () => $user->tokens()->delete());

            return response()->json(['message' => 'El acceso de soporte ya no está vigente.', 'code' => 'RN-OPS-04'], 401);
        }

        $modulo = strtoupper((string) $request->segment(3));
        $permitidos = json_decode($a->modules, true) ?: [];
        if ($permitidos && in_array($modulo, Access::for($user)['enabled_modules'], true) && ! in_array($modulo, $permitidos, true)) {
            return $this->negar($a, $request, 'El acceso de soporte no incluye este módulo.');
        }
        if ($a->level === 'RO' && ! $request->isMethodSafe() && ! $request->is(...self::SIEMPRE)) {
            return $this->negar($a, $request, 'El acceso de soporte es de solo lectura: no puede modificar nada.');
        }
        $exporta = (bool) preg_match('#/(exportar|export|descargar)(/|$)#', '/'.$request->path());
        if ($exporta && ! $a->can_export) {
            return $this->negar($a, $request, 'El acceso de soporte no permite exportar.');
        }

        $response = $next($request);

        // Una descarga que no pasó por una ruta «exportar» también cuenta como exportación.
        $archivo = $response instanceof BinaryFileResponse || $response instanceof StreamedResponse
            || str_contains((string) $response->headers->get('Content-Disposition'), 'attachment');
        if ($archivo && ! $a->can_export) {
            return $this->negar($a, $request, 'El acceso de soporte no permite exportar.');
        }
        Accesos::registrar($a, $request, $response->getStatusCode(), $exporta || $archivo ? 'EXPORT' : null);

        return $response;
    }

    private function negar(object $a, Request $request, string $mensaje): Response
    {
        Accesos::registrar($a, $request, 403, 'DENIED', $mensaje);

        return response()->json(['message' => $mensaje, 'code' => 'RN-OPS-04'], 403);
    }
}
