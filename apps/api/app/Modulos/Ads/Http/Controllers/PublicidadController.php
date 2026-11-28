<?php

namespace App\Modulos\Ads\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ads\Services\Publicidad;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** ADS-01 a ADS-09: Cuentas publicitarias, Campañas y anuncios, Enlaces de rastreo, Importaciones, Resultados, Embudo, Facturas, Creadores y Comparativo. */
class PublicidadController extends Controller
{
    public function cuentas(Request $request)
    {
        $f = $request->validate([
            'plataforma' => ['nullable', Rule::in(array_keys(Publicidad::PLATAFORMAS))],
            'marca' => ['nullable', 'uuid'],
            'estado' => ['nullable', Rule::in(array_keys(Publicidad::ESTADOS_CUENTA))],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Publicidad::cuentas($f, $request->user()));
    }

    public function verCuenta(Request $request, string $id)
    {
        return response()->json(Publicidad::verCuenta($id, $request->user()));
    }

    public function conectarCuenta(Request $request)
    {
        $d = $request->validate([
            'platform' => ['required', Rule::in(array_keys(Publicidad::PLATAFORMAS))],
            'brand_id' => ['required', 'uuid'],
            'external_id' => ['required', 'string', 'min:3', 'max:80'],
            'name' => ['required', 'string', 'min:3', 'max:120'],
            'currency' => ['required', Rule::in(['PEN', 'USD'])],
            'timezone' => ['nullable', 'string', 'max:60'],
            'supplier_id' => ['nullable', 'uuid'],
        ], [], ['platform' => 'plataforma', 'brand_id' => 'marca', 'external_id' => 'ID externo', 'name' => 'nombre', 'currency' => 'moneda']);

        return response()->json(Publicidad::conectarCuenta($d, $request->user()), 201);
    }

    public function estadoCuenta(Request $request, string $id)
    {
        $d = $request->validate([
            'status' => ['required', Rule::in(array_keys(Publicidad::ESTADOS_CUENTA))],
        ]);

        return response()->json(Publicidad::estadoCuenta($id, $d['status'], $request->user()));
    }

    public function anuncios(Request $request)
    {
        $f = $request->validate([
            'plataforma' => ['nullable', Rule::in(array_keys(Publicidad::PLATAFORMAS))],
            'marca' => ['nullable', 'uuid'],
            'destino' => ['nullable', Rule::in(array_keys(Publicidad::DESTINOS))],
            'estado' => ['nullable', Rule::in(array_keys(Publicidad::ESTADOS_ANUNCIO))],
            'campana' => ['nullable', 'uuid'],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Publicidad::campanasYAnuncios($f, $request->user()));
    }

    public function guardarRastreo(Request $request, string $id)
    {
        $d = $request->validate([
            'destination' => ['required', Rule::in(array_keys(Publicidad::DESTINOS))],
            'is_ctwa' => ['nullable', 'boolean'],
            'channel_id' => ['nullable', 'uuid'],
            'tracking_code' => ['nullable', 'string', 'max:20'],
            'utm_source' => ['nullable', 'string', 'max:80'],
            'utm_medium' => ['nullable', 'string', 'max:80'],
            'utm_campaign' => ['nullable', 'string', 'max:120'],
            'utm_content' => ['nullable', 'string', 'max:120'],
            'landing_url' => ['nullable', 'string', 'max:500'],
            'status' => ['required', Rule::in(array_keys(Publicidad::ESTADOS_ANUNCIO))],
        ], [], ['destination' => 'destino', 'tracking_code' => 'código de rastreo', 'status' => 'estado']);

        return response()->json(Publicidad::guardarRastreo($id, $d, $request->user()));
    }

    public function importaciones(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(array_keys(Publicidad::ESTADOS_CORRIDA))],
            'cuenta' => ['nullable', 'uuid'],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Publicidad::listaImportaciones($f, $request->user()));
    }

    public function reimportar(Request $request)
    {
        $d = $request->validate([
            'account_id' => ['required', 'uuid'],
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d'],
        ], [], ['account_id' => 'cuenta', 'from' => 'desde', 'to' => 'hasta']);

        return response()->json(Publicidad::importarRango($d['account_id'], $d['from'], $d['to'], $request->user()));
    }

    public function correrImportacionDiaria(Request $request)
    {
        return response()->json(Publicidad::correrImportacionDiaria($request->user()));
    }

