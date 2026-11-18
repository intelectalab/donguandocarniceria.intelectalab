<?php

namespace App\Modulos\Equ\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Equ\Services\EquiposService as Equ;
use App\Support\Listado;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** EQU-08 Uso del equipo: horas por orden de producción (PRO-09) y lecturas de horómetro. EQU-09 Tablero. */
class UsoController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('equipment_usage as u')->join('equipment as e', 'e.id', '=', 'u.equipment_id')->join('establishments as s', 's.id', '=', 'e.establishment_id')
            ->leftJoin('users as x', 'x.id', '=', 'u.recorded_by')
            ->when($r->query('equipment_id'), fn ($y, $v) => $y->where('u.equipment_id', $v))
            ->when($r->query('desde'), fn ($y, $v) => $y->where('u.used_on', '>=', $v))
            ->when($r->query('hasta'), fn ($y, $v) => $y->where('u.used_on', '<=', $v))
            ->selectRaw('u.*, e.code as equipment_code, e.name as equipment_name, coalesce(s.short, s.name) as establishment_name, x.name as recorded_by_name');
        $this->porLocal($q, $r, 'e.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['equipment_code', 'equipment_name', 'order_ref'],
            ordenar: ['used_on', 'equipment_code', 'order_ref', 'hours', 'cost', 'created_at'], porDefecto: '-used_on'));
    }

    /** Horas del mes por equipo (gráfico de EQU-08). */
    public function porEquipo(Request $r)
    {
        $desde = $r->query('desde') ?: CarbonImmutable::now('America/Lima')->startOfMonth()->toDateString();
        $q = DB::table('equipment_usage as u')->join('equipment as e', 'e.id', '=', 'u.equipment_id')->where('u.used_on', '>=', $desde)
            ->groupBy('e.code')->orderByDesc(DB::raw('sum(u.hours)'))->selectRaw('e.code as label, sum(u.hours) as value, sum(u.cost) as cost');
        $this->porLocal($q, $r, 'e.establishment_id');

        return response()->json($q->get());
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'equipment_id' => 'required|uuid', 'hours' => 'required|numeric|gt:0', 'used_on' => 'nullable|date', 'order_ref' => 'nullable|string|max:40',
            'production_order_id' => 'nullable|uuid',
        ]);
        $e = DB::table('equipment')->where('id', $d['equipment_id'])->first() ?? abort(404);
        $this->dentroDelAlcance($r, $e->establishment_id);

        return response()->json(Equ::registrarUso($d, $r->user()), 201);
    }

    public function lectura(Request $r, string $id)
    {
        $d = $r->validate(['hours' => 'required|numeric|min:0']);
        $e = DB::table('equipment')->where('id', $id)->first() ?? abort(404);
        $this->dentroDelAlcance($r, $e->establishment_id);

        return response()->json(Equ::lecturaHorometro($id, $d['hours'], $r->user()));
    }

    /** EQU-09: KPI-EQU-01 a 04 del mes (o ?mes=AAAA-MM) y sus desgloses por equipo, local y mes. */
    public function tablero(Request $r)
    {
        $hoy = CarbonImmutable::now('America/Lima');
        $mes = preg_match('/^\d{4}-\d{2}$/', (string) $r->query('mes')) ? CarbonImmutable::parse($r->query('mes').'-01', 'America/Lima') : $hoy->startOfMonth();
        $desde = $mes->startOfMonth()->toDateString();
        $hasta = min($mes->endOfMonth()->toDateString(), $hoy->toDateString());
        $locales = $this->locales($r);
        $k = Equ::kpis($desde, $hasta, $locales);

        $equipos = DB::table('equipment as e')->join('establishments as s', 's.id', '=', 'e.establishment_id')->where('e.status', '<>', 'RETIRED')
            ->when($locales, fn ($x) => $x->whereIn('e.establishment_id', $locales))->orderBy('e.code')
            ->get(['e.*', DB::raw('coalesce(s.short, s.name) as establishment_name')]);
        $disp = $equipos->map(fn ($e) => ['code' => $e->code, 'name' => $e->name] + Equ::disponibilidad([$e->id], $desde, $hasta))
            ->filter(fn ($x) => (float) $x['down'] > 0)->sortBy(fn ($x) => (float) $x['pct'])->values();
        $porLocal = DB::table('maintenance_orders as m')->join('equipment as e', 'e.id', '=', 'm.equipment_id')->join('establishments as s', 's.id', '=', 'e.establishment_id')
            ->where('m.status', 'DONE')->whereRaw("(m.finished_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$desde, $hasta])
            ->when($locales, fn ($x) => $x->whereIn('e.establishment_id', $locales))
            ->groupBy(DB::raw('coalesce(s.short, s.name)'))->selectRaw('coalesce(s.short, s.name) as label, sum(m.total_cost) as value')->orderBy('label')->get();
        $porEquipo = DB::table('maintenance_orders as m')->join('equipment as e', 'e.id', '=', 'm.equipment_id')
            ->where('m.status', 'DONE')->whereRaw("(m.finished_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$desde, $hasta])
            ->when($locales, fn ($x) => $x->whereIn('e.establishment_id', $locales))
            ->groupBy('e.code')->selectRaw('e.code as label, sum(m.total_cost) as value')->orderByDesc('value')->get();
        // Costo por mes de los últimos 6 meses, preventivo y correctivo.
        $meses = [];
        for ($i = 5; $i >= 0; $i--) {
            $m = $mes->subMonthsNoOverflow($i);
            $fila = DB::table('maintenance_orders as m')->join('equipment as e', 'e.id', '=', 'm.equipment_id')->where('m.status', 'DONE')
                ->whereRaw("to_char(m.finished_at AT TIME ZONE 'America/Lima', 'YYYY-MM') = ?", [$m->format('Y-m')])
                ->when($locales, fn ($x) => $x->whereIn('e.establishment_id', $locales))
                ->selectRaw("coalesce(sum(case when m.kind = 'PREVENTIVE' then m.total_cost end), 0) as preventive, coalesce(sum(case when m.kind = 'CORRECTIVE' then m.total_cost end), 0) as corrective")->first();
            $meses[] = ['month' => $m->format('Y-m'), 'preventive' => Equ::t($fila->preventive), 'corrective' => Equ::t($fila->corrective)];
        }
        $balanzas = $equipos->where('category', 'SCALE')->map(function ($b) use ($hasta) {
            $c = Equ::calibracionVigente($b->id, $hasta) ?? Equ::ultimaCalibracion($b->id);
            $m = Equ::motivoNoApto($b, $hasta);

            return ['id' => $b->id, 'code' => $b->code, 'name' => $b->name, 'establishment_name' => $b->establishment_name, 'valid_until' => $c?->valid_until,
                'usable' => $m === null, 'rule' => $m['rule'] ?? null];
        })->values();

        return response()->json($k + ['availability_by_equipment' => $disp, 'cost_by_site' => $porLocal, 'cost_by_equipment' => $porEquipo, 'cost_by_month' => $meses, 'scales_list' => $balanzas]);
    }
}
