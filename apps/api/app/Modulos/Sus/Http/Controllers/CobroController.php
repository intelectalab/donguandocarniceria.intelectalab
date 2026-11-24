<?php

namespace App\Modulos\Sus\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Sus\Services\Facturacion;
use App\Modulos\Sus\Services\Mora;
use App\Modulos\Sus\Services\Pagos;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Consola: SUS-12 Facturación del SaaS, SUS-13 Cobros y conciliación y SUS-14 Mora. */
class CobroController extends Controller
{
    /* ------------------------------------------------------------------ SUS-12 */

    public function facturacion(Request $request)
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in(['DRAFT', 'ISSUED'])],
            'payment_status' => ['nullable', Rule::in(array_keys(Facturacion::PAGO))],
            'doc_type' => ['nullable', Rule::in(array_keys(Facturacion::TIPOS))],
            'tenant' => ['nullable', 'uuid'],
            'period' => ['nullable', 'regex:/^\d{4}-\d{2}$/'],
        ]);

        return response()->json([
            'data' => Facturacion::lista($f), 'corridas' => Facturacion::corridas(), 'series' => Facturacion::series(),
            'emisor' => Facturacion::emisor(), 'tipos' => Facturacion::TIPOS, 'pagos' => Facturacion::PAGO,
        ]);
    }

    public function comprobante(string $id)
    {
        return response()->json(Facturacion::ver($id));
    }

    public function corrida(Request $request)
    {
        $d = $request->validate(['period' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/']], [], ['period' => 'período']);

        return response()->json(Facturacion::corrida($this->quien($request), $d['period']), 201);
    }

    public function emitir(Request $request, string $id)
    {
        return response()->json(Facturacion::emitir($id, $this->quien($request)));
    }

    public function borrar(Request $request, string $id)
    {
        Facturacion::borrarBorrador($id, $this->quien($request));

        return response()->noContent();
    }

    public function notaCredito(Request $request, string $id)
    {
        $d = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01', 'max:999999'],
            'reason' => ['required', 'string', 'min:5', 'max:300'],
        ], [], ['amount' => 'monto', 'reason' => 'motivo']);

        return response()->json(Facturacion::notaCredito($id, $this->quien($request), (float) $d['amount'], $d['reason']));
    }

    public function cobrar(Request $request, string $id)
    {
        return response()->json(Pagos::cobrar($id, 'CONSOLE', $this->quien($request)));
    }

    /* ------------------------------------------------------------------ SUS-13 */

    public function cobros(Request $request)
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in(array_keys(Pagos::ESTADOS))],
            'tenant' => ['nullable', 'uuid'],
            'conciliado' => ['nullable', Rule::in(['0', '1'])],
        ]);

        return response()->json(['data' => Pagos::lista($f), 'eventos' => Pagos::eventos(), 'abonos' => Pagos::abonos()]);
    }

    public function conciliar(Request $request)
    {
        $d = $request->validate([
            'payments' => ['required', 'array', 'min:1', 'max:500'], 'payments.*' => ['uuid'],
            'reference' => ['required', 'string', 'min:3', 'max:80'],
            'settled_on' => ['required', 'date', 'before_or_equal:today'],
            'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999'],
        ], [], ['payments' => 'cobros', 'reference' => 'referencia del abono', 'settled_on' => 'fecha del abono', 'amount' => 'monto abonado']);

        return response()->json(Pagos::conciliar($this->quien($request), $d), 201);
    }

    /* ------------------------------------------------------------------ SUS-14 */

    public function mora()
    {
        return response()->json(['data' => Mora::cola()]);
    }

    public function recordatorio(Request $request, string $sub)
    {
        Mora::recordatorio($sub, $this->quien($request));

        return response()->noContent();
    }

    public function prorroga(Request $request, string $sub)
    {
        $d = $request->validate([
            'until' => ['required', 'date'],
            'reason' => ['required', 'string', 'min:5', 'max:300'],
        ], [], ['until' => 'hasta', 'reason' => 'motivo']);
        Mora::prorroga($sub, $this->quien($request), $d['until'], $d['reason']);

        return response()->noContent();
    }

    public function cobrarAhora(Request $request, string $sub)
    {
        return response()->json(Mora::cobrarAhora($sub, $this->quien($request)));
    }

    private function quien(Request $request): array
    {
        return $request->attributes->get('consola_usuario');
    }
}
