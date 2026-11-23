<?php

namespace App\Http\Middleware;

use App\Modulos\Ops\Services\Consola;
use App\Modulos\Ops\Services\UsuariosPlataforma;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rutas de la consola de Intelectalab: sesión de un usuario de plataforma (token «gcc_…»), nunca de una empresa.
 * Sin empresa fijada, RLS no deja ver datos de negocio de ninguna empresa (RN-OPS-06). Revisa además las redes
 * permitidas en cada petición (RN-OPS-16).
 */
class ConsolaSesion
{
    public function handle(Request $request, Closure $next): Response
    {
        TenantContext::set(null);
        $s = UsuariosPlataforma::sesion($request->bearerToken());
        if (! $s) {
            return response()->json(['message' => 'Tu sesión de la consola terminó. Vuelve a ingresar.', 'code' => 'CONSOLE_UNAUTHENTICATED'], 401);
        }
        if (! Consola::ipPermitida($request->ip(), (array) Consola::param('ops_console_ip_allowlist', []))) {
            return response()->json(['message' => 'La consola no acepta conexiones desde tu red.', 'code' => 'RN-OPS-16'], 403);
        }
        TenantContext::platform();   // RN-OPS-06: tablas de soporte de todas las empresas; datos de negocio, ninguno
        $request->attributes->set('consola_sesion', $s['sesion_id']);
        $request->attributes->set('consola_usuario', $s['usuario']);

        return $next($request);
    }
}
