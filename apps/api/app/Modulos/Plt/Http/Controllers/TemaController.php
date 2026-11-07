<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Services\Temas;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** PLT-06 Colores: el tema de la empresa y el de cada marca, con su contraste y sus versiones. */
class TemaController extends Controller
{
    /**
     * Para la marca pedida (?brand_id=, vacío = la empresa): el tema que rige, si es propio, sus
     * versiones y lo necesario para la pantalla (marcas, colores, pares y contraste mínimo).
     */
    public function index(Request $request)
    {
        $request->validate(['brand_id' => ['nullable', 'uuid', Rule::exists('brands', 'id')]]);
        $marca = $request->query('brand_id') ?: null;
        $propio = Temas::propio($marca);
        $vigente = $propio ?? Temas::vigente($marca);

        $conPropio = DB::table('ui_themes')->where('status', 'ACTIVE')->whereNotNull('brand_id')->pluck('brand_id')->all();
        $marcas = DB::table('brands')->orderBy('sort_order')->get(['id', 'code', 'name', 'primary_color', 'status', 'legal_footer'])
            ->map(fn ($b) => (array) $b + ['propio' => in_array($b->id, $conPropio, true)]);

        $versiones = DB::table('ui_themes')->where(fn ($q) => $marca ? $q->where('brand_id', $marca) : $q->whereNull('brand_id'))
            // A igual hora, la activa primero.
            ->orderByDesc('created_at')->orderByRaw("status = 'ACTIVE' desc")->get(['id', 'name', 'light', 'status', 'changed_by', 'created_at'])
            ->map(fn ($t) => ['id' => $t->id, 'name' => $t->name, 'primary' => json_decode($t->light, true)['primary'] ?? null,
                'status' => $t->status, 'changed_by' => $t->changed_by, 'created_at' => $t->created_at]);

        return response()->json([
            'tema' => $vigente,
            'propio' => (bool) $propio,
            'marcas' => $marcas,
            'versiones' => $versiones,
            'colores' => Temas::COLORES,
            'pares' => array_map(fn ($p) => ['texto' => $p[0], 'fondo' => $p[1], 'nombre' => $p[2]], Temas::PARES),
            'minimo' => Temas::minimo(),
        ]);
    }

    public function guardar(Request $request)
    {
        $datos = $request->validate([
            'brand_id' => ['nullable', 'uuid', Rule::exists('brands', 'id')],
            'light' => ['required', 'array'],
            'dark' => ['required', 'array'],
            'name' => ['nullable', 'string', 'max:80'],
        ]);

        return response()->json(Temas::guardar($datos['brand_id'] ?? null, $datos['light'], $datos['dark'], $request->user(), $datos['name'] ?? null), 201);
    }

    public function quitar(Request $request)
    {
        $datos = $request->validate(['brand_id' => ['required', 'uuid', Rule::exists('brands', 'id')]]);
        Temas::quitar($datos['brand_id']);

        return response()->json(['ok' => true]);
    }
}
