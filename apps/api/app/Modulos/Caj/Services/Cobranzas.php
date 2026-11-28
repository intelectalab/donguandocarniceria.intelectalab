<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Support\Access;
use Illuminate\Support\Facades\DB;

/**
 * CAJ-11 Cuentas por cobrar: comprobantes con saldo por cliente y antigüedad (0–30, 31–60, más de 60 días), con
 * vencimiento. RN-CAJ-14: saldo = total − notas de crédito − cobros vigentes aplicados; los rechazados por SUNAT no
 * cuentan. El saldo de cada comprobante lo mantienen FAC (al emitir y con sus notas) y CAJ (al aplicar o revertir).
 * Sin caj.receivable.view, cada vendedora ve solo los comprobantes de sus ventas.
 */
final class Cobranzas
{
    public const TRAMOS = ['0-30' => '0 a 30 días', '31-60' => '31 a 60 días', '60+' => 'Más de 60 días'];

    public static function consulta(User $u, array $f = [])
    {
        $q = DB::table('sales_documents as p')->leftJoin('customers as c', 'c.id', '=', 'p.customer_id')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')
            ->leftJoin('users as s', 's.id', '=', 'p.seller_id')
            ->whereIn('p.doc_type', ['INVOICE', 'RECEIPT'])->where('p.status', 'ISSUED')->where('p.sunat_status', '<>', 'REJECTED')->where('p.balance', '>', 0.005)
            ->when(! Access::can($u, 'caj.receivable.view'), fn ($w) => $w->where('p.seller_id', $u->id))
            ->when($f['cliente'] ?? null, fn ($w, $v) => $w->where('p.customer_id', $v))
            ->when($f['marca'] ?? null, fn ($w, $v) => $w->where('p.brand_id', $v))
            ->when($f['tramo'] ?? null, fn ($w, $v) => match ($v) {
                '0-30' => $w->whereRaw('current_date - p.issue_date <= 30'),
                '31-60' => $w->whereRaw('current_date - p.issue_date between 31 and 60'),
                '60+' => $w->whereRaw('current_date - p.issue_date > 60'),
                default => $w,
            })
            ->when(($f['vencidos'] ?? null) === '1', fn ($w) => $w->whereRaw('coalesce(p.due_date, p.issue_date) < current_date'));

        return Base::alcance($q, $u)->select([
            'p.id', 'p.full_number', 'p.doc_type', 'p.issue_date', 'p.due_date', 'p.total', 'p.balance', 'p.payment_terms', 'p.customer_id', 'p.order_id',
            'c.full_name as cliente', 'c.doc_number as cliente_doc', 'b.name as marca', 's.name as vendedora',
            DB::raw('current_date - p.issue_date as dias'),
            DB::raw('greatest(0, current_date - coalesce(p.due_date, p.issue_date)) as dias_vencido'),
            DB::raw("case when current_date - p.issue_date <= 30 then '0-30' when current_date - p.issue_date <= 60 then '31-60' else '60+' end as tramo"),
        ]);
    }

    /** Totales por tramo y vencido, y los clientes que más deben. */
    public static function resumen(User $u, array $f = []): array
    {
        $base = self::consulta($u, array_diff_key($f, ['tramo' => 1, 'vencidos' => 1]));
        $t = DB::query()->fromSub($base, 'x')->selectRaw("coalesce(sum(balance), 0) as total,
            coalesce(sum(balance) filter (where tramo = '0-30'), 0) as t1, coalesce(sum(balance) filter (where tramo = '31-60'), 0) as t2,
            coalesce(sum(balance) filter (where tramo = '60+'), 0) as t3, coalesce(sum(balance) filter (where dias_vencido > 0), 0) as vencido, count(*) as n")->first();
        $clientes = DB::query()->fromSub($base, 'x')->groupBy('customer_id', 'cliente')
            ->selectRaw("customer_id, cliente, count(*) as n, sum(balance) as saldo, sum(balance) filter (where tramo = '0-30') as t1,
                sum(balance) filter (where tramo = '31-60') as t2, sum(balance) filter (where tramo = '60+') as t3, sum(balance) filter (where dias_vencido > 0) as vencido, max(dias) as max_dias")
            ->orderByDesc('saldo')->limit(100)->get()
            ->map(fn ($c) => ['customer_id' => $c->customer_id, 'cliente' => $c->cliente, 'n' => (int) $c->n, 'saldo' => Base::r($c->saldo), 't1' => Base::r($c->t1 ?? 0),
                't2' => Base::r($c->t2 ?? 0), 't3' => Base::r($c->t3 ?? 0), 'vencido' => Base::r($c->vencido ?? 0), 'max_dias' => (int) $c->max_dias]);
        $total = Base::r($t->total);

        return [
            'total' => $total, 'n' => (int) $t->n, 'tramos' => ['0-30' => Base::r($t->t1), '31-60' => Base::r($t->t2), '60+' => Base::r($t->t3)],
            'vencido' => Base::r($t->vencido), 'vencido_pct' => $total > 0 ? round($t->vencido / $total * 100, 1) : 0.0,
            'clientes' => $clientes, 'todos' => Access::can($u, 'caj.receivable.view'),
        ];
    }
}
