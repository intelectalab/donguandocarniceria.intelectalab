<?php

namespace App\Modulos\Web\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Web\Services\Tiendas;
use App\Support\Access;
use Illuminate\Http\Request;

/** WEB-01 Tiendas. */
class TiendaController extends Controller
{
    public function index(Request $r)
    {
        return response()->json(Tiendas::lista($r->user()) + ['puede_editar' => Access::can($r->user(), 'web.store.manage')]);
    }

    public function show(Request $r, string $id)
    {
        return response()->json(Tiendas::ver($id, $r->user()) + ['puede_editar' => Access::can($r->user(), 'web.store.manage')]);
    }

    public function opciones()
    {
        return response()->json(Tiendas::opciones());
    }

    public function store(Request $r)
    {
        return response()->json(Tiendas::guardar($this->datos($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(Tiendas::guardar($this->datos($r), $id, $r->user()));
    }

    public function probar(Request $r, string $id)
    {
        return response()->json(Tiendas::probar($id, $r->user()));
    }

    public function estado(Request $r, string $id)
    {
        $d = $r->validate(['status' => ['required', 'in:ACTIVE,TESTING,PENDING,DISABLED'], 'reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Tiendas::cambiarEstado($id, $d['status'], $d['reason'] ?? null, $r->user()));
    }

    private function datos(Request $r): array
    {
        return $r->validate([
            'name' => ['required', 'string', 'max:80'], 'url' => ['required', 'string', 'max:200'], 'theme' => ['nullable', 'string', 'max:80'],
            'brand_id' => ['required', 'uuid'], 'brands' => ['nullable', 'array', 'max:10'], 'brands.*' => ['uuid'],
            'price_list_id' => ['required', 'uuid'], 'establishment_id' => ['required', 'uuid'],
            'warehouse_ids' => ['required', 'array', 'min:1', 'max:10'], 'warehouse_ids.*' => ['uuid'],
            'safety_margin_pct' => ['required', 'numeric', 'min:0', 'max:50'], 'default_seller_id' => ['nullable', 'uuid'],
            'sync_catalog' => ['boolean'], 'sync_prices' => ['boolean'], 'sync_stock' => ['boolean'], 'sync_orders' => ['boolean'],
            'split_mixed_cart' => ['boolean'], 'connector_id' => ['nullable', 'uuid'], 'payment_connector_id' => ['nullable', 'uuid'],
        ]);
    }
}
