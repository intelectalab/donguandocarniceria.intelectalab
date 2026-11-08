<?php

namespace App\Modulos\Cat\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Marcas;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Listas de precio y sus precios (CAT-05 y CAT-06).
 *  - RN-CAT-05: la lista tiene marca, canales, tipos de cliente, prioridad y vigencia (la elección está en Precios).
 *  - RN-CAT-06: en una lista no se superponen vigencias de la misma variante y cantidad mínima.
 *    Para cambiar un precio se cierra la vigencia anterior (el día previo) y se abre otra.
 * Cada cambio emite price.changed para que PED, POS y WEB refresquen sus precios.
 */
final class Listas
{
    public const TIPOS_CLIENTE = ['PERSON', 'RESTAURANT', 'BUSINESS', 'CONSIGNMENT_POINT', 'RELATED', 'OTHER'];

    public const ESTADOS = ['ACTIVE', 'DRAFT', 'INACTIVE'];

    /** La lista, si el usuario la puede ver: las de su marca y las de todas las marcas. */
    public static function delAlcance(User $u, string $id): object
    {
        $marcas = Access::for($u)['brands'];

        return DB::table('price_lists')->where('id', $id)
            ->when($marcas, fn ($q) => $q->where(fn ($w) => $w->whereNull('brand_id')->orWhereIn('brand_id', $marcas)))
            ->first() ?? abort(404);
    }

    /** Solo edita una lista de todas las marcas quien ve todas las marcas. */
    private static function puedeEditar(User $u, ?string $marca): void
    {
        $marcas = Access::for($u)['brands'];
        if ($marcas && ($marca === null || ! in_array($marca, $marcas, true))) {
            RuleError::fail('RN-CAT-05', $marca === null
                ? 'Solo quien ve todas las marcas edita una lista que aplica a todas.'
                : 'No tienes acceso a esa marca.');
        }
    }

    public static function guardar(array $d, ?object $actual, User $u): object
    {
        $marca = $d['brand_id'] ?? null;
        self::puedeEditar($u, $marca);
        if ($actual && $actual->brand_id !== $marca) {
            self::puedeEditar($u, $actual->brand_id);
        }
        if ($marca && (! $actual || $actual->brand_id !== $marca)) {
            Marcas::activa($marca);
        }
        if (! empty($d['valid_to']) && $d['valid_to'] < $d['valid_from']) {
            RuleError::fail('RN-CAT-05', 'La vigencia termina antes de empezar.');
        }

        $fila = [
            'code' => $d['code'], 'name' => $d['name'], 'brand_id' => $marca,
            'channels' => json_encode(array_values($d['channels'] ?? [])), 'customer_types' => json_encode(array_values($d['customer_types'] ?? [])),
            'includes_igv' => (bool) ($d['includes_igv'] ?? true), 'currency' => 'PEN', 'priority' => $d['priority'] ?? Precios::PRIORIDAD_POR_DEFECTO,
            'valid_from' => $d['valid_from'], 'valid_to' => $d['valid_to'] ?? null, 'status' => $d['status'],
        ];

        if ($actual) {
            DB::table('price_lists')->where('id', $actual->id)->update($fila + ['updated_at' => now()]);
            $id = $actual->id;
        } else {
            $id = DB::table('price_lists')->insertGetId($fila);
        }
        Events::emit('price.changed', 'price_lists', $id, ['list_id' => $id, 'code' => $d['code'], 'status' => $d['status']]);

        return DB::table('price_lists')->where('id', $id)->first();
    }

    public static function cambiarEstado(object $l, string $status, User $u): object
    {
        self::puedeEditar($u, $l->brand_id);
        DB::table('price_lists')->where('id', $l->id)->update(['status' => $status, 'updated_at' => now()]);
        Events::emit('price.changed', 'price_lists', $l->id, ['list_id' => $l->id, 'status' => $status]);

        return DB::table('price_lists')->where('id', $l->id)->first();
    }

