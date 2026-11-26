<?php

namespace App\Modulos\B2b\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Modulos\Cat\Services\Precios;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * B2B-03: precio por cliente y presentación con vigencia (RN-B2B-06), aprobación bajo el margen mínimo
 * (RN-B2B-07) y el precio que rige un pedido B2B: el del cliente antes que la lista del canal.
 */
final class PreciosCliente
{
    /** Costo promedio de la presentación (saldos de ALM) o, sin stock, su costo estándar. */
    public static function costo(string $variantId): float
    {
        $r = DB::table('stock_balances')->where('variant_id', $variantId)->where('qty', '>', 0)
            ->selectRaw('sum(qty * avg_cost) AS valor, sum(qty) AS q')->first();

        return $r && (float) $r->q > 0 ? S::r((float) $r->valor / (float) $r->q, 4) : (float) DB::table('product_variants')->where('id', $variantId)->value('std_cost');
    }

    public static function minimo(string $variantId): float
    {
        return S::r(self::costo($variantId) * (1 + S::num('b2b_min_margin_pct', 10) / 100));
    }

    /** Precio vigente del cliente para la presentación en una fecha (solo ACTIVE). */
    public static function delCliente(string $customerId, string $variantId, ?string $fecha = null): ?object
    {
        $f = S::fecha($fecha);

        return DB::table('customer_prices')->where('customer_id', $customerId)->where('variant_id', $variantId)->where('status', 'ACTIVE')
            ->where('valid_from', '<=', $f)->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $f))->first();
    }

    /** Precio de la lista del canal B2B para el tipo de cliente. */
    public static function deLista(string $customerId, string $variantId, ?string $fecha = null): ?array
    {
        $tipo = DB::table('customers')->where('id', $customerId)->value('customer_type') ?? 'BUSINESS';

        return Precios::vigente($variantId, ['canal' => 'B2B', 'tipo_cliente' => $tipo, 'fecha' => S::fecha($fecha)]);
    }

    /**
     * RN-B2B-06: el precio del cliente prevalece sobre la lista del canal.
     *
     * @return array{price: float, basis: string, list_id: string, list_price: ?float, source: string}|null
     */
    public static function precio(string $customerId, string $variantId, ?string $fecha = null): ?array
    {
        $lista = self::deLista($customerId, $variantId, $fecha);
        $propio = self::delCliente($customerId, $variantId, $fecha);
        if ($propio) {
            $listId = $lista['list_id'] ?? DB::table('price_list_items')->where('variant_id', $variantId)->orderByDesc('valid_from')->value('list_id');
            if (! $listId) {
                return null;
            }

            return ['price' => (float) $propio->unit_price, 'basis' => $propio->price_basis, 'list_id' => $listId, 'list_price' => $lista['price'] ?? null, 'source' => 'CUSTOMER'];
        }

        return $lista ? ['price' => $lista['price'], 'basis' => $lista['basis'], 'list_id' => $lista['list_id'], 'list_price' => $lista['price'], 'source' => 'LIST'] : null;
    }

    public static function guardar(array $d, User $quien): object
    {
        return S::base(fn () => DB::transaction(function () use ($d, $quien) {
            $v = DB::table('product_variants')->where('id', $d['variant_id'] ?? null)->first() ?? RuleError::fail('RN-B2B-06', 'Elige la presentación.');
            $precio = (float) ($d['unit_price'] ?? 0);
            $precio > 0 || RuleError::fail('RN-B2B-06', 'El precio debe ser mayor que cero.');
            $desde = $d['valid_from'] ?? null;
            $desde || RuleError::fail('RN-B2B-06', 'Indica el inicio de la vigencia.');
            $hasta = $d['valid_to'] ?? null;
            if ($hasta && $hasta < $desde) {
                RuleError::fail('RN-B2B-06', 'La vigencia termina antes de empezar.');
            }
            $choca = DB::table('customer_prices')->where('customer_id', $d['customer_id'])->where('variant_id', $v->id)->where('status', '<>', 'REJECTED')
                ->where('valid_from', '<=', $hasta ?? '9999-12-31')->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $desde))->first();
            if ($choca) {
                RuleError::fail('RN-B2B-06', "{$v->name} ya tiene un precio de ".S::soles($choca->unit_price).'/'.($choca->price_basis === 'KG' ? 'kg' : 'u').' del '.S::dmy($choca->valid_from).' al '
                    .($choca->valid_to ? S::dmy($choca->valid_to) : 'indefinido').': las vigencias no se traslapan. Cierra el anterior antes.');
            }
            $min = self::minimo($v->id);
            $bajo = $precio < $min - 0.005;
            $puede = Access::can($quien, 'b2b.price.approve_below_margin');
            $id = DB::table('customer_prices')->insertGetId([
                'customer_id' => $d['customer_id'], 'variant_id' => $v->id, 'unit_price' => $precio,
                'price_basis' => $d['price_basis'] ?? ($v->sale_mode === 'UNIT' ? 'UNIT' : 'KG'), 'valid_from' => $desde, 'valid_to' => $hasta,
                'status' => $bajo && ! $puede ? 'PENDING_APPROVAL' : 'ACTIVE', 'cost_at_request' => self::costo($v->id), 'min_price' => $min,
                'notes' => $d['notes'] ?? null, 'requested_by' => $quien->id, 'below_margin_approved_by' => $bajo && $puede ? $quien->id : null,
                'decided_at' => $bajo && $puede ? now() : null,
            ], 'id');
            if ($bajo && ! $puede) {
                S::avisar('B2B', ['role' => 'GERENTE'], 'Precio bajo el margen mínimo por aprobar', DB::table('customers')->where('id', $d['customer_id'])->value('full_name')." · {$v->name} a ".S::soles($precio).' (mínimo '.S::soles($min).')', 'B2B-03', $d['customer_id'], 'warning');
            }

            return DB::table('customer_prices')->where('id', $id)->first();
        }));
    }

    public static function decidir(string $id, bool $aprobar, ?string $nota, User $quien): object
    {
        return S::base(fn () => DB::transaction(function () use ($id, $aprobar, $nota, $quien) {
            $p = DB::table('customer_prices')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            $p->status === 'PENDING_APPROVAL' || RuleError::fail('RN-B2B-07', 'Ese precio no está por aprobar.');
            $p->requested_by !== $quien->id || RuleError::fail('RN-B2B-07', 'Quien registra el precio no lo aprueba.');
            DB::table('customer_prices')->where('id', $id)->update([
                'status' => $aprobar ? 'ACTIVE' : 'REJECTED', 'below_margin_approved_by' => $aprobar ? $quien->id : null, 'decided_at' => now(),
                'reject_reason' => $aprobar ? null : ($nota ? mb_substr($nota, 0, 255) : 'Rechazado'),
                'notes' => trim(implode(' · ', array_filter([$p->notes, $aprobar ? $nota : null]))) ?: null, 'updated_at' => now(),
            ]);

            return DB::table('customer_prices')->where('id', $id)->first();
        }));
    }

    public static function cerrar(string $id, string $hasta, User $quien): object
    {
        $p = DB::table('customer_prices')->where('id', $id)->first() ?? abort(404);
        $hasta = S::fecha($hasta);
        $hasta >= $p->valid_from || RuleError::fail('RN-B2B-06', 'El cierre no puede ser anterior al inicio.');
        DB::table('customer_prices')->where('id', $id)->update(['valid_to' => $hasta, 'updated_at' => now()]);

        return DB::table('customer_prices')->where('id', $id)->first();
    }
}
