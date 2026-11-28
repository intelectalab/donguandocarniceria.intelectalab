<?php

namespace App\Modulos\Tab\Calculadores;

use App\Modulos\Cli\Services\Direcciones;
use App\Modulos\Web\Services\Base as WebBase;
use App\Modulos\Web\Services\Mapeos;
use Illuminate\Support\Facades\DB;

/**
 * Calculadores de ventas y canales: PED, CLI, POS, WEB y los de CRM que salen de pedidos, cobros y alertas
 * (CRM todavía no está construido; sus tablas sí: se calculan desde ellas, como el respaldo del prototipo).
 * Cada uno sigue la fórmula de su indicador en kpi_definitions.
 */
final class Ventas
{
    private const ENTREGADO = ['DELIVERED', 'CLOSED'];

    public static function todos(): array
    {
        return [
            // PED · por fecha de entrega del pedido, como PED-14 (TableroController::kpis)
            'KPI-PED-01' => fn (Periodo $p) => Periodo::total(self::ventas($p)),
            'KPI-PED-02' => function (Periodo $p) {
                $n = self::entregados($p)->count();

                return Periodo::razon(self::ventas($p), $n);
            },
            'KPI-PED-03' => function (Periodo $p) {
                $conf = fn () => self::confirmados($p);
                $inc = $conf()->whereRaw('coalesce(o.imported, false)')->where(fn ($q) => $q->whereNull('o.payment_method_id')
                    ->orWhere(fn ($w) => $w->where('o.fulfillment', 'DELIVERY')->whereNull('o.address_id')))->count();

                return Periodo::pct($inc, $conf()->count());
            },
            'KPI-PED-04' => function (Periodo $p) {
                $k = self::kilos($p);

                return Periodo::valor($k->e > 0 ? ($k->r - $k->e) / $k->e * 100 : null, $k->r - $k->e, $k->e);
            },
            'KPI-PED-05' => fn (Periodo $p) => Periodo::pct(self::confirmados($p)->where('o.status', 'CANCELLED')->count(), self::confirmados($p)->count()),
            'KPI-PED-06' => fn (Periodo $p) => Periodo::pct(self::confirmados($p)->where('o.reschedule_count', '>', 0)->count(), self::confirmados($p)->count()),
            'KPI-PED-07' => function (Periodo $p) {
                $desc = (float) self::entregados($p)->sum('o.discount_total');

                return Periodo::pct($desc, self::ventas($p) + $desc);
            },
            'KPI-PED-08' => function (Periodo $p) {
                $n = self::confirmados($p)->where('o.status', '<>', 'CANCELLED')->count();
                $dias = self::confirmados($p)->where('o.status', '<>', 'CANCELLED')->distinct()->count('o.delivery_date');

                return Periodo::razon($n, $dias, 1);
            },
            'KPI-PED-09' => function (Periodo $p) {
                $pesados = self::porEntrega($p)->whereIn('o.weight_diff_status', ['WITHIN_TOLERANCE', 'NOTICE_REQUIRED', 'NOTICE_SENT'])->count();

                return Periodo::pct(self::porEntrega($p)->whereIn('o.weight_diff_status', ['NOTICE_REQUIRED', 'NOTICE_SENT'])->count(), $pesados);
            },
            'KPI-PED-10' => function (Periodo $p) {
                $m = self::confirmados($p)->whereColumn('o.confirmed_at', '>=', 'o.created_at')
                    ->selectRaw('percentile_cont(0.5) within group (order by extract(epoch from (o.confirmed_at - o.created_at)) / 60) as m')->value('m');

                return Periodo::valor($m === null ? null : (float) $m, null, null, 0);
            },

            // CLI
            'KPI-CLI-01' => fn (Periodo $p) => Periodo::total(self::clientesNuevos($p, 'confirmed_at'), 0),
            'KPI-CLI-02' => function (Periodo $p) {
                $porCliente = self::entregados($p)->whereNotNull('o.customer_id')->groupBy('o.customer_id')->selectRaw('count(*) n')->pluck('n');

                return Periodo::pct($porCliente->filter(fn ($n) => $n >= 2)->count(), $porCliente->count());
            },
            'KPI-CLI-03' => fn (Periodo $p) => Periodo::total(DB::table('customer_duplicate_candidates')->where('status', 'OPEN')
                ->where('created_at', '<', $p->fin())->count(), 0),
            'KPI-CLI-04' => function (Periodo $p) {
                $usadas = DB::table('customer_addresses as a')->whereIn('a.id', self::porEntrega($p)->whereNotNull('o.address_id')->select('o.address_id'));

                return Periodo::pct((clone $usadas)->whereIn('a.pin_source', Direcciones::CONFIRMADOS)->count(), (clone $usadas)->count());
            },

            // POS · ventas del mostrador (canal COUNTER)
            'KPI-POS-01' => fn (Periodo $p) => Periodo::total(self::ventas($p, 'COUNTER')),
            'KPI-POS-02' => fn (Periodo $p) => Periodo::razon(self::ventas($p, 'COUNTER'), self::entregados($p)->where('o.channel', 'COUNTER')->count()),
            'KPI-POS-03' => fn (Periodo $p) => Periodo::total((float) self::turnos($p)->whereIn('s.status', ['CLOSED', 'APPROVED'])
                ->sum(DB::raw('abs(coalesce(s.total_difference, s.difference, 0))'))),
            'KPI-POS-04' => function (Periodo $p) {
                $l = DB::table('sales_order_lines as l')->joinSub(self::entregados($p)->where('o.channel', 'COUNTER')->select('o.id'), 'e', 'e.id', '=', 'l.sales_order_id')
                    ->where('l.price_basis', 'KG');

                return Periodo::pct((clone $l)->whereIn('l.weight_source', ['SCALE', 'LABEL'])->count(), (clone $l)->count());
            },
            'KPI-POS-05' => function (Periodo $p) {
                $horas = (float) self::turnos($p)->whereNotNull('s.closed_at')->sum(DB::raw('extract(epoch from (s.closed_at - s.opened_at)) / 3600'));

                return Periodo::razon(self::entregados($p)->where('o.channel', 'COUNTER')->count(), $horas, 1);
            },

            // WEB
            'KPI-WEB-01' => function (Periodo $p) {
                $ib = fn () => self::bandeja($p);

                return Periodo::pct($ib()->where('i.status', 'PROCESSED')->where('i.ever_error', false)->count(), $ib()->where('i.status', '<>', 'IGNORED')->count());
            },
            'KPI-WEB-02' => fn (Periodo $p) => Periodo::total(self::tiendas($p)->join('web_order_inbox as i', 'i.store_id', '=', 'w.id')->where('i.status', 'ERROR')->count(), 0),
            'KPI-WEB-03' => function (Periodo $p) {
                $t = fn () => $p->enRango(DB::table('gateway_transactions as g')->whereIn('g.store_id', self::tiendas($p)->select('w.id')), 'g.date_created');

                return Periodo::pct($t()->whereIn('g.status', ['approved', 'refunded', 'charged_back'])->count(), $t()->count());
            },
            'KPI-WEB-04' => function (Periodo $p) {
                $filas = [];
                foreach (self::tiendas($p)->get(['w.*']) as $s) {
                    $filas = array_merge($filas, Mapeos::filas(WebBase::decodificar($s)));
                }
                $k = Mapeos::kpi($filas);

                return Periodo::pct($k['numerador'], $k['denominador']);
            },

            // CRM · desde pedidos, cobros, cargos de WhatsApp y alertas de control
            'KPI-CRM-05' => fn (Periodo $p) => Periodo::total(self::clientesNuevos($p, 'delivered_at'), 0),
            'KPI-CRM-06' => function (Periodo $p) {
                $clientes = self::porEntregaReal($p)->whereNotNull('o.customer_id')->distinct()->pluck('o.customer_id');
                $antes = $clientes->isEmpty() ? collect() : DB::table('sales_orders')->whereIn('customer_id', $clientes)->whereIn('status', self::ENTREGADO)
                    ->where('delivered_at', '>=', \Carbon\CarbonImmutable::parse($p->desde)->subDays(90)->toDateString().' 00:00:00-05')->where('delivered_at', '<', $p->ini())
                    ->distinct()->pluck('customer_id');
                $varios = self::porEntregaReal($p)->whereNotNull('o.customer_id')->groupBy('o.customer_id')->havingRaw('count(*) > 1')->pluck('o.customer_id');

                return Periodo::pct($antes->merge($varios)->unique()->count(), $clientes->count(), 1);
            },
            'KPI-CRM-08' => function (Periodo $p) {
                $costo = (float) DB::table('message_charges')->where('period', $p->mes())->when($p->marca, fn ($q, $v) => $q->where('brand_id', $v))->sum('amount');

                return Periodo::valor(($n = self::porEntregaReal($p)->where('o.channel', 'WHATSAPP')->count()) > 0 ? $costo / $n : null, $costo, $n, 4);
            },
            'KPI-CRM-10' => fn (Periodo $p) => Periodo::total($p->enRango($p->filtrar(DB::table('control_alerts as a'), 'a.brand_id', null)->where('a.status', 'CONFIRMED'), 'a.reviewed_at')->count(), 0),
            'KPI-CRM-15' => fn (Periodo $p) => Periodo::total((float) DB::query()->fromSub(self::cobradoPor($p, 'o.seller_id'), 'x')->sum('x.total')),
        ];
    }

