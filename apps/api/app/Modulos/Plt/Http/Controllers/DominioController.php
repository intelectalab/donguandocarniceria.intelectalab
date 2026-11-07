<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Services\Dominios;
use App\Support\TenantContext;
use Illuminate\Http\Request;

/** PLT-13 Dominio de acceso: ver los dominios de la empresa, pedir uno propio y verificarlo. */
class DominioController extends Controller
{
    public function index()
    {
        $t = TenantContext::find(TenantContext::id());
        $dominios = Dominios::deLaEmpresa()->orderByDesc('is_primary')->orderBy('hostname')
            ->get(['id', 'hostname', 'is_primary', 'status', 'verified_at', 'verify_token', 'created_at'])
            ->map(fn ($d) => (array) $d + ['plataforma' => Dominios::esDeLaPlataforma($d->hostname)]);

        return response()->json([
            'empresa' => ['name' => $t['name'] ?? null, 'short' => $t['short'] ?? null, 'plan' => $t['plan'] ?? null, 'status' => $t['status'] ?? null],
            'dominios' => $dominios,
            'por_dominio' => (bool) config('aycha.tenant_por_dominio'),
        ]);
    }

    public function store(Request $request)
    {
        $datos = $request->validate([
            'hostname' => ['required', 'string', 'max:253'],
            'primary' => ['boolean'],
        ], ['hostname.required' => 'Escribe el dominio.']);

        return response()->json(Dominios::agregar($datos['hostname'], (bool) ($datos['primary'] ?? false), $request->user()), 201);
    }

    public function verificar(Request $request, string $id)
    {
        $datos = $request->validate(['primary' => ['boolean']]);

        return response()->json(Dominios::verificar($id, (bool) ($datos['primary'] ?? false)));
    }

    public function principal(string $id)
    {
        Dominios::hacerPrincipal($id);

        return response()->json(['ok' => true]);
    }

    public function desactivar(string $id)
    {
        Dominios::desactivar($id);

        return response()->json(['ok' => true]);
    }
}
