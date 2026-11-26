<?php

namespace App\Modulos\Cal\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cal\Services\CalidadService as Cal;
use App\Modulos\Pro\Http\Controllers\Alcance;
use App\Modulos\Pro\Services\Comun;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAL-01 Checklists, CAL-02 Programación, CAL-03 Inspecciones y CAL-12 Limpieza y BPM. */
class ChecklistController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('qc_checklists as c')
            ->when($r->query('stage'), fn ($x, $v) => $x->where('c.stage', $v))
            ->when($r->query('status'), fn ($x, $v) => $x->where('c.status', $v), fn ($x) => $r->query('todas') ? $x : $x->where('c.status', '<>', 'RETIRED'))
            ->selectRaw('c.id, c.code, c.name, c.stage, c.version, c.status, c.activated_at, c.created_by,
                (SELECT count(*) FROM qc_checklist_items i WHERE i.checklist_id = c.id) as items,
                (SELECT count(*) FROM qc_checklist_items i WHERE i.checklist_id = c.id AND i.is_critical) as critical_items,
                (SELECT count(*) FROM qc_schedules s WHERE s.checklist_id = c.id AND s.status = \'ACTIVE\') as schedules,
                (SELECT max(inspected_at) FROM qc_inspections n WHERE n.checklist_id = c.id) as last_used');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['code', 'name'], ordenar: ['code', 'name', 'stage', 'version', 'status', 'last_used'], porDefecto: 'code'));
    }

    public function show(string $id)
    {
        return response()->json(Cal::checklist($id));
    }

    public function store(Request $r)
    {
        return response()->json(Cal::guardarChecklist($this->datos($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(Cal::guardarChecklist($this->datos($r), $id, $r->user()));
    }

    public function activar(Request $r, string $id)
    {
        return response()->json(Cal::activarChecklist($id, $r->user()));
    }

    public function version(Request $r, string $id)
    {
        return response()->json(Cal::versionChecklist($id, $r->user()), 201);
    }

    private function datos(Request $r): array
    {
        return $r->validate(['code' => 'nullable|string|max:40', 'name' => 'nullable|string|max:120', 'stage' => 'nullable|in:'.implode(',', Cal::ETAPAS),
            'items' => 'nullable|array|max:60', 'items.*.question' => 'required_with:items|string|max:255', 'items.*.answer_type' => 'nullable|in:'.implode(',', Cal::TIPOS_RESPUESTA),
            'items.*.min_value' => 'nullable|numeric', 'items.*.max_value' => 'nullable|numeric', 'items.*.is_critical' => 'nullable|boolean', 'items.*.requires_photo' => 'nullable|boolean']);
    }

    /* CAL-02 */

    public function programacion(Request $r)
    {
        $q = DB::table('qc_schedules as s')->join('qc_checklists as c', 'c.id', '=', 's.checklist_id')->join('establishments as e', 'e.id', '=', 's.establishment_id')
            ->leftJoin('roles as ro', 'ro.code', '=', 's.responsible_role')
            ->when($r->query('status'), fn ($x, $v) => $x->where('s.status', $v))
            ->orderBy('e.name')->orderBy('s.area')
            ->select(['s.*', 'c.code as checklist_code', 'c.name as checklist_name', 'c.stage', 'c.version as checklist_version', DB::raw('coalesce(e.short, e.name) as establishment_name'),
                'ro.name as role_name']);
        $this->porLocal($q, $r, 's.establishment_id');
        $hoy = Comun::hoy();
        $tareas = DB::table('qc_schedule_tasks')->where('task_date', $hoy)->get()->groupBy('schedule_id');
        $filas = $q->get()->map(fn ($s) => tap($s, fn () => $s->today = ($tareas[$s->id] ?? collect())->values()));

        return response()->json(['data' => $filas]);
    }

    public function guardarProgramacion(Request $r, ?string $id = null)
    {
        $d = $r->validate(['checklist_id' => 'nullable|uuid', 'establishment_id' => 'nullable|uuid', 'area' => 'nullable|string|max:120', 'frequency' => 'nullable|in:'.implode(',', Cal::FRECUENCIAS),
            'responsible_role' => 'nullable|string|max:40', 'weekday' => 'nullable|integer|min:0|max:6', 'status' => 'nullable|in:ACTIVE,INACTIVE', 'active_from' => 'nullable|date']);

        return response()->json(Cal::guardarProgramacion($d, $id, $r->user()), $id ? 200 : 201);
    }

    /* CAL-03 */

    public function inspecciones(Request $r)
    {
        $q = DB::table('qc_inspections as i')->join('qc_checklists as c', 'c.id', '=', 'i.checklist_id')->leftJoin('users as u', 'u.id', '=', 'i.inspector_user_id')
            ->leftJoin('lots as l', 'l.id', '=', 'i.lot_id')->join('establishments as e', 'e.id', '=', 'i.establishment_id')
            ->when($r->query('result'), fn ($x, $v) => $x->where('i.result', $v))
            ->when($r->query('stage'), fn ($x, $v) => $x->where('i.stage', $v))
            ->when($r->query('lot_id'), fn ($x, $v) => $x->where('i.lot_id', $v))
            ->when($r->query('from'), fn ($x, $v) => $x->where('i.inspected_at', '>=', $v))
            ->when($r->query('to'), fn ($x, $v) => $x->where('i.inspected_at', '<=', $v.' 23:59:59'))
            ->selectRaw("i.id, i.number, i.stage, i.area, i.shift, i.inspected_at, i.status, i.result, i.score_pct, i.production_order_ref, i.establishment_id,
                jsonb_array_length(coalesce(i.critical_failed, '[]'::jsonb)) as critical_failed, c.code as checklist_code, c.name as checklist_name, i.checklist_version,
                u.name as inspector_name, l.code as lot_code, coalesce(e.short, e.name) as establishment_name");
        $this->porLocal($q, $r, 'i.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'checklist_name', 'lot_code', 'area', 'inspector_name', 'production_order_ref'],
            ordenar: ['number', 'inspected_at', 'result', 'score_pct', 'stage'], porDefecto: '-inspected_at'));
    }

    public function inspeccion(Request $r, string $id)
    {
        $i = Cal::inspeccion($id);
        $this->dentroDelAlcance($r, $i->establishment_id);

        return response()->json($i);
    }

    public function inspeccionar(Request $r)
    {
        $d = $r->validate(['checklist_id' => 'required|uuid', 'establishment_id' => 'nullable|uuid', 'area' => 'nullable|string|max:120', 'schedule_id' => 'nullable|uuid',
            'lot_id' => 'nullable|uuid', 'production_order_id' => 'nullable|uuid', 'purchase_receipt_id' => 'nullable|uuid', 'sales_order_id' => 'nullable|uuid', 'vehicle_id' => 'nullable|uuid',
            'shift' => 'nullable|in:M,T,N', 'notes' => 'nullable|string|max:2000', 'finish' => 'nullable|boolean',
            'answers' => 'array', 'answers.*.item_id' => 'required|uuid', 'answers.*.answer_bool' => 'nullable|boolean', 'answers.*.answer_num' => 'nullable|numeric',
            'answers.*.answer_text' => 'nullable|string|max:1000', 'answers.*.photo_url' => 'nullable|string|max:255', 'answers.*.is_conforming' => 'nullable|boolean']);

        return response()->json(Cal::inspeccionar($d, $r->user()), 201);
    }

    /* CAL-12 */

    public function limpieza(Request $r)
    {
        [$desde, $hasta] = $r->query('from') && $r->query('to') ? [Comun::fecha($r->query('from')), Comun::fecha($r->query('to'))] : Comun::mes($r->query('month'));
        $etapas = $r->query('all') ? Cal::ETAPAS : ['CLEANING', 'BPM'];
        $q = DB::table('qc_schedule_tasks as t')->join('qc_schedules as s', 's.id', '=', 't.schedule_id')->join('qc_checklists as c', 'c.id', '=', 's.checklist_id')
            ->join('establishments as e', 'e.id', '=', 's.establishment_id')->leftJoin('users as u', 'u.id', '=', 't.done_by')->leftJoin('qc_inspections as i', 'i.id', '=', 't.inspection_id')
            ->whereIn('c.stage', $etapas)->whereBetween('t.task_date', [$desde, $hasta])
            ->when($r->query('status'), fn ($x, $v) => $x->where('t.status', $v))
            ->orderByDesc('t.task_date')->orderBy('s.area')
            ->select(['t.*', 's.area', 's.frequency', 's.responsible_role', 's.establishment_id', 'c.code as checklist_code', 'c.name as checklist_name', 'c.stage',
                DB::raw('coalesce(e.short, e.name) as establishment_name'), 'u.name as done_by_name', 'i.number as inspection_number', 'i.result as inspection_result']);
        $this->porLocal($q, $r, 's.establishment_id');
        $filas = $q->get();
        $resumen = $filas->groupBy(fn ($t) => $t->establishment_name.'|'.$t->area)->map(fn ($g) => ['establishment_name' => $g->first()->establishment_name, 'area' => $g->first()->area,
            'stage' => $g->first()->stage, 'tasks' => $g->count(), 'done' => $g->where('status', 'DONE')->count(), 'missed' => $g->where('status', 'MISSED')->count(),
            'pending' => $g->where('status', 'PENDING')->count(), 'compliance_pct' => Comun::t($g->whereIn('status', ['DONE', 'MISSED'])->count() ? $g->where('status', 'DONE')->count() / $g->whereIn('status', ['DONE', 'MISSED'])->count() * 100 : null, 1)])
            ->values();

        return response()->json(['period' => ['from' => $desde, 'to' => $hasta], 'summary' => $resumen, 'data' => $filas->take(400)->values(),
            'today' => $filas->where('task_date', Comun::hoy())->values()]);
    }

    public function completarTarea(Request $r, string $id)
    {
        $d = $r->validate(['evidence_url' => 'nullable|string|max:255', 'notes' => 'nullable|string|max:1000', 'inspection_id' => 'nullable|uuid']);

        return response()->json(Cal::completarTarea($id, $d, $r->user()));
    }
}