    /* ------------------------------------------------------------------ consultas comunes */

    /** Pedidos con fecha de entrega en el rango (como PED-14). */
    public static function porEntrega(Periodo $p)
    {
        return $p->enFechas($p->pedidos(), 'o.delivery_date');
    }

    public static function entregados(Periodo $p)
    {
        return self::porEntrega($p)->whereIn('o.status', self::ENTREGADO);
    }

    /** Pedidos entregados de verdad en el rango (por la hora de entrega). */
    public static function porEntregaReal(Periodo $p)
    {
        return $p->enRango($p->pedidos()->whereIn('o.status', self::ENTREGADO), 'o.delivered_at');
    }

    public static function confirmados(Periodo $p)
    {
        return self::porEntrega($p)->whereNotNull('o.confirmed_at');
    }

    public static function ventas(Periodo $p, ?string $canal = null): float
    {
        return (float) self::entregados($p)->when($canal, fn ($q, $v) => $q->where('o.channel', $v))->sum(DB::raw('coalesce(o.final_total, o.estimated_total)'));
    }

    private static function kilos(Periodo $p): object
    {
        $k = DB::table('sales_order_lines as l')->joinSub(self::entregados($p)->select('o.id'), 'e', 'e.id', '=', 'l.sales_order_id')
            ->where('l.price_basis', 'KG')->whereNotNull('l.weighed_kg')->selectRaw('coalesce(sum(l.weighed_kg),0) r, coalesce(sum(l.est_weight_kg),0) e')->first();

        return (object) ['r' => (float) $k->r, 'e' => (float) $k->e];
    }

