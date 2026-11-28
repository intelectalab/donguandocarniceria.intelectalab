<?php

namespace App\Modulos\Gas\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Gas\Services\Base;
use App\Modulos\Gas\Services\Contadora;
use App\Modulos\Gas\Services\Gastos;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** GAS-09 Bandeja de la contadora. */
class ContadoraController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate(['vista' => ['nullable', Rule::in(['pendientes', 'revisados'])]]);
        $q = Contadora::bandeja($request->user(), $f['vista'] ?? 'pendientes');
        $resumen = (clone $q)->reorder()->select(DB::raw("count(*) AS n, coalesce(sum(e.amount_pen), 0) AS total, count(*) FILTER (WHERE e.accounting_flag = 'OBSERVED') AS observados"))->first();
        $p = Listado::de($q, $request, buscar: ['e.number', 'e.description', 'e.supplier_name', 'c.name', 'u.name'], ordenar: ['issue_date', 'amount_pen', 'number', 'created_at'], porDefecto: '-issue_date');
        $p->getCollection()->transform(fn ($g) => Gastos::aLista($g));

        return response()->json($p->toArray() + ['resumen' => ['n' => (int) $resumen->n, 'total' => Base::r($resumen->total), 'observados' => (int) $resumen->observados],
            'por_traer' => Contadora::porTraer()]);
    }

    public function clasificar(Request $request, string $id)
    {
        $d = $request->validate(['accounting_flag' => ['required', Rule::in(['OK', 'NO_VALID_RECEIPT'])], 'category_id' => ['nullable', 'uuid'],
            'cost_center_id' => ['nullable', 'uuid'], 'note' => ['nullable', 'string', 'max:255']]);
        Contadora::clasificar($id, $d, $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function observar(Request $request, string $id)
    {
        $d = $request->validate(['nota' => ['required', 'string', 'max:255']]);
        Contadora::observar($id, $d['nota'], $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function traer(Request $request)
    {
        return response()->json(Contadora::traerDeRuta($request->user()));
    }
}
