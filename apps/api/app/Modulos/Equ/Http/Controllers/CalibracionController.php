<?php

namespace App\Modulos\Equ\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Equ\Services\EquiposService as Equ;
use App\Support\Listado;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** EQU-03 Calibraciones (solo inserción, RN-EQU-12) y EQU-04 Calendario de calibraciones. */
class CalibracionController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('equipment_calibrations as c')->join('equipment as e', 'e.id', '=', 'c.equipment_id')
            ->join('establishments as s', 's.id', '=', 'e.establishment_id')
            ->when($r->query('result'), fn ($x, $v) => $x->where('c.result', $v))
            ->when($r->query('equipment_id'), fn ($x, $v) => $x->where('c.equipment_id', $v))
            ->when($r->query('category'), fn ($x, $v) => $x->where('e.category', $v))
            ->selectRaw('c.*, e.code as equipment_code, e.name as equipment_name, e.category, coalesce(s.short, s.name) as establishment_name');
        $this->porLocal($q, $r, 'e.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['equipment_code', 'equipment_name', 'certificate_number', 'provider_name'],
            ordenar: ['calibrated_on', 'valid_until', 'equipment_code', 'result', 'cost', 'created_at'], porDefecto: '-calibrated_on'));
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'equipment_id' => 'required|uuid', 'calibrated_on' => 'required|date', 'valid_until' => 'required|date',
            'provider_supplier_id' => 'nullable|uuid', 'provider_name' => 'nullable|string|max:255',
            'certificate_number' => 'nullable|string|max:40', 'certificate_url' => 'nullable|string|max:255',
            'max_error_g' => 'nullable|numeric|min:0', 'result' => 'required|in:PASS,FAIL', 'cost' => 'nullable|numeric|min:0', 'notes' => 'nullable|string|max:2000',
        ]);
        $e = DB::table('equipment')->where('id', $d['equipment_id'])->first() ?? abort(404);
        $this->dentroDelAlcance($r, $e->establishment_id);

        return response()->json(Equ::registrarCalibracion($d, $r->user()), 201);
    }

    /**
     * EQU-04: equipos que exigen calibración con su estado a hoy: vencidos o bloqueados, por vencer en 30 días y vigentes.
     * ?estado=BLOCKED|EXPIRING|USABLE filtra.
     */
    public function calendario(Request $r)
    {
        $hoy = Equ::fecha(null);
        $aviso = (int) Params::get('equ_calibration_alert_days');
        $q = DB::table('equipment as e')->join('establishments as s', 's.id', '=', 'e.establishment_id')
            ->where('e.requires_calibration', true)->where('e.status', '<>', 'RETIRED')
            ->when($r->query('category'), fn ($x, $v) => $x->where('e.category', $v))
            ->orderBy('e.code')->select(['e.*', DB::raw('coalesce(s.short, s.name) as establishment_name')]);
        $this->porLocal($q, $r, 'e.establishment_id');
        $orden = ['BLOCKED' => 0, 'EXPIRING' => 1, 'USABLE' => 2];
        $filas = $q->get()->map(function ($e) use ($hoy, $aviso) {
            $s = Equ::estadoCalibracion($e, $hoy);
            $c = $s['calibration'];
            $m = Equ::motivoNoApto($e, $hoy);

            return [
                'id' => $e->id, 'code' => $e->code, 'name' => $e->name, 'category' => $e->category, 'status' => $e->status, 'establishment_name' => $e->establishment_name,
                'state' => $s['state'] === 'USABLE' && $e->status !== 'ACTIVE' ? 'BLOCKED' : $s['state'], 'days' => $s['days'], 'alert' => $s['state'] === 'EXPIRING' && $s['days'] <= $aviso,
                'valid_until' => $c?->valid_until, 'calibrated_on' => $c?->calibrated_on, 'certificate_number' => $c?->certificate_number, 'result' => $c?->result,
                'provider_name' => $c?->provider_name, 'usable' => $m === null, 'rule' => $m['rule'] ?? null, 'message' => $m['msg'] ?? null,
            ];
        })->sortBy(fn ($f) => sprintf('%d-%06d-%s', $orden[$f['state']] ?? 3, 500000 + ($f['days'] ?? -500000), $f['code']))->values();
        $estado = $r->query('estado');
        $balanzas = $filas->where('category', 'SCALE')->where('status', 'ACTIVE');

        return response()->json([
            'rows' => $estado ? $filas->where('state', $estado)->values() : $filas,
            'summary' => [
                'blocked' => $filas->where('state', 'BLOCKED')->count(), 'expiring' => $filas->where('state', 'EXPIRING')->count(),
                'alert' => $filas->where('alert', true)->count(), 'usable' => $filas->where('state', 'USABLE')->count(), 'alert_days' => $aviso,
                'scales_ok' => $balanzas->where('usable', true)->count(), 'scales' => $balanzas->count(),
                'scales_pct' => $balanzas->count() ? Equ::t($balanzas->where('usable', true)->count() / $balanzas->count() * 100, 1) : null,
            ],
        ]);
    }
}
