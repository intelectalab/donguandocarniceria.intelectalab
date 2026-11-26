<?php

namespace App\Modulos\Cmp\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Canales\Soporte as S;
use App\Modulos\Cmp\Services\Campanas;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CMP-03 campañas, CMP-04 nueva campaña, CMP-05 estimación y aprobación, CMP-06 resultados, CMP-13 calendario. */
class CampanaController extends Controller
{
    public function index(Request $r)
    {
        $rows = Alcance::filtrar(DB::table('campaigns as c'), $r->user(), 'c.brand_id')->join('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('customer_segments as s', 's.id', '=', 'c.segment_id')
            ->leftJoin('coupons as k', 'k.id', '=', 'c.coupon_id')
            ->when($r->query('brand_id'), fn ($q, $v) => $q->where('c.brand_id', $v))
            ->when($r->query('status'), fn ($q, $v) => $q->where('c.status', $v))
            ->orderByRaw("CASE c.status WHEN 'PENDING_APPROVAL' THEN 0 WHEN 'APPROVED' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END")->orderByDesc('c.created_at')
            ->get(['c.*', 'b.name as brand_name', 's.code as segment_code', 's.name as segment_name', 'k.code as coupon_code'])
            ->map(function ($c) {
                $c->history = json_decode($c->history ?? '[]', true) ?: [];
                if ($c->status === 'SENT') {
                    $res = Campanas::resultados($c);
                    $c->orders = $res['orders'];
                    $c->collected = $res['collected'];
                    $c->roi = $res['roi'];
                    $c->total_cost = $res['total_cost'];
                }

                return $c;
            });

        return response()->json(['data' => $rows]);
    }

    public function show(Request $r, string $id)
    {
        $c = DB::table('campaigns as c')->join('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('customer_segments as s', 's.id', '=', 'c.segment_id')
            ->leftJoin('message_templates as t', 't.id', '=', 'c.template_id')->leftJoin('messaging_channels as m', 'm.id', '=', 'c.channel_id')->leftJoin('coupons as k', 'k.id', '=', 'c.coupon_id')
            ->where('c.id', $id)->first(['c.*', 'b.name as brand_name', 's.code as segment_code', 's.name as segment_name', 't.name as template_name', 't.body as template_body',
                'm.display_name as channel_name', 'm.number as channel_number', 'k.code as coupon_code']) ?? abort(404);
        Alcance::exigir($r->user(), $c->brand_id);
        $c->history = json_decode($c->history ?? '[]', true) ?: [];
        $c->created_name = S::nombre($c->created_by_user);
        $c->approved_name = S::nombre($c->approved_by);
        $c->threshold = Campanas::umbral();
        $c->needs_manager = (float) $c->estimated_cost > Campanas::umbral() + 0.0001;
        $c->rate = Campanas::tarifa();
        $c->fee = Campanas::comision();
        if (in_array($c->status, ['SENT'], true)) {
            $c->results = Campanas::resultados($c);
            $c->recipients = DB::table('campaign_recipients as r')->join('customers as k', 'k.id', '=', 'r.customer_id')->where('r.campaign_id', $id)
                ->orderBy('r.status')->limit(300)->get(['r.*', 'k.full_name']);
            $c->attributions = DB::table('campaign_attributions as a')->join('sales_orders as o', 'o.id', '=', 'a.order_id')->join('customers as k', 'k.id', '=', 'a.customer_id')
                ->where('a.campaign_id', $id)->orderByDesc('a.attributed_at')->limit(200)->get(['a.*', 'o.number as order_number', 'k.full_name']);
        }

        return response()->json($c);
    }

    private function datos(Request $r): array
    {
        $d = $r->validate(['name' => 'required|string|max:255', 'brand_id' => 'required|uuid', 'segment_id' => 'required|uuid', 'channel_id' => 'required|uuid', 'template_id' => 'required|uuid',
            'objective' => 'nullable|string|max:20', 'coupon_id' => 'nullable|uuid', 'scheduled_at' => 'nullable|date', 'attribution_window_days' => 'nullable|integer',
            'control_group_pct' => 'nullable|numeric']);
        Alcance::exigir($r->user(), $d['brand_id']);

        return $d;
    }

    public function store(Request $r)
    {
        return response()->json(Campanas::guardar($this->datos($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(Campanas::guardar($this->datos($r), $id, $r->user()));
    }

    /** CMP-05: recalcula la estimación (también al abrir la pantalla de una campaña por aprobar). */
    public function estimar(Request $r, string $id)
    {
        $c = DB::table('campaigns')->where('id', $id)->first() ?? abort(404);
        in_array($c->status, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'], true) || abort(409, 'La campaña ya se envió o se canceló.');

        return response()->json(Campanas::aplicarEstimacion($c));
    }

    public function enviarAAprobacion(Request $r, string $id)
    {
        return response()->json(Campanas::enviarAAprobacion($id, $r->user()));
    }

    public function aprobar(Request $r, string $id)
    {
        return response()->json(Campanas::aprobar($id, $r->user()));
    }

    public function cancelar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'nullable|string|max:255']);

        return response()->json(Campanas::cancelar($id, $d['reason'] ?? null, $r->user()));
    }

    public function enviar(Request $r, string $id)
    {
        return response()->json(Campanas::enviar($id, $r->user()));
    }

    public function atribuir()
    {
        return response()->json(['attributed' => Campanas::atribuirRecientes()]);
    }

    /** CMP-13 */
    public function calendario(Request $r)
    {
        $mes = preg_match('/^\d{4}-\d{2}$/', (string) $r->query('month')) ? $r->query('month') : substr(S::fecha(), 0, 7);

        return response()->json(Campanas::calendario($mes) + ['month' => $mes]);
    }
}
