<?php

namespace App\Modulos\Equ\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Equ\Services\EquiposService as Equ;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** EQU-05 Planes preventivos: actividad, frecuencia en días u horas, responsable, repuestos y su estado (RN-EQU-07). */
class PlanController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $hoy = Equ::fecha(null);
        $q = DB::table('maintenance_plans as p')->join('equipment as e', 'e.id', '=', 'p.equipment_id')->join('establishments as s', 's.id', '=', 'e.establishment_id')
            ->leftJoin('maintenance_orders as m', fn ($j) => $j->on('m.plan_id', '=', 'p.id')->whereIn('m.status', ['OPEN', 'IN_PROGRESS']))
            ->when($r->query('status'), fn ($x, $v) => $x->where('p.status', $v))
            ->when($r->query('equipment_id'), fn ($x, $v) => $x->where('p.equipment_id', $v))
            ->orderBy('e.code')->orderBy('p.activity')
            ->select(['p.*', 'e.code as equipment_code', 'e.name as equipment_name', 'e.hour_meter', 'e.status as equipment_status', DB::raw('coalesce(s.short, s.name) as establishment_name'),
                'm.id as open_order_id', 'm.number as open_order_number']);
        $this->porLocal($q, $r, 'e.establishment_id');
        $txt = mb_strtolower(trim((string) $r->query('q', '')));
        $filas = $q->get()->map(function ($p) use ($hoy) {
            $p->state = $p->status === 'ACTIVE' ? Equ::estadoPlan($p, $hoy, (float) $p->hour_meter) : 'INACTIVE';
            $p->days_left = $p->next_due_on ? Equ::dias($hoy, $p->next_due_on) : null;
            $p->hours_left = $p->next_due_hours !== null ? Equ::t((float) $p->next_due_hours - (float) $p->hour_meter, 1) : null;

            return $p;
        })->when($txt !== '', fn ($c) => $c->filter(fn ($p) => str_contains(mb_strtolower("{$p->equipment_code} {$p->equipment_name} {$p->activity} {$p->responsible_name}"), $txt)))
            ->when($r->query('state'), fn ($c, $s) => $c->where('state', $s))->values();

        return response()->json(['data' => $filas, 'total' => $filas->count()]);
    }

    public function store(Request $r)
    {
        return response()->json(Equ::guardarPlan($this->validar($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        $p = DB::table('maintenance_plans as p')->join('equipment as e', 'e.id', '=', 'p.equipment_id')->where('p.id', $id)->first(['e.establishment_id']) ?? abort(404);
        $this->dentroDelAlcance($r, $p->establishment_id);

        return response()->json(Equ::guardarPlan($this->validar($r, true), $id, $r->user()));
    }

    /** RN-EQU-07: crea las órdenes preventivas que tocan hoy (también corre sola cada mañana). */
    public function generar(Request $r)
    {
        return response()->json(Equ::generarPreventivas(null, $r->user()));
    }

    private function validar(Request $r, bool $editar = false): array
    {
        return $r->validate([
            'equipment_id' => ($editar ? 'sometimes' : 'required').'|uuid', 'activity' => ($editar ? 'sometimes' : 'required').'|string|max:255',
            'frequency_days' => 'nullable|integer|min:1', 'frequency_hours' => 'nullable|integer|min:1', 'next_due_on' => 'nullable|date', 'next_due_hours' => 'nullable|numeric|min:0',
            'responsible_employee_id' => 'nullable|uuid', 'responsible_name' => 'nullable|string|max:40', 'expected_parts' => 'nullable|string|max:255', 'status' => 'sometimes|in:ACTIVE,INACTIVE',
        ]);
    }
}
