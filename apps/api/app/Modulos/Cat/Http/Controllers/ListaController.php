<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Services\Listas;
use App\Modulos\Cat\Services\Precios;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CAT-05 Listas de precio (por marca, canal y tipo de cliente, con vigencia y prioridad) y
 * CAT-06 Precios de la lista (grilla con vigencias, cambio, cierre e importación CSV).
 * Reglas en Services\Listas; la elección del precio vigente en Services\Precios.
 */
class ListaController extends Controller
{
    /** CAT-05: las listas del alcance del usuario con sus conteos de precios. */
    public function index(Request $request)
    {
        $marcas = Access::for($request->user())['brands'];
        $hoy = now()->toDateString();
        $conteo = DB::table('price_list_items')
            ->selectRaw('list_id, count(*) filter (where valid_from <= ? and (valid_to is null or valid_to >= ?)) as vigentes, count(*) filter (where valid_from > ?) as programados', [$hoy, $hoy, $hoy])
            ->groupBy('list_id')->get()->keyBy('list_id');

        $listas = DB::table('price_lists as l')->leftJoin('brands as b', 'b.id', '=', 'l.brand_id')
            ->when($marcas, fn ($q) => $q->where(fn ($w) => $w->whereNull('l.brand_id')->orWhereIn('l.brand_id', $marcas)))
            ->when($request->query('brand_id'), fn ($q, $m) => $q->where(fn ($w) => $w->whereNull('l.brand_id')->orWhere('l.brand_id', $m)))
            ->orderByRaw('coalesce(l.priority, 100)')->orderBy('l.code')
            ->get(['l.*', 'b.name as brand_name'])
            ->map(fn ($l) => $this->formato($l, $conteo[$l->id] ?? null));

        return response()->json($listas->values());
    }

    public function show(Request $request, string $id)
    {
        $l = Listas::delAlcance($request->user(), $id);
        $hoy = now()->toDateString();
        $items = DB::table('price_list_items')->where('list_id', $id)->get(['valid_from', 'valid_to']);
        $l->brand_name = $l->brand_id ? DB::table('brands')->where('id', $l->brand_id)->value('name') : null;
        $r = $this->formato($l, (object) [
            'vigentes' => $items->filter(fn ($x) => $x->valid_from <= $hoy && (! $x->valid_to || $x->valid_to >= $hoy))->count(),
            'programados' => $items->filter(fn ($x) => $x->valid_from > $hoy)->count(),
        ]);
        $r->historicos = $items->filter(fn ($x) => $x->valid_to && $x->valid_to < $hoy)->count();

        return response()->json($r);
    }

    public function store(Request $request)
    {
        return response()->json(Listas::guardar($this->validar($request), null, $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        $l = Listas::delAlcance($request->user(), $id);

        return response()->json(Listas::guardar($this->validar($request, $id), $l, $request->user()));
    }

    public function estado(Request $request, string $id)
    {
        $d = $request->validate(['status' => ['required', Rule::in(Listas::ESTADOS)]]);

        return response()->json(Listas::cambiarEstado(Listas::delAlcance($request->user(), $id), $d['status'], $request->user()));
    }

    public function copiar(Request $request, string $id)
    {
        $origen = Listas::delAlcance($request->user(), $id);
        $request->merge(['code' => mb_strtoupper(trim((string) $request->input('code')))]);
        $d = $request->validate([
            'code' => ['required', 'regex:/^[A-Z0-9-]{2,20}$/', Rule::unique('price_lists', 'code')],
            'name' => ['required', 'string', 'max:255'],
            'pct' => ['nullable', 'numeric', 'min:-90', 'max:500'],
            'valid_from' => ['required', 'date_format:Y-m-d'],
            'priority' => ['nullable', 'integer', 'min:0', 'max:999'],
        ], $this->mensajes());
        $r = Listas::copiar($origen, $d, $request->user());

        return response()->json(['id' => $r['list']->id, 'code' => $r['list']->code, 'items' => $r['items']], 201);
    }

    public function programar(Request $request, string $id)
    {
        $l = Listas::delAlcance($request->user(), $id);
        $d = $request->validate([
            'valid_from' => ['required', 'date_format:Y-m-d'],
            'pct' => ['required', 'numeric', 'min:-90', 'max:500'],
            'reason' => ['required', 'string', 'min:5', 'max:80'],
        ], ['reason.required' => 'Escribe el motivo del cambio de precios.']);

        return response()->json(['items' => Listas::programar($l, $d['valid_from'], (float) $d['pct'], $d['reason'], $request->user())]);
    }

    /** CAT-06: precios de la lista. cuando = NOW (vigentes), FUTURE, PAST o ALL. */
    public function precios(Request $request, string $id)
    {
        $l = Listas::delAlcance($request->user(), $id);
        $hoy = now()->toDateString();
        $cuando = $request->query('cuando', 'NOW');
        $q = trim((string) $request->query('q'));

        $base = DB::table('price_list_items as i')->join('product_variants as v', 'v.id', '=', 'i.variant_id')->where('i.list_id', $id);
        $filas = (clone $base)
            ->when($cuando === 'NOW', fn ($w) => $w->where('i.valid_from', '<=', $hoy)->where(fn ($x) => $x->whereNull('i.valid_to')->orWhere('i.valid_to', '>=', $hoy)))
            ->when($cuando === 'FUTURE', fn ($w) => $w->where('i.valid_from', '>', $hoy))
            ->when($cuando === 'PAST', fn ($w) => $w->whereNotNull('i.valid_to')->where('i.valid_to', '<', $hoy))
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('v.sku', 'ilike', "%{$q}%")->orWhere('v.name', 'ilike', "%{$q}%")))
            ->orderBy('v.sku')->orderBy('i.min_qty')->orderBy('i.valid_from')
            ->get(['i.id', 'i.variant_id', 'v.sku', 'v.name', 'v.sale_mode', 'i.price', 'i.basis', 'i.min_qty', 'i.valid_from', 'i.valid_to',
                'i.previous_price', 'i.created_by', 'i.reason', 'i.closed_by', 'i.closed_reason'])
            ->map(function ($x) {
                foreach (['price', 'previous_price', 'min_qty'] as $k) {
                    $x->$k = $x->$k === null ? null : (float) $x->$k;
                }

                return $x;
            });

        $vigentes = Listas::vigentesEn($id, $hoy)->pluck('variant_id')->unique();
        $sinPrecio = DB::table('product_variants')->where('sellable', true)->where('status', 'ACTIVE')
            ->when($l->brand_id, fn ($w) => $w->where('brand_id', $l->brand_id))
            ->whereNotIn('id', $vigentes)->orderBy('sku')->get(['id', 'sku', 'name']);

        return response()->json([
            'filas' => $filas,
            'resumen' => [
                'vigentes' => (clone $base)->where('i.valid_from', '<=', $hoy)->where(fn ($x) => $x->whereNull('i.valid_to')->orWhere('i.valid_to', '>=', $hoy))->count(),
                'programados' => (clone $base)->where('i.valid_from', '>', $hoy)->count(),
                'historicos' => (clone $base)->whereNotNull('i.valid_to')->where('i.valid_to', '<', $hoy)->count(),
                'sin_precio' => $sinPrecio->count(),
                'sin_precio_ejemplos' => $sinPrecio->take(5)->values(),
            ],
        ]);
    }

