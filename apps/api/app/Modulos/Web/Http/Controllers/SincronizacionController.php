<?php

namespace App\Modulos\Web\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Web\Services\Base;
use App\Modulos\Web\Services\Sincronizacion;
use App\Support\Access;
use Illuminate\Http\Request;

/** WEB-03 Sincronización. */
class SincronizacionController extends Controller
{
    public function index(Request $r)
    {
        $f = $r->validate(['tienda' => ['nullable', 'uuid'], 'tipo' => ['nullable', 'in:CATALOG,PRICES,STOCK,ORDERS'], 'estado' => ['nullable', 'in:COMPLETED,PARTIAL,FAILED'],
            'origen' => ['nullable', 'in:SCHEDULE,MANUAL,SALE'], 'per_page' => ['nullable', 'integer']]);

        return response()->json(Sincronizacion::lista($r->user(), $f) + ['tipos' => Base::TIPOS, 'origenes' => Base::ORIGENES,
            'puede_correr' => Access::can($r->user(), 'web.sync.run')]);
    }

    public function show(Request $r, string $id)
    {
        return response()->json(Sincronizacion::ver($id, $r->user()));
    }

    public function correr(Request $r)
    {
        $d = $r->validate(['store_id' => ['required', 'uuid'], 'kind' => ['required', 'in:CATALOG,PRICES,STOCK,ORDERS'],
            'skus' => ['nullable', 'array', 'max:500'], 'skus.*' => ['string', 'max:60']]);
        $run = Sincronizacion::correr($d['store_id'], $d['kind'], 'MANUAL', $d['skus'] ?? null, $r->user());

        return response()->json(Sincronizacion::ver($run->id, $r->user()), 201);
    }
}
