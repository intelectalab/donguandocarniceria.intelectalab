<?php

namespace App\Modulos\Cli\Services;

use App\Modulos\Cat\Services\Precios;
use App\Modulos\Cli\Models\DeliveryZone;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Zonas de reparto y tarifa de delivery. Es el servicio que usan PED, WEB y DEL:
 *   Zonas::para($lat, $lng, 'Santiago de Surco')   // ['zona' => DeliveryZone|null, 'por' => 'POLYGON'|'DISTRICT'|null]
 *   Zonas::tarifa(['lat' => …, 'lng' => …, 'lineas' => [['variant_id' => …, 'qty' => 2]]])
 *
 * RN-CLI-06: primero el polígono que contiene el pin (el de menor prioridad si hay varios) y, si
 * ninguno, la zona cuyo distrito coincide. Sin zona, el pedido de delivery queda fuera de cobertura.
 * Delivery gratis desde N unidades, N kg o S/ N, lo que se cumpla primero (CA-CLI-03).
 */
final class Zonas
{
    /** @return Collection<int, DeliveryZone> */
    public static function activas(): Collection
    {
        return DeliveryZone::where('status', 'ACTIVE')->orderByRaw('coalesce(priority, 100)')->orderBy('code')->get();
    }

    /** @return array{zona: ?DeliveryZone, por: ?string} */
    public static function para(?float $lat, ?float $lng, ?string $distrito = null, ?Collection $zonas = null): array
    {
        $zonas ??= self::activas();
        if ($lat !== null && $lng !== null) {
            $z = $zonas->first(fn ($z) => ! $z->province && is_array($z->polygon) && count($z->polygon) >= 3 && self::dentro($lat, $lng, $z->polygon));
            if ($z) {
                return ['zona' => $z, 'por' => 'POLYGON'];
            }
        }
        if ($distrito) {
            $d = self::clave($distrito);
            $z = $zonas->first(fn ($z) => ! $z->province && collect($z->districts ?? [])->contains(fn ($x) => self::clave($x) === $d));
            if ($z) {
                return ['zona' => $z, 'por' => 'DISTRICT'];
            }
        }

        return ['zona' => null, 'por' => null];
    }

    /** Distritos de todas las zonas, para las listas de las pantallas. */
    public static function distritos(): array
    {
        return DeliveryZone::pluck('districts')->flatten()->filter()->unique()->sort(fn ($a, $b) => strcoll($a, $b))->values()->all();
    }

    /**
     * Tarifa para un pin o distrito (o una zona elegida) y un carrito.
     *
     * @param  array{lat?: ?float, lng?: ?float, distrito?: ?string, zone_id?: ?string, lineas?: array, canal?: string}  $o
     */
    public static function tarifa(array $o): array
    {
        if (! empty($o['zone_id'])) {
            $m = ['zona' => DeliveryZone::find($o['zone_id']), 'por' => 'ZONE'];
        } else {
            $m = self::para(isset($o['lat']) ? (float) $o['lat'] : null, isset($o['lng']) ? (float) $o['lng'] : null, $o['distrito'] ?? null);
        }
        $carrito = self::carrito($o['lineas'] ?? [], $o['canal'] ?? 'WEB');
        $z = $m['zona'];
        if (! $z) {
            return $carrito + ['zona' => null, 'por' => null, 'tarifa' => null, 'gratis' => false, 'cubierto' => false, 'bajo_minimo' => false,
                'motivo' => 'Fuera de cobertura: el pedido de delivery solo se confirma como envío a provincia o recojo en local.'];
        }
        $porUnidades = $z->free_from_units && $carrito['unidades'] >= $z->free_from_units;
        $porKg = $z->free_from_kg && $carrito['kg'] >= $z->free_from_kg;
        $porMonto = $z->free_from_amount && $carrito['monto'] >= $z->free_from_amount;
        $gratis = $porUnidades || $porKg || $porMonto;
        $motivo = match (true) {
            $porUnidades => "Gratis desde {$z->free_from_units} unidades (lleva ".self::num($carrito['unidades']).')',
            $porKg => 'Gratis desde '.self::num($z->free_from_kg).' kg (lleva '.self::num($carrito['kg'], 3).' kg)',
            $porMonto => 'Gratis desde S/ '.number_format($z->free_from_amount, 2),
            default => "Tarifa de {$z->name}: no llega a ".self::umbrales($z),
        };

        return $carrito + [
            'zona' => self::json($z), 'por' => $m['por'], 'tarifa' => $gratis ? 0.0 : (float) $z->delivery_fee, 'gratis' => $gratis, 'cubierto' => true,
            'bajo_minimo' => $z->min_order_amount > 0 && $carrito['monto'] < $z->min_order_amount, 'motivo' => $motivo,
        ];
    }

    /** Unidades, kg y monto estimado del carrito con el precio vigente del canal (CAT). */
    public static function carrito(array $lineas, string $canal = 'WEB'): array
    {
        $ids = array_values(array_filter(array_column($lineas, 'variant_id')));
        $vs = $ids ? DB::table('product_variants')->whereIn('id', $ids)->get(['id', 'sku', 'name', 'sale_mode', 'nominal_weight_kg'])->keyBy('id') : collect();
        $precios = Precios::vigentes($ids, ['canal' => $canal]);
        $u = $kg = $monto = 0.0;
        $detalle = [];
        foreach ($lineas as $l) {
            $v = $vs[$l['variant_id'] ?? ''] ?? null;
            $q = (float) ($l['qty'] ?? 0);
            if (! $v || $q <= 0) {
                continue;
            }
            $p = $precios[$v->id] ?? null;
            [$lu, $lkg] = match ($v->sale_mode) {
                'UNIT_VARIABLE_WEIGHT' => [$q, $q * (float) $v->nominal_weight_kg],
                'KG' => [0, $q],
                default => [$q, 0],
            };
            $importe = $p ? ($p['basis'] === 'KG' ? $lkg : $q) * $p['price'] : 0;
            $u += $lu;
            $kg += $lkg;
            $monto += $importe;
            $detalle[] = ['variant_id' => $v->id, 'sku' => $v->sku, 'name' => $v->name, 'sale_mode' => $v->sale_mode, 'qty' => $q,
                'kg' => round($lkg, 3), 'precio' => $p['price'] ?? null, 'base' => $p['basis'] ?? null, 'importe' => round($importe, 2)];
        }

        return ['unidades' => $u, 'kg' => round($kg, 3), 'monto' => round($monto, 2), 'lineas' => $detalle];
    }

