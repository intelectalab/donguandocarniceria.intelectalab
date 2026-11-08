<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Models\Product;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Cat\Services\Productos;
use App\Modulos\Cat\Services\RegistroSanitario;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * CAT-01 Productos: lo que vende cada marca, una sola vez, con sus variantes, el precio vigente del
 * canal WhatsApp (RN-CAT-05), el registro sanitario (RN-CAT-09) y los lotes bloqueados.
 * CAT-02 Ficha del producto: sus datos, variantes, precios por lista e historial; crear, editar,
 * activar e inactivar (reglas en Services\Productos).
 * La vendedora solo ve los productos de sus marcas.
 */
class ProductoController extends Controller
{
    /** Tipos que se venden (pestaña «Productos de venta»); el resto son insumos, materia prima y empaques. */
    public const DE_VENTA = ['GOODS', 'COMBO', 'SERVICE'];

    public const LINEAS = ['CUY', 'CONEJO', 'AVES', 'CORDERO', 'CERDO', 'RES', 'CALDOS', 'EMBUTIDOS', 'MANTECA', 'ABARROTES',
        'CAFE', 'FRUTOS_SECOS', 'MERMELADAS', 'INFUSIONES', 'COMBOS', 'OTROS'];

    public const CANAL = 'WHATSAPP';

    public const TIPOS = ['GOODS', 'SERVICE', 'COMBO', 'INPUT', 'PACKAGING'];

    public const ORIGENES = ['PRODUCED', 'RESALE', 'RAW_MATERIAL'];

    public const ALMACENAMIENTO = ['CHILLED', 'FROZEN', 'AMBIENT'];

    public const IGV = ['10', '20', '30'];

    public const AUTORIDADES = ['SENASA', 'DIGESA', 'NONE'];

    /** Lista paginada para la tabla. Filtros: tipo, brand_id, line, category_id, status, storage, web. */
    public function index(Request $request)
    {
        $query = $this->filtrar(Product::query()->select('products.*'), $request)->addSelect([
            'brand_name' => DB::table('brands')->select('name')->whereColumn('brands.id', 'products.brand_id')->limit(1),
            'category_name' => DB::table('product_categories')->select('name')->whereColumn('product_categories.id', 'products.category_id')->limit(1),
            'variantes_activas' => DB::table('product_variants')->selectRaw('count(*)')
                ->whereColumn('product_variants.product_id', 'products.id')->where('product_variants.status', 'ACTIVE'),
            'lotes_bloqueados' => DB::table('lots')->selectRaw('count(*)')->whereColumn('lots.product_id', 'products.id')
                ->whereIn('lots.qc_status', ['BLOCKED', 'RECALLED'])
                ->whereExists(fn ($q) => $q->from('stock_balances')->whereColumn('stock_balances.lot_id', 'lots.id')->where('stock_balances.qty', '>', 0)),
        ]);

        // Busca también por SKU y nombre de las variantes.
        $variantes = "(select string_agg(v.sku || ' ' || v.name, ' ') from product_variants v where v.product_id = products.id)";
        $pagina = Listado::de($query, $request, buscar: ['products.code', 'products.name', $variantes],
            ordenar: ['code', 'name', 'line', 'status'], porDefecto: 'code');

        // Precio WhatsApp de las variantes activas de esta página, en una sola consulta.
        $productos = $pagina->getCollection();
        $porProducto = DB::table('product_variants')->whereIn('product_id', $productos->pluck('id'))->where('status', 'ACTIVE')
            ->get(['id', 'product_id'])->groupBy('product_id');
        $precios = Precios::vigentes($porProducto->flatten()->pluck('id')->all(), ['canal' => self::CANAL]);
        $hoy = now()->toDateString();
        $aviso = RegistroSanitario::diasAviso();

        $productos->each(function (Product $p) use ($porProducto, $precios, $hoy, $aviso) {
            $p->setAttribute('se_vende', in_array($p->product_type, self::DE_VENTA, true));
            $p->setAttribute('precio_whatsapp', $p->se_vende
                ? self::rango(($porProducto[$p->id] ?? collect())->map(fn ($v) => $precios[$v->id] ?? null)->filter()->values()->all())
                : null);
            $p->setAttribute('sanitario', RegistroSanitario::estado($p, $hoy, $aviso));
        });

        return response()->json($pagina);
    }

