<?php

namespace App\Modulos\Cmp\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Canales\Soporte as S;
use App\Modulos\Cmp\Services\Audiencia;
use App\Modulos\Cmp\Services\Campanas;
use App\Modulos\Cmp\Services\Cupones;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CMP-01 y 02 segmentos, CMP-11 consentimientos por marca, CMP-12 recompra esperada y opciones del módulo. */
class AudienciaController extends Controller
{
    public const PERMISOS = ['cmp.segment.manage', 'cmp.campaign.manage', 'cmp.campaign.approve', 'cmp.campaign.approve_over_threshold', 'cmp.coupon.manage', 'cmp.loyalty.adjust', 'crm.consent.manage'];

    public function opciones(Request $r)
    {
        $u = $r->user();
        $marcas = Alcance::marcas($u);

        return response()->json([
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->when($marcas, fn ($q, $m) => $q->whereIn('id', $m))->orderBy('sort_order')->get(['id', 'name']),
            'zones' => DB::table('delivery_zones')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'products' => DB::table('products')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name', 'brand_id', 'line']),
            'lines' => DB::table('products')->whereNotNull('line')->distinct()->orderBy('line')->pluck('line'),
            'channels' => DB::table('messaging_channels')->where('kind', 'WHATSAPP')->orderBy('display_name')->get(['id', 'brand_id', 'display_name', 'number', 'status']),
            'templates' => DB::table('message_templates')->where('category', 'MARKETING')->orderBy('name')->get(['id', 'brand_id', 'channel_id', 'name', 'body', 'provider_status', 'category']),
            'segments' => Alcance::filtrar(DB::table('customer_segments'), $u)->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'brand_id', 'member_count', 'consent_count']),
            'coupons' => Alcance::filtrar(DB::table('coupons'), $u)->where('status', 'ACTIVE')->whereNull('customer_id')->orderBy('code')->get(['id', 'code', 'brand_id', 'discount_type', 'value', 'valid_from', 'valid_to', 'campaign_id']),
            'objectives' => Campanas::OBJETIVOS, 'rfm' => Audiencia::RFM, 'discount_types' => Cupones::TIPOS,
            'order_channels' => DB::table('sales_orders')->distinct()->orderBy('channel')->pluck('channel'),
            'params' => [
                'rate' => Campanas::tarifa(), 'fee' => Campanas::comision(), 'threshold' => Campanas::umbral(), 'control_pct' => S::num('cmp_control_group_pct', 10),
                'window_days' => (int) S::num('cmp_attribution_window_days', 7), 'max_per_week' => (int) S::num('cmp_max_marketing_per_week', 2),
                'inactive_days' => (int) S::num('cmp_inactive_days', 60), 'refresh_hours' => (int) S::num('cmp_segment_refresh_hours', 24),
                'optout_keywords' => json_decode(S::texto('cmp_optout_keywords', '["BAJA","STOP","NO QUIERO"]'), true),
            ],
            'can' => collect(self::PERMISOS)->mapWithKeys(fn ($p) => [$p => Access::can($u, $p)]),
            'today' => S::fecha(), 'me' => $u->id,
        ]);
    }

    /** CMP-01 */
    public function segmentos(Request $r)
    {
        $rows = Alcance::filtrar(DB::table('customer_segments as s'), $r->user(), 's.brand_id')->leftJoin('brands as b', 'b.id', '=', 's.brand_id')
            ->when($r->query('brand_id'), fn ($q, $v) => $q->where('s.brand_id', $v))
            ->when($r->query('segment_type'), fn ($q, $v) => $q->where('s.segment_type', $v))
            ->orderBy('s.code')->get(['s.*', 'b.name as brand_name'])
            ->map(function ($s) {
                $s->rules = json_decode($s->rules ?? '{}', true) ?: [];
                $s->description = $s->segment_type === 'STATIC' ? 'Lista fija de clientes' : Audiencia::describir($s->rules);
                $s->campaigns = DB::table('campaigns')->where('segment_id', $s->id)->count();
                $s->created_name = S::nombre($s->created_by_user);

                return $s;
            });

        return response()->json(['data' => $rows]);
    }

    public function segmento(Request $r, string $id)
    {
        $s = DB::table('customer_segments')->where('id', $id)->first() ?? abort(404);
        Alcance::exigir($r->user(), $s->brand_id);
        $s->rules = json_decode($s->rules ?? '{}', true) ?: [];
        $s->description = Audiencia::describir($s->rules);
        $st = Audiencia::estadisticas();
        $ids = Audiencia::miembros($id);
        $cons = Audiencia::consentimientos($s->brand_id, $ids);
        $s->members = DB::table('customers')->whereIn('id', $ids ?: ['00000000-0000-0000-0000-000000000000'])->orderBy('full_name')->limit(300)->get(['id', 'full_name', 'phone', 'customer_type'])
            ->map(fn ($c) => ['id' => $c->id, 'full_name' => $c->full_name, 'phone' => $c->phone, 'customer_type' => $c->customer_type, 'last' => $st[$c->id]['last'] ?? null,
                'n' => $st[$c->id]['n'] ?? 0, 'avg' => $st[$c->id]['avg'] ?? 0, 'rfm' => $st[$c->id]['rfm'] ?? null, 'consent' => $cons[$c->id] ?? false]);

        return response()->json($s);
    }

    public function vistaPrevia(Request $r)
    {
        $d = $r->validate(['rules' => 'nullable|array', 'brand_id' => 'nullable|uuid']);

        return response()->json(Audiencia::vistaPrevia($d['rules'] ?? [], $d['brand_id'] ?? null));
    }

    private function datosSegmento(Request $r): array
    {
        $d = $r->validate(['code' => 'required|string|max:30', 'name' => 'required|string|max:255', 'brand_id' => 'nullable|uuid', 'segment_type' => 'nullable|in:DYNAMIC,STATIC',
            'rules' => 'nullable|array', 'refresh_hours' => 'nullable|integer|min:1|max:720', 'static_ids' => 'nullable|array', 'static_ids.*' => 'uuid', 'status' => 'nullable|in:ACTIVE,ARCHIVED']);
        Alcance::exigir($r->user(), $d['brand_id'] ?? null);

        return $d;
    }

    public function guardarSegmento(Request $r)
    {
        return response()->json(Audiencia::guardarSegmento($this->datosSegmento($r), null, $r->user()), 201);
    }

    public function actualizarSegmento(Request $r, string $id)
    {
        return response()->json(Audiencia::guardarSegmento($this->datosSegmento($r), $id, $r->user()));
    }

    public function refrescar(Request $r, string $id)
    {
        $ids = Audiencia::refrescar($id);

        return response()->json(['size' => count($ids), 'segment' => DB::table('customer_segments')->where('id', $id)->first()]);
    }

    /** CMP-11 */
    public function consentimientos(Request $r)
    {
        $rows = DB::table('contact_consents as k')->join('customers as c', 'c.id', '=', 'k.customer_id')->leftJoin('brands as b', 'b.id', '=', 'k.brand_id')
            ->where('k.purpose', 'MARKETING')
            ->when($r->query('brand_id'), fn ($q, $v) => $q->where('k.brand_id', $v))
            ->when($r->query('source'), fn ($q, $v) => $q->where('k.source', $v))
            ->when($r->has('granted') && $r->query('granted') !== '', fn ($q) => $q->where('k.granted', $r->boolean('granted')))
            ->when($r->query('q'), fn ($q, $v) => $q->where(fn ($w) => $w->where('c.full_name', 'ilike', "%{$v}%")->orWhere('c.phone', 'like', "%{$v}%")))
            ->orderByDesc('k.recorded_at')->limit(300)
            ->get(['k.*', 'c.full_name', 'c.phone', 'b.name as brand_name']);
        $resumen = DB::table('contact_consents as k')->leftJoin('brands as b', 'b.id', '=', 'k.brand_id')->where('k.purpose', 'MARKETING')
            ->groupBy('b.name', 'k.brand_id')->get([DB::raw("coalesce(b.name, 'Todas las marcas') AS brand"), 'k.brand_id',
                DB::raw('count(*) FILTER (WHERE k.granted) AS granted'), DB::raw('count(*) FILTER (WHERE NOT k.granted) AS revoked'),
                DB::raw("count(*) FILTER (WHERE NOT k.granted AND k.source = 'KEYWORD') AS keyword")]);
        $porCampana = DB::table('campaign_recipients as r')->join('campaigns as c', 'c.id', '=', 'r.campaign_id')->where('r.opted_out', true)
            ->groupBy('c.id', 'c.code', 'c.name')->orderByDesc(DB::raw('count(*)'))->get(['c.id', 'c.code', 'c.name', DB::raw('count(*) AS optouts')]);

        return response()->json(['data' => $rows, 'summary' => $resumen, 'by_campaign' => $porCampana]);
    }

    public function registrarConsentimiento(Request $r)
    {
        $d = $r->validate(['customer_id' => 'required|uuid', 'brand_id' => 'nullable|uuid', 'granted' => 'required|boolean', 'evidence' => 'nullable|string|max:500']);

        return response()->json(Audiencia::registrarConsentimiento($d, $r->user()), 201);
    }

    /** Mensaje entrante (lo usa CRM al recibir; en la pantalla sirve para probar una baja por palabra clave). */
    public function entrante(Request $r)
    {
        $d = $r->validate(['customer_id' => 'required|uuid', 'brand_id' => 'required|uuid', 'text' => 'required|string|max:1000', 'campaign_id' => 'nullable|uuid']);

        return response()->json(Audiencia::entrante($d));
    }

    /** CMP-12 */
    public function recompra(Request $r)
    {
        $rows = collect(Audiencia::recompra())
            ->when($r->query('brand_id'), fn ($c, $v) => $c->where('brand_id', $v))
            ->when($r->query('zone_id'), fn ($c, $v) => $c->where('zone_id', $v))
            ->when($r->query('status'), fn ($c, $v) => $c->where('status', $v))
            ->sortByDesc('over')->values();
        $nombres = DB::table('customers')->whereIn('id', $rows->pluck('customer_id')->unique()->values() ?: [])->get(['id', 'full_name', 'phone'])->keyBy('id');
        $cons = Audiencia::consentimientos(null, $rows->pluck('customer_id')->unique()->values()->all());
        $rows = $rows->map(fn ($x) => $x + ['customer_name' => $nombres[$x['customer_id']]->full_name ?? null, 'consent' => $cons[$x['customer_id']] ?? false]);

        return response()->json(['data' => $rows->take(500)->values(), 'total' => $rows->count(), 'customers' => $rows->pluck('customer_id')->unique()->count(),
            'at_risk' => $rows->where('status', 'AT_RISK')->count()]);
    }

    public function buscarClientes(Request $r)
    {
        $q = trim((string) $r->query('q'));

        return response()->json(strlen($q) < 2 ? [] : DB::table('customers')->where('status', 'ACTIVE')
            ->where(fn ($w) => $w->where('full_name', 'ilike', "%{$q}%")->orWhere('phone', 'like', "%{$q}%")->orWhere('doc_number', 'like', "%{$q}%"))
            ->orderBy('full_name')->limit(20)->get(['id', 'full_name', 'phone', 'customer_type', 'referral_code', 'orders_count']));
    }
}
