<?php

namespace App\Modulos\Cli\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Models\CustomerAddress;
use App\Modulos\Cli\Services\Direcciones;
use App\Modulos\Cli\Services\Zonas;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CLI-05 Direcciones del cliente (zona, predeterminada, último uso) y CLI-06 Mapa de la dirección
 * (pin, búsqueda por texto, referencia obligatoria y contacto). Reglas en Services\Direcciones.
 */
class DireccionController extends Controller
{
    /** Direcciones activas de un cliente con su zona y la última vez que se usaron en un pedido. */
    public static function deCliente(string $customerId): array
    {
        return DB::table('customer_addresses as a')->where('a.customer_id', $customerId)->where('a.status', 'ACTIVE')
            ->leftJoin('delivery_zones as z', 'z.id', '=', 'a.zone_id')
            ->orderByDesc('a.is_default')->orderBy('a.created_at')
            ->get(['a.id', 'a.customer_id', 'a.label', 'a.address_line', 'a.district', 'a.reference', 'a.lat', 'a.lng', 'a.zone_id', 'a.zone_by',
                'a.contact_name', 'a.contact_phone', 'a.is_default', 'a.pin_source', 'a.geocode_confidence', 'z.code as zone_code', 'z.name as zone_name',
                DB::raw('coalesce((select max(o.created_at) from sales_orders o where o.address_id = a.id), a.last_used_at) as ultimo_uso')])
            ->map(fn ($a) => self::conTipos($a))->all();
    }

    public function index(string $id)
    {
        $c = Customer::findOrFail($id);

        return response()->json(['cliente' => ['id' => $c->id, 'nombre' => $c->nombre(), 'phone' => $c->phone, 'merged_into_id' => $c->merged_into_id, 'status' => $c->status],
            'direcciones' => self::deCliente($id)]);
    }

    /** Cifras de CLI-05 y las direcciones de toda la base que hay que revisar. ?mes=2026-10 para KPI-CLI-04. */
    public function revisar(Request $request)
    {
        $d = $request->validate(['mes' => ['nullable', 'date_format:Y-m']]);
        $desde = isset($d['mes']) ? Carbon::parse($d['mes'].'-01', 'America/Lima') : now('America/Lima')->startOfMonth();
        $minConf = (float) Params::get('cli_min_geocode_confidence');
        // KPI-CLI-04: direcciones usadas en pedidos del mes con pin de mapa, GPS, web o enlace.
        $usadas = DB::table('customer_addresses')->whereIn('id', DB::table('sales_orders')->whereNotNull('address_id')->where('status', '<>', 'CANCELLED')
            ->where('created_at', '>=', $desde)->where('created_at', '<', $desde->copy()->addMonth())->select('address_id'))->get(['pin_source']);
        $ok = $usadas->whereIn('pin_source', Direcciones::CONFIRMADOS)->count();
        $activas = DB::table('customer_addresses')->where('status', 'ACTIVE');

        return response()->json([
            'mes' => $desde->format('Y-m'),
            'pins_confirmados' => ['valor' => $usadas->count() ? round($ok / $usadas->count() * 100, 1) : 0.0, 'numerador' => $ok, 'denominador' => $usadas->count()],
            'por_confirmar' => (clone $activas)->whereNotIn('pin_source', Direcciones::CONFIRMADOS)->count(),
            'fuera_de_cobertura' => (clone $activas)->whereNull('zone_id')->count(),
            'confianza_minima' => $minConf,
            'lista' => DB::table('customer_addresses as a')->where('a.status', 'ACTIVE')
                ->where(fn ($q) => $q->whereNotIn('a.pin_source', Direcciones::CONFIRMADOS)->orWhereNull('a.zone_id'))
                ->join('customers as c', 'c.id', '=', 'a.customer_id')->leftJoin('delivery_zones as z', 'z.id', '=', 'a.zone_id')
                ->orderBy('c.full_name')->limit(50)
                ->get(['a.id', 'a.customer_id', 'c.full_name as cliente', 'a.address_line', 'a.district', 'a.pin_source', 'a.geocode_confidence', 'z.name as zone_name'])
                ->map(fn ($a) => self::conTipos($a)),
        ]);
    }

