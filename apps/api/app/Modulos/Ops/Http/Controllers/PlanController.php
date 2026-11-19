<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Planes;
use App\Modulos\Ops\Services\Suscripciones;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** SUS-09 Catálogo de planes, SUS-11 Suscripciones de clientes y OPS-04 Suspender o reactivar. */
class PlanController extends Controller
{
    private const MOTIVO = ['required', 'string', 'min:5', 'max:300'];

    public function catalogo()
    {
        return response()->json(Planes::catalogo());
    }

    public function nuevoBorrador(Request $request)
    {
        $d = $request->validate([
            'plan_code' => ['required', 'string', 'regex:/^[A-Za-z][A-Za-z0-9_]{1,19}$/'],
            'name' => ['nullable', 'string', 'min:2', 'max:40'],
            'nuevo' => ['sometimes', 'boolean'],
        ], [], ['plan_code' => 'código del plan', 'name' => 'nombre']);

        return response()->json(Planes::nuevoBorrador($d, $this->quien($request)), 201);
    }

    public function editarBorrador(Request $request, string $id)
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:40'],
            'description' => ['required', 'string', 'min:5', 'max:300'],
            'price_pen' => ['required', 'numeric', 'min:0', 'max:99999'],
            'users_max' => ['required', 'integer', 'min:1', 'max:9999'],
            'brands_max' => ['required', 'integer', 'min:1', 'max:999'],
            'sites_max' => ['required', 'integer', 'min:1', 'max:999'],
            'all_modules' => ['required', 'boolean'],
            'modules' => ['array', 'max:60'],
            'modules.*' => ['string', 'max:10'],
            'highlights' => ['array', 'max:12'],
            'highlights.*' => ['nullable', 'string', 'max:120'],
            'includes_previous' => ['nullable', 'string', 'max:80'],
            'is_featured' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:99'],
        ], [], ['name' => 'nombre', 'description' => 'descripción', 'price_pen' => 'precio', 'users_max' => 'usuarios', 'brands_max' => 'marcas',
            'sites_max' => 'locales', 'highlights' => 'lo que incluye', 'includes_previous' => 'texto de lo que incluye del plan anterior']);

        return response()->json(Planes::editarBorrador($id, $d, $this->quien($request)));
    }

    public function borrarBorrador(Request $request, string $id)
    {
        Planes::borrarBorrador($id, $this->quien($request));

        return response()->noContent();
    }

    public function publicar(Request $request, string $id)
    {
        Planes::publicar($id, $this->quien($request));

        return response()->json(Planes::catalogo());
    }

    public function retirar(Request $request, string $codigo)
    {
        $d = $request->validate(['reason' => self::MOTIVO], [], ['reason' => 'motivo']);
        Planes::retirar($codigo, trim($d['reason']), $this->quien($request));

        return response()->json(Planes::catalogo());
    }

    public function suscripciones()
    {
        return response()->json(['data' => Suscripciones::lista()]);
    }

    public function suscripcion(string $id)
    {
        return response()->json(Suscripciones::detalle($id));
    }

    public function estado(Request $request, string $id)
    {
        $d = $request->validate([
            'status' => ['required', Rule::in(array_keys(Suscripciones::TRANSICIONES))],
            'reason' => self::MOTIVO,
        ], [], ['status' => 'estado', 'reason' => 'motivo']);

        return response()->json(Suscripciones::cambiarEstado($id, $d['status'], trim($d['reason']), $this->quien($request)));
    }

    public function extender(Request $request, string $id)
    {
        $d = $request->validate(['days' => ['required', 'integer', 'min:1', 'max:30'], 'reason' => self::MOTIVO], [], ['days' => 'días', 'reason' => 'motivo']);

        return response()->json(Suscripciones::extenderPrueba($id, (int) $d['days'], trim($d['reason']), $this->quien($request)));
    }

    public function descuento(Request $request, string $id)
    {
        $d = $request->validate(['pct' => ['required', 'numeric', 'min:0', 'max:100'], 'reason' => self::MOTIVO], [], ['pct' => 'descuento', 'reason' => 'motivo']);

        return response()->json(Suscripciones::descuento($id, (float) $d['pct'], trim($d['reason']), $this->quien($request)));
    }

    private function quien(Request $request): array
    {
        return $request->attributes->get('consola_usuario');
    }
}
