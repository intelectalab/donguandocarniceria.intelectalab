<?php

namespace App\Modulos\Mae\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Mae\Services\MediosDePago;
use App\Modulos\Mae\Services\TiposDeCambio;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** MAE-03 Medios de pago y MAE-04 Comisiones por medio de pago. Reglas en Services\MediosDePago. */
class MedioPagoController extends Controller
{
    /** Cobros confirmados del mes por medio (los registra CAJ; aquí solo se leen). */
    private function cobradoDelMes(string $mes): array
    {
        return DB::table('payments')->where('status', 'CONFIRMED')
            ->whereRaw("to_char(paid_at AT TIME ZONE 'America/Lima', 'YYYY-MM') = ?", [$mes])
            ->groupBy('payment_method_id')->selectRaw('payment_method_id, count(*) as n, coalesce(sum(amount), 0) as monto')
            ->get()->keyBy('payment_method_id')->all();
    }

    public function index()
    {
        $hoy = TiposDeCambio::hoy();
        $mes = substr($hoy, 0, 7);
        $cobrado = $this->cobradoDelMes($mes);
        $entidades = DB::table('financial_institutions')->pluck('name', 'code');
        $medios = DB::table('payment_methods')->where('status', '<>', 'INTERNAL')->orderBy('sort_order')->get()->map(function ($m) use ($hoy, $cobrado, $entidades) {
            $f = MediosDePago::comisionVigente($m->id, $hoy);

            // array_merge y no «+»: con «+» quedaría el texto JSON de la base en vez de la lista de canales.
            return array_merge((array) $m, [
                'allowed_channels' => json_decode($m->allowed_channels ?? '[]', true) ?: [],
                'entidad' => $m->institution_code ? ($entidades[$m->institution_code] ?? $m->institution_code) : null,
                'comision_vigente' => $f ? ['fee_pct' => (float) $f->fee_pct, 'fee_fixed' => (float) $f->fee_fixed, 'igv_included' => (bool) $f->igv_included] : null,
                'cobros_mes' => (int) ($cobrado[$m->id]->n ?? 0), 'cobrado_mes' => (float) ($cobrado[$m->id]->monto ?? 0),
            ]);
        });
        $mp = $medios->firstWhere('system_code', 'MERCADOPAGO');

        return response()->json([
            'medios' => $medios, 'mes' => $mes,
            'cifras' => [
                'activos' => $medios->where('status', 'ACTIVE')->count(), 'total' => $medios->count(),
                'exigen_referencia' => $medios->where('requires_reference', true)->count(),
                'cobrado_mes' => round($medios->sum('cobrado_mes'), 2), 'cobros_mes' => $medios->sum('cobros_mes'),
                'comision_mp' => $mp['comision_vigente']['fee_pct'] ?? null,
            ],
            'entidades' => DB::table('financial_institutions')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['code', 'name', 'kind']),
            'canales' => MediosDePago::CANALES,
        ]);
    }

    public function update(Request $request, string $id)
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:80'], 'institution_code' => ['nullable', 'string', 'max:40'],
            'settlement_days' => ['required', 'integer', 'between:0,60'], 'allowed_channels' => ['required', 'array', 'min:1'],
            'allowed_channels.*' => [Rule::in(MediosDePago::CANALES)], 'allowed_on_delivery' => ['boolean'], 'reason' => ['required', 'string', 'min:5', 'max:255'],
        ], ['allowed_channels.required' => 'Elige al menos un canal.', 'allowed_channels.min' => 'Elige al menos un canal.']);
        MediosDePago::configurar(MediosDePago::medio($id), $d, $request->user());

        return response()->noContent();
    }

    public function estado(Request $request, string $id)
    {
        $d = $request->validate(['active' => ['required', 'boolean'], 'reason' => ['required', 'string', 'min:5', 'max:255']]);
        MediosDePago::cambiarEstado(MediosDePago::medio($id), $d['active'], $d['reason'], $request->user());

        return response()->noContent();
    }

    /** RN-MAE-04: ¿este cobro tiene los datos que exige el medio? */
    public function validar(Request $request)
    {
        $d = $request->validate(['payment_method_id' => ['required', 'uuid'], 'reference' => ['nullable', 'string', 'max:80']]);
        $m = MediosDePago::validarCobro($d['payment_method_id'], $d['reference'] ?? null);

        return response()->json(['ok' => true, 'medio' => $m->name]);
    }

    public function comisiones(Request $request)
    {
        $d = $request->validate(['payment_method_id' => ['nullable', 'uuid']]);
        $hoy = TiposDeCambio::hoy();
        $filas = DB::table('payment_method_fees as f')->join('payment_methods as m', 'm.id', '=', 'f.payment_method_id')
            ->when($d['payment_method_id'] ?? null, fn ($q, $v) => $q->where('f.payment_method_id', $v))
            ->orderBy('m.sort_order')->orderBy('f.valid_from')
            ->get(['f.id', 'f.payment_method_id', 'm.name as medio', 'f.valid_from', 'f.valid_to', 'f.fee_pct', 'f.fee_fixed', 'f.igv_included', 'f.note', 'f.created_by'])
            ->map(fn ($f) => (array) $f + ['vigencia' => $f->valid_from > $hoy ? 'PROGRAMADA' : ($f->valid_to && $f->valid_to < $hoy ? 'HISTORICA' : 'VIGENTE')]);

        return response()->json(['comisiones' => $filas, 'efectiva' => $this->efectiva(substr($hoy, 0, 7)),
            'medios' => DB::table('payment_methods')->where('status', '<>', 'INTERNAL')->orderBy('sort_order')->get(['id', 'name', 'system_code'])]);
    }

    /** KPI-MAE-02: comisión efectiva del mes por medio (cobros confirmados de CAJ). */
    private function efectiva(string $mes): array
    {
        $porMedio = [];
        DB::table('payments as p')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->where('p.status', 'CONFIRMED')
            ->whereRaw("to_char(p.paid_at AT TIME ZONE 'America/Lima', 'YYYY-MM') = ?", [$mes])
            ->orderBy('p.paid_at')->select(['p.payment_method_id', 'm.name', 'p.amount', 'p.paid_at'])
            ->each(function ($p) use (&$porMedio) {
                $c = MediosDePago::comision($p->payment_method_id, substr((string) $p->paid_at, 0, 10), (float) $p->amount);
                $porMedio[$p->payment_method_id] ??= ['medio' => $p->name, 'cobros' => 0, 'cobrado' => 0.0, 'comision' => 0.0];
                $porMedio[$p->payment_method_id]['cobros']++;
                $porMedio[$p->payment_method_id]['cobrado'] += (float) $p->amount;
                $porMedio[$p->payment_method_id]['comision'] += $c['comision'];
            });

        return array_values(array_map(fn ($r) => array_merge($r, ['cobrado' => round($r['cobrado'], 2), 'comision' => round($r['comision'], 2),
            'pct' => $r['cobrado'] ? round($r['comision'] / $r['cobrado'] * 100, 2) : 0.0]), $porMedio));
    }

    public function simular(Request $request)
    {
        $d = $request->validate(['payment_method_id' => ['required', 'uuid'], 'date' => ['required', 'date_format:Y-m-d'], 'amount' => ['required', 'numeric', 'min:0', 'max:9999999']]);
        MediosDePago::medio($d['payment_method_id']);
        $c = MediosDePago::comision($d['payment_method_id'], $d['date'], (float) $d['amount']);

        return response()->json(array_merge($c, ['fila' => $c['fila'] ? ['valid_from' => $c['fila']->valid_from, 'valid_to' => $c['fila']->valid_to,
            'igv_included' => (bool) $c['fila']->igv_included] : null]));
    }

    public function storeComision(Request $request)
    {
        $d = $request->validate([
            'payment_method_id' => ['required', 'uuid'], 'valid_from' => ['required', 'date_format:Y-m-d'], 'valid_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:valid_from'],
            'fee_pct' => ['required', 'numeric', 'between:0,20'], 'fee_fixed' => ['nullable', 'numeric', 'between:0,1000'], 'igv_included' => ['boolean'],
            'close_previous' => ['boolean'], 'note' => ['nullable', 'string', 'max:255'],
        ]);
        $f = MediosDePago::agregarComision($d, (bool) ($d['close_previous'] ?? false), $request->user());

        return response()->json(['id' => $f->id], 201);
    }
}
