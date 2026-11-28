<?php

namespace App\Modulos\Web\Services;

use Illuminate\Support\Facades\DB;

/**
 * Stock publicado (RN-WEB-05): disponible (saldo − reservado) de los lotes liberados y no vencidos en los almacenes de
 * la tienda × (1 − margen de seguridad), redondeado hacia abajo. Un lote vencido, en cuarentena o rechazado no suma
 * (CA-WEB-05). Lee los saldos de ALM; no escribe nada.
 */
final class Stock
{
    /**
     * @param  string[]  $variantes
     * @return array<string, array{total: float, reservado: float, no_usable: float, disponible: float, margen: float, crudo: float, publicado: int, lotes: list<array>}>
     */
    public static function publicados(object $s, array $variantes, bool $conLotes = false): array
    {
        $variantes = array_values(array_unique(array_filter($variantes)));
        $margen = (float) $s->safety_margin_pct;
        $out = [];
        foreach ($variantes as $v) {
            $out[$v] = ['total' => 0.0, 'reservado' => 0.0, 'no_usable' => 0.0, 'disponible' => 0.0, 'margen' => $margen, 'crudo' => 0.0, 'publicado' => 0, 'lotes' => []];
        }
        $almacenes = (array) $s->warehouse_ids;
        if (! $variantes || ! $almacenes) {
            return $out;
        }
        $hoy = Base::hoy();
        $filas = DB::table('stock_balances as b')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')->leftJoin('warehouses as w', 'w.id', '=', 'b.warehouse_id')
            ->whereIn('b.variant_id', $variantes)->whereIn('b.warehouse_id', $almacenes)
            ->where(fn ($q) => $q->where('b.qty', '>', 0.0005)->orWhere('b.reserved_qty', '>', 0))
            ->orderByRaw("coalesce(l.expiry_date, '9999-12-31')")->orderBy('w.name')
            ->get(['b.variant_id', 'b.warehouse_id', 'w.name as almacen', 'b.lot_id', 'l.code as lote', 'l.expiry_date', 'l.qc_status', 'b.qty', 'b.reserved_qty']);
        foreach ($filas as $b) {
            $usable = ! $b->lot_id || ($b->qc_status === 'RELEASED' && $b->expiry_date !== null && substr((string) $b->expiry_date, 0, 10) >= $hoy);
            $qty = (float) $b->qty;
            $res = (float) $b->reserved_qty;
            $libre = max(0, round($qty - $res, 3));
            $x = &$out[$b->variant_id];
            $x['total'] += $qty;
            if ($usable) {
                $x['reservado'] += $res;
                $x['disponible'] += $libre;
            } else {
                $x['no_usable'] += $qty;
            }
            if ($conLotes) {
                $porque = null;
                if (! $usable) {
                    $porque = $b->qc_status !== 'RELEASED' ? 'Lote '.match ($b->qc_status) {
                        'QUARANTINE' => 'en cuarentena', 'REJECTED' => 'rechazado', 'BLOCKED' => 'bloqueado', 'RECALLED' => 'retirado del mercado', default => 'no liberado'
                    } : 'Vencido el '.date('d/m/Y', strtotime((string) $b->expiry_date));
                }
                $x['lotes'][] = ['almacen' => $b->almacen, 'lote' => $b->lote ?? 'Sin lote', 'vence' => $b->expiry_date ? substr((string) $b->expiry_date, 0, 10) : null,
                    'qty' => round($qty, 3), 'reservado' => round($res, 3), 'libre' => $libre, 'usable' => $usable, 'porque' => $porque];
            }
            unset($x);
        }
        foreach ($out as &$x) {
            $x['total'] = round($x['total'], 3);
            $x['reservado'] = round($x['reservado'], 3);
            $x['no_usable'] = round($x['no_usable'], 3);
            $x['disponible'] = round($x['disponible'], 3);
            $x['crudo'] = round($x['disponible'] * (1 - $margen / 100), 4);
            $x['publicado'] = max(0, (int) floor($x['crudo'] + 1e-9));
        }
        unset($x);

        return $out;
    }

    public static function publicado(object $s, string $variante): array
    {
        return self::publicados($s, [$variante], true)[$variante];
    }

    /** «7 × 0,90 = 6,30 → 6» */
    public static function formula(array $x): string
    {
        $d = $x['disponible'];

        return number_format($d, fmod($d, 1.0) ? 3 : 0, ',', '.').' × '.number_format(1 - $x['margen'] / 100, 2, ',', '.').' = '
            .number_format($x['crudo'], 2, ',', '.').' → '.$x['publicado'];
    }
}