    public function show(string $id)
    {
        $a = CustomerAddress::findOrFail($id);
        $c = Customer::findOrFail($a->customer_id);

        return response()->json(['direccion' => $a, 'cliente' => ['id' => $c->id, 'nombre' => $c->nombre(), 'full_name' => $c->full_name, 'phone' => $c->phone]]);
    }

    public function store(Request $request, string $id)
    {
        $r = Direcciones::guardar(Customer::findOrFail($id), $this->validar($request));

        return response()->json($r, 201);
    }

    public function update(Request $request, string $id)
    {
        $a = CustomerAddress::findOrFail($id);

        return response()->json(Direcciones::guardar(Customer::findOrFail($a->customer_id), $this->validar($request), $a));
    }

    public function predeterminar(string $id)
    {
        Direcciones::predeterminar(CustomerAddress::findOrFail($id));

        return response()->noContent();
    }

    public function desactivar(string $id)
    {
        Direcciones::desactivar(CustomerAddress::findOrFail($id));

        return response()->noContent();
    }

    /** Búsqueda por texto (geocodificación de prueba): pin aproximado con su confianza. */
    public function geocodificar(Request $request)
    {
        $d = $request->validate(['q' => ['required', 'string', 'max:255']]);
        $g = Direcciones::geocodificar($d['q']);

        return $g ? response()->json($g) : response()->json(['message' => 'No se encontró: escribe también el distrito (por ejemplo «Surco»).'], 404);
    }

    /** Zona y tarifa para un pin o distrito, mientras se mueve el pin (CLI-06 y el enlace del cliente). */
    public function zona(Request $request)
    {
        $d = $request->validate(['lat' => ['nullable', 'numeric'], 'lng' => ['nullable', 'numeric'], 'distrito' => ['nullable', 'string', 'max:80']]);
        $lat = isset($d['lat']) ? (float) $d['lat'] : null;
        $lng = isset($d['lng']) ? (float) $d['lng'] : null;
        $m = Zonas::para($lat, $lng, $d['distrito'] ?? null);
        $local = $m['zona'] ? DB::table('establishments')->where('id', $m['zona']->establishment_id)->value('name') : null;

        return response()->json(['en_peru' => $lat === null || Direcciones::enPeru($lat, $lng), 'zona' => $m['zona'] ? Zonas::json($m['zona']) + ['local' => $local] : null, 'por' => $m['por']]);
    }

    /** Distritos de las zonas, para la lista de CLI-06. */
    public function distritos()
    {
        return response()->json(Zonas::distritos());
    }

    private function validar(Request $request): array
    {
        return $request->validate([
            'label' => ['nullable', 'string', 'max:40'], 'address_line' => ['required', 'string', 'max:255'], 'district' => ['required', 'string', 'max:80'],
            'reference' => ['nullable', 'string', 'max:255'], 'lat' => ['nullable', 'numeric'], 'lng' => ['nullable', 'numeric'],
            'contact_name' => ['nullable', 'string', 'max:255'], 'contact_phone' => ['nullable', 'string', 'max:40'], 'is_default' => ['boolean'],
            'pin_source' => ['nullable', Rule::in(Direcciones::ORIGENES)], 'geocode_confidence' => ['nullable', 'numeric', 'between:0,1'], 'pin_confirmed' => ['boolean'],
        ]);
    }

    private static function conTipos(object $a): object
    {
        foreach (['lat', 'lng', 'geocode_confidence'] as $k) {
            if (property_exists($a, $k) && $a->{$k} !== null) {
                $a->{$k} = (float) $a->{$k};
            }
        }
        $a->confirmado = in_array($a->pin_source, Direcciones::CONFIRMADOS, true);

        return $a;
    }
}
