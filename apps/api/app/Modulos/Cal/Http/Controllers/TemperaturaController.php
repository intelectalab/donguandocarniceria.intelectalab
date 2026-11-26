<?php

namespace App\Modulos\Cal\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cal\Services\CalidadService as Cal;
use App\Modulos\Pro\Http\Controllers\Alcance;
use App\Modulos\Pro\Services\Comun;
use App\Support\Listado;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAL-04 Puntos de temperatura, CAL-05 Registro (con semáforo por punto) y CAL-06 Excursiones. */
class TemperaturaController extends Controller
{
    use Alcance;

    /** CAL-04 y CAL-05: puntos con su última lectura y su semáforo. */
    public function puntos(Request $r)
    {
        $ultima = DB::table('temperature_readings as t')->selectRaw('DISTINCT ON (t.point_id) t.point_id, t.value_c, t.read_at, t.in_range, t.source, t.approved_by')
            ->orderBy('t.point_id')->orderByDesc('t.read_at');
        $q = DB::table('temperature_points as p')->join('establishments as e', 'e.id', '=', 'p.establishment_id')->leftJoin('equipment as q', 'q.id', '=', 'p.equipment_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 'p.warehouse_id')->leftJoin('vehicles as v', 'v.id', '=', 'p.vehicle_id')->leftJoinSub($ultima, 'u', 'u.point_id', '=', 'p.id')
            ->leftJoin('temperature_excursions as x', fn ($j) => $j->on('x.point_id', '=', 'p.id')->where('x.status', 'OPEN'))
            ->when($r->query('status'), fn ($x, $v) => $x->where('p.status', $v))
            ->when($r->query('point_type'), fn ($x, $v) => $x->where('p.point_type', $v))
            ->orderBy('e.name')->orderBy('p.code')
            ->select(['p.*', DB::raw('coalesce(e.short, e.name) as establishment_name'), 'q.code as equipment_code', 'w.code as warehouse_code', 'v.plate as vehicle_plate',
                'u.value_c as last_value_c', 'u.read_at as last_read_at', 'u.in_range as last_in_range', 'x.id as open_excursion_id', 'x.max_deviation_c as open_excursion_deviation', 'x.ended_at as open_excursion_ended_at']);
        $this->porLocal($q, $r, 'p.establishment_id');
        $atrasados = collect(Cal::puntosAtrasados(null, $this->locales($r)))->pluck('id')->flip();
        $filas = $q->get()->map(function ($p) use ($atrasados) {
            $p->overdue = isset($atrasados[$p->id]) && $p->status === 'ACTIVE';
            $p->light = $p->open_excursion_id && ! $p->open_excursion_ended_at ? 'bad' : ($p->last_in_range === false ? 'bad' : ($p->overdue || $p->open_excursion_id ? 'warn' : ($p->last_read_at ? 'ok' : 'neutral')));
            $p->next_due_at = $p->last_read_at ? CarbonImmutable::parse($p->last_read_at)->addMinutes((int) $p->reading_frequency_min)->toIso8601String() : null;

            return $p;
        });

        return response()->json(['data' => $filas]);
    }

    public function guardarPunto(Request $r, ?string $id = null)
    {
        $d = $r->validate(['code' => 'nullable|string|max:40', 'name' => 'nullable|string|max:120', 'point_type' => 'nullable|in:'.implode(',', Cal::TIPOS_PUNTO),
            'establishment_id' => 'nullable|uuid', 'equipment_id' => 'nullable|uuid', 'warehouse_id' => 'nullable|uuid', 'vehicle_id' => 'nullable|uuid',
            'min_c' => 'nullable|numeric', 'max_c' => 'nullable|numeric', 'reading_frequency_min' => 'nullable|numeric|gt:0', 'status' => 'nullable|in:ACTIVE,INACTIVE', 'sensor' => 'nullable|boolean']);

        return response()->json(Cal::guardarPunto($d, $id, $r->user()), $id ? 200 : 201);
    }

    /** CAL-05: lecturas (de un punto o de todos). */
    public function lecturas(Request $r)
    {
        $q = DB::table('temperature_readings as t')->join('temperature_points as p', 'p.id', '=', 't.point_id')->leftJoin('users as u', 'u.id', '=', 't.read_by')
            ->leftJoin('users as a', 'a.id', '=', 't.approved_by')
            ->when($r->query('point_id'), fn ($x, $v) => $x->where('t.point_id', $v))
            ->when($r->query('in_range') === 'NO', fn ($x) => $x->where('t.in_range', false))
            ->when($r->query('from'), fn ($x, $v) => $x->where('t.read_at', '>=', $v))
            ->when($r->query('to'), fn ($x, $v) => $x->where('t.read_at', '<=', $v.' 23:59:59'))
            ->selectRaw('t.id, t.point_id, t.read_at, t.value_c, t.source, t.context, t.in_range, t.photo_url, t.excursion_id, t.approved_at, t.establishment_id,
                p.code as point_code, p.name as point_name, p.point_type, p.min_c, p.max_c, u.name as read_by_name, a.name as approved_by_name');
        $this->porLocal($q, $r, 't.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['point_code', 'point_name', 'read_by_name'], ordenar: ['read_at', 'value_c', 'point_code'], porDefecto: '-read_at'));
    }

    public function leer(Request $r)
    {
        $d = $r->validate(['point_id' => 'required|uuid', 'value_c' => 'required|numeric', 'source' => 'nullable|in:MANUAL,SENSOR', 'context' => 'nullable|string|max:255',
            'photo_url' => 'nullable|string|max:255', 'read_at' => 'nullable|date']);

        return response()->json(Cal::leer($d, $r->user()), 201);
    }

    public function aprobar(Request $r, string $id)
    {
        return response()->json(Cal::aprobarLectura($id, $r->user()));
    }

    /** CAL-06 */
    public function excursiones(Request $r)
    {
        $q = DB::table('temperature_excursions as x')->join('temperature_points as p', 'p.id', '=', 'x.point_id')->join('establishments as e', 'e.id', '=', 'x.establishment_id')
            ->leftJoin('users as u', 'u.id', '=', 'x.closed_by')->leftJoin('nonconformities as n', 'n.id', '=', 'x.nonconformity_id')
            ->when($r->query('status'), fn ($x, $v) => $x->where('x.status', $v))
            ->selectRaw("x.id, x.point_id, x.started_at, x.ended_at, x.first_value_c, x.last_value_c, x.max_value_c, x.max_deviation_c, x.readings_count, x.status, x.action_taken,
                x.closed_at, x.lots_exposed, x.establishment_id, p.code as point_code, p.name as point_name, p.min_c, p.max_c, p.point_type, coalesce(e.short, e.name) as establishment_name,
                u.name as closed_by_name, n.number as nc_number, n.id as nc_id,
                round(extract(epoch FROM (coalesce(x.ended_at, now()) - x.started_at)) / 60) as duration_min");
        $this->porLocal($q, $r, 'x.establishment_id');
        $p = Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['point_code', 'point_name', 'action_taken'], ordenar: ['started_at', 'max_deviation_c', 'status', 'duration_min'], porDefecto: '-started_at');
        $p->getCollection()->transform(fn ($x) => tap($x, fn () => $x->lots_exposed = json_decode($x->lots_exposed ?? '[]', true) ?: []));

        return response()->json($p);
    }

    public function excursion(Request $r, string $id)
    {
        $x = DB::table('temperature_excursions as x')->join('temperature_points as p', 'p.id', '=', 'x.point_id')->where('x.id', $id)
            ->first(['x.*', 'p.code as point_code', 'p.name as point_name', 'p.min_c', 'p.max_c']) ?? abort(404);
        $this->dentroDelAlcance($r, $x->establishment_id);
        $x->lots_exposed = json_decode($x->lots_exposed ?? '[]', true) ?: [];
        $x->readings = DB::table('temperature_readings as t')->leftJoin('users as u', 'u.id', '=', 't.read_by')->where('t.excursion_id', $id)->orderBy('t.read_at')
            ->get(['t.id', 't.read_at', 't.value_c', 't.in_range', 't.source', 'u.name as read_by_name']);

        return response()->json($x);
    }

    public function cerrar(Request $r, string $id)
    {
        $d = $r->validate(['action_taken' => 'nullable|string|max:255', 'create_nc' => 'nullable|boolean', 'severity' => 'nullable|in:MINOR,MAJOR,CRITICAL']);

        return response()->json(Cal::cerrarExcursion($id, $d, $r->user()));
    }
}
