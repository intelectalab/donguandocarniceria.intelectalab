<?php

namespace App\Modulos\Cat\Services;

use App\Models\User;
use App\Modulos\Cat\Models\Product;
use App\Modulos\Cat\Models\ProductVariant;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Variantes (SKU por corte o presentación) de CAT-03, con sus reglas:
 *  RN-CAT-01  el SKU y el código de barras son únicos en la empresa.
 *  RN-CAT-02  una variante de peso variable exige peso nominal por unidad.
 *  RN-CAT-03  mínimo ≤ nominal ≤ máximo.
 *  RN-CAT-04  el PLU de balanza (5 dígitos) es único entre las variantes activas.
 *  RN-CAT-07  cantidad mínima y múltiplo no negativos.
 *  RN-CAT-09  con el registro sanitario vencido, no se publica en la web.
 *  RN-CAT-11  con movimientos no se borra: se inactiva. No se activa si su producto está inactivo.
 */
final class Variantes
{
    public const MODOS = ['UNIT', 'KG', 'UNIT_VARIABLE_WEIGHT'];

    /** Tablas donde una variante deja huella: con alguna fila, ya no se borra. */
    private const MOVIMIENTOS = [
        'sales_order_lines', 'sales_document_lines', 'stock_movements', 'stock_balances', 'lots', 'stock_receipt_lines',
        'stock_reservations', 'stock_transfer_lines', 'stock_count_lines', 'stock_waste_records', 'picking_task_lines', 'picking_scans',
        'dispatch_guide_lines', 'recipe_ingredients', 'food_additives', 'web_product_mappings',
    ];

    public static function tieneMovimientos(string $variantId): bool
    {
        foreach (self::MOVIMIENTOS as $tabla) {
            if (DB::table($tabla)->where('variant_id', $variantId)->exists()) {
                return true;
            }
        }

        return DB::table('combo_components')->where('combo_variant_id', $variantId)->orWhere('component_variant_id', $variantId)->exists();
    }

    /** Tolerancia de peso por defecto (ped_weight_tolerance_pct). */
    public static function toleranciaPorDefecto(?string $brandId = null): float
    {
        return (float) (Params::get('ped_weight_tolerance_pct', ['brand' => $brandId]) ?? 10);
    }

