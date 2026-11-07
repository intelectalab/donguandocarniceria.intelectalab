<?php

namespace App\Modulos\Cat\Services;

use App\Models\User;
use App\Modulos\Cat\Models\ProductVariant;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Combos (CAT-08, RN-CAT-08): un combo no contiene otro combo; sus componentes son variantes vendibles
 * activas y el reparto del precio suma 100 %. El stock y el comprobante salen por componente (desglose()).
 */
final class Combos
{
    /** Componentes del combo con los datos de su variante. */
    public static function componentes(string $comboId)
    {
        return DB::table('combo_components as c')->join('product_variants as v', 'v.id', '=', 'c.component_variant_id')
            ->leftJoin('products as p', 'p.id', '=', 'v.product_id')
            ->where('c.combo_variant_id', $comboId)->orderByDesc('c.price_share_pct')->orderBy('v.sku')
            ->get(['c.id', 'c.component_variant_id', 'v.sku', 'v.name', 'v.sale_mode', 'v.status', 'v.sellable', 'p.product_type',
                'c.qty', 'c.est_weight_kg', 'c.price_share_pct']);
    }

    /** RN-CAT-08: ¿el combo está bien armado? */
    public static function revisar(string $comboId): array
    {
        $cs = self::componentes($comboId);
        $suma = round((float) $cs->sum('price_share_pct'), 3);
        $problemas = [];
        if ($cs->isEmpty()) {
            $problemas[] = 'El combo no tiene componentes.';
        }
        if ($cs->isNotEmpty() && abs($suma - 100) > 0.001) {
            $problemas[] = 'El reparto del precio suma '.self::num($suma).' % y debe sumar 100 %.';
        }
        foreach ($cs as $c) {
            if ($c->product_type === 'COMBO') {
                $problemas[] = "«{$c->name}» es un combo: un combo no contiene otro combo.";
            } elseif ($c->status !== 'ACTIVE' || ! $c->sellable) {
                $problemas[] = "«{$c->name}» no es una variante vendible activa.";
            }
        }

        return ['ok' => ! $problemas, 'suma' => $suma, 'problemas' => $problemas];
    }

    /** Stock disponible para vender por variante: almacenes de venta activos y lotes liberados sin vencer, menos lo reservado. */
    public static function stock(array $variantIds): array
    {
        if (! $variantIds) {
            return [];
        }
        $hoy = now()->toDateString();
        $filas = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')
            ->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')
            ->whereIn('b.variant_id', $variantIds)->where('w.allows_sale', true)->where('w.status', 'ACTIVE')
            ->where(fn ($q) => $q->whereNull('b.lot_id')->orWhere(fn ($w) => $w->where('l.qc_status', 'RELEASED')
                ->where(fn ($x) => $x->whereNull('l.expiry_date')->orWhere('l.expiry_date', '>=', $hoy))))
            ->groupBy('b.variant_id')->selectRaw('b.variant_id, sum(b.qty - coalesce(b.reserved_qty, 0)) as disponible')
            ->pluck('disponible', 'variant_id');

        return collect($variantIds)->mapWithKeys(fn ($id) => [$id => round((float) ($filas[$id] ?? 0), 3)])->all();
    }

    /** Cuántos combos alcanzan con el stock de cada componente. */
    public static function alcanza($componentes, array $stock): int
    {
        if ($componentes->isEmpty()) {
            return 0;
        }

        return max(0, (int) $componentes->map(fn ($c) => floor(($stock[$c->component_variant_id] ?? 0) / max((float) $c->qty, 0.001) + 1e-9))->min());
    }

    /** Lo que sale por componente al vender qty combos por un total: cantidad, peso e importe repartido. */
    public static function desglose(string $comboId, float $qty, float $total): array
    {
        $r = self::revisar($comboId);
        if (! $r['ok']) {
            RuleError::fail('RN-CAT-08', implode(' ', $r['problemas']));
        }

        return self::componentes($comboId)->map(fn ($c) => [
            'variant_id' => $c->component_variant_id, 'qty' => round($c->qty * $qty, 3),
            'est_weight_kg' => $c->est_weight_kg === null ? null : round($c->est_weight_kg * $qty, 3),
            'price_share_pct' => (float) $c->price_share_pct, 'amount' => round($total * $c->price_share_pct / 100, 2),
        ])->values()->all();
    }

    public static function delAlcance(User $u, string $comboId): object
    {
        $marcas = Access::for($u)['brands'];

        return DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')
            ->where('v.id', $comboId)->where('p.product_type', 'COMBO')
            ->when($marcas, fn ($q) => $q->whereIn('v.brand_id', $marcas))
            ->first(['v.id', 'v.sku', 'v.name', 'v.brand_id']) ?? abort(404);
    }

