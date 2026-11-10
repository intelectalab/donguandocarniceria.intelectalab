<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\ReservasService;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ALM-10 Reservas activas por pedido, lote y almacén; liberación manual con motivo y permiso. */
class ReservaController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('stock_reservations as r')->join('product_variants as v', 'v.id', '=', 'r.variant_id')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')
            ->leftJoin('lots as l', 'l.id', '=', 'r.lot_id')->leftJoin('users as u', 'u.id', '=', 'r.released_by')
            ->where('r.status', $r->query('status', 'ACTIVE'))->when($r->query('order_id'), fn ($x, $o) => $x->where('r.order_id', $o));
        $this->porLocal($q, $r, 'r.establishment_id');
        $this->porMarca($q, $r, 'r.brand_id');
        $q->selectRaw('r.id, r.order_id, r.order_number, r.order_line_id, r.status, r.qty, r.weight_kg, r.delivery_date, r.reserved_at, r.closed_at, r.released_reason,
            u.name as released_by_name, v.sku, v.name as variant_name, v.sale_mode, w.code as warehouse_code, l.code as lot_code, l.expiry_date');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['order_number', 'sku', 'variant_name', 'lot_code'],
            ordenar: ['order_number', 'delivery_date', 'reserved_at', 'qty'], porDefecto: 'delivery_date'));
    }

    public function liberar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:200']);

        return response()->json(ReservasService::liberarManual($id, $d['reason'], $r->user()));
    }
}
