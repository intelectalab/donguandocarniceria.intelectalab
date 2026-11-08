<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Models\ProductVariant;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Cat\Services\Variantes;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * CAT-03 Variantes y cortes: un SKU por corte o presentación, con su modo de venta (unidad, kg o
 * unidad de peso variable), pesos, tolerancia, código de barras, PLU, mínimo y múltiplo de pedido.
 * Reglas en Services\Variantes.
 */
class VarianteController extends Controller
{
    /** Lista paginada. Filtros: product_id, brand_id, sale_mode, cut_type_id, status. */
    public function index(Request $request)
    {
        $query = $this->filtrar(ProductVariant::query()->select('product_variants.*'), $request)->addSelect([
            'product_name' => DB::table('products')->select('name')->whereColumn('products.id', 'product_variants.product_id')->limit(1),
            'product_code' => DB::table('products')->select('code')->whereColumn('products.id', 'product_variants.product_id')->limit(1),
            'brand_name' => DB::table('brands')->select('name')->whereColumn('brands.id', 'product_variants.brand_id')->limit(1),
            'cut_name' => DB::table('cut_types')->select('name')->whereColumn('cut_types.id', 'product_variants.cut_type_id')->limit(1),
        ]);

        $pagina = Listado::de($query, $request, buscar: ['product_variants.sku', 'product_variants.name', 'product_variants.barcode', 'product_variants.scale_plu'],
            ordenar: ['sku', 'name', 'sale_mode', 'status'], porDefecto: 'sku');

        $filas = $pagina->getCollection();
        $precios = Precios::vigentes($filas->pluck('id')->all(), ['canal' => ProductoController::CANAL]);
        $tolerancia = Variantes::toleranciaPorDefecto();
        $filas->each(function (ProductVariant $v) use ($precios, $tolerancia) {
            $v->setAttribute('precio_whatsapp', $precios[$v->id] ?? null);
            $v->setAttribute('tolerancia', $v->sale_mode === 'UNIT' ? null : (float) ($v->weight_tolerance_pct ?? $tolerancia));
        });

        return response()->json($pagina);
    }

    /** Cifras de cabecera: activas por modo de venta y con PLU. */
    public function resumen(Request $request)
    {
        $activas = $this->filtrar(ProductVariant::query(), $request, soloAlcance: true)->where('status', 'ACTIVE')
            ->get(['sale_mode', 'sellable', 'scale_plu']);
        $vendibles = $activas->where('sellable', true);

        return response()->json([
            'peso_variable' => $vendibles->where('sale_mode', 'UNIT_VARIABLE_WEIGHT')->count(),
            'por_kg' => $vendibles->where('sale_mode', 'KG')->count(),
            'por_unidad' => $vendibles->where('sale_mode', 'UNIT')->count(),
            'con_plu' => $activas->whereNotNull('scale_plu')->count(),
            'tolerancia' => Variantes::toleranciaPorDefecto(),
        ]);
    }

    public function show(Request $request, string $id)
    {
        $v = $this->delAlcance($request, $id);
        $p = DB::table('products')->where('id', $v->product_id)->first(['id', 'code', 'name', 'line', 'status', 'product_type']);
        $v->setAttribute('producto', $p);
        $v->setAttribute('brand_name', DB::table('brands')->where('id', $v->brand_id)->value('name'));
        $v->setAttribute('cut_name', $v->cut_type_id ? DB::table('cut_types')->where('id', $v->cut_type_id)->value('name') : null);
        $v->setAttribute('tolerancia', $v->sale_mode === 'UNIT' ? null : (float) ($v->weight_tolerance_pct ?? Variantes::toleranciaPorDefecto($v->brand_id)));
        $v->setAttribute('con_movimientos', Variantes::tieneMovimientos($v->id));
        $v->setAttribute('stock', (float) DB::table('stock_balances')->where('variant_id', $v->id)->sum('qty'));

        $hoy = now()->toDateString();
        $v->setAttribute('precios', DB::table('price_list_items as i')->join('price_lists as l', 'l.id', '=', 'i.list_id')
            ->where('i.variant_id', $v->id)
            ->where(fn ($q) => $q->whereNull('l.brand_id')->orWhere('l.brand_id', $v->brand_id))
            ->where('i.valid_from', '<=', $hoy)->where(fn ($q) => $q->whereNull('i.valid_to')->orWhere('i.valid_to', '>=', $hoy))
            ->orderByRaw('coalesce(l.priority, 100)')->orderBy('l.code')
            ->get(['l.id as list_id', 'l.name as list_name', 'l.status as list_status', 'i.price', 'i.basis', 'i.min_qty']));

        return response()->json($v);
    }

