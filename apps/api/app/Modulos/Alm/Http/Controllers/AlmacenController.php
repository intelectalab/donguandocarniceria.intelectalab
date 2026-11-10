<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\AlmacenesService;
use App\Modulos\Alm\Services\InventarioService;
use App\Support\Access;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ALM-01 Almacenes y ubicaciones, más las opciones que usan los formularios de ALM. */
class AlmacenController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('warehouses as w')->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id')
            ->leftJoin('vehicles as ve', 've.id', '=', 'w.vehicle_id')
            ->when($r->query('status'), fn ($x, $s) => $x->where('w.status', $s));
        $this->porLocal($q, $r, 'w.establishment_id');
        $filas = $q->orderByRaw('e.name nulls first')->orderBy('w.pick_priority')->orderBy('w.code')
            ->get(['w.*', 'e.name as establishment_name', 'e.short as establishment_short', 've.plate as vehicle_plate']);
        $stock = DB::table('stock_balances')->where('qty', '>', 0)->groupBy('warehouse_id')
            ->selectRaw('warehouse_id, count(*) saldos, sum(qty * avg_cost) valor')->get()->keyBy('warehouse_id');
        $ver = $this->verCostos($r);
        $filas->each(function ($w) use ($stock, $ver) {
            $w->balances = (int) ($stock[$w->id]->saldos ?? 0);
            $w->stock_value = $ver ? round((float) ($stock[$w->id]->valor ?? 0), 2) : null;
        });

        return response()->json(['data' => $filas]);
    }

    public function store(Request $r)
    {
        return response()->json(AlmacenesService::guardar($this->datos($r), null), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(AlmacenesService::guardar($this->datos($r), $id));
    }

    /** Opciones para los formularios: almacenes, locales, marcas, líneas, proveedores y motivos. */
    public function opciones(Request $r)
    {
        $locales = Access::for($r->user())['establishments'];
        $marcas = Access::for($r->user())['brands'];

        return response()->json([
            'warehouses' => DB::table('warehouses')->where('status', 'ACTIVE')->when($locales, fn ($q) => $q->where(fn ($y) => $y->whereIn('establishment_id', $locales)->orWhereNull('establishment_id')))
                ->orderBy('pick_priority')->orderBy('code')->get(['id', 'code', 'name', 'wh_type', 'establishment_id', 'allows_sale', 'min_temp_c', 'max_temp_c']),
            'establishments' => DB::table('establishments')->when($locales, fn ($q) => $q->whereIn('id', $locales))->orderBy('name')->get(['id', 'name', 'short']),
            'brands' => DB::table('brands')->when($marcas, fn ($q) => $q->whereIn('id', $marcas))->orderBy('name')->get(['id', 'name']),
            'lines' => DB::table('products')->whereNotNull('line')->distinct()->orderBy('line')->pluck('line'),
            'suppliers' => DB::table('suppliers')->where('status', 'ACTIVE')->orderBy('trade_name')->get(['id', 'trade_name', 'supplier_type']),
            'waste_reasons' => DB::table('waste_reasons')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'code', 'name', 'requires_photo', 'approval_above_pen', 'counts_as_expired']),
            'vehicles' => DB::table('vehicles')->orderBy('plate')->get(['id', 'plate']),
            'params' => [
                'alm_max_temp_chilled_c' => (float) (Params::get('alm_max_temp_chilled_c') ?? 4),
                'alm_max_temp_frozen_c' => (float) (Params::get('alm_max_temp_frozen_c') ?? -18),
                'alm_expiry_alert_days' => (int) (Params::get('alm_expiry_alert_days') ?? 7),
            ],
        ]);
    }

    /** Buscador de variantes para los formularios (SKU, nombre o código de barras). */
    public function variantes(Request $r)
    {
        $t = '%'.mb_strtolower(trim((string) $r->query('q', ''))).'%';
        $q = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.status', 'ACTIVE')
            ->where(fn ($x) => $x->whereRaw('lower(v.sku) like ?', [$t])->orWhereRaw('lower(v.name) like ?', [$t])->orWhereRaw('lower(coalesce(v.barcode, \'\')) like ?', [$t]));
        $this->porMarca($q, $r, 'v.brand_id');

        return response()->json(['data' => $q->orderBy('v.sku')->limit(30)
            ->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.nominal_weight_kg', 'v.std_cost', 'v.brand_id', 'p.requires_lot', 'p.storage', 'p.line', 'p.shelf_life_days'])]);
    }

    /** Lotes y saldos que se pueden usar de una variante en un almacén (o los de venta de un local). */
    public function disponibles(Request $r)
    {
        $r->validate(['variant_id' => 'required|uuid']);
        $donde = array_filter(['warehouse_id' => $r->query('warehouse_id'), 'establishment_id' => $r->query('establishment_id'), 'delivery_date' => $r->query('delivery_date')]);
        if ($r->boolean('todos') && $r->query('warehouse_id')) {
            // Para mermas y conteos: todos los saldos del almacén, sin importar el estado del lote.
            return response()->json(['data' => DB::table('stock_balances as b')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')
                ->where('b.variant_id', $r->query('variant_id'))->where('b.warehouse_id', $r->query('warehouse_id'))->where('b.qty', '>', 0)
                ->orderByRaw("coalesce(l.expiry_date, '9999-12-31')")
                ->get(['b.id as balance_id', 'b.lot_id', 'l.code as lot_code', 'l.expiry_date', 'l.qc_status', 'b.qty', 'b.reserved_qty', 'b.weight_kg'])]);
        }

        return response()->json(['data' => InventarioService::lotesDisponibles($r->query('variant_id'), $donde)]);
    }

    private function datos(Request $r): array
    {
        return $r->validate([
            'code' => 'required|string|max:40', 'name' => 'required|string|max:120', 'wh_type' => 'required|string',
            'establishment_id' => 'nullable|uuid', 'min_temp_c' => 'nullable|numeric', 'max_temp_c' => 'nullable|numeric',
            'allows_sale' => 'boolean', 'pick_priority' => 'nullable|integer|min:0|max:9999', 'parent_id' => 'nullable|uuid',
            'vehicle_id' => 'nullable|uuid', 'status' => 'nullable|in:ACTIVE,INACTIVE',
        ]);
    }
}
