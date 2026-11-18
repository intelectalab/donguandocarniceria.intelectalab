<?php

namespace App\Modulos\Equ\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Equ\Services\EquiposService as Equ;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** EQU-06 Órdenes de mantenimiento y EQU-07 Reporte de falla. */
class OrdenController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('maintenance_orders as m')->join('equipment as e', 'e.id', '=', 'm.equipment_id')->join('establishments as s', 's.id', '=', 'e.establishment_id')
            ->leftJoin('users as u', 'u.id', '=', 'm.reported_by')
            ->when($r->query('kind'), fn ($x, $v) => $x->where('m.kind', $v))
            ->when($r->query('status') === 'ABIERTAS', fn ($x) => $x->whereIn('m.status', ['OPEN', 'IN_PROGRESS']), fn ($x) => $x->when($r->query('status'), fn ($y, $v) => $y->where('m.status', $v)))
            ->when($r->query('equipment_id'), fn ($x, $v) => $x->where('m.equipment_id', $v))
            ->when($r->query('mias'), fn ($x) => $x->where('m.reported_by', $r->user()->id))
            ->selectRaw("m.id, m.number, m.kind, m.status, m.urgency, m.description, m.reported_at, m.finished_at, m.due_on, m.downtime_hours, m.total_cost, m.created_at,
                e.id as equipment_id, e.code as equipment_code, e.name as equipment_name, coalesce(s.short, s.name) as establishment_name, u.name as reported_by_name,
                case when m.status in ('OPEN','IN_PROGRESS') then 0 else 1 end as abierta");
        $this->porLocal($q, $r, 'e.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'equipment_code', 'equipment_name', 'description'],
            ordenar: ['number', 'reported_at', 'finished_at', 'equipment_code', 'status', 'total_cost', 'abierta'], porDefecto: '-reported_at'));
    }

    public function show(Request $r, string $id)
    {
        DB::table('maintenance_orders')->where('id', $id)->exists() || abort(404);
        $o = Equ::orden($id);
        $this->dentroDelAlcance($r, $o->establishment_id);

        return response()->json($o);
    }

    /** Nueva orden desde EQU-06: correctiva (una falla) o preventiva (de un plan). */
    public function store(Request $r)
    {
        $d = $r->validate([
            'equipment_id' => 'required|uuid', 'kind' => 'required|in:PREVENTIVE,CORRECTIVE', 'plan_id' => 'nullable|uuid',
            'description' => 'required|string|max:2000', 'urgency' => 'nullable|in:LOW,NORMAL,HIGH', 'photo_url' => 'nullable|string|max:255', 'due_on' => 'nullable|date',
        ]);
        $e = DB::table('equipment')->where('id', $d['equipment_id'])->first() ?? abort(404);
        $this->dentroDelAlcance($r, $e->establishment_id);

        return response()->json(Equ::abrirOrden($d, $r->user()), 201);
    }

    /** EQU-07: reporte desde el celular, por QR o código. Suma a la correctiva abierta si ya hay una. */
    public function falla(Request $r)
    {
        $d = $r->validate([
            'equipment_id' => 'nullable|uuid', 'code' => 'nullable|string|max:60', 'description' => 'required|string|max:2000',
            'urgency' => 'nullable|in:LOW,NORMAL,HIGH', 'photo_url' => 'nullable|string|max:255',
        ]);
        $r = Equ::reportarFalla($d, $r->user());

        return response()->json($r, $r['created'] ? 201 : 200);
    }

    public function iniciar(Request $r, string $id)
    {
        return response()->json(Equ::iniciarOrden($this->existe($r, $id), $r->user()));
    }

    public function terminar(Request $r, string $id)
    {
        $d = $r->validate([
            'diagnosis' => 'nullable|string|max:2000', 'labor_hours' => 'nullable|numeric|min:0', 'labor_cost' => 'nullable|numeric|min:0',
            'parts' => 'sometimes|array', 'parts.*.description' => 'nullable|string|max:120', 'parts.*.qty' => 'nullable|numeric', 'parts.*.unit_cost' => 'nullable|numeric',
            'external_cost' => 'nullable|numeric|min:0', 'external_supplier_id' => 'nullable|uuid', 'finished_at' => 'nullable|date', 'downtime_hours' => 'nullable|numeric|min:0',
        ]);

        return response()->json(Equ::terminarOrden($this->existe($r, $id), $d, $r->user()));
    }

    public function anular(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:255']);

        return response()->json(Equ::anularOrden($this->existe($r, $id), $d['reason'], $r->user()));
    }

    private function existe(Request $r, string $id): string
    {
        $o = DB::table('maintenance_orders as m')->join('equipment as e', 'e.id', '=', 'm.equipment_id')->where('m.id', $id)->first(['e.establishment_id']) ?? abort(404);
        $this->dentroDelAlcance($r, $o->establishment_id);

        return $id;
    }
}
