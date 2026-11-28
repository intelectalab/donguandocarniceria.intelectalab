<?php

namespace App\Modulos\Pre\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Pre\Services\Base;
use App\Modulos\Pre\Services\Errores;
use App\Modulos\Pre\Services\Indicadores;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** PRE-10 Errores de armado (RN-PRE-11). */
class ErrorController extends Controller
{
    public function index(Request $request)
    {
        $d = $request->validate(['status' => ['nullable', Rule::in(['OPEN', 'CLOSED'])], 'stage' => ['nullable', Rule::in(array_keys(Errores::ETAPAS))],
            'type' => ['nullable', Rule::in(array_keys(Errores::TIPOS))], 'mes' => ['nullable', 'date_format:Y-m']]);
        $q = DB::table('packing_errors as e')->join('sales_orders as t', 't.id', '=', 'e.order_id')->leftJoin('employees as r', 'r.id', '=', 'e.responsible_employee_id')
            ->leftJoin('users as u', 'u.id', '=', 'e.detected_by')->leftJoin('customers as c', 'c.id', '=', 't.customer_id')
            ->when($d['status'] ?? null, fn ($x, $v) => $x->where('e.status', $v))->when($d['stage'] ?? null, fn ($x, $v) => $x->where('e.detected_at_stage', $v))
            ->when($d['type'] ?? null, fn ($x, $v) => $x->where('e.error_type', $v));
        if ($d['mes'] ?? null) {
            [$ini, $fin] = Indicadores::mes($d['mes']);
            $q->where('e.detected_at', '>=', $ini)->where('e.detected_at', '<', $fin);
        }
        Base::alcanceTareas($q, $request->user());
        $q->select(['e.*', 't.number as pedido', 'r.full_name as responsable', 'u.name as detectado_por', DB::raw('coalesce(c.trade_name, c.full_name) as cliente')]);

        return response()->json(Listado::de($q, $request, buscar: ['t.number', 'e.description', 'r.full_name'], ordenar: ['e.detected_at', 'e.cost_amount', 't.number'], porDefecto: '-e.detected_at'));
    }

    public function resumen(Request $request)
    {
        $d = $request->validate(['mes' => ['nullable', 'date_format:Y-m']]);
        $mes = $d['mes'] ?? now('America/Lima')->format('Y-m');
        [$ini, $fin] = Indicadores::mes($mes);
        $q = fn () => Base::alcanceTareas(DB::table('packing_errors as e')->join('sales_orders as t', 't.id', '=', 'e.order_id'), $request->user())
            ->where('e.detected_at', '>=', $ini)->where('e.detected_at', '<', $fin);
        $k = Indicadores::kpis($mes, $request->user());

        return response()->json([
            'mes' => $mes, 'total' => $q()->count(), 'abiertos' => Base::alcanceTareas(DB::table('packing_errors as e')->join('sales_orders as t', 't.id', '=', 'e.order_id'), $request->user())->where('e.status', 'OPEN')->count(),
            'llegaron' => $q()->whereIn('e.detected_at_stage', Errores::LLEGARON_AL_CLIENTE)->count(), 'costo' => round((float) $q()->sum('e.cost_amount'), 2),
            'error_pct' => $k['error_pct'], 'entregados' => $k['entregados'], 'con_error' => $k['con_error'],
            'por_tipo' => $q()->groupBy('e.error_type')->selectRaw('e.error_type, count(*) n')->orderByDesc('n')->get()->map(fn ($r) => ['tipo' => Errores::TIPOS[$r->error_type] ?? $r->error_type, 'n' => (int) $r->n]),
        ]);
    }

    public function opciones(Request $request)
    {
        $a = Access::for($request->user());

        return response()->json([
            'tipos' => Errores::TIPOS, 'etapas' => Errores::ETAPAS, 'llegaron_al_cliente' => Errores::LLEGARON_AL_CLIENTE,
            'empleados' => DB::table('employees')->where('status', 'ACTIVE')->when($a['establishments'], fn ($q, $v) => $q->whereIn('establishment_id', $v))
                ->orderBy('full_name')->get(['id', 'full_name', 'position']),
        ]);
    }

    /** Buscar el pedido por número para registrar un error. */
    public function pedidos(Request $request)
    {
        $d = $request->validate(['q' => ['required', 'string', 'min:2', 'max:30']]);
        $q = DB::table('sales_orders as t')->leftJoin('customers as c', 'c.id', '=', 't.customer_id')->where('t.status', '<>', 'DRAFT')
            ->whereRaw('lower(t.number) like ?', ['%'.addcslashes(mb_strtolower($d['q']), '%_\\').'%']);
        Base::alcanceTareas($q, $request->user());

        return response()->json($q->orderByDesc('t.created_at')->limit(15)->get(['t.id', 't.number', 't.status', 't.delivery_date', DB::raw('coalesce(c.trade_name, c.full_name) as cliente')]));
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'order_id' => ['required', 'uuid'], 'error_type' => ['required', Rule::in(array_keys(Errores::TIPOS))], 'detected_at_stage' => ['required', Rule::in(array_keys(Errores::ETAPAS))],
            'description' => ['required', 'string', 'max:2000'], 'responsible_employee_id' => ['nullable', 'uuid'], 'cost_amount' => ['nullable', 'numeric', 'min:0', 'max:999999'],
            'corrective_action' => ['nullable', 'string', 'max:255'],
        ], [], ['order_id' => 'pedido', 'error_type' => 'tipo', 'detected_at_stage' => 'etapa', 'description' => 'qué pasó', 'responsible_employee_id' => 'responsable',
            'cost_amount' => 'costo', 'corrective_action' => 'acción correctiva']);

        return response()->json(Errores::registrar($d, $request->user()), 201);
    }

    public function cerrar(Request $request, string $id)
    {
        $d = $request->validate(['corrective_action' => ['nullable', 'string', 'max:255'], 'responsible_employee_id' => ['nullable', 'uuid']]);

        return response()->json(Errores::cerrar($id, $d['corrective_action'] ?? null, $d['responsible_employee_id'] ?? null, $request->user()));
    }
}
