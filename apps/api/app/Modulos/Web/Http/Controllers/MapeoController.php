<?php

namespace App\Modulos\Web\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Web\Services\Mapeos;
use App\Support\Access;
use Illuminate\Http\Request;

/** WEB-02 Mapeo de productos y WEB-08 Stock publicado. */
class MapeoController extends Controller
{
    public function index(Request $r)
    {
        $f = $r->validate(['store' => ['nullable', 'uuid'], 'estado' => ['nullable', 'in:LINKED,UNLINKED,ERROR'], 'marca' => ['nullable', 'uuid'],
            'problema' => ['nullable', 'in:SI,NO'], 'q' => ['nullable', 'string', 'max:80'], 'sort' => ['nullable', 'string', 'max:30'], 'per_page' => ['nullable', 'integer']]);

        return response()->json(Mapeos::lista($r->user(), $f) + ['puede_editar' => Access::can($r->user(), 'web.mapping.manage')]);
    }

    public function show(Request $r, string $id)
    {
        return response()->json(Mapeos::ver($id, $r->user()) + ['puede_editar' => Access::can($r->user(), 'web.mapping.manage')]);
    }

    public function variantes(Request $r)
    {
        $f = $r->validate(['store' => ['nullable', 'uuid']]);

        return response()->json(Mapeos::variantes($r->user(), $f['store'] ?? null));
    }

    public function vincular(Request $r)
    {
        $d = $r->validate(['store_id' => ['required', 'uuid'], 'sku' => ['required', 'string', 'max:60'], 'variant_id' => ['required', 'uuid'], 'note' => ['nullable', 'string', 'max:255']]);

        return response()->json(Mapeos::vincular($d['store_id'], $d['sku'], $d['variant_id'], $d['note'] ?? null, $r->user()));
    }

    public function desvincular(Request $r, string $id)
    {
        $d = $r->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Mapeos::desvincular($id, $d['reason'] ?? null, $r->user()));
    }

    public function publicar(Request $r, string $id)
    {
        $d = $r->validate(['publish' => ['required', 'boolean']]);

        return response()->json(Mapeos::publicar($id, (bool) $d['publish'], $r->user()));
    }

    public function crear(Request $r)
    {
        $d = $r->validate(['store_id' => ['required', 'uuid'], 'variant_id' => ['required', 'uuid']]);

        return response()->json(Mapeos::crearEnWeb($d['store_id'], $d['variant_id'], $r->user()), 201);
    }

    public function stock(Request $r)
    {
        $f = $r->validate(['store' => ['nullable', 'uuid'], 'situacion' => ['nullable', 'in:AGOTADO,POR_ENVIAR,AL_DIA'], 'marca' => ['nullable', 'uuid'],
            'q' => ['nullable', 'string', 'max:80'], 'sort' => ['nullable', 'string', 'max:30'], 'per_page' => ['nullable', 'integer']]);

        return response()->json(Mapeos::stock($r->user(), $f) + ['puede_sincronizar' => Access::can($r->user(), 'web.sync.run')]);
    }

    public function stockDe(Request $r, string $id)
    {
        return response()->json(Mapeos::stockDe($id, $r->user()));
    }
}