    /** Clientes cuyo primer pedido (confirmado o entregado, según $col) cae en el rango, con la marca y el local de ese pedido. */
    private static function clientesNuevos(Periodo $p, string $col): int
    {
        $primeros = DB::table('sales_orders')->whereNotNull($col)->whereNotNull('customer_id')->where('status', '<>', 'CANCELLED')
            ->when($col === 'delivered_at', fn ($q) => $q->whereIn('status', self::ENTREGADO))
            ->selectRaw("DISTINCT ON (customer_id) customer_id, {$col} AS primero, brand_id, establishment_id")->orderBy('customer_id')->orderBy($col);

        return $p->filtrar(DB::query()->fromSub($primeros, 'x'), 'x.brand_id', 'x.establishment_id')
            ->where('x.primero', '>=', $p->ini())->where('x.primero', '<', $p->fin())->count();
    }

    private static function turnos(Periodo $p)
    {
        return $p->enRango($p->filtrar(DB::table('pos_shifts as s'), null, 's.establishment_id'), 's.opened_at')
            ->when($p->marca, fn ($q) => $q->whereRaw('false'));
    }

    private static function tiendas(Periodo $p)
    {
        return DB::table('web_stores as w')->where('w.status', '<>', 'INACTIVE')
            ->when($p->marca, fn ($q, $v) => $q->where(fn ($w) => $w->where('w.brand_id', $v)->orWhereRaw('w.brands @> ?::jsonb', [json_encode([$v])])))
            ->when($p->local, fn ($q, $v) => $q->where('w.establishment_id', $v));
    }

    private static function bandeja(Periodo $p)
    {
        return $p->enRango(DB::table('web_order_inbox as i')->whereIn('i.store_id', self::tiendas($p)->select('w.id')), 'i.received_at');
    }

    /** Cobros confirmados del rango aplicados a pedidos, agrupados por una columna del pedido (vendedora, canal, marca…). */
    public static function cobradoPor(Periodo $p, string $col)
    {
        return $p->enRango(DB::table('payment_allocations as a')->join('payments as py', 'py.id', '=', 'a.payment_id')->join('sales_orders as o', 'o.id', '=', 'a.order_id')
            ->where('py.status', 'CONFIRMED'), 'py.paid_at')
            ->when($p->marca, fn ($q, $v) => $q->where('o.brand_id', $v))->when($p->local, fn ($q, $v) => $q->where('o.establishment_id', $v))
            ->whereNotNull($col)->groupBy($col)->selectRaw("{$col} AS clave, sum(a.amount) AS total");
    }
}
