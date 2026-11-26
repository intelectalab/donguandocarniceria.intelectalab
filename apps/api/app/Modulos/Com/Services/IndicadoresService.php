<?php

namespace App\Modulos\Com\Services;

use App\Modulos\Com\Services\Soporte as C;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** COM-11 Evaluación de proveedores y COM-12 Tablero de compras (KPI-COM-01 a 06). */
final class IndicadoresService
{
    /** Líneas de producto cárnico (KPI-COM-05). */
    public const CARNICOS = ['CERDO', 'CUY', 'AVES', 'CONEJO', 'RES', 'CORDERO', 'EMBUTIDOS'];

    /** @return array{0: string, 1: string} primer y último día del mes */
    public static function mes(?string $mes): array
    {
        $d = CarbonImmutable::parse(($mes ? substr($mes, 0, 7) : C::ahora()->format('Y-m')).'-01');

        return [$d->toDateString(), $d->endOfMonth()->toDateString()];
    }

    /** Puntualidad, recepciones observadas, diferencias de peso y de precio por proveedor en el mes, con su puntaje de 1 a 5. */
    public static function evaluacion(?string $mes): array
    {
        [$de, $a] = self::mes($mes);
        $rcs = DB::table('purchase_receipts as r')->leftJoin('purchase_orders as o', 'o.id', '=', 'r.po_id')->where('r.status', 'POSTED')
            ->whereRaw("(r.received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])
            ->get(['r.id', 'r.supplier_id', 'r.po_id', 'r.received_at', 'o.expected_date']);
        $lineas = DB::table('purchase_receipt_lines as l')->leftJoin('purchase_order_lines as pl', 'pl.id', '=', 'l.po_line_id')
            ->whereIn('l.receipt_id', $rcs->pluck('id'))->get(['l.receipt_id', 'l.accepted', 'l.quality_hold', 'l.price_basis', 'l.weight_kg', 'pl.est_weight_kg', 'pl.qty as po_qty'])
            ->groupBy('receipt_id');
        $docs = DB::table('purchase_documents')->where('status', '<>', 'VOIDED')->whereBetween('issue_date', [$de, $a])->get(['supplier_id', 'match_status'])->groupBy('supplier_id');
        $out = [];
        foreach ($rcs->groupBy('supplier_id') as $sid => $rs) {
            $conOc = $rs->whereNotNull('po_id');
            $aTiempo = $conOc->filter(fn ($r) => $r->expected_date && CarbonImmutable::parse($r->received_at)->setTimezone('America/Lima')->toDateString() <= $r->expected_date)->count();
            $ls = $rs->flatMap(fn ($r) => $lineas[$r->id] ?? []);
            $obs = $ls->filter(fn ($l) => ! $l->accepted || $l->quality_hold)->count();
            $dp = $ls->filter(fn ($l) => $l->price_basis === 'KG' && ($l->est_weight_kg ?? $l->po_qty))->map(fn ($l) => abs((float) $l->weight_kg - (float) ($l->est_weight_kg ?? $l->po_qty)) / (float) ($l->est_weight_kg ?? $l->po_qty) * 100);
            $ds = $docs[$sid] ?? collect();
            $precio = $ds->whereIn('match_status', ['OBSERVED', 'APPROVED_DIFF'])->count();
            $punt = $conOc->count() ? $aTiempo / $conOc->count() * 100 : null;
            $obsPct = $ls->count() ? $obs / $ls->count() * 100 : 0;
            $pesoPct = $dp->count() ? $dp->avg() : 0;
            $precioPct = $ds->count() ? $precio / $ds->count() * 100 : 0;
            $puntaje = round(($punt ?? 100) / 100 * 2 + (1 - min($obsPct, 50) / 50) * 1.2 + (1 - min($pesoPct, 10) / 10) * 0.9 + (1 - min($precioPct, 50) / 50) * 0.9, 2);
            $s = DB::table('suppliers')->where('id', $sid)->first(['legal_name', 'trade_name', 'supplier_type', 'rating']);
            $out[] = ['supplier_id' => $sid, 'supplier_name' => $s->trade_name ?: $s->legal_name, 'supplier_type' => $s->supplier_type, 'current_rating' => $s->rating,
                'receipts' => $rs->count(), 'with_po' => $conOc->count(), 'on_time' => $aTiempo, 'punctuality' => $punt === null ? null : C::t($punt, 1),
                'lines' => $ls->count(), 'observed' => $obs, 'observed_pct' => C::t($obsPct, 1), 'weight_diff_pct' => C::t($pesoPct, 2),
                'docs' => $ds->count(), 'price_obs' => $precio, 'price_obs_pct' => C::t($precioPct, 1), 'score' => C::t($puntaje), 'rating' => max(1, min(5, (int) round($puntaje)))];
        }
        usort($out, fn ($x, $y) => (float) $y['score'] <=> (float) $x['score']);

        return $out;
    }

    /** Guarda la calificación del mes en la ficha de cada proveedor evaluado. */
    public static function fijarCalificaciones(?string $mes): int
    {
        $n = 0;
        foreach (self::evaluacion($mes) as $e) {
            $n += DB::table('suppliers')->where('id', $e['supplier_id'])->update(['rating' => $e['rating'], 'updated_at' => now()]);
        }

        return $n;
    }

    /** KPI-COM-01 a 06 del mes. */
    public static function tablero(?string $mes): array
    {
        [$de, $a] = self::mes($mes);
        $lineas = DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.receipt_id')->join('suppliers as s', 's.id', '=', 'r.supplier_id')
            ->join('product_variants as v', 'v.id', '=', 'l.variant_id')->join('products as p', 'p.id', '=', 'v.product_id')->where('r.status', 'POSTED')
            ->whereRaw("(r.received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])
            ->get(['l.accepted', 'l.quality_hold', 'l.weight_kg', 'l.total_cost', 'r.supplier_id', 'r.receipt_type', 's.supplier_type', 's.trade_name', 's.legal_name', 'v.name as variant_name', 'l.variant_id', 'p.line', 'r.received_at']);
        $conPeso = $lineas->filter(fn ($l) => $l->accepted && (float) $l->weight_kg > 0);
        $porPar = $conPeso->groupBy(fn ($l) => $l->supplier_id.'|'.$l->variant_id)->map(fn ($g) => [
            'supplier' => $g[0]->trade_name ?: $g[0]->legal_name, 'variant' => $g[0]->variant_name, 'kg' => C::t($g->sum('weight_kg'), 1),
            'cost' => C::t($g->sum('total_cost')), 'per_kg' => C::t($g->sum('total_cost') / max(0.001, $g->sum('weight_kg'))),
        ])->sortByDesc(fn ($x) => (float) $x['cost'])->values()->take(10);
        $kg = $conPeso->sum('weight_kg');
        $obs = $lineas->filter(fn ($l) => ! $l->accepted || $l->quality_hold)->count();
        $ocs = DB::table('purchase_orders')->whereIn('status', ['RECEIVED', 'CLOSED'])->whereNotNull('received_complete_at')
            ->whereRaw("(received_complete_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->get(['expected_date', 'received_complete_at']);
        $completas = $ocs->filter(fn ($o) => CarbonImmutable::parse($o->received_complete_at)->setTimezone('America/Lima')->toDateString() <= $o->expected_date)->count();
        $pagos = DB::table('supplier_payment_allocations as a')->join('supplier_payments as p', 'p.id', '=', 'a.payment_id')->join('purchase_documents as d', 'd.id', '=', 'a.document_id')
            ->where('p.status', 'CONFIRMED')->whereRaw("(p.paid_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->get(['a.amount', 'p.paid_at', 'd.issue_date']);
        $diasPond = $pagos->sum(fn ($x) => max(0, CarbonImmutable::parse($x->issue_date)->diffInDays(CarbonImmutable::parse($x->paid_at)->setTimezone('America/Lima')->startOfDay())) * (float) $x->amount);
        $carne = $lineas->filter(fn ($l) => $l->accepted && in_array($l->line, self::CARNICOS, true));
        $granja = $carne->filter(fn ($l) => $l->supplier_type === 'RELATED_FARM')->sum('total_cost');
        $cierre = min($a, C::hoy());
        $vencidas = PagosService::porPagar($cierre)->filter(fn ($d) => $d->due_date && $d->due_date < $cierre);
        $docs = DB::table('purchase_documents as d')->join('suppliers as s', 's.id', '=', 'd.supplier_id')->where('d.status', '<>', 'VOIDED')->whereBetween('d.accounting_date', [$de, $a])
            ->get(['s.supplier_type', DB::raw('(d.base_taxed + d.non_taxed) * d.exchange_rate as neto')]);
        $semanas = [];
        for ($d = CarbonImmutable::parse($de); $d->toDateString() <= $a; $d = $d->addDays(7)) {
            $fin = min($d->addDays(6)->toDateString(), $a);
            $en = $lineas->filter(fn ($l) => ($f = CarbonImmutable::parse($l->received_at)->setTimezone('America/Lima')->toDateString()) >= $d->toDateString() && $f <= $fin);
            $semanas[] = ['week' => $d->toDateString(), 'farm' => C::t($en->filter(fn ($l) => $l->receipt_type !== 'PURCHASE')->sum('total_cost')),
                'others' => C::t($en->filter(fn ($l) => $l->receipt_type === 'PURCHASE')->sum('total_cost'))];
        }

        return [
            'month' => substr($de, 0, 7), 'from' => $de, 'to' => $a,
            'kpis' => [
                'cost_per_kg' => $kg > 0 ? C::t($conPeso->sum('total_cost') / $kg) : null,
                'observed_pct' => $lineas->count() ? C::t($obs / $lineas->count() * 100, 1) : null,
                'compliance_pct' => $ocs->count() ? C::t($completas / $ocs->count() * 100, 1) : null,
                'payment_days' => $pagos->sum('amount') > 0 ? C::t($diasPond / $pagos->sum('amount'), 1) : null,
                'farm_share_pct' => $carne->sum('total_cost') > 0 ? C::t($granja / $carne->sum('total_cost') * 100, 1) : null,
                'overdue_payables' => C::t($vencidas->sum(fn ($d) => (float) $d->balance_pen)),
            ],
            'detail' => [
                'kg_received' => C::t($kg, 1), 'lines' => $lineas->count(), 'observed_lines' => $obs, 'pos_received' => $ocs->count(), 'pos_on_time' => $completas,
                'paid' => C::t($pagos->sum('amount')), 'overdue_docs' => $vencidas->count(), 'meat_purchases' => C::t($carne->sum('total_cost')), 'farm_purchases' => C::t($granja),
                'pending_approval' => DB::table('purchase_orders')->where('status', 'PENDING_APPROVAL')->count(),
                'observed_docs' => DB::table('purchase_documents')->where('match_status', 'OBSERVED')->count(),
            ],
            'cost_per_kg' => $porPar,
            'by_supplier_type' => $docs->groupBy('supplier_type')->map(fn ($g, $t) => ['type' => $t, 'value' => C::t($g->sum('neto'))])->sortByDesc(fn ($x) => (float) $x['value'])->values(),
            'weeks' => $semanas,
            'aging' => collect(PagosService::TRAMOS)->map(fn ($n, $k) => ['bucket' => $k, 'label' => $n, 'amount' => C::t(PagosService::porPagar()->where('bucket', $k)->sum(fn ($d) => (float) $d->balance_pen))])->values(),
        ];
    }
}
