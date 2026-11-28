<?php

namespace App\Modulos\Onb\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Onb\Services\Asistente;
use App\Modulos\Onb\Services\Importador;
use Illuminate\Http\Request;

/**
 * ONB · Asistente de alta de empresas, plantillas por rubro e importadores (ONB-02 a ONB-15).
 */
class AsistenteController extends Controller
{
    /* ------------------------------------------------------------------ ONB-02 Lista de pasos */

    public function pasos()
    {
        return response()->json(Asistente::estadoGeneral());
    }

    public function completarPaso(Request $request, string $code)
    {
        return response()->json(Asistente::completarPaso(strtoupper($code), $request->user()));
    }

    public function omitirPaso(Request $request, string $code)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Asistente::omitirPaso(strtoupper($code), $d['reason'] ?? null, $request->user()));
    }

    public function cambiarObligatorio(Request $request, string $code)
    {
        $d = $request->validate(['is_required' => ['required', 'boolean']]);

        return response()->json(Asistente::cambiarObligatorio(strtoupper($code), (bool) $d['is_required']));
    }

    /* ------------------------------------------------------------------ ONB-03 Empresa */

    public function verEmpresa()
    {
        return response()->json(Asistente::verEmpresa());
    }

    public function guardarEmpresa(Request $request)
    {
        $d = $request->validate([
            'trade_name' => ['required', 'string', 'max:40'],
            'fiscal_address' => ['required', 'string', 'max:255'],
            'fiscal_ubigeo' => ['nullable', 'string', 'max:20'],
            'tax_regime' => ['nullable', 'string', 'max:20'],
            'logo_url' => ['nullable', 'string', 'max:40'],
            'primary_color' => ['nullable', 'string', 'max:20'],
            'secondary_color' => ['nullable', 'string', 'max:20'],
        ]);

        return response()->json(Asistente::guardarEmpresa($d, $request->user()));
    }

    /* ------------------------------------------------------------------ ONB-04 Marcas */

    public function verMarcas()
    {
        return response()->json(Asistente::verMarcas());
    }

    public function crearMarca(Request $request)
    {
        $d = $request->validate([
            'code' => ['required', 'string', 'max:10'],
            'name' => ['required', 'string', 'max:40'],
            'color' => ['nullable', 'string', 'max:20'],
            'wa_name' => ['nullable', 'string', 'max:40'],
            'logo_url' => ['nullable', 'string', 'max:40'],
            'description' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json(Asistente::crearMarca($d, $request->user()), 201);
    }

    /* ------------------------------------------------------------------ ONB-05 Locales y almacenes */

    public function verLocales()
    {
        return response()->json(Asistente::verLocalesYAlmacenes());
    }

    public function crearLocal(Request $request)
    {
        $d = $request->validate([
            'code' => ['required', 'string', 'max:20'],
            'name' => ['required', 'string', 'max:80'],
            'short' => ['nullable', 'string', 'max:80'],
            'sunat_code' => ['required', 'string', 'max:10'],
            'est_type' => ['nullable', 'string', 'max:40'],
            'address' => ['nullable', 'string', 'max:80'],
            'has_counter' => ['nullable', 'boolean'],
        ]);

        return response()->json(Asistente::crearLocal($d, $request->user()), 201);
    }

    public function crearAlmacen(Request $request)
    {
        $d = $request->validate([
            'establishment_id' => ['required', 'uuid'],
            'code' => ['required', 'string', 'max:40'],
            'name' => ['required', 'string', 'max:80'],
            'wh_type' => ['nullable', 'string', 'max:40'],
            'min_temp_c' => ['nullable'],
            'max_temp_c' => ['nullable'],
            'pick_priority' => ['nullable', 'integer'],
        ]);

        return response()->json(Asistente::crearAlmacen($d, $request->user()), 201);
    }

    /* ------------------------------------------------------------------ ONB-06 Series y OSE */

    public function verSeries()
    {
        return response()->json(Asistente::verSeriesYOse());
    }

    public function proponerSeries(Request $request)
    {
        $d = $request->validate(['mode' => ['nullable', 'in:BRAND,COMPANY']]);

        return response()->json(Asistente::proponerSeries($d['mode'] ?? 'BRAND', $request->user()));
    }

    public function fijarCorrelativo(Request $request, string $series)
    {
        $d = $request->validate(['last_number' => ['required', 'integer']]);

        return response()->json(Asistente::fijarUltimoCorrelativo($series, (int) $d['last_number']));
    }

    public function probarOse(Request $request)
    {
        $d = $request->validate([
            'provider' => ['required', 'string', 'max:40'],
            'user' => ['required', 'string', 'max:40'],
            'secret' => ['required', 'string', 'max:120'],
        ]);

        return response()->json(Asistente::probarOse($d, $request->user()));
    }

    /* ------------------------------------------------------------------ ONB-07 Medios de pago y cajas */

    public function verPagos()
    {
        return response()->json(Asistente::verPagosYCajas());
    }

    public function guardarPagos(Request $request)
    {
        $d = $request->validate([
            'codes' => ['required', 'array'],
            'codes.*' => ['string', 'max:20'],
            'cash_boxes' => ['nullable', 'array'],
        ]);

        return response()->json(Asistente::guardarPagosYCajas($d['codes'], $d['cash_boxes'] ?? [], $request->user()));
    }

    /* ------------------------------------------------------------------ ONB-08 WhatsApp */

    public function verWhatsapp()
    {
        return response()->json(Asistente::verWhatsapp());
    }

    public function conectarWhatsapp(Request $request)
    {
        $d = $request->validate([
            'number' => ['required', 'string', 'max:25'],
            'display_name' => ['nullable', 'string', 'max:80'],
            'brand_id' => ['nullable', 'uuid'],
            'shared' => ['nullable', 'boolean'],
            'coexistence' => ['nullable', 'boolean'],
        ]);

        return response()->json(Asistente::conectarWhatsapp($d, $request->user()), 201);
    }

    /* ------------------------------------------------------------------ ONB-09 Zonas de reparto */

    public function verZonas()
    {
        return response()->json(Asistente::verZonas());
    }

    public function crearZona(Request $request)
    {
        $d = $request->validate([
            'code' => ['required', 'string', 'max:40'],
            'name' => ['required', 'string', 'max:80'],
            'establishment_id' => ['required', 'uuid'],
            'districts' => ['required'],
            'delivery_fee' => ['nullable', 'numeric'],
            'free_from_units' => ['nullable', 'integer'],
            'free_from_kg' => ['nullable', 'numeric'],
            'min_order_amount' => ['nullable', 'numeric'],
            'province' => ['nullable', 'boolean'],
        ]);

        return response()->json(Asistente::crearZona($d, $request->user()), 201);
    }

    /* ------------------------------------------------------------------ ONB-10 Plantilla por rubro */

    public function verPlantillas(Request $request)
    {
        return response()->json(Asistente::verPlantillas($request->query('code')));
    }

    public function aplicarPlantilla(Request $request)
    {
        $d = $request->validate([
            'template_code' => ['required', 'string', 'max:40'],
            'brand_id' => ['required', 'uuid'],
        ]);

        return response()->json(Asistente::aplicarPlantilla($d['template_code'], $d['brand_id'], $request->user()), 201);
    }

    /* ------------------------------------------------------------------ ONB-11, ONB-12 y ONB-13 Importadores */

    public function catalogoImportador()
    {
        return response()->json(Importador::catalogoImportador());
    }

    public function plantillaCsv(string $type)
    {
        return response()->json([
            'type' => strtoupper($type),
            'file_name' => 'plantilla-'.strtolower($type).'.csv',
            'csv' => Importador::plantillaCsv(strtoupper($type)),
        ]);
    }

    public function ejemploCsv(Request $request, string $type)
    {
        return response()->json([
            'type' => strtoupper($type),
            'file_name' => 'ejemplo-'.strtolower($type).'.csv',
            'csv' => Importador::ejemploCsv(strtoupper($type), $request->all()),
        ]);
    }

    public function crearImportacion(Request $request)
    {
        $d = $request->validate([
            'type' => ['required', 'string', 'max:30'],
            'content' => ['required', 'string'],
            'file_name' => ['nullable', 'string', 'max:160'],
            'mode' => ['nullable', 'in:INSERT_ONLY,UPSERT'],
            'brand_id' => ['nullable', 'uuid'],
            'warehouse_id' => ['nullable', 'uuid'],
            'company_id' => ['nullable', 'uuid'],
            'cutover_date' => ['nullable', 'date'],
            'map' => ['nullable', 'array'],
        ]);

        return response()->json(Importador::crearYValidar($d, $request->user()), 201);
    }

    public function verImportacion(Request $request, string $id)
    {
        return response()->json(Importador::ver($id, $request->query('status')));
    }

    public function revalidarImportacion(string $id)
    {
        return response()->json(Importador::validar($id));
    }

    public function ejecutarImportacion(Request $request, string $id)
    {
        $d = $request->validate([
            'allow_partial' => ['nullable', 'boolean'],
            'fail_at_row' => ['nullable', 'integer'],
        ]);

        return response()->json(Importador::ejecutar($id, $d, $request->user()));
    }

    public function cancelarImportacion(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:300']]);

        return response()->json(Importador::cancelar($id, $d['reason'] ?? null, $request->user()));
    }

    public function revertirImportacion(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:300']]);

        return response()->json(Importador::revertir($id, $d['reason'], $request->user()));
    }

    public function liberarStockInicial(Request $request, string $id)
    {
        return response()->json(Importador::liberarStockInicial($id, $request->user()));
    }

    public function archivoErrores(string $id)
    {
        return response()->json(Importador::archivoErrores($id));
    }

    /* ------------------------------------------------------------------ ONB-14 Usuarios e invitaciones */

    public function verUsuarios()
    {
        return response()->json(Asistente::verUsuarios());
    }

    public function invitarUsuario(Request $request)
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'email' => ['required', 'email', 'max:120'],
            'role' => ['required', 'string', 'max:40'],
            'brands' => ['nullable', 'array'],
            'brands.*' => ['uuid'],
            'sites' => ['nullable', 'array'],
            'sites.*' => ['uuid'],
        ]);

        return response()->json(Asistente::invitarUsuario($d, $request->user()), 201);
    }

    public function aceptarInvitacion(Request $request, string $id)
    {
        $d = $request->validate(['with_mfa' => ['nullable', 'boolean']]);

        return response()->json(Asistente::aceptarInvitacionSimulada($id, (bool) ($d['with_mfa'] ?? true)));
    }

    /* ------------------------------------------------------------------ ONB-15 Salida a producción */

    public function emitirPrimerComprobante(Request $request)
    {
        $d = $request->validate([
            'series' => ['nullable', 'string', 'max:20'],
            'description' => ['nullable', 'string', 'max:200'],
            'amount' => ['nullable', 'numeric', 'min:1'],
            'date' => ['nullable', 'date'],
        ]);

        return response()->json(Asistente::emitirPrimerComprobante($d, $request->user()), 201);
    }

    public function salirAProduccion(Request $request)
    {
        $d = $request->validate(['date' => ['nullable', 'date']]);

        return response()->json(Asistente::salirAProduccion($d['date'] ?? null, $request->user()));
    }
}
