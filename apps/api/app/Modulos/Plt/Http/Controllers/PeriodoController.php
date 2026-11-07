<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Listado;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PLT-09 Períodos: los meses de cada empresa con su estado, cerrar en orden (RN-PLT-17), reabrir
 * con motivo (RN-PLT-18) y el historial. Las reglas viven en el servicio Periodos.
 */
class PeriodoController extends Controller
{
    /**
     * Meses de la empresa, desde el primero registrado (o enero del año en curso) hasta el mes en
     * curso. Los meses sin registro salen abiertos y con id null. Incluye las cifras de cabecera.
     */
    public function index(Request $request)
    {
        $empresa = $this->empresa($request);
        $hoy = Periodos::hoy();
        $actual = $hoy->startOfMonth();

        $filas = DB::table('accounting_periods')->where('company_id', $empresa)->orderBy('period')->get()
            ->keyBy(fn ($p) => substr($p->period, 0, 10));
        $eventos = DB::table('accounting_period_events')->whereIn('period_id', $filas->pluck('id'))->orderBy('acted_at')->get()
            ->groupBy('period_id');

        $desde = $filas->isNotEmpty() ? CarbonImmutable::parse($filas->keys()->first(), 'America/Lima') : $actual->startOfYear();
        $meses = [];
        for ($m = $desde; $m->lessThanOrEqualTo($actual); $m = $m->addMonth()) {
            $fila = $filas->get($m->toDateString());
            $ev = $fila ? ($eventos->get($fila->id) ?? collect()) : collect();
            $cierre = $ev->where('action', 'CLOSE')->last();
            $cerrado = $fila?->status === 'CLOSED';
            $meta = Periodos::meta($m);
            $meses[] = [
                'id' => $fila?->id,
                'period' => $m->toDateString(),
                'nombre' => Periodos::nombre($m),
                'status' => $cerrado ? 'CLOSED' : 'OPEN',
                'closed_at' => $fila?->closed_at,
                'closed_by' => $fila?->closed_by,
                'en_curso' => $m->equalTo($actual),
                'meta' => $meta->toDateString(),
                // A tiempo: el último cierre fue hasta la meta. null mientras no esté cerrado.
                'a_tiempo' => $cerrado && $cierre ? CarbonImmutable::parse($cierre->acted_at)->setTimezone('America/Lima')->startOfDay()->lessThanOrEqualTo($meta) : null,
                'reaperturas' => $ev->where('action', 'REOPEN')->count(),
            ];
        }

        $cerrados = array_values(array_filter($meses, fn ($m) => $m['status'] === 'CLOSED'));
        $aTiempo = count(array_filter($cerrados, fn ($m) => $m['a_tiempo']));
        // El siguiente por cerrar es el mes terminado más antiguo que sigue abierto (se cierran en orden).
        $pendiente = collect($meses)->first(fn ($m) => $m['status'] === 'OPEN' && ! $m['en_curso']);

        return response()->json([
            'meses' => $meses,
            'resumen' => [
                'cerrados' => count($cerrados),
                'total' => count($meses),
                // KPI-PLT-01: meses cerrados hasta el día plt_period_close_day del mes siguiente.
                'a_tiempo' => $aTiempo,
                'a_tiempo_pct' => $cerrados ? round($aTiempo / count($cerrados) * 100) : null,
                'dia_cierre' => (int) Periodos::meta($actual)->day,
                'pendiente' => $pendiente ? ['nombre' => $pendiente['nombre'], 'meta' => $pendiente['meta'], 'vencido' => $hoy->toDateString() > $pendiente['meta']] : null,
                'cnt_encendido' => DB::table('tenant_modules')->where('module_code', 'CNT')->where('enabled', true)->exists(),
            ],
        ]);
    }

    /** Historial de aperturas, cierres y reaperturas de la empresa (o de un mes con ?period_id). */
    public function historial(Request $request)
    {
        $empresa = $this->empresa($request);
        $query = DB::table('accounting_period_events as e')
            ->join('accounting_periods as p', 'p.id', '=', 'e.period_id')
            ->where('p.company_id', $empresa)
            ->select('e.id', 'e.period', 'e.action', 'e.reason', 'e.acted_by_name', 'e.acted_at')
            ->when($request->query('period_id'), fn ($q, $v) => $q->where('e.period_id', $v))
            ->when($request->query('action'), fn ($q, $v) => $q->where('e.action', $v));

        return response()->json(Listado::de($query, $request, buscar: ['e.reason', 'e.acted_by_name'],
            ordenar: ['acted_at', 'period', 'action'], porDefecto: '-acted_at'));
    }

    public function cerrar(Request $request)
    {
        $datos = $request->validate([
            'company_id' => ['required', 'uuid', 'exists:companies,id'],
            'period' => ['required', 'date_format:Y-m-d'],
            'note' => ['nullable', 'string', 'max:255'],
        ], ['company_id.exists' => 'La empresa no existe.']);

        return response()->json(Periodos::cerrar($datos['company_id'], $datos['period'], $request->user(), $datos['note'] ?? null));
    }

    public function reabrir(Request $request, string $id)
    {
        $datos = $request->validate(['reason' => ['required', 'string', 'max:255']], ['reason.required' => 'Escribe el motivo.']);

        return response()->json(Periodos::reabrir($id, $request->user(), $datos['reason']));
    }

    /** La empresa pedida o, sin ella, la primera por razón social. */
    private function empresa(Request $request): string
    {
        $request->validate(['company_id' => ['nullable', 'uuid', Rule::exists('companies', 'id')]]);

        return $request->query('company_id') ?: (DB::table('companies')->orderBy('legal_name')->value('id') ?? abort(404, 'No hay empresas.'));
    }
}
