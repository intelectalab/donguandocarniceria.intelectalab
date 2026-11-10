<?php

namespace App\Modulos\Alm\Services;

use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Events;
use App\Support\Params;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Alertas de vencimiento (ALM-11, RN-ALM-15): lotes con stock que vencen en alm_expiry_alert_days
 * (7) días o menos, separados en 3 y 7 días, y los vencidos, con su valor en soles y la acción
 * sugerida. generarDiarias() deja la foto del día en stock_expiry_alerts (una por lote y día).
 */
final class AlertasService
{
    /** @param  array{brand_id?: ?string, establishment_id?: ?string, establishments?: array, dias?: ?int, al?: ?string}  $f */
    public static function vencimientos(array $f = []): Collection
    {
        $dias = (int) ($f['dias'] ?? Params::get('alm_expiry_alert_days') ?? 7);
        $al = isset($f['al']) ? CarbonImmutable::parse($f['al'], 'America/Lima')->startOfDay() : S::hoy();

        $filas = DB::table('stock_balances as b')->join('lots as l', 'l.id', '=', 'b.lot_id')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')
            ->join('product_variants as v', 'v.id', '=', 'b.variant_id')->join('products as p', 'p.id', '=', 'v.product_id')
            ->where('b.qty', '>', S::EPS)->whereNotIn('l.qc_status', ['REJECTED', 'RECALLED'])->where('w.wh_type', '<>', 'TRANSIT')
            ->where('l.expiry_date', '<=', $al->addDays($dias)->toDateString())
            ->when($f['brand_id'] ?? null, fn ($q, $b) => $q->where('v.brand_id', $b))
            ->when($f['establishment_id'] ?? null, fn ($q, $e) => $q->where('w.establishment_id', $e))
            ->when($f['establishments'] ?? null, fn ($q, $e) => $q->whereIn('w.establishment_id', $e))
            ->groupBy('l.id', 'l.code', 'l.expiry_date', 'l.qc_status', 'v.id', 'v.sku', 'v.name', 'v.brand_id', 'v.sale_mode', 'p.line')
            ->selectRaw("l.id as lot_id, l.code as lot_code, l.expiry_date, l.qc_status, v.id as variant_id, v.sku, v.name as variant_name, v.brand_id, v.sale_mode, p.line,
                sum(b.qty) qty, sum(b.reserved_qty) reserved_qty, sum(b.qty * b.avg_cost) value, string_agg(distinct w.code, ', ') warehouses,
                min(w.establishment_id::text) establishment_id, min(w.id::text) warehouse_id")
            ->orderBy('l.expiry_date')->get();

        return $filas->map(function ($r) use ($al) {
            $d = S::diasDeVida($r->expiry_date, $al);
            $r->expiry_date = substr($r->expiry_date, 0, 10);
            $r->days_left = $d;
            $r->bucket = $d < 0 ? 'EXPIRED' : ($d <= 3 ? 'D3' : 'D7');
            $r->qty = S::t($r->qty);
            $r->reserved_qty = S::t($r->reserved_qty);
            $r->value = S::t($r->value, 2);
            $r->action = $d < 0 ? 'WASTE' : ($d <= 1 ? 'PROMO' : ($d <= 3 ? 'PROMO_FEFO' : 'SELL_FIRST'));
            $r->action_label = ['WASTE' => 'Merma por vencido', 'PROMO' => 'Vender hoy o promoción', 'PROMO_FEFO' => 'Promoción y vender primero', 'SELL_FIRST' => 'Vender primero (FEFO)'][$r->action];

            return $r;
        });
    }

    /** Foto diaria (RN-ALM-15). Devuelve cuántas alertas nuevas dejó; correrla dos veces el mismo día no duplica. */
    public static function generarDiarias(?string $fecha = null): array
    {
        $al = $fecha ? CarbonImmutable::parse($fecha, 'America/Lima')->startOfDay() : S::hoy();

        return DB::transaction(function () use ($al) {
            $nuevas = ['EXPIRED' => 0, 'D3' => 0, 'D7' => 0];
            $valor = 0.0;
            foreach (self::vencimientos(['al' => $al->toDateString()]) as $a) {
                $ok = DB::table('stock_expiry_alerts')->insertOrIgnore([
                    'alert_date' => $al->toDateString(), 'lot_id' => $a->lot_id, 'variant_id' => $a->variant_id, 'bucket' => $a->bucket,
                    'days_left' => $a->days_left, 'qty' => $a->qty, 'reserved_qty' => $a->reserved_qty, 'value_pen' => $a->value,
                ]);
                if ($ok) {
                    $nuevas[$a->bucket]++;
                    $valor += (float) $a->value;
                }
            }
            if (array_sum($nuevas)) {
                $txt = "{$nuevas['D3']} lote(s) vencen en 3 días o menos, {$nuevas['D7']} en 7 días y {$nuevas['EXPIRED']} ya vencieron · S/ ".number_format($valor, 2);
                DB::table('notifications')->insert([
                    'role' => 'ALMACENERO', 'title' => 'Lotes por vencer', 'body' => $txt.'. Revísalos en Alertas de vencimiento.',
                    'ref' => json_encode(['screen' => 'ALM-11', 'date' => $al->toDateString()]), 'tone' => $nuevas['EXPIRED'] || $nuevas['D3'] ? 'warn' : 'info',
                    'module' => 'ALM', 'at' => now(), 'type' => 'stock.expiring', 'in_app' => true,
                ]);
                // Ventas también se entera: ofrece primero lo que vence (RN-ALM-15).
                DB::table('notifications')->insert([
                    'role' => 'SUPERVISORA_VENTAS', 'title' => ($nuevas['D3'] + $nuevas['D7']).' lote(s) por vencer', 'body' => $txt.'. Ofrécelos primero o con promoción.',
                    'ref' => json_encode(['screen' => 'ALM-11', 'date' => $al->toDateString()]), 'tone' => 'warn',
                    'module' => 'ALM', 'at' => now(), 'type' => 'stock.expiring', 'in_app' => true,
                ]);
                Events::emit('stock.expiring', 'stock_expiry_alerts', null, ['date' => $al->toDateString(), 'd3' => $nuevas['D3'], 'd7' => $nuevas['D7'],
                    'expired' => $nuevas['EXPIRED'], 'value_pen' => S::t($valor, 2)]);
            }

            return ['date' => $al->toDateString(), 'new' => $nuevas, 'value_pen' => S::t($valor, 2)];
        });
    }
}
