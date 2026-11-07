<?php

namespace App\Modulos\Cat\Services;

use Illuminate\Support\Facades\DB;

/**
 * Precio vigente de una variante (RN-CAT-05). Es el servicio que usan PED, POS, WEB y CRM:
 *   Precios::vigente($variantId, ['canal' => 'WHATSAPP', 'tipo_cliente' => 'RESTAURANT', 'cantidad' => 2]);
 *   Precios::vigentes([$id1, $id2], ['canal' => 'WHATSAPP']);   // varias de una vez (listas como CAT-01)
 *
 * Cómo se elige:
 *  1. Listas activas y vigentes en la fecha.
 *  2. Que coincidan en marca, canal y tipo de cliente (vacío = cualquiera).
 *  3. Gana la de menor prioridad (sin prioridad = 100); a igual prioridad, la más específica.
 *  4. Dentro de la lista, el precio vigente con el tramo de cantidad mínima más alto que no supere la cantidad.
 * Sin precio vigente, la variante no se puede vender en ese canal: devuelve null.
 *
 * Precios::simular() da lo mismo con la traza de cada lista evaluada (CAT-07).
 */
final class Precios
{
    public const CANALES = ['WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'COUNTER', 'B2B', 'CONSIGNMENT'];

    public const PRIORIDAD_POR_DEFECTO = 100;

    /**
     * @param  array{canal?: string, tipo_cliente?: string, fecha?: string, cantidad?: float|int|string, marca?: string|null}  $o
     * @return array{price: float, basis: string, list_id: string, list_code: string, list_name: string, min_qty: float, reason: string}|null
     */
    public static function vigente(string $variantId, array $o = []): ?array
    {
        return self::vigentes([$variantId], $o)[$variantId] ?? null;
    }

    /**
     * @param  string[]  $variantIds
     * @return array<string, array|null> precio por id de variante (null = sin precio vigente)
     */
    public static function vigentes(array $variantIds, array $o = []): array
    {
        $variantIds = array_values(array_unique($variantIds));
        if (! $variantIds) {
            return [];
        }
        $canal = $o['canal'] ?? 'WHATSAPP';
        $tipo = $o['tipo_cliente'] ?? 'PERSON';
        $fecha = $o['fecha'] ?? now()->toDateString();
        $cantidad = (float) ($o['cantidad'] ?? 0);

        $variantes = DB::table('product_variants')->whereIn('id', $variantIds)->get(['id', 'brand_id', 'sale_mode'])->keyBy('id');

        // 1 y 2 (canal y tipo de cliente): listas que aplican, ya en el orden de la regla.
        $listas = DB::table('price_lists')->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->whereNull('valid_from')->orWhere('valid_from', '<=', $fecha))
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))
            ->get(['id', 'code', 'name', 'brand_id', 'channels', 'customer_types', 'priority'])
            ->filter(fn ($l) => self::coincide(self::lista($l->channels), $canal) && self::coincide(self::lista($l->customer_types), $tipo))
            ->sort(fn ($a, $b) => self::prioridad($a) <=> self::prioridad($b)
                ?: self::especificidad($b) <=> self::especificidad($a)
                ?: strcmp($a->code, $b->code))
            ->values();
        if ($listas->isEmpty()) {
            return array_fill_keys($variantIds, null);
        }

        // 4: precios vigentes de esas variantes en esas listas, con el tramo más alto primero.
        $precios = DB::table('price_list_items')
            ->whereIn('variant_id', $variantIds)->whereIn('list_id', $listas->pluck('id'))
            ->where('valid_from', '<=', $fecha)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))
            ->where(fn ($q) => $q->whereNull('min_qty')->orWhere('min_qty', '<=', $cantidad))
            ->orderByRaw('coalesce(min_qty, 0) desc')->orderByDesc('valid_from')
            ->get(['variant_id', 'list_id', 'price', 'basis', 'min_qty'])
            ->groupBy(fn ($p) => $p->variant_id.'|'.$p->list_id)
            ->map->first();

        $resultado = [];
        foreach ($variantIds as $id) {
            $v = $variantes[$id] ?? null;
            $resultado[$id] = null;
            if (! $v) {
                continue;
            }
            $marca = $o['marca'] ?? $v->brand_id;
            foreach ($listas as $l) {
                // 2 (marca): una lista sin marca vale para todas.
                if ($l->brand_id !== null && $l->brand_id !== $marca) {
                    continue;
                }
                $p = $precios[$id.'|'.$l->id] ?? null;
                if (! $p) {
                    continue;
                }
                $resultado[$id] = [
                    'price' => (float) $p->price,
                    'basis' => $p->basis ?: ($v->sale_mode === 'UNIT' ? 'UNIT' : 'KG'),
                    'list_id' => $l->id,
                    'list_code' => $l->code,
                    'list_name' => $l->name,
                    'min_qty' => (float) ($p->min_qty ?? 0),
                    'reason' => self::motivo($l, (float) ($p->min_qty ?? 0)),
                ];
                break;
            }
        }

        return $resultado;
    }

    /**
     * CAT-07: el precio que se elegiría y por qué, con cada lista de la marca evaluada en orden.
     * Con cliente_id, la lista asignada al cliente va primero y su tipo de cliente reemplaza al indicado.
     *
     * @return array{elegido: array|null, traza: list<array>, tipo_cliente: string}
     */
    public static function simular(string $variantId, array $o = []): array
    {
        $fecha = $o['fecha'] ?? now()->toDateString();
        $canal = $o['canal'] ?? 'WHATSAPP';
        $cantidad = (float) ($o['cantidad'] ?? 0);
        $cliente = ! empty($o['cliente_id']) ? DB::table('customers')->where('id', $o['cliente_id'])->first(['id', 'customer_type', 'price_list_id']) : null;
        $tipo = $cliente?->customer_type ?: ($o['tipo_cliente'] ?? 'PERSON');
        $asignada = $cliente?->price_list_id;

        $v = DB::table('product_variants')->where('id', $variantId)->first(['id', 'brand_id', 'sale_mode']);
        if (! $v) {
            return ['elegido' => null, 'traza' => [], 'tipo_cliente' => $tipo];
        }
        $marca = $o['marca'] ?? $v->brand_id;

        $listas = DB::table('price_lists')->where(fn ($q) => $q->whereNull('brand_id')->orWhere('brand_id', $marca))
            ->get(['id', 'code', 'name', 'brand_id', 'channels', 'customer_types', 'priority', 'status', 'valid_from', 'valid_to'])
            ->sort(fn ($a, $b) => (int) ($b->id === $asignada) <=> (int) ($a->id === $asignada)
                ?: self::prioridad($a) <=> self::prioridad($b)
                ?: self::especificidad($b) <=> self::especificidad($a)
                ?: strcmp($a->code, $b->code))
            ->values();

        $items = DB::table('price_list_items')->where('variant_id', $variantId)->whereIn('list_id', $listas->pluck('id'))
            ->where('valid_from', '<=', $fecha)->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))
            ->where(fn ($q) => $q->whereNull('min_qty')->orWhere('min_qty', '<=', $cantidad))
            ->orderByRaw('coalesce(min_qty, 0) desc')->orderByDesc('valid_from')
            ->get(['list_id', 'price', 'basis', 'min_qty', 'valid_from', 'valid_to'])->groupBy('list_id')->map->first();

        $traza = [];
        $elegido = null;
        foreach ($listas as $l) {
            [$aplica, $porque] = $l->id === $asignada && $l->status === 'ACTIVE'
                ? [true, 'Lista asignada al cliente']
                : self::aplica($l, $canal, $tipo, $fecha);
            $it = $aplica ? ($items[$l->id] ?? null) : null;
            if ($aplica && ! $it) {
                $porque = 'Aplica, pero no tiene precio vigente de esta variante'.($cantidad > 0 ? ' para esa cantidad' : '');
            }
            $fila = [
                'list_id' => $l->id, 'list_code' => $l->code, 'list_name' => $l->name, 'priority' => self::prioridad($l),
                'criterios' => self::especificidad($l), 'aplica' => $aplica && $it !== null, 'porque' => $porque, 'elegida' => false,
                'price' => $it ? (float) $it->price : null, 'basis' => $it?->basis, 'min_qty' => $it ? (float) ($it->min_qty ?? 0) : null,
            ];
            if (! $elegido && $fila['aplica']) {
                $fila['elegida'] = true;
                $elegido = [
                    'price' => (float) $it->price, 'basis' => $it->basis ?: ($v->sale_mode === 'UNIT' ? 'UNIT' : 'KG'),
                    'list_id' => $l->id, 'list_code' => $l->code, 'list_name' => $l->name, 'min_qty' => (float) ($it->min_qty ?? 0),
                    'reason' => self::motivo($l, (float) ($it->min_qty ?? 0)).(self::especificidad($l) ? ', '.self::especificidad($l).' criterio(s) específico(s)' : ''),
                ];
            }
            $traza[] = $fila;
        }

        return ['elegido' => $elegido, 'traza' => $traza, 'tipo_cliente' => $tipo];
    }

    /** ¿La lista aplica al caso? Devuelve [sí o no, por qué]. */
    private static function aplica(object $l, string $canal, string $tipo, string $fecha): array
    {
        $canales = self::lista($l->channels);
        $tipos = self::lista($l->customer_types);

        return match (true) {
            $l->status !== 'ACTIVE' => [false, $l->status === 'DRAFT' ? 'En borrador' : 'Inactiva'],
            $l->valid_from && $l->valid_from > $fecha => [false, 'Vigente desde el '.date('d/m/Y', strtotime($l->valid_from))],
            $l->valid_to && $l->valid_to < $fecha => [false, 'Venció el '.date('d/m/Y', strtotime($l->valid_to))],
            ! self::coincide($canales, $canal) => [false, 'No incluye ese canal'],
            ! self::coincide($tipos, $tipo) => [false, 'Solo para otros tipos de cliente'],
            default => [true, 'Coincide en marca, canal y tipo de cliente'],
        };
    }

    /** Lista vacía = cualquiera. */
    private static function coincide(array $valores, string $buscado): bool
    {
        return ! $valores || in_array($buscado, $valores, true);
    }

    private static function lista(mixed $json): array
    {
        $v = is_string($json) ? json_decode($json, true) : $json;

        return is_array($v) ? $v : [];
    }

    private static function prioridad(object $l): int
    {
        return $l->priority === null ? self::PRIORIDAD_POR_DEFECTO : (int) $l->priority;
    }

    /** Cuántos criterios fija la lista (marca, canales, tipos de cliente): más criterios, más específica. */
    private static function especificidad(object $l): int
    {
        return (int) ($l->brand_id !== null) + (int) (self::lista($l->channels) !== []) + (int) (self::lista($l->customer_types) !== []);
    }

    private static function motivo(object $l, float $minimo): string
    {
        $texto = "Lista «{$l->name}» (prioridad ".self::prioridad($l).')';

        return $minimo > 0 ? $texto.', tramo desde '.rtrim(rtrim(number_format($minimo, 3, '.', ''), '0'), '.') : $texto;
    }
}
