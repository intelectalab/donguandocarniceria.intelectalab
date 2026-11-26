<?php

namespace App\Modulos\Cmp\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Canales\Soporte as S;
use App\Modulos\Cmp\Services\Cupones;
use App\Modulos\Cmp\Services\Puntos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CMP-07 cupones, CMP-08 programa de puntos, CMP-09 puntos del cliente, CMP-10 referidos. */
class FidelizacionController extends Controller
{
    public function cupones(Request $r)
    {
        $hoy = S::fecha();
        $rows = Alcance::filtrar(DB::table('coupons as k'), $r->user(), 'k.brand_id')->leftJoin('brands as b', 'b.id', '=', 'k.brand_id')->leftJoin('customers as c', 'c.id', '=', 'k.customer_id')
            ->leftJoin('campaigns as m', 'm.id', '=', 'k.campaign_id')
            ->when($r->query('status'), fn ($q, $v) => $q->where('k.status', $v))
            ->when($r->query('personal') === '0', fn ($q) => $q->whereNull('k.customer_id'))
            ->orderByRaw("CASE k.status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END")->orderByDesc('k.valid_from')
            ->get(['k.*', 'b.name as brand_name', 'c.full_name as customer_name', 'm.code as campaign_code'])
            ->map(function ($k) use ($hoy) {
                $k->channels = json_decode($k->channels ?? '[]', true) ?: [];
                $k->usage = Cupones::usos($k->id);
                $k->in_force = $k->status === 'ACTIVE' && $k->valid_from <= $hoy && $k->valid_to >= $hoy;

                return $k;
            });

        return response()->json(['data' => $rows]);
    }

    private function datosCupon(Request $r): array
    {
        $d = $r->validate(['code' => 'required|string|max:20', 'brand_id' => 'nullable|uuid', 'discount_type' => 'required|in:PCT,AMOUNT,FREE_DELIVERY', 'value' => 'nullable|numeric',
            'max_discount' => 'nullable|numeric|min:0', 'min_order_amount' => 'nullable|numeric|min:0', 'valid_from' => 'required|date', 'valid_to' => 'required|date',
            'max_uses_total' => 'nullable|integer', 'max_uses_per_customer' => 'nullable|integer', 'customer_id' => 'nullable|uuid', 'channels' => 'nullable|array',
            'status' => 'nullable|in:ACTIVE,PAUSED,EXPIRED', 'description' => 'nullable|string|max:255', 'campaign_id' => 'nullable|uuid']);
        Alcance::exigir($r->user(), $d['brand_id'] ?? null);

        return $d;
    }

    public function guardarCupon(Request $r)
    {
        return response()->json(Cupones::guardar($this->datosCupon($r), null, $r->user()), 201);
    }

    public function actualizarCupon(Request $r, string $id)
    {
        return response()->json(Cupones::guardar($this->datosCupon($r), $id, $r->user()));
    }

    /** Prueba un cupón contra un pedido (lo que hará PED al aplicarlo). */
    public function probarCupon(Request $r)
    {
        $d = $r->validate(['order_id' => 'required_without:order_number|nullable|uuid', 'order_number' => 'nullable|string|max:20', 'code' => 'required|string|max:20', 'apply' => 'nullable|boolean'],
            ['order_id.required_without' => 'Indica el número del pedido.']);
        if (empty($d['order_id'])) {
            $d['order_id'] = DB::table('sales_orders')->whereRaw('upper(number) = ?', [strtoupper(trim($d['order_number']))])->value('id')
                ?? \App\Support\RuleError::fail('RN-CMP-10', 'No hay un pedido con el número '.strtoupper(trim($d['order_number'])).'.');
        }
        if (! empty($d['apply'])) {
            return response()->json(Cupones::aplicar($d['order_id'], $d['code'], $r->user()));
        }
        $o = DB::table('sales_orders')->where('id', $d['order_id'])->first() ?? abort(404);
        $res = Cupones::revisar($o, $d['code']);

        return response()->json(['code' => $res['coupon']->code, 'base' => $res['base'], 'discount' => $res['discount'], 'order_id' => $o->id, 'order_number' => $o->number, 'order_status' => $o->status]);
    }

