<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ped\Services\Descuentos;
use App\Modulos\Ped\Services\Pedidos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** PED-10 Aprobación de descuentos sobre el límite del rol (RN-PED-11). Quien pide no aprueba. */
class DescuentoController extends Controller
{
    public function index(Request $request)
    {
        $d = $request->validate(['status' => ['nullable', Rule::in(['PENDING', 'APPROVED', 'REJECTED', 'ALL'])]]);
        $q = DB::table('order_discount_approvals as a')->join('sales_orders as o', 'o.id', '=', 'a.order_id')
            ->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('brands as b', 'b.id', '=', 'a.brand_id')
            ->when(($d['status'] ?? 'PENDING') !== 'ALL', fn ($w) => $w->where('a.status', $d['status'] ?? 'PENDING'));
        Pedidos::alcance($q, $request->user());

        return response()->json($q->orderByDesc('a.requested_at')->limit(200)->get([
            'a.id', 'a.order_id', 'a.order_number', 'a.requested_by', 'a.requested_by_name', 'a.requested_role', 'a.requested_pct', 'a.requested_amount', 'a.order_base',
            'a.reason', 'a.status', 'a.requested_at', 'a.decided_by_name', 'a.decided_at', 'a.decision_note', 'o.status as estado_pedido',
            DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'b.name as marca',
        ])->map(fn ($r) => (array) $r + ['propia' => $r->requested_by === $request->user()->id]));
    }

    public function aprobar(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['nullable', 'string', 'max:255']]);
        $this->delAlcance($request, $id);

        return response()->json(Descuentos::decidir($id, true, $d['note'] ?? null, $request->user()));
    }

    public function rechazar(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['required', 'string', 'max:255']]);
        $this->delAlcance($request, $id);

        return response()->json(Descuentos::decidir($id, false, $d['note'], $request->user()));
    }

    /**
     * Quien aprueba o rechaza solo decide sobre pedidos de su alcance (marcas y locales), igual que en la lista:
     * con el id de una solicitud de otra marca responde 404, como si no existiera.
     */
    private function delAlcance(Request $request, string $id): void
    {
        $orden = DB::table('order_discount_approvals')->where('id', $id)->value('order_id') ?? abort(404, 'Solicitud no encontrada.');
        Pedidos::visible($orden, $request->user());
    }

    /** El límite de quien pide, para avisarle en el formulario antes de guardar. */
    public function limite(Request $request)
    {
        $d = $request->validate(['brand_id' => ['required', 'uuid']]);

        return response()->json(Descuentos::limite($request->user(), $d['brand_id']));
    }
}
