<?php

namespace App\Modulos\Sus\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Sus\Services\Facturacion;
use App\Modulos\Sus\Services\Mora;
use App\Modulos\Sus\Services\Pagos;
use App\Support\Paginas;
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

        return response()->json(Facturacion::lista($f) + [
            'corridas' => Facturacion::corridas(), 'series' => Facturacion::series(),
            'emisor' => Facturacion::emisor(), 'tipos' => Facturacion::TIPOS, 'pagos' => Facturacion::PAGO, 'cifras' => Facturacion::cifras(),
            'igv' => (float) \App\Modulos\Ops\Services\Consola::param('sus_igv_rate', 0.18),
            'empresas' => \Illuminate\Support\Facades\DB::table('tenants as t')->whereExists(fn ($w) => $w->from('saas_invoices as x')->whereColumn('x.tenant_id', 't.id'))
                ->orderBy('t.short')->get(['t.id', 't.short']),
        ]);
    }

    /** Vista previa de la corrida de un período: qué se facturaría, sin grabar nada. */
    public function vistaPrevia(Request $request)
    {
        $d = $request->validate(['period' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/']], [], ['period' => 'período']);

        return response()->json(Facturacion::vistaPrevia($this->quien($request), $d['period']));
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

        return response()->json(Pagos::lista($f));
    }

    public function eventos()
    {
        return response()->json(Pagos::eventos());
    }

    public function abonos()
    {
        return response()->json(Pagos::abonos());
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
        $cola = Mora::cola();

        $ordenada = Paginas::ordenarLista($cola, ['tenant_short', 'plan_code', 'status', 'factura_numero', 'deuda', 'dias', 'proximo_reintento']);

        return response()->json(Paginas::deLista($ordenada) + ['cifras' => Mora::cifras($cola), 'ultima_corrida' => Mora::ultimaCorrida()]);
    }

    /** Corre ahora el proceso diario de mora (reintentos y cambios de estado). */
    public function procesar(Request $request)
    {
        return response()->json(Mora::ejecutar($this->quien($request)));
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