    /** Cifras de cabecera, con los mismos filtros de pestaña y marca que la tabla. */
    public function resumen(Request $request)
    {
        $productos = $this->filtrar(Product::query(), $request, soloPestanaYMarca: true)
            ->get(['id', 'status', 'product_type', 'sanitary_authority', 'sanitary_registry', 'sanitary_registry_expires', 'sanitary_alert_days']);

        // KPI-CAT-01: variantes vendibles (activas, de un producto activo) con precio vigente en WhatsApp.
        $vendibles = DB::table('product_variants')
            ->whereIn('product_variants.product_id', $productos->where('status', 'ACTIVE')->pluck('id'))
            ->where('product_variants.status', 'ACTIVE')->where('product_variants.sellable', true)
            ->orderBy('product_variants.sku')
            ->get(['product_variants.id', 'product_variants.sku', 'product_variants.name']);
        $precios = Precios::vigentes($vendibles->pluck('id')->all(), ['canal' => self::CANAL]);
        $sinPrecio = $vendibles->filter(fn ($v) => ! ($precios[$v->id] ?? null))->values();

        $hoy = now()->toDateString();
        $aviso = RegistroSanitario::diasAviso();
        $estados = $productos->map(fn ($p) => RegistroSanitario::estado($p, $hoy, $aviso)['code']);

        return response()->json([
            'activos' => $productos->where('status', 'ACTIVE')->count(),
            'en_vista' => $productos->count(),
            'variantes_vendibles' => $vendibles->count(),
            'con_precio' => $vendibles->count() - $sinPrecio->count(),
            'cobertura' => $vendibles->count() ? round(($vendibles->count() - $sinPrecio->count()) / $vendibles->count() * 100, 1) : 0.0,
            'sin_precio' => $sinPrecio->take(10)->map(fn ($v) => ['sku' => $v->sku, 'name' => $v->name])->all(),
            'sanitario_por_vencer' => $estados->filter(fn ($c) => in_array($c, RegistroSanitario::POR_VENCER, true))->count(),
            'sanitario_vencidos' => $estados->filter(fn ($c) => in_array($c, ['RED', 'EXPIRED'], true))->count(),
            'dias_aviso' => $aviso,
            'canal' => self::CANAL,
        ]);
    }