    /** RN-CLI-06 en CLI-08: código único, y un polígono o al menos un distrito (salvo provincia). */
    public static function guardar(?DeliveryZone $z, array $d): DeliveryZone
    {
        $code = strtoupper(trim($d['code']));
        if (DeliveryZone::where('code', $code)->when($z, fn ($q) => $q->where('id', '<>', $z->id))->exists()) {
            RuleError::fail('RN-CLI-06', "Ya existe la zona {$code}.");
        }
        $distritos = collect($d['districts'] ?? [])->map(fn ($x) => trim((string) $x))->filter()->unique()->values()->all();
        $poligono = array_key_exists('polygon', $d) ? $d['polygon'] : $z?->polygon;
        $provincia = (bool) ($d['province'] ?? false);
        if (! $provincia && ! $distritos && ! (is_array($poligono) && count($poligono) >= 3)) {
            RuleError::fail('RN-CLI-06', 'La zona necesita un polígono dibujado en el mapa o al menos un distrito.');
        }
        if (is_array($poligono) && count($poligono) >= 3) {
            $poligono = array_map(fn ($p) => [round((float) $p[0], 6), round((float) $p[1], 6)], $poligono);
            foreach ($poligono as [$la, $ln]) {
                if (! Direcciones::enPeru($la, $ln)) {
                    RuleError::fail('RN-CLI-04', 'Un vértice del polígono cae fuera del Perú: revisa el dibujo.');
                }
            }
        } else {
            $poligono = null;
        }
        $centro = $poligono
            ? [round(array_sum(array_column($poligono, 0)) / count($poligono), 6), round(array_sum(array_column($poligono, 1)) / count($poligono), 6)]
            : [$z?->lat, $z?->lng];
        if ($centro[0] === null) {
            $local = DB::table('establishments')->where('id', $d['establishment_id'])->first(['lat', 'lng']);
            $centro = [$local?->lat, $local?->lng];
        }
        $datos = [
            'code' => $code, 'name' => trim($d['name']), 'establishment_id' => $d['establishment_id'],
            'priority' => (int) ($d['priority'] ?? 100), 'delivery_fee' => (float) $d['delivery_fee'],
            'min_order_amount' => (float) ($d['min_order_amount'] ?? 0),
            'free_from_units' => self::nulo($d['free_from_units'] ?? null, 'int'), 'free_from_kg' => self::nulo($d['free_from_kg'] ?? null),
            'free_from_amount' => self::nulo($d['free_from_amount'] ?? null), 'districts' => $distritos, 'province' => $provincia,
            'status' => $d['status'] ?? 'ACTIVE', 'polygon' => $poligono, 'lat' => $centro[0], 'lng' => $centro[1],
        ];
        if ($z) {
            $z->update($datos);
        } else {
            $z = DeliveryZone::create($datos);
        }

        return $z->refresh();
    }

    public static function json(DeliveryZone $z): array
    {
        return $z->only(['id', 'code', 'name', 'establishment_id', 'delivery_fee', 'min_order_amount', 'free_from_units', 'free_from_kg', 'free_from_amount',
            'priority', 'province', 'districts', 'polygon', 'lat', 'lng', 'status']);
    }

    /** Punto dentro del polígono (rayo), con los vértices como [lat, lng]. */
    public static function dentro(float $lat, float $lng, array $poligono): bool
    {
        $dentro = false;
        $n = count($poligono);
        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            [$yi, $xi] = [(float) $poligono[$i][0], (float) $poligono[$i][1]];
            [$yj, $xj] = [(float) $poligono[$j][0], (float) $poligono[$j][1]];
            if (($yi > $lat) !== ($yj > $lat) && $lng < ($xj - $xi) * ($lat - $yi) / (($yj - $yi) ?: 1e-12) + $xi) {
                $dentro = ! $dentro;
            }
        }

        return $dentro;
    }

    public static function clave(?string $s): string
    {
        return strtr(mb_strtolower(trim((string) $s)), ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
    }

    private static function umbrales(DeliveryZone $z): string
    {
        $p = array_filter([
            $z->free_from_units ? "{$z->free_from_units} unidades" : null,
            $z->free_from_kg ? self::num($z->free_from_kg).' kg' : null,
            $z->free_from_amount ? 'S/ '.number_format($z->free_from_amount, 2) : null,
        ]);

        return $p ? implode(' ni ', $p) : 'el envío gratis (no tiene)';
    }

    private static function num(float $n, int $dec = 2): string
    {
        return rtrim(rtrim(number_format($n, $dec, ',', '.'), '0'), ',');
    }

    private static function nulo(mixed $v, string $tipo = 'float'): int|float|null
    {
        if ($v === null || $v === '' || (float) $v <= 0) {
            return null;
        }

        return $tipo === 'int' ? (int) $v : (float) $v;
    }
}
