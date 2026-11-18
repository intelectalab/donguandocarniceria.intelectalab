<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Services\Celulares;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Cli\Services\Direcciones;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * PED-02: el cliente del pedido sin salir del formulario. Busca por celular (como sea que se
 * escriba), da de alta rápido y agrega la dirección con pin, con los servicios de CLI
 * (Clientes::buscarPorCelular, altaRapida y Direcciones::guardar).
 */
class ClienteController extends Controller
{
    public function buscar(Request $request)
    {
        $d = $request->validate(['q' => ['required', 'string', 'min:3', 'max:60']]);
        $texto = trim($d['q']);
        $exacto = Clientes::buscarPorCelular($texto);
        $digitos = preg_replace('/\D/', '', $texto);
        $q = DB::table('customers')->whereNull('merged_into_id')->where('status', '<>', 'INACTIVE');
        if (strlen($digitos) >= 6 && preg_match('/^[\d\s+().-]+$/', $texto)) {
            $q->where(fn ($w) => $w->where('phone', 'like', "%{$digitos}%")->orWhere('phone_alt', 'like', "%{$digitos}%")->orWhere('doc_number', 'like', "%{$digitos}%"));
        } else {
            $p = '%'.addcslashes(mb_strtolower($texto), '%_\\').'%';
            $q->where(fn ($w) => $w->whereRaw("translate(lower(full_name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", [$p])
                ->orWhereRaw('lower(coalesce(trade_name, \'\')) like ?', [$p]));
        }
        $filas = $q->orderBy('full_name')->limit(8)->get(['id', 'full_name', 'trade_name', 'phone', 'doc_type', 'doc_number', 'customer_type', 'status', 'blocked_reason']);

        return response()->json(['exacto' => $exacto?->only(['id']), 'normalizado' => Celulares::normalizar($texto), 'filas' => $filas]);
    }

    public function show(string $id)
    {
        $c = Customer::findOrFail($id);

        return response()->json([
            'cliente' => $c->only(['id', 'full_name', 'trade_name', 'phone', 'phone_alt', 'doc_type', 'doc_number', 'customer_type', 'status', 'blocked_reason', 'merged_into_id']),
            'bloqueo' => Clientes::puedeComprar($c),
            'saldo' => Clientes::saldo($c->id),
            'direcciones' => DB::table('customer_addresses as a')->leftJoin('delivery_zones as z', 'z.id', '=', 'a.zone_id')
                ->where('a.customer_id', $id)->where('a.status', 'ACTIVE')->orderByDesc('a.is_default')->orderByDesc('a.last_used_at')
                ->get(['a.id', 'a.label', 'a.address_line', 'a.district', 'a.reference', 'a.lat', 'a.lng', 'a.zone_id', 'a.is_default', 'a.needs_pin',
                    'a.out_of_coverage', 'z.name as zona', 'z.establishment_id', 'z.province']),
        ]);
    }

    /** CA-CLI-01 desde el pedido: si el celular ya existe, devuelve ese cliente. */
    public function rapida(Request $request)
    {
        $d = $request->validate([
            'phone' => ['required', 'string', 'max:30'], 'full_name' => ['required', 'string', 'max:255'],
            'customer_type' => ['nullable', 'string'], 'source_channel' => ['nullable', 'string'],
            'doc_type' => ['nullable', 'in:NONE,DNI,RUC,CE,PASSPORT'], 'doc_number' => ['nullable', 'string', 'max:20'],
        ]);
        $canal = in_array($d['source_channel'] ?? '', Clientes::CANALES, true) ? $d['source_channel'] : 'WHATSAPP';
        $r = Clientes::altaRapida($d + ['source_channel' => $canal, 'customer_type' => $d['customer_type'] ?? 'PERSON', 'doc_type' => $d['doc_type'] ?? 'NONE'], $request->user());

        return response()->json(['customer' => $r['customer']->only(['id', 'full_name', 'phone']), 'existente' => $r['existente']], $r['existente'] ? 200 : 201);
    }

    /** Dirección nueva con pin (RN-CLI-02, RN-CLI-04), con la zona que le toca. */
    public function direccion(Request $request, string $id)
    {
        $d = $request->validate([
            'label' => ['nullable', 'string', 'max:40'], 'address_line' => ['required', 'string', 'max:255'], 'district' => ['required', 'string', 'max:80'],
            'reference' => ['required', 'string', 'max:255'], 'lat' => ['required', 'numeric'], 'lng' => ['required', 'numeric'],
            'contact_name' => ['nullable', 'string', 'max:120'], 'contact_phone' => ['nullable', 'string', 'max:30'],
        ]);
        $r = Direcciones::guardar(Customer::findOrFail($id), $d + ['pin_source' => 'MAP']);

        return response()->json(['direccion' => $r['direccion'], 'zona' => $r['zona']], 201);
    }
}
