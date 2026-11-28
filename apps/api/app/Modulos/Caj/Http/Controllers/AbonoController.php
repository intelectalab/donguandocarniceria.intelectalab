<?php

namespace App\Modulos\Caj\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Caj\Services\Abonos;
use App\Support\Listado;
use Illuminate\Http\Request;

/** CAJ-08 Abonos de pasarela y adquirente y CAJ-09 Conciliación pendiente. */
class AbonoController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate(['desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'],
            'estado' => ['nullable', 'in:OPEN,MATCHED,WITH_DIFFERENCE'], 'cuenta' => ['nullable', 'uuid']]);

        return response()->json(Abonos::lista($request->user(), $f));
    }

    public function show(string $id)
    {
        return response()->json(Abonos::detalle($id));
    }

    public function candidatos(Request $request)
    {
        $d = $request->validate(['cuenta' => ['required', 'uuid'], 'hasta' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Abonos::candidatos($d['cuenta'], $d['hasta'] ?? null));
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'source_account_id' => ['required', 'uuid'], 'bank_account_id' => ['required', 'uuid'], 'deposit_date' => ['required', 'date_format:Y-m-d'],
            'reference' => ['required', 'string', 'max:80'], 'gross_amount' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'fee_amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'], 'fee_igv' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'net_amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'], 'payment_ids' => ['nullable', 'array', 'max:500'], 'payment_ids.*' => ['uuid'],
        ]);

        return response()->json(Abonos::crear($d, $request->user()), 201);
    }

    public function agregar(Request $request, string $id)
    {
        $d = $request->validate(['payment_ids' => ['required', 'array', 'min:1', 'max:500'], 'payment_ids.*' => ['uuid']]);

        return response()->json(Abonos::agregar($id, $d['payment_ids'], $request->user()));
    }

    public function quitar(Request $request, string $id, string $paymentId)
    {
        return response()->json(Abonos::quitar($id, $paymentId, $request->user()));
    }

    public function cerrar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Abonos::cerrar($id, $d['reason'] ?? null, $request->user()));
    }

    public function pendientes(Request $request)
    {
        $f = $request->validate(['cuenta' => ['nullable', 'uuid'], 'alerta' => ['nullable', 'in:0,1']]);
        $p = Listado::de(Abonos::pendientes($request->user(), $f), $request, buscar: ['p.number', 'p.reference', 'cu.full_name'],
            ordenar: ['paid_at', 'amount', 'dias'], porDefecto: 'paid_at');

        return response()->json(array_merge($p->toArray(), ['resumen' => Abonos::resumenPendientes($request->user())]));
    }
}