    /** Copia una lista en borrador con sus precios vigentes a la fecha y un ajuste en %. */
    public static function copiar(object $origen, array $d, User $u): array
    {
        return DB::transaction(function () use ($origen, $d, $u) {
            $desde = $d['valid_from'];
            $nueva = self::guardar([
                'code' => $d['code'], 'name' => $d['name'], 'brand_id' => array_key_exists('brand_id', $d) ? $d['brand_id'] : $origen->brand_id,
                'channels' => self::json($origen->channels), 'customer_types' => self::json($origen->customer_types),
                'includes_igv' => $origen->includes_igv, 'priority' => $d['priority'] ?? $origen->priority,
                'valid_from' => $desde, 'valid_to' => null, 'status' => 'DRAFT',
            ], null, $u);

            $pct = (float) ($d['pct'] ?? 0);
            $motivo = 'Copia de '.$origen->code.($pct ? ' ('.($pct > 0 ? '+' : '').rtrim(rtrim(number_format($pct, 1, ',', ''), '0'), ',').' %)' : '');
            $items = self::vigentesEn($origen->id, $desde);
            if ($nueva->brand_id) {
                $items = $items->filter(fn ($i) => DB::table('product_variants')->where('id', $i->variant_id)->value('brand_id') === $nueva->brand_id);
            }
            foreach ($items as $i) {
                DB::table('price_list_items')->insert([
                    'list_id' => $nueva->id, 'variant_id' => $i->variant_id, 'price' => round($i->price * (1 + $pct / 100), 2),
                    'basis' => $i->basis, 'min_qty' => $i->min_qty ?? 0, 'valid_from' => $desde, 'valid_to' => null,
                    'created_by' => self::quien($u), 'reason' => mb_substr($motivo, 0, 80),
                ]);
            }

            return ['list' => $nueva, 'items' => $items->count()];
        });
    }

    /** Nueva vigencia para toda la lista: cada precio vigente en esa fecha se cierra el día anterior y se abre con el ajuste. */
    public static function programar(object $l, string $desde, float $pct, string $motivo, User $u): int
    {
        self::puedeEditar($u, $l->brand_id);
        if ($desde <= now()->toDateString()) {
            RuleError::fail('RN-CAT-06', 'La nueva vigencia se programa desde mañana en adelante.');
        }

        return DB::transaction(function () use ($l, $desde, $pct, $motivo, $u) {
            $n = 0;
            foreach (self::vigentesEn($l->id, $desde)->filter(fn ($i) => $i->valid_from < $desde) as $i) {
                self::agregarPrecio($l, [
                    'variant_id' => $i->variant_id, 'price' => round($i->price * (1 + $pct / 100), 2), 'basis' => $i->basis,
                    'min_qty' => $i->min_qty, 'valid_from' => $desde, 'cerrar_anterior' => true, 'reason' => $motivo,
                ], $u);
                $n++;
            }

            return $n;
        });
    }