    /** CAT-02: la ficha completa de un producto. */
    public function show(Request $request, string $id)
    {
        $p = $this->delAlcance($request, $id);
        $p->setAttribute('brand_name', DB::table('brands')->where('id', $p->brand_id)->value('name'));
        $p->setAttribute('category_name', DB::table('product_categories')->where('id', $p->category_id)->value('name'));
        $p->setAttribute('se_vende', in_array($p->product_type, self::DE_VENTA, true));
        $p->setAttribute('sanitario', RegistroSanitario::estado($p));
        $p->setAttribute('tiene_ventas', Productos::tieneVentas($p->id));
        $p->setAttribute('lotes', DB::table('lots')->where('product_id', $p->id)->whereIn('qc_status', ['BLOCKED', 'RECALLED'])
            ->whereExists(fn ($q) => $q->from('stock_balances')->whereColumn('stock_balances.lot_id', 'lots.id')->where('stock_balances.qty', '>', 0))
            ->orderBy('code')->get(['id', 'code', 'qc_status', 'block_reason']));

        $variantes = DB::table('product_variants as v')->where('v.product_id', $p->id)
            ->leftJoin('cut_types as c', 'c.id', '=', 'v.cut_type_id')
            ->orderBy('v.sku')
            ->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.nominal_weight_kg', 'v.min_weight_kg', 'v.max_weight_kg', 'v.barcode',
                'v.scale_plu', 'v.status', 'v.web_publishable', 'v.sellable', 'c.name as cut_name']);
        $whatsapp = Precios::vigentes($variantes->pluck('id')->all(), ['canal' => self::CANAL]);
        $variantes->each(fn ($v) => $v->precio_whatsapp = $whatsapp[$v->id] ?? null);
        $p->setAttribute('variantes', $variantes);

        // Precios vigentes hoy en las listas de su marca o sin marca.
        $hoy = now()->toDateString();
        $p->setAttribute('precios', DB::table('price_list_items as i')
            ->join('price_lists as l', 'l.id', '=', 'i.list_id')
            ->join('product_variants as v', 'v.id', '=', 'i.variant_id')
            ->where('v.product_id', $p->id)
            ->where(fn ($q) => $q->whereNull('l.brand_id')->orWhere('l.brand_id', $p->brand_id))
            ->where('i.valid_from', '<=', $hoy)->where(fn ($q) => $q->whereNull('i.valid_to')->orWhere('i.valid_to', '>=', $hoy))
            ->orderBy('v.sku')->orderByRaw('coalesce(l.priority, 100)')->orderBy('l.code')
            ->get(['i.id', 'v.sku', 'v.name as variant_name', 'l.id as list_id', 'l.name as list_name', 'l.status as list_status',
                DB::raw('coalesce(l.priority, 100) as priority'), 'i.price', 'i.basis', 'i.min_qty', 'i.valid_from', 'i.valid_to']));

        // Componentes de sus combos (se editan en CAT-08).
        $p->setAttribute('componentes', $p->product_type !== 'COMBO' ? [] : DB::table('combo_components as cc')
            ->join('product_variants as combo', 'combo.id', '=', 'cc.combo_variant_id')
            ->join('product_variants as comp', 'comp.id', '=', 'cc.component_variant_id')
            ->where('combo.product_id', $p->id)->orderBy('combo.sku')->orderByDesc('cc.price_share_pct')
            ->get(['cc.id', 'combo.sku as combo_sku', 'comp.sku', 'comp.name', 'cc.qty', 'cc.est_weight_kg', 'cc.price_share_pct']));

        // Historial: la bitácora de cambios del producto y sus variantes.
        $p->setAttribute('historial', DB::table('audit.change_log as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.changed_by')
            ->where(fn ($q) => $q->where(fn ($w) => $w->where('a.table_name', 'products')->where('a.row_id', $p->id))
                ->orWhere(fn ($w) => $w->where('a.table_name', 'product_variants')->whereIn('a.row_id', $variantes->pluck('id'))))
            ->orderByDesc('a.changed_at')->limit(30)
            ->get(['a.id', 'a.table_name', 'a.action', 'a.changed_columns', 'a.changed_at', 'u.name as user_name',
                DB::raw("coalesce(a.new_data->>'sku', a.new_data->>'code', a.old_data->>'sku', a.old_data->>'code') as ref")]));

        return response()->json($p);
    }

    public function store(Request $request)
    {
        $p = Productos::guardar($this->validar($request), null, $request->user());

        return response()->json($p, 201);
    }

    public function update(Request $request, string $id)
    {
        $p = $this->delAlcance($request, $id);

        return response()->json(Productos::guardar($this->validar($request, $p), $p, $request->user()));
    }

    /** Activar o inactivar (RN-CAT-11: al inactivar, sus variantes activas también). */
    public function estado(Request $request, string $id)
    {
        $datos = $request->validate(['status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])]]);

        return response()->json(Productos::cambiarEstado($this->delAlcance($request, $id), $datos['status'], $request->user()));
    }

    /** Categorías para el filtro. */
    public function categorias()
    {
        return response()->json(DB::table('product_categories')->orderBy('name')->get(['id', 'code', 'name', 'line']));
    }

    /** El producto existe y está dentro de las marcas del usuario. */
    private function delAlcance(Request $request, string $id): Product
    {
        $marcas = Access::for($request->user())['brands'];

        return Product::query()->when($marcas, fn ($q) => $q->whereIn('brand_id', $marcas))->findOrFail($id);
    }

    private function validar(Request $request, ?Product $p = null): array
    {
        $request->merge([
            'code' => mb_strtoupper(trim((string) $request->input('code'))),
            'sanitary_registry' => trim((string) $request->input('sanitary_registry')) ?: null,
            'sunat_product_code' => trim((string) $request->input('sunat_product_code')) ?: null,
        ]);

        return $request->validate([
            'code' => ['required', 'regex:/^[A-Z0-9-]{2,40}$/', Rule::unique('products', 'code')->ignore($p?->id)],
            'name' => ['required', 'string', 'max:255'],
            'brand_id' => ['required', 'uuid', 'exists:brands,id'],
            'category_id' => ['required', 'uuid', 'exists:product_categories,id'],
            'product_type' => ['required', Rule::in(self::TIPOS)],
            'origin' => ['required', Rule::in(self::ORIGENES)],
            'storage' => ['required', Rule::in(self::ALMACENAMIENTO)],
            'shelf_life_days' => ['nullable', 'integer', 'min:0', 'max:3650'],
            'requires_lot' => ['boolean'],
            'igv_affectation' => ['required', Rule::in(self::IGV)],
            'sunat_product_code' => ['nullable', 'regex:/^\d{8}$/'],
            'allow_discount' => ['boolean'],
            'sanitary_authority' => ['required', Rule::in(self::AUTORIDADES)],
            'sanitary_registry' => ['nullable', 'string', 'max:40'],
            'sanitary_registry_expires' => ['nullable', 'date'],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
            'tax_change_reason' => ['nullable', 'string', 'max:200'],
        ], [
            'code.regex' => 'El código tiene de 2 a 40 letras, números o guiones.',
            'code.unique' => 'Ya existe un producto con ese código en la empresa (RN-CAT-01).',
            'sunat_product_code.regex' => 'El código SUNAT tiene 8 dígitos (catálogo UNSPSC).',
        ]);
    }

    private function filtrar($query, Request $request, bool $soloPestanaYMarca = false)
    {
        $marcas = Access::for($request->user())['brands'];
        $marca = $request->query('brand_id');
        $tipo = $request->query('tipo', 'SALE');

        $query
            // Alcance del usuario: sin marcas asignadas, ve todas.
            ->when($marcas, fn ($q) => $q->whereIn('products.brand_id', $marcas))
            ->when(Str::isUuid((string) $marca), fn ($q) => $q->where('products.brand_id', $marca))
            ->when($tipo === 'SALE', fn ($q) => $q->whereIn('products.product_type', self::DE_VENTA))
            ->when($tipo === 'INPUT', fn ($q) => $q->whereNotIn('products.product_type', self::DE_VENTA));

        if ($soloPestanaYMarca) {
            return $query;
        }

        $web = $request->query('web');

        return $query
            ->when($request->query('line'), fn ($q, $v) => $q->where('products.line', $v))
            ->when(Str::isUuid((string) $request->query('category_id')), fn ($q) => $q->where('products.category_id', $request->query('category_id')))
            ->when($request->query('status'), fn ($q, $v) => $q->where('products.status', $v))
            ->when($request->query('storage'), fn ($q, $v) => $q->where('products.storage', $v))
            ->when($web === '1', fn ($q) => $q->where('products.web_publishable', true))
            ->when($web === '0', fn ($q) => $q->where(fn ($w) => $w->whereNull('products.web_publishable')->orWhere('products.web_publishable', false)));
    }

    /** Precio mínimo y máximo de las variantes con precio; null si ninguna tiene (RN-CAT-05: no se vende). */
    private static function rango(array $precios): ?array
    {
        if (! $precios) {
            return null;
        }
        $valores = array_column($precios, 'price');

        return ['min' => min($valores), 'max' => max($valores), 'basis' => $precios[0]['basis']];
    }
}
