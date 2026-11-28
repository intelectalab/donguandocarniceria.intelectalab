<?php

namespace App\Modulos\Caj\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Caj\Services\Base;
use App\Modulos\Caj\Services\Cuentas;
use App\Support\Access;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAJ-01 Cuentas. */
class CuentaController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate(['tipo' => ['nullable', 'string', 'max:20'], 'estado' => ['nullable', 'in:ACTIVE,INACTIVE']]);
        $u = $request->user();
        $filas = Cuentas::lista($u, $f);
        // Los datos de pago completos (QR, número, CCI) solo se muestran a quien administra las cuentas.
        if (! Access::can($u, 'caj.account.manage')) {
            $filas = $filas->map(function ($c) {
                $c->qr_payload = null;
                $c->cci = $c->cci ? '••••'.substr((string) $c->cci, -4) : null;
                $c->account_number = $c->account_number && $c->account_type === 'BANK' ? '••••'.substr((string) $c->account_number, -4) : $c->account_number;

                return $c;
            });
        }

        return response()->json([
            'cuentas' => $filas, 'tipos' => Base::TIPOS, 'puede_editar' => Access::can($u, 'caj.account.manage'),
            'total' => Base::r($filas->where('status', 'ACTIVE')->sum('saldo')),
        ]);
    }

    public function opciones()
    {
        return response()->json([
            'tipos' => collect(Base::TIPOS)->except('DRIVER_CASH')->map(fn ($n, $k) => ['value' => $k, 'label' => $n])->values(),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
        ]);
    }

    public function store(Request $request)
    {
        return response()->json(Cuentas::guardar(null, $this->datos($request), $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        return response()->json(Cuentas::guardar($id, $this->datos($request), $request->user()));
    }

    public function movimientos(Request $request, string $id)
    {
        $d = $request->validate(['desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d']]);
        $c = DB::table('cash_accounts')->where('id', $id)->first(['id', 'code', 'name', 'account_type', 'establishment_id']) ?? abort(404, 'No se encontró la cuenta.');
        $l = Base::locales($request->user());
        if ($l && $c->establishment_id && ! in_array($c->establishment_id, $l, true)) {
            abort(404, 'No se encontró la cuenta.');
        }
        $desde = $d['desde'] ?? CarbonImmutable::parse(Base::hoy())->subDays(14)->toDateString();

        return response()->json(['cuenta' => $c, 'saldo' => Cuentas::saldos([$id])[$id] ?? null] + Cuentas::movimientos($id, $desde, $d['hasta'] ?? Base::hoy()));
    }

    private function datos(Request $request): array
    {
        return $request->validate([
            'code' => ['sometimes', 'nullable', 'string', 'max:40'], 'name' => ['sometimes', 'nullable', 'string', 'max:80'],
            'account_type' => ['sometimes', 'nullable', 'string', 'max:20'], 'establishment_id' => ['sometimes', 'nullable', 'uuid'], 'brand_id' => ['sometimes', 'nullable', 'uuid'],
            'bank_name' => ['sometimes', 'nullable', 'string', 'max:40'], 'account_number' => ['sometimes', 'nullable', 'string', 'max:40'], 'cci' => ['sometimes', 'nullable', 'string', 'max:80'],
            'holder_name' => ['sometimes', 'nullable', 'string', 'max:80'], 'qr_payload' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'payment_link_base' => ['sometimes', 'nullable', 'string', 'max:255'], 'fee_pct' => ['sometimes', 'nullable', 'numeric'], 'fee_fixed' => ['sometimes', 'nullable', 'numeric'],
            'settlement_days' => ['sometimes', 'nullable', 'integer'], 'opening_balance' => ['sometimes', 'nullable', 'numeric', 'min:-99999999', 'max:99999999'],
            'max_balance' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:99999999'], 'status' => ['sometimes', 'nullable', 'in:ACTIVE,INACTIVE'],
        ]);
    }
}
