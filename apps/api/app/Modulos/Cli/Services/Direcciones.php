<?php

namespace App\Modulos\Cli\Services;

use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Models\CustomerAddress;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Direcciones con pin (CLI-05, CLI-06 y el enlace de CLI-07).
 *  RN-CLI-02: línea, distrito, pin y referencia de al menos cli_min_reference_chars caracteres.
 *  RN-CLI-04: el pin cae dentro del Perú.
 *  RN-CLI-05: un pin geocodificado con confianza menor a cli_min_geocode_confidence se confirma
 *             moviéndolo en el mapa (o con el enlace al cliente).
 *  RN-CLI-06: la zona sale del pin. RN-CLI-10: una sola predeterminada.
 */
final class Direcciones
{
    /** Orígenes del pin que cuentan como confirmados (KPI-CLI-04). */
    public const CONFIRMADOS = ['MAP', 'GPS', 'WEB', 'LINK'];

    public const ORIGENES = ['MAP', 'GPS', 'WEB', 'LINK', 'GEOCODE', 'IMPORT', 'COORDINATES', 'PENDING_LINK'];

    public static function enPeru(?float $lat, ?float $lng): bool
    {
        return $lat !== null && $lng !== null && ! ($lat == 0 && $lng == 0)
            && $lat >= -18.4 && $lat <= -0.03 && $lng >= -81.4 && $lng <= -68.6;
    }

    /**
     * Crea o edita una dirección. $desdeEnlace: la escribió el cliente desde su enlace (CLI-07).
     *
     * @return array{direccion: CustomerAddress, zona: mixed, por: ?string}
     */
    public static function guardar(Customer $c, array $v, ?CustomerAddress $existente = null): array
    {
        if ($c->fusionado()) {
            RuleError::fail('RN-CLI-08', "{$c->nombre()} fue fusionado: agrega la dirección al sobreviviente.");
        }
        $minRef = (int) (Params::get('cli_min_reference_chars') ?? 10);
        $minConf = (float) (Params::get('cli_min_geocode_confidence') ?? 0.8);
        $linea = trim((string) ($v['address_line'] ?? ''));
        $ref = trim((string) ($v['reference'] ?? ''));
        $distrito = trim((string) ($v['district'] ?? ''));
        if ($linea === '') {
            RuleError::fail('RN-CLI-02', 'Escribe la dirección: calle y número.');
        }
        if ($distrito === '') {
            RuleError::fail('RN-CLI-02', 'Indica el distrito.');
        }
        $largo = mb_strlen($ref);
        if ($largo < $minRef) {
            RuleError::fail('RN-CLI-02', "La referencia «{$ref}» tiene {$largo} caracteres; el mínimo es {$minRef} (por ejemplo «Frente al parque»).");
        }
        if (($v['lat'] ?? null) === null || ($v['lat'] ?? '') === '' || ($v['lng'] ?? null) === null || ($v['lng'] ?? '') === '') {
            RuleError::fail('RN-CLI-02', 'Marca el pin en el mapa: sin pin la dirección no se guarda.');
        }
        $lat = (float) $v['lat'];
        $lng = (float) $v['lng'];
        if (! self::enPeru($lat, $lng)) {
            RuleError::fail('RN-CLI-04', 'El pin ('.number_format($lat, 4).', '.number_format($lng, 4).') está fuera del Perú: muévelo a la dirección real.');
        }
        $origen = $v['pin_source'] ?? 'MAP';
        $conf = isset($v['geocode_confidence']) && $v['geocode_confidence'] !== '' ? (float) $v['geocode_confidence'] : ($origen === 'GEOCODE' ? 0.5 : 1.0);
        // Moverlo en el mapa lo confirma.
        if ($origen === 'GEOCODE' && ! empty($v['pin_confirmed'])) {
            [$origen, $conf] = ['MAP', 1.0];
        }
        if ($origen === 'GEOCODE' && $conf < $minConf) {
            RuleError::fail('RN-CLI-05', 'El pin salió de la búsqueda por texto con confianza '.number_format($conf, 2).' (mínimo '.number_format($minConf, 2).'): muévelo en el mapa para confirmarlo o envía el enlace al cliente.');
        }
        $contacto = Celulares::normalizar($v['contact_phone'] ?? null) ?: $c->phone;
        if ($contacto && ! Celulares::valido($contacto)) {
            RuleError::fail('RN-CLI-01', 'El celular de quien recibe no es válido.');
        }
        $m = Zonas::para($lat, $lng, $distrito);
        $propias = CustomerAddress::where('customer_id', $c->id)->where('status', 'ACTIVE')
            ->when($existente, fn ($q) => $q->where('id', '<>', $existente->id));
        $predeterminada = ! empty($v['is_default']) || ! $propias->exists();

        return DB::transaction(function () use ($c, $v, $existente, $linea, $ref, $distrito, $lat, $lng, $origen, $conf, $contacto, $m, $predeterminada) {
            if ($predeterminada) {
                CustomerAddress::where('customer_id', $c->id)->where('is_default', true)
                    ->when($existente, fn ($q) => $q->where('id', '<>', $existente->id))->update(['is_default' => false]);
            }
            $datos = [
                'customer_id' => $c->id, 'label' => trim((string) ($v['label'] ?? '')) ?: 'Casa', 'address_line' => $linea, 'district' => $distrito,
                'reference' => $ref, 'lat' => round($lat, 6), 'lng' => round($lng, 6), 'zone_id' => $m['zona']?->id, 'zone_by' => $m['por'],
                'out_of_coverage' => ! $m['zona'], 'contact_name' => trim((string) ($v['contact_name'] ?? '')) ?: $c->full_name,
                'contact_phone' => $contacto, 'is_default' => $predeterminada, 'status' => 'ACTIVE', 'pin_source' => $origen,
                'geocode_confidence' => $conf, 'needs_pin' => false,
            ];
            if ($existente) {
                $existente->update($datos);
                $a = $existente->refresh();
            } else {
                $a = CustomerAddress::create($datos);
            }

            return ['direccion' => $a, 'zona' => $m['zona'] ? Zonas::json($m['zona']) : null, 'por' => $m['por']];
        });
    }

