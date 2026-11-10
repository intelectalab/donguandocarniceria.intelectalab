<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\AlertasService;
use App\Modulos\Alm\Services\KpiService;
use App\Support\Access;
use Illuminate\Http\Request;

/** ALM-11 Alertas de vencimiento (RN-ALM-15) y los indicadores KPI-ALM-01 a 08. */
class AlertaController extends Controller
{
    public function index(Request $r)
    {
        $locales = Access::for($r->user())['establishments'];
        $marcas = Access::for($r->user())['brands'];
        $site = $r->query('site');
        $brand = $r->query('brand');
        $filas = AlertasService::vencimientos([
            'establishment_id' => $site && $site !== 'ALL' ? $site : null, 'establishments' => $locales ?: null,
            'brand_id' => $brand && $brand !== 'ALL' ? $brand : null,
        ])->when($marcas, fn ($c) => $c->whereIn('brand_id', $marcas))->values();
        $suma = fn ($b) => round((float) $filas->where('bucket', $b)->sum(fn ($x) => (float) $x->value), 2);

        return response()->json([
            'data' => $filas,
            'summary' => [
                'EXPIRED' => ['lots' => $filas->where('bucket', 'EXPIRED')->count(), 'value' => $suma('EXPIRED')],
                'D3' => ['lots' => $filas->where('bucket', 'D3')->count(), 'value' => $suma('D3')],
                'D7' => ['lots' => $filas->where('bucket', 'D7')->count(), 'value' => $suma('D7')],
            ],
        ]);
    }

    public function generar()
    {
        return response()->json(AlertasService::generarDiarias());
    }

    public function kpi(Request $r)
    {
        $d = $r->validate(['from' => 'nullable|date', 'to' => 'nullable|date']);
        $site = $r->query('site');
        $brand = $r->query('brand');

        return response()->json(KpiService::todos($d + [
            'establishment_id' => $site && $site !== 'ALL' ? $site : null, 'brand_id' => $brand && $brand !== 'ALL' ? $brand : null,
        ]));
    }
}