    public function resultados(Request $request)
    {
        $f = $request->validate([
            'desde' => ['nullable', 'date_format:Y-m-d'],
            'hasta' => ['nullable', 'date_format:Y-m-d'],
            'por' => ['nullable', Rule::in(['ad', 'campaign', 'platform'])],
            'plataforma' => ['nullable', Rule::in(array_keys(Publicidad::PLATAFORMAS))],
            'marca' => ['nullable', 'uuid'],
            'campana' => ['nullable', 'uuid'],
            'anuncio' => ['nullable', 'uuid'],
        ]);

        return response()->json(Publicidad::resultados($f, $request->user()));
    }

    public function pedidosDeResultado(Request $request)
    {
        $f = $request->validate([
            'desde' => ['nullable', 'date_format:Y-m-d'],
            'hasta' => ['nullable', 'date_format:Y-m-d'],
            'ad_id' => ['nullable', 'uuid'],
            'campaign_id' => ['nullable', 'uuid'],
        ]);

        return response()->json(Publicidad::pedidosDeResultado($f, $request->user()));
    }

    public function embudo(Request $request)
    {
        $f = $request->validate([
            'desde' => ['nullable', 'date_format:Y-m-d'],
            'hasta' => ['nullable', 'date_format:Y-m-d'],
            'marca' => ['nullable', 'uuid'],
        ]);

        return response()->json(Publicidad::embudo($f, $request->user()));
    }

    public function corregirAtribucion(Request $request, string $orderId)
    {
        $d = $request->validate([
            'ad_id' => ['nullable', 'uuid'],
            'reason' => ['required', 'string', 'min:1', 'max:255'],
        ], [], ['ad_id' => 'anuncio', 'reason' => 'motivo']);

        return response()->json(Publicidad::corregirAtribucion($orderId, $d['ad_id'] ?? null, $d['reason'], $request->user()));
    }

    public function facturas(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(array_keys(Publicidad::ESTADOS_FACTURA))],
            'cuenta' => ['nullable', 'uuid'],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Publicidad::listaFacturas($f, $request->user()));
    }

    public function registrarFactura(Request $request)
    {
        $d = $request->validate([
            'account_id' => ['required', 'uuid'],
            'invoice_number' => ['required', 'string', 'min:2', 'max:60'],
            'issue_date' => ['required', 'date_format:Y-m-d'],
            'period_from' => ['required', 'date_format:Y-m-d'],
            'period_to' => ['required', 'date_format:Y-m-d'],
            'currency' => ['required', Rule::in(['PEN', 'USD'])],
            'amount' => ['required', 'numeric', 'min:0'],
            'exchange_rate' => ['nullable', 'numeric', 'min:0.01'],
            'note' => ['nullable', 'string', 'max:500'],
            'send_to_gas' => ['nullable', 'boolean'],
        ], [], ['account_id' => 'cuenta', 'invoice_number' => 'número de factura', 'amount' => 'monto']);

        return response()->json(Publicidad::registrarFactura($d, $request->user()), 201);
    }

    public function conciliarFactura(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['nullable', 'string', 'max:500']]);

        return response()->json(Publicidad::conciliarFactura($id, $request->user(), $d['note'] ?? null));
    }

    public function enviarFacturaAGas(Request $request, string $id)
    {
        return response()->json(Publicidad::enviarFacturaAGas($id, $request->user()));
    }

    public function creadores(Request $request)
    {
        $f = $request->validate([
            'desde' => ['nullable', 'date_format:Y-m-d'],
            'hasta' => ['nullable', 'date_format:Y-m-d'],
            'marca' => ['nullable', 'uuid'],
            'estado' => ['nullable', 'string', 'max:30'],
        ]);

        return response()->json(Publicidad::creadores($f, $request->user()));
    }

    public function registrarGastoCreador(Request $request)
    {
        $d = $request->validate([
            'supplier_id' => ['required', 'uuid'],
            'ad_campaign_id' => ['required', 'uuid'],
            'doc_number' => ['required', 'string', 'min:1', 'max:20'],
            'issue_date' => ['required', 'date_format:Y-m-d'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'description' => ['nullable', 'string', 'max:500'],
        ], [], ['supplier_id' => 'creador', 'ad_campaign_id' => 'campaña', 'doc_number' => 'número de recibo', 'amount' => 'monto']);

        return response()->json(Publicidad::registrarGastoCreador($d, $request->user()), 201);
    }

    public function comparativo(Request $request)
    {
        $f = $request->validate([
            'desde' => ['nullable', 'date_format:Y-m-d'],
            'hasta' => ['nullable', 'date_format:Y-m-d'],
            'marca' => ['nullable', 'uuid'],
        ]);

        return response()->json(Publicidad::comparativo($f, $request->user()));
    }
}
