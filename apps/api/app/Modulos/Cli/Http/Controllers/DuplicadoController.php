<?php

namespace App\Modulos\Cli\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Cli\Services\Duplicados;
use App\Modulos\Cli\Services\Fusion;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CLI-10 Duplicados (pares con motivo y puntaje; fusionar o descartar con motivo) y CLI-11 Fusión
 * de clientes (sobreviviente, lo que se moverá y motivo; no se deshace). Reglas en Services.
 */
class DuplicadoController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate(['vista' => ['nullable', Rule::in(['OPEN', 'DONE', 'ALL'])]]);
        $lado = fn (string $col, string $p) => [
            DB::raw("(select coalesce(x.trade_name, x.full_name) from customers x where x.id = d.{$col}) as {$p}_nombre"),
            DB::raw("(select x.phone from customers x where x.id = d.{$col}) as {$p}_phone"),
            DB::raw("(select x.origin_wa_number from customers x where x.id = d.{$col}) as {$p}_wa"),
            DB::raw("(select count(*) from sales_orders o where o.customer_id = d.{$col} and o.status <> 'CANCELLED') as {$p}_pedidos"),
        ];
        $q = DB::table('customer_duplicate_candidates as d')->leftJoin('users as u', 'u.id', '=', 'd.resolved_by')
            ->select(array_merge(['d.id', 'd.customer_id', 'd.duplicate_of_id', 'd.match_reason', 'd.score', 'd.status', 'd.created_at', 'd.resolved_at', 'd.resolution_note', 'u.name as resuelto_por'],
                $lado('customer_id', 'cliente'), $lado('duplicate_of_id', 'original')));
        match ($f['vista'] ?? 'OPEN') {
            'OPEN' => $q->where('d.status', 'OPEN'),
            'DONE' => $q->where('d.status', '<>', 'OPEN'),
            'ALL' => $q,
        };
        $pagina = Listado::de($q, $request, ordenar: ['score', 'created_at', 'match_reason'], porDefecto: '-created_at');
        $pagina->getCollection()->transform(function ($d) {
            $d->score = (float) $d->score;
            $d->motivo = Duplicados::MOTIVOS[$d->match_reason] ?? $d->match_reason;
            $d->cliente_pedidos = (int) $d->cliente_pedidos;
            $d->original_pedidos = (int) $d->original_pedidos;

            return $d;
        });

        return response()->json($pagina);
    }

    public function resumen()
    {
        $por = DB::table('customer_duplicate_candidates')->groupBy('status')->selectRaw('status, count(*) as n')->pluck('n', 'status');

        return response()->json(['abiertos' => (int) ($por['OPEN'] ?? 0), 'fusionados' => (int) ($por['MERGED'] ?? 0), 'descartados' => (int) ($por['DISMISSED'] ?? 0),
            'fusiones' => DB::table('customer_merges')->count()]);
    }

    /** Revisa toda la base (RN-CLI-07). */
    public function buscar()
    {
        return response()->json(['nuevos' => Duplicados::buscarEnTodaLaBase()]);
    }

    public function descartar(Request $request, string $id)
    {
        $d = $request->validate(['nota' => ['required', 'string', 'max:255']]);
        Duplicados::descartar($id, $d['nota'], $request->user());

        return response()->noContent();
    }

    /** CLI-11: los dos clientes y lo que se moverá si sobrevive ?sobreviviente=. Sin par, el primero abierto. */
    public function vista(Request $request)
    {
        $d = $request->validate(['a' => ['nullable', 'uuid'], 'b' => ['nullable', 'uuid'], 'sobreviviente' => ['nullable', 'uuid']]);
        if (empty($d['a']) || empty($d['b'])) {
            $par = DB::table('customer_duplicate_candidates')->where('status', 'OPEN')->orderBy('created_at')->first();
            if (! $par) {
                return response()->json(['par' => null]);
            }
            [$d['a'], $d['b']] = [$par->duplicate_of_id, $par->customer_id];
        }
        $a = Customer::findOrFail($d['a']);
        $b = Customer::findOrFail($d['b']);
        $pedidos = fn ($c) => DB::table('sales_orders')->where('customer_id', $c->id)->where('status', '<>', 'CANCELLED')->count();
        // Por defecto sobrevive el que tiene más pedidos.
        $sid = $d['sobreviviente'] ?? ($pedidos($a) >= $pedidos($b) ? $a->id : $b->id);
        [$s, $m] = $sid === $b->id ? [$b, $a] : [$a, $b];
        $ficha = fn (Customer $c) => $c->only(['id', 'full_name', 'trade_name', 'phone', 'phone_alt', 'email', 'doc_type', 'doc_number', 'doc_validated_at',
            'doc_validation_source', 'customer_type', 'source_channel', 'origin_wa_number', 'status', 'merged_into_id']) + [
                'nombre' => $c->nombre(), 'pedidos' => $pedidos($c), 'saldo' => Clientes::saldo($c->id),
                'direcciones' => DB::table('customer_addresses')->where(['customer_id' => $c->id, 'status' => 'ACTIVE'])->count(),
            ];

        return response()->json(['par' => ['a' => $a->id, 'b' => $b->id], 'sobreviviente' => $ficha($s), 'fusionado' => $ficha($m), 'mueve' => Fusion::vistaPrevia($m)]);
    }

    public function fusionar(Request $request)
    {
        $d = $request->validate(['sobreviviente_id' => ['required', 'uuid'], 'fusionado_id' => ['required', 'uuid'], 'motivo' => ['required', 'string', 'max:255']]);
        $r = Fusion::fusionar(Customer::findOrFail($d['sobreviviente_id']), Customer::findOrFail($d['fusionado_id']), $d['motivo'], $request->user());
        $r->moved_counts = json_decode($r->moved_counts, true);

        return response()->json($r, 201);
    }

    /** Fusiones registradas (solo inserción). */
    public function fusiones(Request $request)
    {
        $q = DB::table('customer_merges')->select(['id', 'survivor_id', 'merged_id', 'survivor_name', 'merged_name', 'moved_counts', 'reason', 'merged_at', 'merged_by']);
        $pagina = Listado::de($q, $request, buscar: ['survivor_name', 'merged_name', 'reason'], ordenar: ['merged_at'], porDefecto: '-merged_at');
        $pagina->getCollection()->transform(function ($m) {
            $m->moved_counts = json_decode($m->moved_counts ?? '{}', true) ?: [];
            $m->movido = collect($m->moved_counts)->except('balance')->map(fn ($n, $t) => (Fusion::NOMBRES[$t] ?? $t).": {$n}")->values()->implode(', ');

            return $m;
        });

        return response()->json($pagina);
    }
}