    /**
     * Carga un precio (RN-CAT-06). Si se superpone con otro de la misma variante y cantidad mínima, se rechaza;
     * con cerrar_anterior, las vigencias que empezaron antes se cierran el día previo.
     */
    public static function agregarPrecio(object $l, array $d, User $u): object
    {
        self::puedeEditar($u, $l->brand_id);
        $v = DB::table('product_variants')->where('id', $d['variant_id'])->first(['id', 'sku', 'name', 'brand_id', 'sale_mode']);
        if (! $v) {
            RuleError::fail('RN-CAT-06', 'Elige la variante.');
        }
        if ($l->brand_id && $v->brand_id !== $l->brand_id) {
            RuleError::fail('RN-CAT-01', "{$v->name} es de otra marca que la lista.");
        }
        $desde = $d['valid_from'];
        $hasta = $d['valid_to'] ?? null;
        if ($hasta && $hasta < $desde) {
            RuleError::fail('RN-CAT-06', 'La vigencia termina antes de empezar.');
        }
        $min = (float) ($d['min_qty'] ?? 0);

        return DB::transaction(function () use ($l, $d, $u, $v, $desde, $hasta, $min) {
            $iguales = DB::table('price_list_items')->where('list_id', $l->id)->where('variant_id', $v->id)
                ->whereRaw('coalesce(min_qty, 0) = ?', [$min])
                ->where('valid_from', '<=', $hasta ?? '9999-12-31')
                ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $desde))
                ->orderBy('valid_from')->lockForUpdate()->get();

            if ($iguales->isNotEmpty()) {
                $cerrable = ! empty($d['cerrar_anterior']) && $iguales->every(fn ($x) => $x->valid_from < $desde);
                if (! $cerrable) {
                    $x = $iguales->first();
                    RuleError::fail('RN-CAT-06', sprintf('Ya hay un precio de %s en «%s» vigente del %s %s (S/ %s). Cierra esa vigencia antes de abrir otra desde el %s.',
                        $v->name, $l->name, self::fecha($x->valid_from), $x->valid_to ? 'al '.self::fecha($x->valid_to) : 'sin fecha de fin',
                        number_format((float) $x->price, 2), self::fecha($desde)));
                }
                $dia = CarbonImmutable::parse($desde)->subDay()->toDateString();
                foreach ($iguales as $x) {
                    DB::table('price_list_items')->where('id', $x->id)->update([
                        'valid_to' => $dia, 'closed_by' => self::quien($u), 'closed_reason' => mb_substr($d['reason'] ?? 'Cambio de precio', 0, 80), 'updated_at' => now(),
                    ]);
                }
            }

            $id = DB::table('price_list_items')->insertGetId([
                'list_id' => $l->id, 'variant_id' => $v->id, 'price' => round((float) $d['price'], 2),
                'basis' => $d['basis'] ?? ($v->sale_mode === 'UNIT' ? 'UNIT' : 'KG'), 'min_qty' => $min,
                'valid_from' => $desde, 'valid_to' => $hasta, 'created_by' => self::quien($u),
                'reason' => isset($d['reason']) ? mb_substr($d['reason'], 0, 80) : null,
                'previous_price' => $iguales->isNotEmpty() ? $iguales->last()->price : null,
            ]);
            Events::emit('price.changed', 'price_list_items', $id, ['list_id' => $l->id, 'variant_id' => $v->id, 'price' => round((float) $d['price'], 2), 'valid_from' => $desde]);

            return DB::table('price_list_items')->where('id', $id)->first();
        });
    }

    /** Cierra la vigencia de un precio en una fecha. */
    public static function cerrarPrecio(object $l, object $item, string $fecha, ?string $motivo, User $u): void
    {
        self::puedeEditar($u, $l->brand_id);
        if ($fecha < $item->valid_from) {
            RuleError::fail('RN-CAT-06', 'La fecha de cierre es anterior al inicio de la vigencia.');
        }
        DB::table('price_list_items')->where('id', $item->id)->update([
            'valid_to' => $fecha, 'closed_by' => self::quien($u), 'closed_reason' => mb_substr($motivo ?: 'Cierre de vigencia', 0, 80), 'updated_at' => now(),
        ]);
        Events::emit('price.changed', 'price_list_items', $item->id, ['list_id' => $l->id, 'variant_id' => $item->variant_id]);
    }

    /**
     * Lee un CSV «sku;precio;desde;cant_min» y devuelve cada fila validada con el precio actual y la diferencia.
     * Nada se guarda: es la vista previa de la importación.
     */
    public static function vistaCsv(object $l, string $texto): array
    {
        $hoy = now()->toDateString();
        $manana = now()->addDay()->toDateString();
        $filas = [];
        foreach (preg_split('/\r?\n/', $texto) as $i => $linea) {
            $linea = trim($linea);
            if ($linea === '' || ($i === 0 && preg_match('/sku/i', $linea))) {
                continue;
            }
            [$sku, $precio, $desde, $min] = array_pad(array_map('trim', explode(str_contains($linea, ';') ? ';' : (str_contains($linea, "\t") ? "\t" : ','), $linea)), 4, '');
            $sku = mb_strtoupper($sku);
            $v = DB::table('product_variants')->where('sku', $sku)->first(['id', 'sku', 'name', 'brand_id', 'sale_mode']);
            $precio = (float) str_replace(',', '.', $precio);
            $fila = ['linea' => $i + 1, 'sku' => $sku, 'variant_id' => $v?->id, 'name' => $v?->name, 'price' => $precio,
                'valid_from' => $desde ?: $manana, 'min_qty' => (float) str_replace(',', '.', $min ?: '0'), 'current' => null, 'diff_pct' => null, 'error' => null];

            if (! $v) {
                $fila['error'] = 'El SKU no existe';
            } elseif ($l->brand_id && $v->brand_id !== $l->brand_id) {
                $fila['error'] = 'Es de otra marca';
            } elseif (! ($precio > 0)) {
                $fila['error'] = 'Precio no válido';
            } elseif (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $fila['valid_from']) || ! strtotime($fila['valid_from'])) {
                $fila['error'] = 'Fecha no válida (AAAA-MM-DD)';
            }
            if ($v) {
                $actual = self::vigentesEn($l->id, $hoy)->first(fn ($x) => $x->variant_id === $v->id && (float) $x->min_qty === $fila['min_qty']);
                if ($actual) {
                    $fila['current'] = (float) $actual->price;
                    $fila['diff_pct'] = round(($precio - $actual->price) / $actual->price * 100, 1);
                }
                $futuro = DB::table('price_list_items')->where('list_id', $l->id)->where('variant_id', $v->id)
                    ->whereRaw('coalesce(min_qty, 0) = ?', [$fila['min_qty']])->where('valid_from', '>=', $fila['valid_from'])->value('valid_from');
                if (! $fila['error'] && $futuro) {
                    $fila['error'] = 'RN-CAT-06: ya hay un precio desde el '.self::fecha($futuro);
                }
            }
            $filas[] = $fila;
        }

        return $filas;
    }

    /** Aplica las filas válidas del CSV, cerrando la vigencia anterior de cada una. */
    public static function importarCsv(object $l, string $texto, ?string $motivo, User $u): array
    {
        self::puedeEditar($u, $l->brand_id);
        $filas = self::vistaCsv($l, $texto);
        $validas = array_filter($filas, fn ($f) => ! $f['error']);
        DB::transaction(function () use ($l, $validas, $motivo, $u) {
            foreach ($validas as $f) {
                self::agregarPrecio($l, ['variant_id' => $f['variant_id'], 'price' => $f['price'], 'min_qty' => $f['min_qty'],
                    'valid_from' => $f['valid_from'], 'cerrar_anterior' => true, 'reason' => $motivo ?: 'Importación CSV'], $u);
            }
        });

        return ['aplicadas' => count($validas), 'con_error' => count($filas) - count($validas)];
    }

    /** Precios de la lista vigentes en una fecha. */
    public static function vigentesEn(string $listaId, string $fecha)
    {
        return DB::table('price_list_items')->where('list_id', $listaId)->where('valid_from', '<=', $fecha)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))->get();
    }

    public static function json($valor): array
    {
        return is_array($valor) ? $valor : (json_decode((string) $valor, true) ?: []);
    }

    private static function quien(User $u): string
    {
        return mb_substr((string) ($u->name ?? $u->email), 0, 40);
    }

    private static function fecha(string $f): string
    {
        return CarbonImmutable::parse($f)->format('d/m/Y');
    }
}