    /** Agrega o actualiza un componente (RN-CAT-08). */
    public static function guardarComponente(object $combo, array $d, ?object $actual): object
    {
        $compId = $actual?->component_variant_id ?? $d['component_variant_id'];
        $cv = DB::table('product_variants as v')->leftJoin('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $compId)
            ->first(['v.id', 'v.name', 'v.brand_id', 'v.status', 'v.sellable', 'v.sale_mode', 'v.nominal_weight_kg', 'p.product_type']);
        if (! $cv) {
            RuleError::fail('RN-CAT-08', 'Elige la variante del componente.');
        }
        if ($cv->id === $combo->id || $cv->product_type === 'COMBO') {
            RuleError::fail('RN-CAT-08', "Un combo no contiene otro combo: «{$cv->name}» es un combo.");
        }
        if ($cv->status !== 'ACTIVE' || ! $cv->sellable) {
            RuleError::fail('RN-CAT-08', "«{$cv->name}» no es una variante vendible activa: no puede ser componente.");
        }
        if ($cv->brand_id !== $combo->brand_id) {
            RuleError::fail('RN-CAT-08', "«{$cv->name}» es de otra marca que el combo.");
        }
        $otros = DB::table('combo_components')->where('combo_variant_id', $combo->id)->when($actual, fn ($q) => $q->where('id', '!=', $actual->id));
        if (! $actual && (clone $otros)->where('component_variant_id', $cv->id)->exists()) {
            RuleError::fail('RN-CAT-08', 'Ese componente ya está en el combo: edita su cantidad.');
        }
        $suma = (float) (clone $otros)->sum('price_share_pct') + (float) $d['price_share_pct'];
        if ($suma > 100.001) {
            RuleError::fail('RN-CAT-08', 'Con este componente el reparto sumaría '.self::num($suma).' %: no puede pasar de 100 %.');
        }

        $qty = (float) $d['qty'];
        $peso = isset($d['est_weight_kg']) && $d['est_weight_kg'] !== null ? (float) $d['est_weight_kg'] : match ($cv->sale_mode) {
            'UNIT_VARIABLE_WEIGHT' => round($qty * (float) $cv->nominal_weight_kg, 3),
            'KG' => $qty,
            default => null,
        };
        $fila = ['qty' => $qty, 'est_weight_kg' => $peso, 'price_share_pct' => (float) $d['price_share_pct']];
        if ($actual) {
            DB::table('combo_components')->where('id', $actual->id)->update($fila + ['updated_at' => now()]);
            $id = $actual->id;
        } else {
            $id = DB::table('combo_components')->insertGetId($fila + ['combo_variant_id' => $combo->id, 'component_variant_id' => $cv->id]);
        }
        Events::emit('product.changed', 'product_variants', $combo->id, ['variant_id' => $combo->id, 'change' => 'combo']);

        return DB::table('combo_components')->where('id', $id)->first();
    }

    public static function quitarComponente(object $combo, object $c): void
    {
        DB::table('combo_components')->where('id', $c->id)->delete();
        Events::emit('product.changed', 'product_variants', $combo->id, ['variant_id' => $combo->id, 'change' => 'combo']);
    }

    /** Nuevo combo: producto COMBO con su variante por unidad y su precio en las listas generales activas de la marca. */
    public static function crear(array $d, User $u): ProductVariant
    {
        return DB::transaction(function () use ($d, $u) {
            $categoria = DB::table('product_categories')->where('line', 'COMBOS')->value('id');
            $p = Productos::guardar([
                'code' => $d['code'], 'name' => $d['name'], 'brand_id' => $d['brand_id'], 'category_id' => $categoria,
                'product_type' => 'COMBO', 'origin' => 'PRODUCED', 'storage' => 'CHILLED', 'shelf_life_days' => 5, 'requires_lot' => false,
                'igv_affectation' => '10', 'allow_discount' => false, 'sanitary_authority' => 'NONE', 'status' => 'ACTIVE',
            ], null, $u);
            $prefijo = DB::table('brands')->where('id', $d['brand_id'])->value('code');
            $v = Variantes::guardar([
                'product_id' => $p->id, 'sku' => ($prefijo ? $prefijo.'-' : '').$d['code'], 'name' => $d['name'], 'sale_mode' => 'UNIT',
                'min_order_qty' => 1, 'qty_step' => 1, 'status' => 'ACTIVE', 'web_publishable' => false,
            ], null, $u);

            $hoy = now()->toDateString();
            $listas = DB::table('price_lists')->where('brand_id', $d['brand_id'])->where('status', 'ACTIVE')
                ->where(fn ($q) => $q->whereNull('valid_from')->orWhere('valid_from', '<=', $hoy))
                ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $hoy))->get()
                ->filter(fn ($l) => ! Listas::json($l->customer_types));
            foreach ($listas as $l) {
                $precio = str_contains($l->code, 'B2B') ? round($d['price'] * 0.9, 2) : (float) $d['price'];
                Listas::agregarPrecio($l, ['variant_id' => $v->id, 'price' => $precio, 'basis' => 'UNIT', 'valid_from' => $hoy, 'reason' => 'Alta de combo'], $u);
            }

            return $v;
        });
    }

    private static function num(float $x): string
    {
        return rtrim(rtrim(number_format($x, 2, ',', '.'), '0'), ',');
    }
}
