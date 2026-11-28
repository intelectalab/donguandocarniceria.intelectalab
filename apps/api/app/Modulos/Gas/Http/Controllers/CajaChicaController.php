<?php

namespace App\Modulos\Gas\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Gas\Services\CajaChica;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** GAS-07 Caja chica y GAS-08 Rendición de caja chica. */
class CajaChicaController extends Controller
{
    public function index(Request $request)
    {
        $u = $request->user();
        $gestiona = CajaChica::gestiona($u);

        return response()->json([
            'fondos' => CajaChica::fondos($u), 'gestiona' => $gestiona,
            'responsables' => $gestiona ? CajaChica::personal()->orderBy('name')->get(['id', 'name']) : [],
            'cuentas' => $gestiona ? DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', 'PETTY_CASH')->orderBy('name')->get(['id', 'name', 'establishment_id']) : [],
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name']),
        ]);
    }

    private function datos(Request $request): array
    {
        return $request->validate(['establishment_id' => ['required', 'uuid'], 'custodian_user_id' => ['required', 'uuid'], 'fund_amount' => ['required', 'numeric', 'min:0', 'max:999999'],
            'max_expense_amount' => ['required', 'numeric', 'min:0', 'max:999999'], 'cash_account_id' => ['nullable', 'uuid'], 'status' => ['nullable', 'in:ACTIVE,INACTIVE']]);
    }

    public function store(Request $request)
    {
        return response()->json(CajaChica::guardarFondo($this->datos($request), $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        return response()->json(CajaChica::guardarFondo($this->datos($request), $request->user(), $id));
    }

    public function rendiciones(Request $request)
    {
        $f = $request->validate(['fondo' => ['nullable', 'uuid']]);

        return response()->json(CajaChica::rendiciones($request->user(), $f['fondo'] ?? null));
    }

    public function rendicion(Request $request, string $id)
    {
        return response()->json(CajaChica::rendicionFicha($id, $request->user()));
    }

    public function enviar(Request $request, string $id)
    {
        CajaChica::enviar($id, $request->user());

        return response()->json(CajaChica::rendicionFicha($id, $request->user()));
    }

    public function aprobar(Request $request, string $id)
    {
        CajaChica::aprobar($id, $request->user());

        return response()->json(CajaChica::rendicionFicha($id, $request->user()));
    }

    public function devolver(Request $request, string $id)
    {
        $d = $request->validate(['motivo' => ['required', 'string', 'max:255']]);
        CajaChica::devolver($id, $d['motivo'], $request->user());

        return response()->json(CajaChica::rendicionFicha($id, $request->user()));
    }

    public function reponer(Request $request, string $id)
    {
        $d = $request->validate(['cash_account_id' => ['required', 'uuid']]);
        CajaChica::reponer($id, $d['cash_account_id'], $request->user());

        return response()->json(CajaChica::rendicionFicha($id, $request->user()));
    }
}
