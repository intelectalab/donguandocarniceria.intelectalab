<?php

namespace App\Modulos\Cli\Services;

use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Models\CustomerAddress;
use App\Support\Params;
use Illuminate\Support\Facades\DB;

/**
 * Lo que WEB necesita de CLI y CLI no tenía.
 *
 * D-WEB-02 / RN-WEB-07: la web no pide el pin en el checkout. La dirección del pedido web se guarda «por completar»
 * (sin pin, needs_pin = true) para que el pedido quede en borrador; la vendedora la completa con el pin o el cliente
 * con el enlace de ubicación (CLI-07). Direcciones::guardar exige el pin, por eso aquí va aparte.
 */
final class ParaWeb
{
    /** Busca una dirección activa del cliente con el mismo texto (sin mayúsculas, tildes ni signos). */
    public static function direccionIgual(string $clienteId, string $linea): ?CustomerAddress
    {
        $clave = self::clave($linea);

        return CustomerAddress::where('customer_id', $clienteId)->where('status', 'ACTIVE')->get()
            ->first(fn ($a) => self::clave($a->address_line) === $clave);
    }

    /** Dirección sin pin, por completar. La zona sale del distrito si se puede (solo como referencia). */
    public static function direccionSinPin(Customer $c, array $v): CustomerAddress
    {
        $distrito = trim((string) ($v['district'] ?? ''));
        $m = $distrito !== '' ? Zonas::para(null, null, $distrito) : ['zona' => null, 'por' => null];
        $tieneOtra = CustomerAddress::where('customer_id', $c->id)->where('status', 'ACTIVE')->where('is_default', true)->exists();
        $ref = trim((string) ($v['reference'] ?? ''));

        return DB::transaction(fn () => CustomerAddress::create([
            'customer_id' => $c->id, 'label' => mb_substr(trim((string) ($v['label'] ?? '')) ?: 'Web', 0, 40),
            'address_line' => mb_substr(trim((string) $v['address_line']), 0, 255), 'district' => $distrito ?: null,
            'reference' => mb_substr($ref !== '' ? $ref : 'Por completar con el enlace de ubicación', 0, 255),
            'lat' => null, 'lng' => null, 'zone_id' => $m['zona']?->id, 'zone_by' => $m['zona'] ? $m['por'] : null, 'out_of_coverage' => ! $m['zona'],
            'contact_name' => trim((string) ($v['contact_name'] ?? '')) ?: $c->full_name, 'contact_phone' => $v['contact_phone'] ?? $c->phone,
            'is_default' => ! $tieneOtra, 'status' => 'ACTIVE', 'pin_source' => 'PENDING_LINK', 'geocode_confidence' => null, 'needs_pin' => true,
        ]));
    }

    /** La dirección que el cliente envió por su enlace después de $desde (la más reciente), si la hay. */
    public static function ubicacionRecibida(string $clienteId, string $desde): ?string
    {
        return DB::table('customer_location_links')->where('customer_id', $clienteId)->where('status', 'USED')->whereNotNull('address_id')
            ->where('used_at', '>=', $desde)->orderByDesc('used_at')->value('address_id');
    }

    public static function minimoReferencia(): int
    {
        return (int) (Params::get('cli_min_reference_chars') ?? 10);
    }

    private static function clave(?string $t): string
    {
        $t = mb_strtolower((string) $t);
        $t = strtr($t, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);

        return preg_replace('/[^a-z0-9]/', '', $t);
    }
}
