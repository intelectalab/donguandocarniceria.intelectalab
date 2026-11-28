<?php

namespace App\Modulos\Caj\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Caj\Services\Saldos;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAJ-10 Saldos a favor. */
class SaldoController extends Controller
{
    public function index(Request $request)
    {
        $p = Listado::de(Saldos::consulta(), $request, buscar: ['c.full_name', 'c.doc_number', 'c.phone'], ordenar: ['saldo', 'ultimo', 'full_name'], porDefecto: '-saldo');

        return response()->json(array_merge($p->toArray(), ['saldo_total' => Saldos::total(),
            'cuentas_devolucion' => DB::table('cash_accounts')->where('status', 'ACTIVE')->whereIn('account_type', ['BANK', 'WALLET'])->orderBy('code')->get(['id', 'code', 'name'])]));
    }

    public function show(string $clienteId)
    {
        return response()->json(Saldos::movimientos($clienteId));
    }

    public function usar(Request $request, string $clienteId)
    {
        $d = $request->validate(['amount' => ['required', 'numeric', 'min:0.01', 'max:999999'], 'order_id' => ['nullable', 'uuid'], 'document_id' => ['nullable', 'uuid'],
            'note' => ['nullable', 'string', 'max:120']]);

        return response()->json(Saldos::usar($clienteId, $d, $request->user()));
    }

    public function devolver(Request $request, string $clienteId)
    {
        $d = $request->validate(['amount' => ['required', 'numeric', 'min:0.01', 'max:999999'], 'refund_account_id' => ['required', 'uuid'],
            'refund_reference' => ['required', 'string', 'max:40'], 'reason' => ['required', 'string', 'max:200']]);

        return response()->json(Saldos::devolver($clienteId, $d, $request->user()));
    }
}
