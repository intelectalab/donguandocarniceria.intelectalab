<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * CAT-12 Historial de precios: cada vigencia de price_list_items es historia (nada se sobreescribe,
 * RN-CAT-06). Para cada precio se muestra el anterior de la misma lista, variante y tramo, con la
 * variación, quién lo cargó, cuándo y el motivo.
 */
class HistorialController extends Controller
{
    public function index(Request $request)
    {
        $pagina = Listado::de($this->base($request), $request, buscar: ['h.sku', 'h.variant_name', 'h.list_name', 'h.created_by'],
            ordenar: ['valid_from', 'sku', 'price', 'cambio_pct', 'created_at'], porDefecto: '-valid_from');
        $pagina->getCollection()->transform(function ($x) {
            foreach (['price', 'precio_anterior', 'cambio_pct', 'min_qty'] as $k) {
                $x->$k = $x->$k === null ? null : (float) $x->$k;
            }

            return $x;
        });

        return response()->json($pagina);
    }

    /** Cifras de cabecera con los mismos filtros. */
    public function resumen(Request $request)
    {
        $filas = $this->base($request)->get(['h.valid_from', 'h.cambio_pct']);
        $cambios = $filas->whereNotNull('cambio_pct');
        $hoy = now();

        return response()->json([
            'cambios' => $cambios->count(),
            'este_mes' => $cambios->filter(fn ($x) => substr((string) $x->valid_from, 0, 7) === $hoy->format('Y-m'))->count(),
            'programados' => $filas->filter(fn ($x) => (string) $x->valid_from > $hoy->toDateString())->count(),
            'variacion_promedio' => $cambios->count() ? round($cambios->avg(fn ($x) => (float) $x->cambio_pct), 1) : null,
        ]);
    }

    /** Precios con el anterior de su misma lista, variante y tramo. Filtros: list_id, variant_id, tipo (CHANGE o FIRST), desde, hasta. */
    private function base(Request $request)
    {
        $marcas = Access::for($request->user())['brands'];
        $w = 'over (partition by i.list_id, i.variant_id, coalesce(i.min_qty, 0) order by i.valid_from, i.created_at)';
        $historia = DB::table('price_list_items as i')
            ->join('price_lists as l', 'l.id', '=', 'i.list_id')->join('product_variants as v', 'v.id', '=', 'i.variant_id')
            ->when($marcas, fn ($q) => $q->where(fn ($x) => $x->whereNull('l.brand_id')->orWhereIn('l.brand_id', $marcas))->whereIn('v.brand_id', $marcas))
            ->selectRaw("i.id, i.list_id, l.code as list_code, l.name as list_name, i.variant_id, v.sku, v.name as variant_name, i.basis, i.min_qty,
                i.price, i.valid_from, i.valid_to, i.created_by, i.created_at, i.reason, i.closed_by, i.closed_reason,
                lag(i.price) {$w} as precio_anterior,
                round((i.price - lag(i.price) {$w}) / nullif(lag(i.price) {$w}, 0) * 100, 1) as cambio_pct");

        return DB::query()->fromSub($historia, 'h')
            ->when(Str::isUuid((string) $request->query('list_id')), fn ($q) => $q->where('h.list_id', $request->query('list_id')))
            ->when(Str::isUuid((string) $request->query('variant_id')), fn ($q) => $q->where('h.variant_id', $request->query('variant_id')))
            ->when($request->query('tipo') === 'CHANGE', fn ($q) => $q->whereNotNull('h.precio_anterior'))
            ->when($request->query('tipo') === 'FIRST', fn ($q) => $q->whereNull('h.precio_anterior'))
            ->when($request->query('desde'), fn ($q, $d) => $q->where('h.valid_from', '>=', $d))
            ->when($request->query('hasta'), fn ($q, $d) => $q->where('h.valid_from', '<=', $d))
            ->select('h.*');
    }
}
