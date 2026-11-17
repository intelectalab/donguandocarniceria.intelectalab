<?php

namespace App\Modulos\Mae\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Mae\Services\TipoCambio\FuenteTipoCambio;
use App\Modulos\Mae\Services\TiposDeCambio;
use App\Support\Access;
use App\Support\Listado;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * MAE-05 Tipo de cambio: calendario del mes, lo aplicable hoy, cargas manuales y correcciones.
 * La ve quien tiene el módulo MAE o el permiso mae.exchange_rate.edit (la contadora, que no tiene el resto de MAE).
 */
class TipoCambioController extends Controller
{
    private function puedeVer(Request $request): void
    {
        $u = $request->user();
        abort_unless(Access::module($u, 'MAE') || Access::can($u, 'mae.exchange_rate.edit'),
            response()->json(['message' => 'No tienes acceso al tipo de cambio.', 'code' => 'PERMISSION_DENIED'], 403));
    }

    public function index(Request $request)
    {
        $this->puedeVer($request);
        $hoy = TiposDeCambio::hoy();
        $d = $request->validate(['mes' => ['nullable', 'date_format:Y-m'], 'moneda' => ['nullable', 'regex:/^[A-Z]{3}$/']]);
        $mes = $d['mes'] ?? substr($hoy, 0, 7);
        $moneda = $d['moneda'] ?? 'USD';
        $desde = "{$mes}-01";
        $hasta = date('Y-m-t', strtotime($desde));
        $filas = DB::table('exchange_rates')->where('currency', $moneda)->whereBetween('date', [$desde, $hasta])->get()->keyBy('date');
        $dias = [];
        for ($x = $desde; $x <= $hasta; $x = date('Y-m-d', strtotime("{$x} +1 day"))) {
            $r = $filas[$x] ?? null;
            $respaldo = null;
            if (! $r && $x <= $hoy) {
                try {
                    $respaldo = TiposDeCambio::para($x, $moneda);
                } catch (RuleError) {
                }
            }
            $dias[] = ['date' => $x, 'habil' => TiposDeCambio::esHabil($x), 'feriado' => TiposDeCambio::feriado($x), 'futuro' => $x > $hoy,
                'fila' => $r ? ['id' => $r->id, 'buy' => (float) $r->buy, 'sell' => (float) $r->sell, 'loaded_via' => $r->loaded_via ?? $r->source,
                    'loaded_by' => $r->loaded_by, 'edit_reason' => $r->edit_reason, 'edited_by' => $r->edited_by] : null,
                'respaldo' => $respaldo ? ['sell' => $respaldo['sell'], 'fecha_usada' => $respaldo['fecha_usada']] : null];
        }
        try {
            $aplicable = TiposDeCambio::para($hoy, $moneda);
        } catch (RuleError $e) {
            $aplicable = ['error' => $e->getMessage()];
        }
        $primero = DB::table('exchange_rates')->where('currency', $moneda)->min('date');

        return response()->json([
            'mes' => $mes, 'moneda' => $moneda, 'dias' => $dias, 'hoy' => $hoy, 'aplicable_hoy' => $aplicable,
            'cobertura' => TiposDeCambio::cobertura($desde, $hasta, $moneda),
            'meses_desde' => $primero ? substr($primero, 0, 7) : $mes,
            'fuente' => app(FuenteTipoCambio::class)->nombre(),
            'parametros' => ['dias_respaldo' => (int) (Params::get('mae_fx_max_fallback_days') ?? 7), 'hora_carga' => (string) (Params::get('mae_fx_load_time') ?? '09:00')],
        ]);
    }

    /**
     * Cargas manuales y correcciones, paginadas (crecen todos los meses). Filtros: tipo (MANUAL o CORREGIDO),
     * rango de fechas y moneda; busca en quién cargó o corrigió y en el motivo.
     */
    public function registros(Request $request)
    {
        $this->puedeVer($request);
        $f = $request->validate([
            'tipo' => ['nullable', 'in:MANUAL,CORREGIDO'], 'desde' => ['nullable', 'date_format:Y-m-d'],
            'hasta' => ['nullable', 'date_format:Y-m-d'], 'moneda' => ['nullable', 'regex:/^[A-Z]{3}$/'],
        ]);
        $q = DB::table('exchange_rates')->where('currency', $f['moneda'] ?? 'USD')
            ->where(fn ($w) => match ($f['tipo'] ?? null) {
                'MANUAL' => $w->where('loaded_via', 'MANUAL'),
                'CORREGIDO' => $w->whereNotNull('edit_reason'),
                default => $w->whereNotNull('edit_reason')->orWhere('loaded_via', 'MANUAL'),
            })
            ->when($f['desde'] ?? null, fn ($w, $v) => $w->where('date', '>=', $v))
            ->when($f['hasta'] ?? null, fn ($w, $v) => $w->where('date', '<=', $v))
            ->select(['id', 'date', 'buy', 'sell', 'loaded_via', 'loaded_by', 'edited_by', 'edit_reason', 'updated_at']);

        return response()->json(Listado::de($q, $request, buscar: ['loaded_by', 'edited_by', 'edit_reason'],
            ordenar: ['date', 'buy', 'sell', 'loaded_via'], porDefecto: '-date'));
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'date' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'], 'currency' => ['nullable', 'regex:/^[A-Z]{3}$/'],
            'buy' => ['required', 'numeric', 'gt:0', 'max:100'], 'sell' => ['required', 'numeric', 'gt:0', 'max:100'], 'reason' => ['nullable', 'string', 'max:255'],
        ]);
        $r = TiposDeCambio::registrar($d, 'MANUAL', $request->user());

        return response()->json(['id' => $r->id, 'corregido' => $r->edit_reason !== null], 201);
    }

    public function cargar(Request $request)
    {
        $d = $request->validate(['date' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'], 'currency' => ['nullable', 'regex:/^[A-Z]{3}$/']]);
        try {
            $r = TiposDeCambio::cargarDeFuente($d['date'], $d['currency'] ?? 'USD');
        } catch (\RuntimeException $e) {
            RuleError::fail('RN-MAE-14', $e->getMessage());
        }

        return response()->json(['cargado' => $r['cargado'], 'mensaje' => $r['mensaje']]);
    }

    /** RN-MAE-07: ¿qué tipo de cambio usa un documento de esa fecha? */
    public function para(Request $request)
    {
        $this->puedeVer($request);
        $d = $request->validate(['date' => ['required', 'date_format:Y-m-d'], 'amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'currency' => ['nullable', 'regex:/^[A-Z]{3}$/']]);

        return response()->json(TiposDeCambio::aSoles((float) ($d['amount'] ?? 0), $d['date'], $d['currency'] ?? 'USD'));
    }
}
