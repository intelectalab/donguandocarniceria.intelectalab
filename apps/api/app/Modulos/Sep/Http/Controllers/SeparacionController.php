<?php

namespace App\Modulos\Sep\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Sep\Services\Separacion;
use Illuminate\Http\Request;

/**
 * SEP · Separación de marcas (SEP-01 a SEP-12; RN-SEP-01 a 20).
 */
class SeparacionController extends Controller
{
    public function index(Request $r)
    {
        return response()->json(Separacion::listar($r->only(['brand_id', 'status', 'dest_type', 'simulation']), $r));
    }

    public function preview(Request $r)
    {
        return response()->json(Separacion::previsualizar($r->all()));
    }

    public function show(Request $r, ?string $id = null)
    {
        return response()->json(Separacion::obtener($id ?? $r->query('id')));
    }

    public function store(Request $r)
    {
        return response()->json(Separacion::crear($r->all(), $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(Separacion::actualizar($id, $r->all(), $r->user()));
    }

    public function cancelar(Request $r, string $id)
    {
        return response()->json(Separacion::cancelar($id, (string) $r->input('reason', ''), $r->user()));
    }

    public function reconstruirItems(Request $r, string $id)
    {
        Separacion::construirItems($id, true);
        Separacion::correrValidaciones($id, $r->user());

        return response()->json(Separacion::obtener($id));
    }

    public function actualizarItem(Request $r, string $itemId)
    {
        $it = Separacion::actualizarItem($itemId, $r->all(), $r->user());

        return response()->json([
            'item' => $it,
            'detail' => Separacion::obtener($it->separation_id),
        ]);
    }

    public function politicaCuentasPorCobrar(Request $r, string $id)
    {
        return response()->json(Separacion::politicaCuentasPorCobrar($id, (string) $r->input('policy', 'KEEP_ORIGIN'), $r->user()));
    }

    public function correrValidaciones(Request $r, string $id)
    {
        Separacion::correrValidaciones($id, $r->user());

        return response()->json(Separacion::obtener($id));
    }

    public function validar(Request $r, string $id)
    {
        return response()->json(Separacion::validar($id, $r->input('warn_note'), $r->user()));
    }

    public function aprobar(Request $r, string $id)
    {
        return response()->json(Separacion::aprobar($id, $r->input('note'), $r->user()));
    }

    public function ejecutar(Request $r, string $id)
    {
        return response()->json(Separacion::ejecutar($id, $r->user(), $r->only(['fail_on', 'item_id'])));
    }

    public function generarPaquete(Request $r, string $id)
    {
        $paq = Separacion::generarPaquete($id, $r->user());

        return response()->json([
            'export' => $paq,
            'detail' => Separacion::obtener($id),
        ]);
    }

    public function enlacePaquete(Request $r, string $id)
    {
        return response()->json(Separacion::enlacePaquete($id, $r->user()));
    }

    public function aprobarPaquete(Request $r, string $id)
    {
        $paq = Separacion::aprobarPaquete($id, $r->user());

        return response()->json([
            'export' => $paq,
            'detail' => Separacion::obtener($id),
        ]);
    }

    public function generarActa(Request $r, string $id)
    {
        $acta = Separacion::generarActa($id, $r->user());

        return response()->json([
            'act' => $acta,
            'detail' => Separacion::obtener($id),
        ]);
    }

    public function enlaceActa(Request $r, string $id)
    {
        return response()->json(Separacion::enlaceActa($id, $r->user()));
    }

    public function historial(Request $r)
    {
        $filtros = $r->validate([
            'brand_id' => ['nullable', 'string'],
            'period' => ['nullable', 'date_format:Y-m'],
            'from' => ['nullable', 'date_format:Y-m', 'required_with:to'],
            'to' => ['nullable', 'date_format:Y-m', 'required_with:from'],
            'all' => ['nullable', 'boolean'],
        ]);

        if (isset($filtros['from'], $filtros['to']) && $filtros['from'] > $filtros['to']) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'from' => 'El mes inicial no puede ser posterior al mes final.',
            ]);
        }

        $todoElHistorial = filter_var($filtros['all'] ?? false, FILTER_VALIDATE_BOOLEAN);
        if ($todoElHistorial && (isset($filtros['period']) || isset($filtros['from']) || isset($filtros['to']))) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'all' => 'No combines el historial completo con un período específico.',
            ]);
        }

        return response()->json(Separacion::historialMarcas(
            $filtros['brand_id'] ?? null,
            $filtros['period'] ?? null,
            $filtros['from'] ?? null,
            $filtros['to'] ?? null,
            $todoElHistorial,
        ));
    }

    public function agregarVigencia(Request $r)
    {
        return response()->json(Separacion::agregarVigencia($r->all()), 201);
    }
}