    public function agregarPrecio(Request $request, string $id)
    {
        $l = Listas::delAlcance($request->user(), $id);
        $d = $request->validate([
            'variant_id' => ['required', 'uuid'],
            'price' => ['required', 'numeric', 'gt:0', 'max:999999'],
            'basis' => ['nullable', Rule::in(['UNIT', 'KG'])],
            'min_qty' => ['nullable', 'numeric', 'min:0'],
            'valid_from' => ['required', 'date_format:Y-m-d'],
            'valid_to' => ['nullable', 'date_format:Y-m-d'],
            'cerrar_anterior' => ['boolean'],
            'reason' => ['nullable', 'string', 'max:80'],
        ], ['price.gt' => 'El precio debe ser mayor que cero.']);

        return response()->json(Listas::agregarPrecio($l, $d, $request->user()), 201);
    }

    public function cerrarPrecio(Request $request, string $id, string $item)
    {
        $l = Listas::delAlcance($request->user(), $id);
        $it = DB::table('price_list_items')->where('list_id', $id)->where('id', $item)->first() ?? abort(404);
        $d = $request->validate(['valid_to' => ['required', 'date_format:Y-m-d'], 'reason' => ['nullable', 'string', 'max:80']]);
        Listas::cerrarPrecio($l, $it, $d['valid_to'], $d['reason'] ?? null, $request->user());

        return response()->noContent();
    }

    public function vistaCsv(Request $request, string $id)
    {
        $l = Listas::delAlcance($request->user(), $id);
        $d = $request->validate(['texto' => ['required', 'string', 'max:200000']]);

        return response()->json(Listas::vistaCsv($l, $d['texto']));
    }

    public function importarCsv(Request $request, string $id)
    {
        $l = Listas::delAlcance($request->user(), $id);
        $d = $request->validate(['texto' => ['required', 'string', 'max:200000'], 'reason' => ['nullable', 'string', 'max:80']]);

        return response()->json(Listas::importarCsv($l, $d['texto'], $d['reason'] ?? null, $request->user()));
    }

    private function formato(object $l, ?object $conteo): object
    {
        $l->channels = Listas::json($l->channels);
        $l->customer_types = Listas::json($l->customer_types);
        $l->priority = $l->priority === null ? null : (int) $l->priority;
        $l->includes_igv = (bool) $l->includes_igv;
        $l->vigentes = (int) ($conteo->vigentes ?? 0);
        $l->programados = (int) ($conteo->programados ?? 0);

        return $l;
    }

    private function validar(Request $request, ?string $id = null): array
    {
        $request->merge(['code' => mb_strtoupper(trim((string) $request->input('code'))), 'brand_id' => $request->input('brand_id') ?: null]);

        return $request->validate([
            'code' => ['required', 'regex:/^[A-Z0-9-]{2,20}$/', Rule::unique('price_lists', 'code')->ignore($id)],
            'name' => ['required', 'string', 'max:255'],
            'brand_id' => ['nullable', 'uuid', 'exists:brands,id'],
            'channels' => ['array'],
            'channels.*' => ['distinct', Rule::in(Precios::CANALES)],
            'customer_types' => ['array'],
            'customer_types.*' => ['distinct', Rule::in(Listas::TIPOS_CLIENTE)],
            'includes_igv' => ['boolean'],
            'priority' => ['required', 'integer', 'min:0', 'max:999'],
            'valid_from' => ['required', 'date_format:Y-m-d'],
            'valid_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:valid_from'],
            'status' => ['required', Rule::in(Listas::ESTADOS)],
        ], $this->mensajes() + ['valid_to.after_or_equal' => 'La vigencia termina antes de empezar.']);
    }

    private function mensajes(): array
    {
        return [
            'code.regex' => 'El código tiene de 2 a 20 letras, números o guiones.',
            'code.unique' => 'Ya existe una lista con ese código.',
        ];
    }
}
