<?php

namespace App\Modulos\B2b\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\B2b\Services\Recurrentes;
use App\Modulos\Canales\Soporte as S;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** B2B-05 pedidos recurrentes y B2B-06 calendario de corridas. */
class RecurrenteController extends Controller
{
    private function conLineas(object $ro): object
    {
        $ro->weekdays = json_decode($ro->weekdays ?? '[]', true) ?: [];
        $ro->lines = DB::table('recurring_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.recurring_order_id', $ro->id)
            ->get(['l.*', 'v.name as variant_name', 'v.sale_mode', 'v.status as variant_status', 'v.sellable'])->all();
        $ro->next_dates = $ro->status === 'ACTIVE' ? Recurrentes::proximas($ro, S::masDias(S::fecha(), 1), 4) : [];
        $ro->last_run = DB::table('recurring_order_runs')->where('recurring_order_id', $ro->id)->orderByDesc('delivery_date')->first();

        return $ro;
    }

    public function index(Request $r)
    {
        $rows = DB::table('recurring_orders as ro')->join('customers as c', 'c.id', '=', 'ro.customer_id')->leftJoin('brands as b', 'b.id', '=', 'ro.brand_id')
            ->leftJoin('customer_addresses as a', 'a.id', '=', 'ro.address_id')
            ->when($r->query('customer_id'), fn ($q, $v) => $q->where('ro.customer_id', $v))
            ->when($r->query('status'), fn ($q, $v) => $q->where('ro.status', $v))
            ->orderBy('c.full_name')->orderBy('ro.name')
            ->get(['ro.*', 'c.full_name as customer_name', 'b.name as brand_name', 'a.address_line as address_text'])
            ->map(fn ($ro) => $this->conLineas($ro));

        return response()->json(['data' => $rows]);
    }

    public function direcciones(string $customerId)
    {
        return response()->json(DB::table('customer_addresses')->where('customer_id', $customerId)->where('status', 'ACTIVE')->orderByDesc('is_default')
            ->get(['id', 'label', 'address_line', 'district', 'zone_id', 'is_default']));
    }

    public function store(Request $r)
    {
        return response()->json($this->conLineas(Recurrentes::guardar($this->datos($r), null, $r->user())), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json($this->conLineas(Recurrentes::guardar($this->datos($r), $id, $r->user())));
    }

    private function datos(Request $r): array
    {
        return $r->validate([
            'customer_id' => 'nullable|uuid', 'address_id' => 'required|uuid', 'name' => 'nullable|string|max:255', 'frequency' => 'required|in:WEEKLY,EVERY_N_DAYS',
            'weekdays' => 'nullable|array', 'weekdays.*' => 'integer|between:1,7', 'interval_days' => 'nullable|integer|min:1|max:60',
            'slot_from' => 'nullable|date_format:H:i', 'slot_to' => 'nullable|date_format:H:i', 'lead_days' => 'nullable|integer|min:1|max:7',
            'starts_on' => 'nullable|date', 'ends_on' => 'nullable|date', 'auto_confirm' => 'nullable|boolean', 'notes' => 'nullable|string|max:500',
            'lines' => 'required|array|min:1', 'lines.*.variant_id' => 'required|uuid', 'lines.*.qty' => 'required|numeric|gt:0',
            'lines.*.est_weight_kg' => 'nullable|numeric|min:0', 'lines.*.cut_notes' => 'nullable|string|max:255',
        ]);
    }

    public function estado(Request $r, string $id)
    {
        $d = $r->validate(['status' => 'required|in:ACTIVE,PAUSED,ENDED']);
        $ro = DB::table('recurring_orders')->where('id', $id)->first() ?? abort(404);
        $ro->status !== 'ENDED' || RuleError::fail('RN-B2B-09', 'La programación ya terminó: crea una nueva.');
        DB::table('recurring_orders')->where('id', $id)->update(['status' => $d['status'], 'ends_on' => $d['status'] === 'ENDED' ? S::fecha() : $ro->ends_on, 'updated_at' => now()]);

        return response()->json($this->conLineas(DB::table('recurring_orders')->where('id', $id)->first()));
    }

    /** B2B-06: próximas corridas (14 días) y resultado de las anteriores. */
    public function corridas(Request $r)
    {
        $hoy = S::fecha();
        $hora = S::texto('b2b_recurring_run_time', '18:00');
        $activas = DB::table('recurring_orders as ro')->join('customers as c', 'c.id', '=', 'ro.customer_id')->where('ro.status', 'ACTIVE')->get(['ro.*', 'c.full_name as customer_name']);
        $proximas = [];
        for ($i = 0; $i < 14; $i++) {
            $corre = S::masDias($hoy, $i);
            foreach ($activas as $ro) {
                $entrega = S::masDias($corre, (int) $ro->lead_days);
                if (Recurrentes::ocurre($ro, $entrega)) {
                    $hecha = DB::table('recurring_order_runs')->where('recurring_order_id', $ro->id)->where('delivery_date', $entrega)->first(['status', 'order_id']);
                    $proximas[] = ['run_date' => $corre, 'run_time' => $hora, 'delivery_date' => $entrega, 'recurring_order_id' => $ro->id, 'name' => $ro->name,
                        'customer_name' => $ro->customer_name, 'auto_confirm' => (bool) $ro->auto_confirm, 'holiday' => Recurrentes::esFeriado($entrega), 'done' => $hecha];
                }
            }
        }
        $pasadas = DB::table('recurring_order_runs as x')->join('recurring_orders as ro', 'ro.id', '=', 'x.recurring_order_id')->join('customers as c', 'c.id', '=', 'ro.customer_id')
            ->leftJoin('sales_orders as o', 'o.id', '=', 'x.order_id')
            ->when($r->query('status'), fn ($q, $v) => $q->where('x.status', $v))
            ->orderByDesc('x.run_at')->limit(200)
            ->get(['x.*', 'ro.name', 'c.full_name as customer_name', 'o.number as order_number', 'o.status as order_status', 'o.estimated_total']);

        return response()->json(['upcoming' => $proximas, 'runs' => $pasadas, 'run_time' => $hora, 'today' => $hoy]);
    }

    /** Ejecuta la corrida de hoy a mano (es idempotente: no duplica pedidos). */
    public function correr(Request $r)
    {
        $d = $r->validate(['recurring_order_id' => 'nullable|uuid']);
        $res = Recurrentes::correr(S::fecha().' '.S::texto('b2b_recurring_run_time', '18:00'), true, $d['recurring_order_id'] ?? null);

        return response()->json($res);
    }
}
