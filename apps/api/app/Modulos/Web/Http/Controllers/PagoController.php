<?php

namespace App\Modulos\Web\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Web\Services\Base;
use App\Modulos\Web\Services\Pagos;
use App\Modulos\Web\Services\Simulador;
use App\Support\Access;
use Illuminate\Http\Request;

/** WEB-06 Pagos de la pasarela. */
class PagoController extends Controller
{
    public function index(Request $r)
    {
        $f = $r->validate(['tienda' => ['nullable', 'uuid'], 'estado' => ['nullable', 'string', 'max:20'], 'conciliacion' => ['nullable', 'string', 'max:20'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'], 'q' => ['nullable', 'string', 'max:80'], 'per_page' => ['nullable', 'integer']]);
        $u = $r->user();

        return response()->json(Pagos::lista($u, $f) + [
            'tiendas' => array_map(fn ($s) => ['id' => $s->id, 'name' => $s->name, 'status' => $s->status], Base::tiendasDe($u)),
            'estados' => Base::ESTADOS_PAGO, 'conciliaciones' => Pagos::CONCILIACION, 'detalles' => Base::MP_DETALLE,
            'puede_simular' => Access::can($u, 'web.sync.run'), 'puede_conciliar' => Access::module($u, 'CAJ', 'E') || Access::module($u, 'CAJ', 'C'),
        ]);
    }

    public function show(Request $r, string $id)
    {
        $u = $r->user();

        return response()->json(Pagos::ver($id, $u) + ['puede_nota' => Access::can($u, 'fac.credit_note.issue')]);
    }

    public function cobrar(Request $r, string $id)
    {
        $d = $r->validate(['amount' => ['required', 'numeric', 'min:0.01', 'max:999999']]);
        Pagos::confirmar($id, (float) $d['amount'], $r->user());

        return response()->json(Pagos::ver($id, $r->user()));
    }

    public function avisar(Request $r, string $id)
    {
        return response()->json(Pagos::avisoCliente($id, $r->user()));
    }

    public function simular(Request $r)
    {
        $d = $r->validate(['store_id' => ['required', 'uuid'], 'status' => ['required', 'string', 'max:20'], 'payment_id' => ['nullable', 'string', 'max:40'],
            'external_reference' => ['nullable', 'string', 'max:40'], 'amount' => ['nullable', 'numeric', 'min:0.01', 'max:999999'],
            'method' => ['nullable', 'in:visa,master,amex,debvisa,yape,pagoefectivo_atm'], 'firma_valida' => ['nullable', 'boolean']]);

        return response()->json(Simulador::pago($d, $r->user()));
    }
}