    /** CMP-08 */
    public function programa()
    {
        $pr = Puntos::programa();
        $tot = DB::table('loyalty_ledger')->selectRaw("coalesce(sum(points), 0) AS balance, coalesce(sum(points) FILTER (WHERE movement IN ('EARN','REFERRAL_BONUS','ADJUST') AND points > 0), 0) AS earned,
            coalesce(-sum(points) FILTER (WHERE movement = 'REDEEM'), 0) AS redeemed, coalesce(-sum(points) FILTER (WHERE movement = 'EXPIRE'), 0) AS expired, count(DISTINCT customer_id) AS customers")->first();

        return response()->json(['program' => $pr, 'totals' => $tot, 'liability' => S::r((float) $tot->balance * (float) ($pr->pen_per_point ?? 0.05)),
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'name'])]);
    }

    public function guardarPrograma(Request $r)
    {
        $d = $r->validate(['name' => 'required|string|max:255', 'points_per_pen' => 'required|numeric|gt:0', 'pen_per_point' => 'required|numeric|gt:0',
            'min_redeem_points' => 'required|integer|min:1', 'expiry_months' => 'required|integer|min:1|max:60', 'referral_bonus_points' => 'required|integer|min:0', 'status' => 'nullable|in:ACTIVE,INACTIVE']);
        $pr = Puntos::programa();
        if ($pr) {
            DB::table('loyalty_programs')->where('id', $pr->id)->update($d + ['updated_at' => now()]);
        } else {
            DB::table('loyalty_programs')->insert($d + ['code' => 'PUNTOS', 'status' => 'ACTIVE']);
        }

        return response()->json(Puntos::programa());
    }

    /** CMP-09 */
    public function clientes(Request $r)
    {
        $q = trim((string) $r->query('q'));
        $rows = DB::table('loyalty_ledger as l')->join('customers as c', 'c.id', '=', 'l.customer_id')
            ->when($q, fn ($x) => $x->where(fn ($w) => $w->where('c.full_name', 'ilike', "%{$q}%")->orWhere('c.phone', 'like', "%{$q}%")))
            ->groupBy('c.id', 'c.full_name', 'c.phone')->orderByDesc(DB::raw('sum(l.points)'))->limit(200)
            ->get(['c.id', 'c.full_name', 'c.phone', DB::raw('sum(l.points)::int AS balance'), DB::raw('max(l.created_at) AS last_movement')]);

        return response()->json(['data' => $rows]);
    }

    public function cliente(string $id)
    {
        $c = DB::table('customers')->where('id', $id)->first(['id', 'full_name', 'phone', 'referral_code']) ?? abort(404);

        return response()->json(Puntos::movimientos($id) + ['customer' => $c]);
    }

    public function canjear(Request $r, string $id)
    {
        $d = $r->validate(['points' => 'required|integer', 'order_id' => 'nullable|uuid']);

        return response()->json(Puntos::canjear($id, (int) $d['points'], $r->user(), $d['order_id'] ?? null), 201);
    }

    public function ajustar(Request $r, string $id)
    {
        $d = $r->validate(['points' => 'required|integer', 'reason' => 'nullable|string|max:255']);

        return response()->json(Puntos::ajustar($id, (int) $d['points'], $d['reason'] ?? null, $r->user()), 201);
    }

    public function reversar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'nullable|string|max:255']);

        return response()->json(Puntos::reversar($id, $d['reason'] ?? null, $r->user()), 201);
    }

    /** CMP-10 */
    public function referidos(Request $r)
    {
        $rows = DB::table('referrals as f')->join('customers as a', 'a.id', '=', 'f.referrer_customer_id')->join('customers as b', 'b.id', '=', 'f.referred_customer_id')
            ->leftJoin('coupons as k', 'k.id', '=', 'f.welcome_coupon_id')->leftJoin('sales_orders as o', 'o.id', '=', 'f.first_order_id')->leftJoin('loyalty_ledger as l', 'l.id', '=', 'f.reward_ledger_id')
            ->when($r->query('status'), fn ($q, $v) => $q->where('f.status', $v))
            ->orderByDesc('f.created_at')
            ->get(['f.*', 'a.full_name as referrer_name', 'b.full_name as referred_name', 'k.code as coupon_code', 'o.number as order_number', 'l.points as reward_points']);
        $top = DB::table('referrals as f')->join('customers as a', 'a.id', '=', 'f.referrer_customer_id')->groupBy('a.id', 'a.full_name', 'a.referral_code')
            ->orderByDesc(DB::raw('count(*)'))->limit(10)->get(['a.id', 'a.full_name', 'a.referral_code', DB::raw('count(*) AS referrals'), DB::raw("count(*) FILTER (WHERE f.status = 'REWARDED') AS rewarded")]);

        return response()->json(['data' => $rows, 'top' => $top, 'bonus_points' => (int) (Puntos::programa()->referral_bonus_points ?? 200)]);
    }

    public function registrarReferido(Request $r)
    {
        $d = $r->validate(['referrer_customer_id' => 'required|uuid', 'referred_customer_id' => 'required|uuid']);

        return response()->json(Puntos::registrarReferido($d['referrer_customer_id'], $d['referred_customer_id'], $r->user()), 201);
    }

    public function rechazarReferido(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'nullable|string|max:255']);

        return response()->json(Puntos::rechazarReferido($id, $d['reason'] ?? null, $r->user()));
    }
}
