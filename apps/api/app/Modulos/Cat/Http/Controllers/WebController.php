<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Services\Combos;
use App\Modulos\Cat\Services\RegistroSanitario;
use App\Modulos\Cat\Services\Web;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAT-09 Publicación web: productos de venta por tienda, sus datos web, stock publicable y sincronización. */
class WebController extends Controller
{
    public function index(Request $request)
    {
        $marcas = Access::for($request->user())['brands'];
        $productos = DB::table('products as p')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')
            ->whereIn('p.product_type', ProductoController::DE_VENTA)
            ->when($marcas, fn ($q) => $q->whereIn('p.brand_id', $marcas))
            ->when($request->query('brand_id'), fn ($q, $m) => $q->where('p.brand_id', $m))
            ->orderBy('b.name')->orderBy('p.name')
            ->get(['p.id', 'p.code', 'p.name', 'p.brand_id', 'b.name as brand_name', 'p.status', 'p.web_publishable', 'p.web_title', 'p.web_description',
                'p.image_url', 'p.web_sync_status', 'p.web_synced_at', 'p.sanitary_authority', 'p.sanitary_registry', 'p.sanitary_registry_expires', 'p.sanitary_alert_days']);

        $variantes = DB::table('product_variants')->whereIn('product_id', $productos->pluck('id'))->where('status', 'ACTIVE')
            ->orderBy('sku')->get(['id', 'product_id', 'sku', 'name', 'web_publishable'])->groupBy('product_id');
        $stock = Combos::stock($variantes->flatten(1)->pluck('id')->all());
        $aviso = RegistroSanitario::diasAviso();

        $filas = $productos->map(function ($p) use ($variantes, $stock, $aviso) {
            $vs = $variantes[$p->id] ?? collect();
            $p->web_publishable = (bool) $p->web_publishable;
            $p->sanitario = RegistroSanitario::estado($p, null, $aviso);
            $p->variantes = $vs->map(fn ($v) => ['id' => $v->id, 'sku' => $v->sku, 'name' => $v->name, 'web_publishable' => (bool) $v->web_publishable, 'stock' => $stock[$v->id] ?? 0])->values();
            $p->variantes_web = $vs->where('web_publishable', true)->count();
            $p->stock_publicable = round($vs->sum(fn ($v) => max(0, $stock[$v->id] ?? 0)), 3);

            return $p;
        });

        // KPI-CAT-02: variantes publicadas (de productos publicados) sin stock publicable.
        $web = $filas->where('web_publishable', true)->flatMap(fn ($p) => collect($p->variantes)->where('web_publishable', true));
        $sinStock = $web->filter(fn ($v) => $v['stock'] <= 0)->count();

        return response()->json([
            'filas' => $filas->values(),
            'resumen' => [
                'publicados' => $filas->where('web_publishable', true)->count(),
                'de_venta' => $filas->count(),
                'pendientes' => $filas->where('web_sync_status', 'PENDING')->count(),
                'variantes_web' => $web->count(),
                'sin_stock' => $sinStock,
                'sin_stock_pct' => $web->count() ? round($sinStock / $web->count() * 100, 1) : 0,
                'bloqueados' => $filas->filter(fn ($p) => $p->sanitario['code'] === 'EXPIRED')->count(),
            ],
        ]);
    }

    public function publicar(Request $request, string $id)
    {
        $d = $request->validate(['web_publishable' => ['required', 'boolean']]);
        Web::publicar(Web::delAlcance($request->user(), $id), (bool) $d['web_publishable']);

        return response()->noContent();
    }

    public function datos(Request $request, string $id)
    {
        $d = $request->validate([
            'web_title' => ['nullable', 'string', 'max:255'],
            'web_description' => ['nullable', 'string', 'max:5000'],
            'image_url' => ['nullable', 'string', 'max:500'],
            'variantes' => ['array'],
            'variantes.*' => ['boolean'],
        ]);
        Web::guardarDatos(Web::delAlcance($request->user(), $id), $d);

        return response()->noContent();
    }

    public function enviar(Request $request, string $id)
    {
        Web::enviar(Web::delAlcance($request->user(), $id));

        return response()->noContent();
    }
}
