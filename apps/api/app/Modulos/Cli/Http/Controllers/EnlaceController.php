<?php

namespace App\Modulos\Cli\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Services\Enlaces;
use App\Modulos\Cli\Services\Zonas;
use App\Support\Listado;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CLI-07 Enlace de ubicación: se genera para un cliente, la vendedora lo envía por WhatsApp y el
 * cliente lo abre sin sesión (publico() y completar(), con límite por IP) para marcar su pin.
 */
class EnlaceController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate(['estado' => ['nullable', Rule::in(Enlaces::ESTADOS)], 'customer_id' => ['nullable', 'uuid']]);
        $estado = "CASE WHEN l.status = 'PENDING' AND l.expires_at < now() THEN 'EXPIRED' ELSE l.status END";
        $q = DB::table('customer_location_links as l')->join('customers as c', 'c.id', '=', 'l.customer_id')
            ->leftJoin('customer_addresses as a', 'a.id', '=', 'l.address_id')
            ->select(['l.id', 'l.customer_id', 'c.full_name as cliente', 'l.phone', 'l.created_at', 'l.expires_at', 'l.used_at', 'l.created_by', 'l.sent_via',
                'a.address_line as resultado', DB::raw("{$estado} as estado")])
            ->when($f['estado'] ?? null, fn ($w, $v) => $w->whereRaw("{$estado} = ?", [$v]))
            ->when($f['customer_id'] ?? null, fn ($w, $v) => $w->where('l.customer_id', $v));

        return response()->json(Listado::de($q, $request, buscar: ['c.full_name', 'l.phone'], ordenar: ['created_at', 'expires_at', 'cliente'], porDefecto: '-created_at'));
    }

    /** Genera el enlace. El token se devuelve solo esta vez: la web arma la dirección completa. */
    public function store(Request $request, string $id)
    {
        $r = Enlaces::crear(Customer::findOrFail($id), $request->user());

        return response()->json(['id' => $r['link']->id, 'token' => $r['token'], 'horas' => $r['horas'], 'expires_at' => $r['link']->expires_at, 'phone' => $r['link']->phone], 201);
    }

    public function anular(string $id)
    {
        DB::table('customer_location_links')->where('id', $id)->where('status', 'PENDING')->update(['status' => 'CANCELLED', 'updated_at' => now()]);

        return response()->noContent();
    }

    /** Lo que ve el cliente al abrir el enlace (sin sesión). */
    public function publico(string $token)
    {
        ['link' => $l, 'cliente' => $c] = Enlaces::abrir($token);
        $zona = DB::table('customer_addresses')->where(['customer_id' => $c->id, 'is_default' => true, 'status' => 'ACTIVE'])->first(['lat', 'lng', 'district']);

        return response()->json([
            'empresa' => TenantContext::tenant()['name'] ?? null,
            'nombre' => explode(' ', trim($c->full_name))[0],
            'vence' => $l->expires_at,
            'centro' => $zona ? ['lat' => (float) $zona->lat, 'lng' => (float) $zona->lng] : null,
            'distrito' => $zona?->district,
            'distritos' => Zonas::distritos(),
        ]);
    }

    public function completar(Request $request, string $token)
    {
        $d = $request->validate([
            'address_line' => ['required', 'string', 'max:255'], 'district' => ['required', 'string', 'max:80'], 'reference' => ['nullable', 'string', 'max:255'],
            'lat' => ['nullable', 'numeric'], 'lng' => ['nullable', 'numeric'], 'contact_name' => ['nullable', 'string', 'max:255'], 'gps' => ['boolean'],
        ], [
            // Lo lee el cliente, no el equipo: en castellano y sin códigos.
            'address_line.required' => 'Escribe tu dirección: calle y número.', 'district.required' => 'Elige tu distrito.',
            '*.max' => 'Es demasiado largo.', '*.numeric' => 'La ubicación no es válida: marca el punto en el mapa.',
        ]);
        $r = Enlaces::completar($token, $d);

        return response()->json(['zona' => $r['zona'] ? ['name' => $r['zona']['name'], 'delivery_fee' => $r['zona']['delivery_fee']] : null], 201);
    }
}
