<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Ped\Services\Pedidos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PED-04 Selector de productos: busca por nombre, SKU o código de barras dentro de la marca del
 * pedido; muestra el corte, el modo de venta, el precio vigente del canal (CAT) y el stock
 * disponible en el local que atiende (ALM). Solo variantes activas y vendibles (RN-PED-02).
 */
class ProductoController extends Controller
{
    public function index(Request $request)
    {
        $d = $request->validate([
            'brand_id' => ['required', 'uuid'], 'channel' => ['nullable', Rule::in(Pedidos::CANALES)], 'customer_id' => ['nullable', 'uuid'],
            'establishment_id' => ['nullable', 'uuid'], 'q' => ['nullable', 'string', 'max:60'],
        ]);
        $texto = trim((string) ($d['q'] ?? ''));
        $patron = '%'.addcslashes(mb_strtolower($texto), '%_\\').'%';
        $vs = DB::table('product_variants as v')->leftJoin('cut_types as c', 'c.id', '=', 'v.cut_type_id')
            ->where('v.brand_id', $d['brand_id'])->where('v.status', 'ACTIVE')->where('v.sellable', true)
            ->when($texto !== '', fn ($q) => $q->where(fn ($w) => $w
                ->whereRaw("translate(lower(v.name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", [$patron])
                ->orWhereRaw('lower(v.sku) like ?', [$patron])->orWhere('v.barcode', $texto)))
            ->orderBy('v.name')->limit(40)
            ->get(['v.id', 'v.sku', 'v.name', 'v.barcode', 'v.sale_mode', 'v.nominal_weight_kg', 'v.weight_tolerance_pct', 'v.min_order_qty', 'v.qty_step', 'c.name as corte']);

        $tipo = ! empty($d['customer_id']) ? (DB::table('customers')->where('id', $d['customer_id'])->value('customer_type') ?? 'PERSON') : 'PERSON';
        $precios = Precios::vigentes($vs->pluck('id')->all(), ['canal' => $d['channel'] ?? 'WHATSAPP', 'tipo_cliente' => $tipo, 'marca' => $d['brand_id']]);
        $stock = $this->stock($vs->pluck('id')->all(), $d['establishment_id'] ?? null);

        return response()->json($vs->map(fn ($v) => (array) $v + [
            'precio' => $precios[$v->id]['price'] ?? null, 'base' => $precios[$v->id]['basis'] ?? null, 'lista' => $precios[$v->id]['list_name'] ?? null,
            'disponible' => $stock[$v->id] ?? 0.0,
        ])->values());
    }

    /** Disponible (saldo − reservado) en almacenes de venta del local, solo lotes liberados y vigentes. */
    private function stock(array $ids, ?string $local): array
    {
        if (! $ids) {
            return [];
        }

        return DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')
            ->whereIn('b.variant_id', $ids)->where('w.status', 'ACTIVE')->where('w.allows_sale', true)
            ->when($local, fn ($q) => $q->where('w.establishment_id', $local))
            ->where(fn ($x) => $x->whereNull('b.lot_id')->orWhere(fn ($y) => $y->where('l.qc_status', 'RELEASED')->where('l.expiry_date', '>=', now('America/Lima')->toDateString())))
            ->groupBy('b.variant_id')->selectRaw('b.variant_id, round(greatest(sum(b.qty - b.reserved_qty), 0), 3) as disp')
            ->pluck('disp', 'variant_id')->map(fn ($x) => (float) $x)->all();
    }
}