    public function store(Request $request)
    {
        return response()->json(Variantes::guardar($this->validar($request), null, $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        $v = $this->delAlcance($request, $id);

        return response()->json(Variantes::guardar($this->validar($request, $v), $v, $request->user()));
    }

    public function estado(Request $request, string $id)
    {
        $datos = $request->validate(['status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])]]);

        return response()->json(Variantes::cambiarEstado($this->delAlcance($request, $id), $datos['status']));
    }

    public function destroy(Request $request, string $id)
    {
        Variantes::borrar($this->delAlcance($request, $id));

        return response()->noContent();
    }

    /** Tipos de corte activos para el selector; con product_id, solo los que aplican a su línea. */
    public function cortes(Request $request)
    {
        $linea = Str::isUuid((string) $request->query('product_id'))
            ? DB::table('products')->where('id', $request->query('product_id'))->value('line') : null;

        $cortes = DB::table('cut_types')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'code', 'name', 'applies_to_lines']);

        return response()->json($cortes->map(function ($c) {
            $c->applies_to_lines = json_decode((string) $c->applies_to_lines, true) ?: [];

            return $c;
        })->filter(fn ($c) => ! $linea || ! $c->applies_to_lines || in_array($linea, $c->applies_to_lines, true))->values());
    }

    private function filtrar($query, Request $request, bool $soloAlcance = false)
    {
        $marcas = Access::for($request->user())['brands'];
        $marca = $request->query('brand_id');
        $query->when($marcas, fn ($q) => $q->whereIn('product_variants.brand_id', $marcas))
            ->when(Str::isUuid((string) $marca), fn ($q) => $q->where('product_variants.brand_id', $marca))
            ->when(Str::isUuid((string) $request->query('product_id')), fn ($q) => $q->where('product_variants.product_id', $request->query('product_id')));
        if ($soloAlcance) {
            return $query;
        }

        return $query
            ->when($request->query('sale_mode'), fn ($q, $v) => $q->where('product_variants.sale_mode', $v))
            ->when(Str::isUuid((string) $request->query('cut_type_id')), fn ($q) => $q->where('product_variants.cut_type_id', $request->query('cut_type_id')))
            ->when($request->query('status'), fn ($q, $v) => $q->where('product_variants.status', $v));
    }

    private function delAlcance(Request $request, string $id): ProductVariant
    {
        $marcas = Access::for($request->user())['brands'];

        return ProductVariant::query()->when($marcas, fn ($q) => $q->whereIn('brand_id', $marcas))->findOrFail($id);
    }

    private function validar(Request $request, ?ProductVariant $v = null): array
    {
        $limpiar = fn ($k) => trim((string) $request->input($k)) ?: null;
        $request->merge([
            'sku' => mb_strtoupper(trim((string) $request->input('sku'))),
            'barcode' => $limpiar('barcode'),
            'scale_plu' => $limpiar('scale_plu'),
        ]);

        return $request->validate([
            'product_id' => [$v ? 'nullable' : 'required', 'uuid', 'exists:products,id'],
            'sku' => ['required', 'regex:/^[A-Z0-9-]{2,40}$/', Rule::unique('product_variants', 'sku')->ignore($v?->id)],
            'name' => ['required', 'string', 'max:255'],
            'cut_type_id' => ['nullable', 'uuid', 'exists:cut_types,id'],
            'sale_mode' => ['required', Rule::in(Variantes::MODOS)],
            'nominal_weight_kg' => ['nullable', 'numeric', 'gt:0', 'max:9999'],
            'min_weight_kg' => ['nullable', 'numeric', 'gt:0', 'max:9999'],
            'max_weight_kg' => ['nullable', 'numeric', 'gt:0', 'max:9999'],
            'weight_tolerance_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'barcode' => ['nullable', 'regex:/^\d{8,14}$/', Rule::unique('product_variants', 'barcode')->ignore($v?->id)],
            'scale_plu' => ['nullable', 'regex:/^\d{5}$/'],
            'min_order_qty' => ['nullable', 'numeric', 'min:0'],
            'qty_step' => ['nullable', 'numeric', 'min:0'],
            'std_cost' => ['nullable', 'numeric', 'min:0'],
            'web_publishable' => ['boolean'],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
        ], [
            'sku.regex' => 'El SKU tiene de 2 a 40 letras, números o guiones.',
            'sku.unique' => 'Ya existe una variante con ese SKU: cada corte tiene su propio SKU (RN-CAT-01).',
            'barcode.regex' => 'El código de barras tiene de 8 a 14 dígitos.',
            'barcode.unique' => 'Ese código de barras ya está asignado a otra variante (RN-CAT-01).',
            'scale_plu.regex' => 'El PLU de balanza tiene 5 dígitos (RN-CAT-04).',
            'min_order_qty.min' => 'La cantidad mínima no puede ser negativa (RN-CAT-07).',
            'qty_step.min' => 'El múltiplo no puede ser negativo (RN-CAT-07).',
        ]);
    }
}
