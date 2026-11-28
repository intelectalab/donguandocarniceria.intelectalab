<?php

namespace App\Modulos\Web\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Web\Services\Bandeja;
use App\Modulos\Web\Services\Base;
use App\Modulos\Web\Services\Simulador;
use App\Support\Access;
use Illuminate\Http\Request;

/** WEB-04 Bandeja de pedidos web y WEB-05 Resolver error. */
class BandejaController extends Controller
{
    public function index(Request $r)
    {
        $f = $r->validate(['store' => ['nullable', 'uuid'], 'estado' => ['nullable', 'in:RECEIVED,PROCESSED,ERROR,IGNORED'], 'origen' => ['nullable', 'in:WEBHOOK,POLL,MANUAL'],
            'error' => ['nullable', 'string', 'max:30'], 'sin_pin' => ['nullable', 'in:0,1'], 'dia' => ['nullable', 'date_format:Y-m-d'], 'q' => ['nullable', 'string', 'max:80'],
            'sort' => ['nullable', 'string', 'max:30'], 'per_page' => ['nullable', 'integer']]);
        $u = $r->user();

        return response()->json(Bandeja::lista($u, $f) + [
            'tiendas' => array_map(fn ($s) => ['id' => $s->id, 'name' => $s->name, 'status' => $s->status], Base::tiendasDe($u)),
            'estados' => Base::ESTADOS_BANDEJA, 'errores' => Base::ERRORES, 'plantillas' => Simulador::PLANTILLAS,
            'puede_resolver' => Access::can($u, 'web.inbox.resolve'), 'puede_simular' => Access::can($u, 'web.sync.run'),
        ]);
    }

    public function show(Request $r, string $id)
    {
        $u = $r->user();

        return response()->json(Bandeja::ver($id, $u) + ['puede_resolver' => Access::can($u, 'web.inbox.resolve'),
            'puede_mapear' => Access::can($u, 'web.mapping.manage')]);
    }

    public function reprocesar(Request $r, string $id)
    {
        return response()->json(Bandeja::reprocesar($id, $r->user()));
    }

    public function ignorar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Bandeja::ignorar($id, $d['reason'] ?? null, $r->user()));
    }

    public function celular(Request $r, string $id)
    {
        $d = $r->validate(['phone' => ['required', 'string', 'max:20']]);

        return response()->json(Bandeja::corregirCelular($id, $d['phone'], $r->user()));
    }

    public function pin(Request $r, string $id)
    {
        $d = $r->validate(['lat' => ['required', 'numeric', 'between:-90,90'], 'lng' => ['required', 'numeric', 'between:-180,180'],
            'address_line' => ['nullable', 'string', 'max:200'], 'district' => ['nullable', 'string', 'max:80'], 'reference' => ['nullable', 'string', 'max:200']]);

        return response()->json(Bandeja::completarPin($id, $d, $r->user()));
    }

    public function ubicacion(Request $r, string $id)
    {
        $u = $r->user();
        $ib = Bandeja::visible($id, $u);
        $res = Bandeja::usarUbicacionRecibida($ib, $u);
        abort_if($res === null, response()->json(['message' => 'El cliente todavía no envió su ubicación por el enlace.', 'code' => 'RN-WEB-07'], 422));

        return response()->json(Bandeja::ver($id, $u));
    }

    public function enlace(Request $r, string $id)
    {
        return response()->json(Bandeja::enlace($id, $r->user()));
    }

    public function ejemplo(Request $r)
    {
        $d = $r->validate(['store_id' => ['required', 'uuid'], 'plantilla' => ['required', 'string', 'max:20']]);

        return response()->json(Simulador::ejemplo($d['store_id'], $d['plantilla'], $r->user()));
    }

    public function simular(Request $r)
    {
        $d = $r->validate(['store_id' => ['required', 'uuid'], 'payload' => ['required'], 'veces' => ['nullable', 'integer', 'min:0', 'max:5'],
            'delivery_id' => ['nullable', 'string', 'max:80'], 'mismo_envio' => ['nullable', 'boolean'], 'firma_valida' => ['nullable', 'boolean']]);

        return response()->json(Simulador::pedido($d, $r->user()));
    }
}
