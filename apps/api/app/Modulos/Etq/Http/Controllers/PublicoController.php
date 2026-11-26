<?php

namespace App\Modulos\Etq\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Etq\Services\EtiquetasService as Etq;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * ETQ-08 Página pública del QR, sin sesión (RN-ETQ-09). La empresa sale del token con etq_tenant_for_qr
 * (SECURITY DEFINER); después todo se lee con RLS dentro de esa empresa.
 */
class PublicoController extends Controller
{
    public function show(string $token)
    {
        $no = fn () => response()->json(['message' => 'Este código no corresponde a un lote disponible.', 'code' => 'RN-ETQ-09'], 404);
        if (! preg_match('/^[A-Za-z0-9]{8,64}$/', $token)) {
            return $no();
        }
        $tenant = TenantContext::find(DB::selectOne('SELECT etq_tenant_for_qr(?) as t', [$token])->t ?? null);
        if (! $tenant) {
            return $no();
        }
        TenantContext::set($tenant);
        $p = Etq::publico($token);

        return $p ? response()->json($p + ['company' => $tenant['short'] ?: $tenant['name']])->header('Cache-Control', 'public, max-age=300') : $no();
    }
}
