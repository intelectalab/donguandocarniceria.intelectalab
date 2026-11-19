<?php

namespace App\Modulos\Equ\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Equ\Services\EquiposService as Equ;
use App\Support\Access;
use App\Support\Listado;
use App\Support\Params;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** EQU-01 Equipos y EQU-02 Ficha del equipo; opciones de los formularios y cifras de cabecera. */
class EquipoController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = $this->base($r)
            ->when($r->query('category'), fn ($x, $c) => $x->where('e.category', $c))
            ->when($r->query('status'), fn ($x, $s) => $x->where('e.status', $s), fn ($x) => $r->query('bajas') ? $x : $x->where('e.status', '<>', 'RETIRED'))
            ->when($r->query('calibra') === 'SI', fn ($x) => $x->where('e.requires_calibration', true));
        $s = DB::query()->fromSub($q, 's')
            ->when($r->query('apto') === 'SI', fn ($x) => $x->where('usable', true))
            ->when($r->query('apto') === 'NO', fn ($x) => $x->where('usable', false));

        return response()->json(Listado::de($s, $r, buscar: ['code', 'name', 'brand_name', 'model', 'serial_number', 'establishment_name'],
            ordenar: ['code', 'name', 'category', 'establishment_name', 'status', 'cal_valid_until', 'hour_meter', 'purchase_cost'], porDefecto: 'code'));
    }

    /** EQU-02: ficha con su estado de uso, calibraciones, órdenes, uso, lecturas y costos acumulados. */
    public function show(Request $r, string $id)
    {
        DB::table('equipment')->where('id', $id)->exists() || abort(404);
        $e = Equ::equipo($id);
        $this->dentroDelAlcance($r, $e->establishment_id);
        $e->meter_readings = array_reverse(json_decode($e->meter_readings ?? '[]', true) ?: []);
        $e->photos = json_decode($e->photos ?? '[]', true) ?: [];
        $e->not_usable = Equ::motivoNoApto($e);
        $e->calibration = Equ::estadoCalibracion($e);
        $e->calibrations = DB::table('equipment_calibrations')->where('equipment_id', $id)->orderByDesc('calibrated_on')->orderByDesc('created_at')->get();
        $e->orders = DB::table('maintenance_orders')->where('equipment_id', $id)->orderByDesc('reported_at')
            ->get(['id', 'number', 'kind', 'status', 'urgency', 'description', 'diagnosis', 'reported_at', 'finished_at', 'downtime_hours', 'total_cost']);
        $e->plans = DB::table('maintenance_plans')->where('equipment_id', $id)->orderBy('activity')->get();
        foreach ($e->plans as $p) {
            $p->state = $p->status === 'ACTIVE' ? Equ::estadoPlan($p, null, (float) $e->hour_meter) : 'INACTIVE';
        }
        $e->usage = DB::table('equipment_usage')->where('equipment_id', $id)->orderByDesc('used_on')->orderByDesc('created_at')->limit(30)->get();
        $e->temperature_point = DB::table('temperature_points')->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->where('equipment_id', $id)->when($e->warehouse_id, fn ($x) => $x->orWhere('warehouse_id', $e->warehouse_id)))
            ->first(['id', 'code', 'name', 'min_c', 'max_c']);
        $hecho = $e->orders->where('status', 'DONE');
        $e->totals = [
            'maintenance_cost' => Equ::t($hecho->sum('total_cost')), 'calibration_cost' => Equ::t($e->calibrations->sum('cost')),
            'failures' => $e->orders->where('kind', 'CORRECTIVE')->where('status', '<>', 'VOIDED')->count(),
            'downtime_hours' => Equ::t($hecho->sum('downtime_hours'), 1),
            'usage_hours' => Equ::t(DB::table('equipment_usage')->where('equipment_id', $id)->sum('hours'), 1),
            'usage_cost' => Equ::t(DB::table('equipment_usage')->where('equipment_id', $id)->sum('cost')),
        ];
        $e->totals['accumulated_cost'] = Equ::t((float) $e->totals['maintenance_cost'] + (float) $e->totals['calibration_cost']);
        $e->suggested_rate = Equ::cargaSugerida($e);

        return response()->json($e);
    }

    public function store(Request $r)
    {
        return response()->json(Equ::guardarEquipo($this->validar($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        $e = DB::table('equipment')->where('id', $id)->first() ?? abort(404);
        $this->dentroDelAlcance($r, $e->establishment_id);

        return response()->json(Equ::guardarEquipo($this->validar($r, true), $id, $r->user()));
    }

    /** RN-EQU-09: fijar la carga por hora (por ejemplo, la sugerida). */
    public function carga(Request $r, string $id)
    {
        $d = $r->validate(['hourly_rate' => 'required|numeric|min:0']);
        $e = DB::table('equipment')->where('id', $id)->first() ?? abort(404);
        $this->dentroDelAlcance($r, $e->establishment_id);

        return response()->json(Equ::fijarCarga($id, $d['hourly_rate'], $r->user()));
    }

    /** ¿Se puede usar a la fecha? Para PRO y ALM, y para avisar en los formularios. */
    public function apto(Request $r, string $id)
    {
        $e = DB::table('equipment')->where('id', $id)->first() ?? abort(404);
        $this->dentroDelAlcance($r, $e->establishment_id);
        $fecha = Equ::fecha($r->query('fecha'));
        $m = Equ::motivoNoApto($e, $fecha);

        return response()->json(['equipment_id' => $id, 'code' => $e->code, 'date' => $fecha, 'usable' => $m === null, 'rule' => $m['rule'] ?? null, 'message' => $m['msg'] ?? null,
            'hourly_rate' => $e->hourly_rate, 'hour_meter' => $e->hour_meter]);
    }

    /** EQU-07: el QR escaneado (o el código escrito) da el equipo. */
    public function porCodigo(Request $r)
    {
        $e = Equ::porCodigo((string) $r->query('code', '')) ?? abort(response()->json(['message' => 'No hay un equipo con ese código o QR.', 'code' => 'RN-EQU-05'], 404));
        $this->dentroDelAlcance($r, $e->establishment_id);
        $x = Equ::equipo($e->id);
        $x->open_corrective = Equ::correctivasAbiertas($e->id)->first();

        return response()->json($x);
    }

    /** Opciones de los formularios: locales, almacenes, centros de costo, equipos, proveedores, responsables y parámetros. */
    public function opciones(Request $r)
    {
        $locales = Access::for($r->user())['establishments'];
        $u = $r->user();
        $hoy = Equ::fecha(null);

        return response()->json([
            'establishments' => DB::table('establishments')->where('status', 'ACTIVE')->when($locales, fn ($x) => $x->whereIn('id', $locales))->orderBy('code')
                ->get(['id', 'code', 'name', 'short', 'company_id']),
            'warehouses' => DB::table('warehouses')->where('status', 'ACTIVE')->whereNotNull('establishment_id')->when($locales, fn ($x) => $x->whereIn('establishment_id', $locales))
                ->orderBy('code')->get(['id', 'code', 'name', 'wh_type', 'establishment_id']),
            'cost_centers' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'establishment_id']),
            'equipment' => DB::table('equipment')->where('status', '<>', 'RETIRED')->when($locales, fn ($x) => $x->whereIn('establishment_id', $locales))->orderBy('code')
                ->get(['id', 'code', 'name', 'category', 'status', 'establishment_id', 'requires_calibration', 'hourly_rate', 'hour_meter', 'qr_code']),
            'suppliers' => DB::table('suppliers')->where('status', 'ACTIVE')->orderBy('legal_name')->get(['id', 'legal_name', 'trade_name', 'doc_number']),
            'employees' => DB::table('employees')->where('status', 'ACTIVE')->when($locales, fn ($x) => $x->whereIn('establishment_id', $locales))->orderBy('full_name')
                ->get(['id', 'full_name', 'position', 'establishment_id']),
            'params' => [
                'calibration_alert_days' => (int) Params::get('equ_calibration_alert_days'), 'preventive_overdue_days' => (int) Params::get('equ_preventive_overdue_days'),
                'scale_calibration_months' => (int) Params::get('equ_scale_calibration_months'), 'expiring_days' => Equ::POR_VENCER_DIAS,
            ],
            'today' => $hoy, 'suggested_valid_until' => Equ::vigenciaSugerida($hoy),
            'can' => [
                'manage' => Access::can($u, 'equ.equipment.manage'), 'calibrate' => Access::can($u, 'equ.calibration.record'),
                'maintain' => Access::can($u, 'equ.maintenance.manage'), 'report' => Access::can($u, 'equ.failure.report') || Access::can($u, 'equ.maintenance.manage'),
                'usage' => Access::can($u, 'equ.usage.record'),
            ],
        ]);
    }

    /** Cifras de la cabecera de EQU-01, EQU-03, EQU-04, EQU-05, EQU-06 y EQU-08. */
    public function cifras(Request $r, string $pantalla)
    {
        $locales = $this->locales($r);
        $hoy = Equ::fecha(null);
        $mes = CarbonImmutable::parse($hoy)->startOfMonth()->toDateString();
        $eq = DB::table('equipment')->when($locales, fn ($x) => $x->whereIn('establishment_id', $locales));
        $ids = (clone $eq)->pluck('id');

        return response()->json(match ($pantalla) {
            '01' => (function () use ($eq, $hoy) {
                $filas = (clone $eq)->where('status', '<>', 'RETIRED')->get();
                $balanzas = $filas->where('category', 'SCALE');

                return [
                    'equipment' => $filas->count(), 'out_of_service' => $filas->where('status', 'OUT_OF_SERVICE')->count(),
                    'scales' => $balanzas->count(), 'scales_not_usable' => $balanzas->filter(fn ($b) => Equ::motivoNoApto($b, $hoy) !== null)->count(),
                    'blocked_calibration' => $filas->filter(fn ($e) => $e->status === 'ACTIVE' && $e->requires_calibration && ! Equ::calibracionVigente($e->id, $hoy))->count(),
                    'purchase_value' => Equ::t($filas->sum('purchase_cost')),
                ];
            })(),
            '03' => [
                'year' => (int) substr($hoy, 0, 4),
                'this_year' => DB::table('equipment_calibrations')->whereIn('equipment_id', $ids)->whereYear('calibrated_on', substr($hoy, 0, 4))->count(),
                'failed' => DB::table('equipment_calibrations')->whereIn('equipment_id', $ids)->whereYear('calibrated_on', substr($hoy, 0, 4))->where('result', 'FAIL')->count(),
                'cost' => Equ::t(DB::table('equipment_calibrations')->whereIn('equipment_id', $ids)->whereYear('calibrated_on', substr($hoy, 0, 4))->sum('cost')),
                'scale_months' => (int) Params::get('equ_scale_calibration_months'),
            ],
            '05' => (function () use ($ids, $hoy, $mes, $locales) {
                $planes = DB::table('maintenance_plans as p')->join('equipment as e', 'e.id', '=', 'p.equipment_id')->whereIn('p.equipment_id', $ids)->where('p.status', 'ACTIVE')->get(['p.*', 'e.hour_meter']);
                $estados = $planes->map(fn ($p) => Equ::estadoPlan($p, $hoy, (float) $p->hour_meter));

                return ['active' => $planes->count(), 'due' => $estados->filter(fn ($s) => $s === 'DUE')->count(), 'overdue' => $estados->filter(fn ($s) => $s === 'OVERDUE')->count(),
                    'overdue_days' => (int) Params::get('equ_preventive_overdue_days'), 'compliance' => Equ::kpis($mes, $hoy, $locales)['preventive']];
            })(),
            '06' => (function () use ($ids, $hoy, $mes, $locales) {
                $abiertas = DB::table('maintenance_orders')->whereIn('equipment_id', $ids)->whereIn('status', ['OPEN', 'IN_PROGRESS'])->get(['kind']);
                $k = Equ::kpis($mes, $hoy, $locales);

                return ['open' => $abiertas->count(), 'open_corrective' => $abiertas->where('kind', 'CORRECTIVE')->count(),
                    'month_cost' => $k['maintenance_cost'], 'availability' => $k['availability']['value']];
            })(),
            '08' => (function () use ($ids, $mes) {
                $u = DB::table('equipment_usage')->whereIn('equipment_id', $ids)->where('used_on', '>=', $mes)->get();

                return ['hours' => Equ::t($u->sum('hours'), 1), 'cost' => Equ::t($u->sum('cost')), 'orders' => $u->map(fn ($x) => $x->order_ref ?? $x->production_order_id)->unique()->count(),
                    'equipment' => $u->pluck('equipment_id')->unique()->count(), 'from' => $mes];
            })(),
            default => abort(404),
        });
    }

    private function validar(Request $r, bool $editar = false): array
    {
        $req = $editar ? 'sometimes|' : 'required|';

        return $r->validate([
            'code' => $req.'string|max:40', 'name' => $req.'string|max:80', 'category' => $req.'in:'.implode(',', Equ::CATEGORIAS),
            'establishment_id' => $req.'uuid', 'warehouse_id' => 'nullable|uuid', 'cost_center_id' => 'nullable|uuid', 'requires_calibration' => 'sometimes|boolean',
            'brand_name' => 'nullable|string|max:40', 'model' => 'nullable|string|max:40', 'serial_number' => 'nullable|string|max:40', 'capacity' => 'nullable|string|max:40',
            'purchase_date' => 'nullable|date', 'purchase_cost' => 'nullable|numeric|min:0', 'useful_life_months' => 'nullable|integer|min:1',
            'hourly_rate' => 'nullable|numeric|min:0', 'power_kw' => 'nullable|numeric|min:0', 'manual_url' => 'nullable|string|max:255',
            'photos' => 'sometimes|array', 'photos.*' => 'nullable|string|max:255', 'status' => 'sometimes|in:'.implode(',', Equ::ESTADOS), 'notes' => 'nullable|string|max:2000',
        ]);
    }

    /** Equipo con local, almacén, calibración vigente a hoy, si está apto y sus órdenes abiertas. */
    private function base(Request $r)
    {
        $hoy = Equ::fecha(null);
        $q = DB::table('equipment as e')->join('establishments as s', 's.id', '=', 'e.establishment_id')->leftJoin('warehouses as w', 'w.id', '=', 'e.warehouse_id')
            ->selectRaw("e.id, e.code, e.name, e.category, e.status, e.establishment_id, e.warehouse_id, e.brand_name, e.model, e.serial_number, e.qr_code,
                e.requires_calibration, e.hourly_rate, e.hour_meter, e.purchase_cost, e.oos_reason, e.oos_since, e.created_at,
                coalesce(s.short, s.name) as establishment_name, w.code as warehouse_code,
                cal.valid_until as cal_valid_until,
                (select max(c2.valid_until) from equipment_calibrations c2 where c2.equipment_id = e.id) as cal_last_until,
                (select count(*) from maintenance_orders m where m.equipment_id = e.id and m.status in ('OPEN','IN_PROGRESS')) as open_orders,
                (e.status = 'ACTIVE' and (not e.requires_calibration or cal.valid_until is not null)) as usable")
            ->leftJoinSub(DB::table('equipment_calibrations')->where('result', 'PASS')->where('calibrated_on', '<=', $hoy)->where('valid_until', '>=', $hoy)
                ->groupBy('equipment_id')->selectRaw('equipment_id, max(valid_until) as valid_until'), 'cal', 'cal.equipment_id', '=', 'e.id');
        $this->porLocal($q, $r, 'e.establishment_id');

        return $q;
    }
}
