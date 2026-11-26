<?php

namespace App\Modulos\Etq\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Etq\Services\EtiquetasService as Etq;
use App\Modulos\Pro\Http\Controllers\Alcance;
use App\Modulos\Pro\Services\Comun;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ETQ-04 Trazabilidad, ETQ-05 a ETQ-07 Retiros y ETQ-09 Tablero. */
class RetiroController extends Controller
{
    use Alcance;

    public function trazabilidad(string $id)
    {
        DB::table('lots')->where('id', $id)->exists() || abort(404);
        $t = Etq::trazar($id);
        $t['recalls'] = DB::table('lot_recall_lots as rl')->join('lot_recalls as r', 'r.id', '=', 'rl.recall_id')->where('rl.lot_id', $id)
            ->orderByDesc('r.initiated_at')->get(['r.id', 'r.number', 'r.status', 'r.initiated_at']);
        $t['prints'] = DB::table('label_prints')->where('lot_id', $id)->selectRaw('count(*) as prints, coalesce(sum(copies), 0) as labels')->first();

        return response()->json($t);
    }

    /** ETQ-08 vista previa interna: el enlace del QR del lote y lo que verá el cliente (lo mismo que la página pública). */
    public function qr(string $id)
    {
        DB::table('lots')->where('id', $id)->exists() || abort(404);
        $token = Etq::token($id);
        $base = rtrim((string) (\App\Support\Params::get('etq_public_base_url') ?? 'https://trazabilidad.aycha.pe/l/'), '/');

        return response()->json(['token' => $token, 'url' => $base.'/'.$token, 'public' => Etq::publico($token)]);
    }

    public function index(Request $r)
    {
        $q = DB::table('lot_recalls as r')->leftJoin('users as u', 'u.id', '=', 'r.initiated_by')
            ->when($r->query('status'), fn ($x, $s) => $x->where('r.status', $s))
            ->selectRaw("r.id, r.number, r.reason, r.risk_class, r.status, r.initiated_at, r.closed_at, r.include_descendants, u.name as initiated_by_name,
                (SELECT string_agg(l.code, ', ' ORDER BY rl.is_descendant, l.code) FROM lot_recall_lots rl JOIN lots l ON l.id = rl.lot_id WHERE rl.recall_id = r.id) as lot_codes,
                (SELECT count(*) FROM lot_recall_lots rl WHERE rl.recall_id = r.id) as lots,
                (SELECT count(DISTINCT coalesce(c.customer_id::text, c.id::text)) FROM lot_recall_contacts c WHERE c.recall_id = r.id) as customers,
                (SELECT count(*) FROM lot_recall_contacts c WHERE c.recall_id = r.id) as contacts,
                (SELECT count(*) FROM lot_recall_contacts c WHERE c.recall_id = r.id AND c.status IN ('CONTACTED','RECOVERED','NOT_REACHABLE')) as contacts_done,
                (SELECT coalesce(sum(c.weight_kg), 0) FROM lot_recall_contacts c WHERE c.recall_id = r.id) as sold_kg,
                (SELECT coalesce(sum(c.recovered_kg), 0) FROM lot_recall_contacts c WHERE c.recall_id = r.id) as recovered_kg");

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'reason', 'lot_codes'],
            ordenar: ['number', 'initiated_at', 'status', 'risk_class', 'customers'], porDefecto: '-initiated_at'));
    }

    private function lotes(Request $r): array
    {
        return $r->validate(['lot_ids' => 'required|array|min:1|max:50', 'lot_ids.*' => 'uuid', 'include_descendants' => 'nullable|boolean',
            'reason' => 'nullable|string|max:2000', 'risk_class' => 'nullable|in:CLASS_I,CLASS_II,CLASS_III']);
    }

    public function previa(Request $r)
    {
        return response()->json(Etq::previa($this->lotes($r)));
    }

    public function store(Request $r)
    {
        return response()->json(Etq::iniciarRetiro($this->lotes($r), $r->user()), 201);
    }

    public function show(string $id)
    {
        DB::table('lot_recalls')->where('id', $id)->exists() || abort(404);

        return response()->json(Etq::retiro($id));
    }

    public function contacto(Request $r, string $id)
    {
        $d = $r->validate(['status' => 'required|in:PENDING,CONTACTED,RECOVERED,NOT_REACHABLE', 'contact_notes' => 'nullable|string|max:2000', 'recovered_kg' => 'nullable|numeric|min:0']);

        return response()->json(Etq::contacto($id, $d, $r->user()));
    }

    public function aviso(string $id)
    {
        return response()->json(Etq::aviso($id));
    }

    public function cerrar(Request $r, string $id)
    {
        $d = $r->validate(['closing_summary' => 'nullable|string|max:4000', 'authority_notified' => 'nullable|boolean']);

        return response()->json(Etq::cerrarRetiro($id, $d, $r->user()));
    }

    public function tablero(Request $r)
    {
        $hasta = Comun::fecha($r->query('hasta') ?: Comun::hoy());
        $desde = Comun::fecha($r->query('desde') ?: Comun::ahora()->subDays(89)->format('Y-m-d'));
        $k = Etq::kpis($desde, $hasta, $this->locales($r));
        $k['open'] = DB::table('lot_recalls')->where('status', 'OPEN')->orderByDesc('initiated_at')->get(['id', 'number', 'reason', 'initiated_at'])
            ->map(fn ($x) => tap($x, fn () => $x->pending = DB::table('lot_recall_contacts')->where('recall_id', $x->id)->whereNotIn('status', Etq::FINALES)->count()));
        $k['brands_without_template'] = DB::table('brands as b')->where('b.status', 'ACTIVE')
            ->whereNotExists(fn ($q) => $q->from('label_templates as t')->whereColumn('t.brand_id', 'b.id')->where('t.status', 'ACTIVE'))->pluck('b.name');

        return response()->json($k);
    }
}
