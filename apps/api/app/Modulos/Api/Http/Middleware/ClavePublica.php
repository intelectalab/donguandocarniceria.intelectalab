<?php

namespace App\Modulos\Api\Http\Middleware;

use App\Modulos\Api\Services\Claves;
use App\Modulos\Api\Services\Uso;
use App\Support\Params;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * La puerta de la API pública (/api/publica/v1). Uso en la ruta: ->middleware('clave:orders:read').
 *
 *  1. Authorization: Bearer ak_live_xxxxxxxx_<secreto>. El prefijo dice la empresa (RN-API-04) y la huella del secreto se
 *     compara en tiempo constante (RN-API-11). Revocada o vencida: 401 con su código.
 *  2. Las claves de pruebas solo funcionan en el sandbox (RN-API-16), que llega en la tanda 5.
 *  3. IP permitidas de la clave, módulo API encendido, ráfaga por minuto y límite del día (RN-API-09): 403 o 429.
 *  4. El alcance de la ruta (RN-API-03): 403.
 *  Toda llamada de una clave conocida queda en su uso del día y en la bitácora de llamadas, con su resultado.
 */
final class ClavePublica
{
    public function handle(Request $request, Closure $next, string $alcance): Response
    {
        $inicio = microtime(true);
        $id = 'req_'.bin2hex(random_bytes(8));
        $ruta = $request->method().' '.preg_replace('#^api/publica/v1#', '', $request->route()?->uri() ?? '');
        $token = trim((string) preg_replace('/^Bearer\s+/i', '', (string) $request->header('Authorization')));
        if (! preg_match('/^(ak_(live|test)_[a-z0-9]{8})_([A-Za-z0-9]{40})$/', $token, $m)) {
            return $this->error($id, 401, 'RN-API-11', 'Falta la clave o no tiene el formato. Envía Authorization: Bearer ak_live_…');
        }
        [$prefijo, $secreto] = [$m[1], $m[3]];
        $empresa = DB::selectOne('SELECT api_tenant_for_key(?) AS t', [$prefijo])?->t;
        if (! $empresa) {
            return $this->error($id, 401, 'RN-API-11', 'La clave no existe.');
        }
        TenantContext::set(TenantContext::find($empresa));
        $k = DB::table('api_keys')->where('prefix', $prefijo)->first();
        if (! $k) {
            return $this->error($id, 401, 'RN-API-11', 'La clave no existe.');
        }

        // El controlador lee la clave de los atributos de la petición (la fija revisar()).
        $respuesta = $this->revisar($request, $k, $secreto, $alcance, $id) ?? $next($request);
        $respuesta->headers->set('X-Request-Id', $id);
        $respuesta->headers->set('GestionCarnica-Api-Version', 'v1');
        Uso::registrar($k, $request, $respuesta, $ruta, (int) round((microtime(true) - $inicio) * 1000), $id);

        return $respuesta;
    }

    /** Devuelve la respuesta de rechazo, o null si la llamada pasa. */
    private function revisar(Request $request, object $k, string $secreto, string $alcance, string $id): ?Response
    {
        $request->attributes->set('api_key', $k);
        $estado = Claves::estado($k);
        if (! hash_equals((string) $k->secret_hash, hash('sha256', $secreto))) {
            return $this->error($id, 401, 'RN-API-11', 'El secreto no corresponde a la clave.');
        }
        if ($estado === 'REVOKED') {
            return $this->error($id, 401, 'RN-API-10', "La clave {$k->prefix} está revocada.");
        }
        if ($estado === 'EXPIRED') {
            return $this->error($id, 401, 'RN-API-02', "La clave {$k->prefix} venció el ".date('d/m/Y', strtotime($k->expires_at)).'.');
        }
        $ips = json_decode((string) $k->allowed_ips, true) ?: [];
        if ($ips && ! array_filter($ips, fn ($r) => self::ipEn((string) $request->ip(), $r))) {
            return $this->error($id, 403, 'RN-API-11', 'La IP '.$request->ip().' no está en la lista permitida de la clave.');
        }
        if (! DB::table('tenant_modules')->where('module_code', 'API')->where('enabled', true)->exists()) {
            return $this->error($id, 403, 'RN-PLT-07', 'El módulo API está apagado para esta empresa.');
        }
        $porMinuto = max(1, (int) (Params::get('api_rate_limit_per_minute') ?? 120));
        $balde = "api-clave:{$k->id}";
        if (RateLimiter::tooManyAttempts($balde, $porMinuto)) {
            return $this->error($id, 429, 'RN-API-09', "Superaste las {$porMinuto} llamadas por minuto de la clave.", ['Retry-After' => (string) RateLimiter::availableIn($balde)]);
        }
        $porDia = Params::get('api_calls_per_day');
        if ($porDia !== null && (int) $porDia > 0 && Uso::delDia($k->environment) >= (int) $porDia) {
            $manana = now('America/Lima')->addDay()->startOfDay();

            return $this->error($id, 429, 'RN-API-09', 'Llegaste al límite de '.number_format((int) $porDia, 0, ',', ' ').' llamadas del día de tu empresa.',
                ['Retry-After' => (string) max(1, now()->diffInSeconds($manana))]);
        }
        RateLimiter::hit($balde, 60);
        if (! in_array($alcance, json_decode((string) $k->scopes, true) ?: [], true)) {
            return $this->error($id, 403, 'RN-API-03', "La clave no tiene el alcance {$alcance}.");
        }

        return null;
    }

    /** ¿La IP está en la IP o el rango CIDR IPv4? */
    public static function ipEn(string $ip, string $rango): bool
    {
        if (! str_contains($rango, '/')) {
            return $ip === $rango;
        }
        [$red, $bits] = explode('/', $rango);
        $a = ip2long($ip);
        $b = ip2long($red);
        if ($a === false || $b === false) {
            return false;
        }
        $mascara = (int) $bits === 0 ? 0 : (~0 << (32 - (int) $bits)) & 0xFFFFFFFF;

        return ($a & $mascara) === ($b & $mascara);
    }

    private function error(string $id, int $http, string $codigo, string $mensaje, array $cabeceras = []): Response
    {
        return response()->json(['code' => $codigo, 'message' => $mensaje, 'request_id' => $id], $http, $cabeceras);
    }
}
