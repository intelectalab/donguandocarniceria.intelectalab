<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Accesos;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** OPS-05 Solicitar acceso de soporte y OPS-06 Sesión de soporte, desde la consola. */
class AccesoConsolaController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in([...array_keys(Accesos::ESTADOS), 'ABIERTOS'])],
            'tenant' => ['nullable', 'uuid'],
        ]);

        return response()->json(['data' => Accesos::listaConsola($f), 'estados' => Accesos::ESTADOS]);
    }

    public function opciones(Request $request)
    {
        $d = $request->validate(['tenant' => ['nullable', 'uuid']]);

        return response()->json(Accesos::opciones($d['tenant'] ?? null));
    }

    public function show(string $id)
    {
        return response()->json(Accesos::verConsola($id));
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'tenant_id' => ['required', 'uuid'],
            'ticket_id' => ['nullable', 'uuid'],
            'reason' => ['required', 'string', 'min:10', 'max:1000'],
            'level' => ['required', Rule::in(array_keys(Accesos::NIVELES))],
            'modules' => ['present', 'array', 'max:60'],
            'modules.*' => ['string', 'regex:/^[A-Z]{3}$/'],
            'can_export' => ['required', 'boolean'],
            'hours' => ['required', 'integer', 'min:1', 'max:999'],
        ], [], ['tenant_id' => 'empresa', 'reason' => 'motivo', 'level' => 'nivel', 'modules' => 'módulos', 'hours' => 'horas']);

        return response()->json(Accesos::solicitar($this->quien($request), $d), 201);
    }

    public function cancelar(Request $request, string $id)
    {
        return response()->json(Accesos::cancelar($id, $this->quien($request)));
    }

    public function terminar(Request $request, string $id)
    {
        return response()->json(Accesos::terminar($id, $this->quien($request)));
    }

    public function entrar(Request $request, string $id)
    {
        return response()->json(Accesos::entrar($id, $this->quien($request), $request));
    }

    private function quien(Request $request): array
    {
        return $request->attributes->get('consola_usuario');
    }
}