    public static function predeterminar(CustomerAddress $a): void
    {
        if ($a->status !== 'ACTIVE') {
            RuleError::fail('RN-CLI-10', 'La dirección está desactivada: actívala antes de predeterminarla.');
        }
        DB::transaction(function () use ($a) {
            CustomerAddress::where('customer_id', $a->customer_id)->where('id', '<>', $a->id)->where('is_default', true)->update(['is_default' => false]);
            $a->update(['is_default' => true]);
        });
    }

    /** Desactivar no borra: los pedidos viejos siguen apuntando a la dirección. */
    public static function desactivar(CustomerAddress $a): void
    {
        $a->update(['status' => 'INACTIVE', 'is_default' => false]);
    }

    /**
     * Búsqueda por texto (MapsProvider de prueba hasta que INT conecte uno real): reconoce el
     * distrito de una zona y da un pin aproximado cerca de su centro. Con número de calle la
     * confianza es 0,82; sin número, 0,6 (hay que confirmarlo, RN-CLI-05).
     *
     * @return array{lat: float, lng: float, confidence: float, district: string}|null
     */
    public static function geocodificar(string $texto): ?array
    {
        $t = Zonas::clave($texto);
        if ($t === '') {
            return null;
        }
        foreach (Zonas::activas()->where('province', false) as $z) {
            $distritos = $z->districts ?? [];
            // «Surco» basta para «Santiago de Surco»: el distrito completo o su última palabra.
            $coincide = collect($distritos)->first(function ($d) use ($t) {
                $palabras = explode(' ', Zonas::clave($d));
                $ultima = end($palabras);

                return str_contains($t, Zonas::clave($d)) || (mb_strlen($ultima) >= 5 && str_contains($t, $ultima));
            });
            if (! $coincide || $z->lat === null) {
                continue;
            }
            $k = 7;
            foreach (mb_str_split($t) as $ch) {
                $k = ($k * 31 + mb_ord($ch)) % 100003;
            }

            return [
                'lat' => round($z->lat + (($k % 100) / 100 - 0.5) * 0.012, 6),
                'lng' => round($z->lng + (((intdiv($k, 8)) % 100) / 100 - 0.5) * 0.012, 6),
                'confidence' => preg_match('/\d{2,5}/', $t) ? 0.82 : 0.6,
                'district' => $coincide,
            ];
        }

        return null;
    }
}