    /** @param  array<string, mixed>  $d  campos validados */
    public static function guardar(array $d, ?ProductVariant $actual, User $quien): ProductVariant
    {
        $p = Product::findOrFail($actual?->product_id ?? $d['product_id']);
        $marcas = Access::for($quien)['brands'];
        if ($marcas && ! in_array($p->brand_id, $marcas, true)) {
            RuleError::fail('RN-CAT-01', 'Solo puedes registrar variantes de productos de tus marcas.');
        }

        $modo = $d['sale_mode'];
        $porUnidad = $modo === 'UNIT';
        $nom = $porUnidad ? null : self::num($d['nominal_weight_kg'] ?? null);
        $min = $porUnidad ? null : self::num($d['min_weight_kg'] ?? null);
        $max = $porUnidad ? null : self::num($d['max_weight_kg'] ?? null);
        $status = $d['status'] ?? 'ACTIVE';

        if ($modo === 'UNIT_VARIABLE_WEIGHT' && ! ($nom > 0)) {
            RuleError::fail('RN-CAT-02', 'Una variante de peso variable exige el peso nominal por unidad (se pide por unidad y se cobra por kg).');
        }
        if ($min !== null && $max !== null && $min > $max) {
            RuleError::fail('RN-CAT-03', 'El peso mínimo ('.self::kg($min).') supera al máximo ('.self::kg($max).').');
        }
        if ($nom !== null && $min !== null && $nom < $min) {
            RuleError::fail('RN-CAT-03', 'El peso nominal ('.self::kg($nom).') es menor que el mínimo ('.self::kg($min).').');
        }
        if ($nom !== null && $max !== null && $nom > $max) {
            RuleError::fail('RN-CAT-03', 'El peso nominal ('.self::kg($nom).') es mayor que el máximo ('.self::kg($max).').');
        }

        $plu = $d['scale_plu'] ?? null;
        if ($plu && $status === 'ACTIVE') {
            self::pluLibre($plu, $actual?->id);
        }
        if (! empty($d['web_publishable']) && RegistroSanitario::estado($p)['code'] === 'EXPIRED') {
            RuleError::fail('RN-CAT-09', "{$p->name} tiene el registro sanitario vencido: no se publica en la web.");
        }
        if ($status === 'ACTIVE' && $p->status !== 'ACTIVE') {
            RuleError::fail('RN-CAT-11', 'El producto está inactivo: actívalo primero.');
        }
        if (! empty($d['cut_type_id'])) {
            $lineas = json_decode((string) DB::table('cut_types')->where('id', $d['cut_type_id'])->value('applies_to_lines'), true) ?: [];
            if ($lineas && ! in_array($p->line, $lineas, true)) {
                RuleError::fail('RN-CAT-01', 'Ese tipo de corte no aplica a la línea del producto.');
            }
        }

        $fila = [
            'product_id' => $p->id, 'brand_id' => $p->brand_id, 'line' => $p->line,
            'sku' => $d['sku'], 'name' => $d['name'], 'cut_type_id' => $d['cut_type_id'] ?? null,
            'uom_id' => DB::table('units_of_measure')->where('code', $porUnidad ? 'NIU' : 'KGM')->value('id'),
            'sale_mode' => $modo, 'nominal_weight_kg' => $nom, 'min_weight_kg' => $min, 'max_weight_kg' => $max,
            'weight_tolerance_pct' => $porUnidad ? null : self::num($d['weight_tolerance_pct'] ?? null),
            'barcode' => $d['barcode'] ?? null, 'scale_plu' => $plu,
            'min_order_qty' => self::num($d['min_order_qty'] ?? null), 'qty_step' => self::num($d['qty_step'] ?? null),
            'std_cost' => self::num($d['std_cost'] ?? null) ?? ($actual?->std_cost ?? 0),
            'web_publishable' => (bool) ($d['web_publishable'] ?? false), 'status' => $status,
            'sellable' => in_array($p->product_type, ['GOODS', 'COMBO', 'SERVICE'], true),
        ];

        return DB::transaction(function () use ($fila, $actual) {
            $v = $actual ? tap($actual)->update($fila) : ProductVariant::create($fila);
            Events::emit('product.changed', 'product_variants', $v->id, ['sku' => $v->sku, 'status' => $v->status]);

            return $v->fresh();
        });
    }

    public static function cambiarEstado(ProductVariant $v, string $status): ProductVariant
    {
        if ($status === 'ACTIVE') {
            if (DB::table('products')->where('id', $v->product_id)->value('status') !== 'ACTIVE') {
                RuleError::fail('RN-CAT-11', 'El producto está inactivo: actívalo primero.');
            }
            if ($v->scale_plu) {
                self::pluLibre($v->scale_plu, $v->id);
            }
        }

        return DB::transaction(function () use ($v, $status) {
            $v->update(['status' => $status]);
            Events::emit('product.changed', 'product_variants', $v->id, ['sku' => $v->sku, 'status' => $status]);

            return $v->fresh();
        });
    }

    /** Solo se borra una variante sin movimientos; sus precios se van con ella. */
    public static function borrar(ProductVariant $v): void
    {
        if (self::tieneMovimientos($v->id)) {
            RuleError::fail('RN-CAT-11', "{$v->name} tiene movimientos o ventas: no se borra. Inactívala: deja de aparecer en pedidos, mostrador y la web.");
        }
        DB::transaction(function () use ($v) {
            DB::table('price_list_items')->where('variant_id', $v->id)->delete();
            $v->delete();
            Events::emit('product.changed', 'product_variants', $v->id, ['sku' => $v->sku, 'change' => 'deleted']);
        });
    }

    private static function pluLibre(string $plu, ?string $menos): void
    {
        $otra = DB::table('product_variants')->where('status', 'ACTIVE')->where('scale_plu', $plu)
            ->when($menos, fn ($q) => $q->where('id', '!=', $menos))->first(['sku', 'name']);
        if ($otra) {
            RuleError::fail('RN-CAT-04', "El PLU {$plu} ya lo usa {$otra->name} ({$otra->sku}): una etiqueta debe identificar un solo producto.");
        }
    }

    private static function num(mixed $x): ?float
    {
        return $x === null || $x === '' ? null : (float) $x;
    }

    private static function kg(float $x): string
    {
        return number_format($x, 3, ',', '.').' kg';
    }
}
