<?php

namespace App\Modulos\Per\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PER-14 Costo de personal (RN-PER-17): planilla importada (o estimada mientras no se importa) + comisiones + bonos,
 * por área, local, marca y centro de costo, y costo de personal por pedido entregado. Lo usa también PRS (presupuesto).
 */
final class CostoPersonal
{
    /** Cargas sobre el sueldo para estimar la planilla aún no importada: EsSalud 9 % + provisiones 12,5 %. */
    public const FACTOR_ESTIMADO = 1.215;

    public const AREAS_POR_PEDIDO = ['SALES', 'WAREHOUSE', 'DELIVERY'];

    /**
     * Filas de costo del mes $mes ('Y-m-01') hasta $hasta ('Y-m-d', corte dentro del mes).
     * Cada fila: kind (PAYROLL, COMMISSION, BONUS), employee_id, cost_center_id, establishment_id, brand_id, amount, ref_type, ref_id, label, area.
     * PAYROLL viene de payroll_cost_lines si la planilla del mes se importó; si no, se estima (ref_type employment_terms).
     */
    public static function filasDelMes(string $mes, string $hasta): array
    {
        // Otro módulo (PRS) puede llamarla desde su migración antes de que corra la de PER: sin tablas, sin filas.
        if (! Schema::hasTable('employment_terms')) {
            return [];
        }
        $mes = Base::mes($mes);
        $fin = Base::finDeMes($mes);
        $hasta = min($hasta, $fin);
        $out = [];
        $centros = DB::table('cost_centers')->get(['id', 'establishment_id', 'brand_id', 'area'])->keyBy('id');
        $mapa = Personal::mapa($hasta);
        $area = fn ($e) => $mapa[$e]['principal']->area ?? 'OTHER';
        $imp = DB::table('payroll_exchanges')->where('period', $mes)->where('direction', 'IMPORT_COST')->where('status', 'DONE')->first();
        if ($imp) {
            $f = $hasta >= $fin ? 1.0 : (CarbonImmutable::parse($mes)->diffInDays(CarbonImmutable::parse($hasta)) + 1) / (CarbonImmutable::parse($mes)->diffInDays(CarbonImmutable::parse($fin)) + 1);
            foreach (DB::table('payroll_cost_lines as l')->join('employees as e', 'e.id', '=', 'l.employee_id')->where('l.exchange_id', $imp->id)->get(['l.*', 'e.full_name']) as $l) {
                $cc = $centros[$l->cost_center_id] ?? null;
                $out[] = ['kind' => 'PAYROLL', 'employee_id' => $l->employee_id, 'cost_center_id' => $l->cost_center_id, 'establishment_id' => $cc?->establishment_id ?? ($mapa[$l->employee_id]['principal']->establishment_id ?? null),
                    'brand_id' => $cc?->brand_id, 'amount' => Base::r((float) $l->total_cost * $f), 'ref_type' => 'payroll_cost_lines', 'ref_id' => $l->id,
                    'label' => 'Planilla · '.$l->full_name, 'area' => $area($l->employee_id)];
            }
        } else {
            $f = (CarbonImmutable::parse($mes)->diffInDays(CarbonImmutable::parse($hasta)) + 1) / (CarbonImmutable::parse($mes)->diffInDays(CarbonImmutable::parse($fin)) + 1);
            $emps = DB::table('employees')->where('status', 'ACTIVE')->get(['id', 'full_name', 'hire_date']);
            foreach ($emps as $e) {
                if ($e->hire_date && $e->hire_date > $hasta) {
                    continue;
                }
                $t = Personal::condicion($e->id, $hasta);
                if ($t && $t->payroll_source === 'NONE') {
                    continue;
                }
                $m = Personal::remuneracion($e->id, $hasta) * self::FACTOR_ESTIMADO * $f;
                foreach ($mapa[$e->id]['todas'] ?? [] as $a) {
                    $cc = $centros[$a->cost_center_id] ?? null;
                    $out[] = ['kind' => 'PAYROLL', 'employee_id' => $e->id, 'cost_center_id' => $a->cost_center_id, 'establishment_id' => $cc?->establishment_id ?? $a->establishment_id,
                        'brand_id' => $cc?->brand_id, 'amount' => Base::r($m * (float) $a->allocation_pct / 100), 'ref_type' => 'employment_terms', 'ref_id' => $t?->id,
                        'label' => 'Planilla estimada · '.$e->full_name, 'area' => $area($e->id)];
                }
            }
        }
        $com = DB::table('commission_entries as c')->join('commission_plans as p', 'p.id', '=', 'c.plan_id')->join('employees as e', 'e.id', '=', 'c.employee_id')
            ->where('c.period', $mes)->where('c.earned_at', '<=', $hasta.' 23:59:59-05')
            ->groupBy('c.employee_id', 'e.full_name', 'p.plan_type', 'c.brand_id')->selectRaw('c.employee_id, e.full_name, p.plan_type, c.brand_id, sum(c.amount) AS amount')->get();
        foreach ($com as $c) {
            $a = $mapa[$c->employee_id]['principal'] ?? null;
            $cc = $a ? ($centros[$a->cost_center_id] ?? null) : null;
            $bono = $c->plan_type === 'DRIVER_DELIVERY';
            $out[] = ['kind' => $bono ? 'BONUS' : 'COMMISSION', 'employee_id' => $c->employee_id, 'cost_center_id' => $a?->cost_center_id,
                'establishment_id' => $cc?->establishment_id ?? $a?->establishment_id, 'brand_id' => $c->brand_id ?? $cc?->brand_id, 'amount' => Base::r($c->amount),
                'ref_type' => 'commission_entries', 'ref_id' => null, 'label' => ($bono ? 'Bonos por entrega · ' : 'Comisiones · ').$c->full_name, 'area' => $area($c->employee_id)];
        }

        return $out;
    }

    /** Pedidos entregados del mes (con fecha de entrega en el mes), opcionalmente de un local. */
    public static function pedidosEntregados(string $mes, ?string $local = null, ?string $hasta = null): int
    {
        return DB::table('sales_orders')->whereIn('status', ['DELIVERED', 'CLOSED'])->whereNotNull('delivered_at')
            ->whereBetween('delivered_at', [$mes.' 00:00:00-05', min($hasta ?? Base::finDeMes($mes), Base::finDeMes($mes)).' 23:59:59-05'])
            ->when($local, fn ($w) => $w->where('establishment_id', $local))->count();
    }

    /** RN-PER-17: costo de ventas, preparación y reparto ÷ pedidos entregados. */
    public static function porPedido(float $costo, int $pedidos): ?float
    {
        return $pedidos > 0 ? Base::r($costo / $pedidos) : null;
    }

    public static function resumen(string $mes, ?string $local, ?string $marca): array
    {
        $hoy = Base::hoy();
        $hasta = min(Base::finDeMes($mes), $hoy);
        $filas = array_values(array_filter(self::filasDelMes($mes, $hasta), fn ($f) => (! $local || $f['establishment_id'] === $local) && (! $marca || $f['brand_id'] === $marca)));
        $importado = DB::table('payroll_exchanges')->where('period', $mes)->where('direction', 'IMPORT_COST')->where('status', 'DONE')->first();
        $suma = fn ($fs) => Base::r(array_sum(array_column($fs, 'amount')));
        $grupo = function (string $clave, callable $nombre) use ($filas, $suma) {
            $g = [];
            foreach ($filas as $f) {
                $k = $f[$clave] ?? '—';
                $g[$k] ??= ['clave' => $k, 'nombre' => $nombre($k), 'planilla' => 0, 'comisiones' => 0, 'bonos' => 0, 'total' => 0];
                $g[$k][['PAYROLL' => 'planilla', 'COMMISSION' => 'comisiones', 'BONUS' => 'bonos'][$f['kind']]] += $f['amount'];
                $g[$k]['total'] += $f['amount'];
            }
            $g = array_map(fn ($x) => array_map(fn ($v) => is_float($v) || is_int($v) ? Base::r($v) : $v, $x), array_values($g));
            usort($g, fn ($a, $b) => $b['total'] <=> $a['total']);

            return $g;
        };
        $locales = DB::table('establishments')->pluck('short', 'id');
        $marcas = DB::table('brands')->pluck('name', 'id');
        $centros = DB::table('cost_centers')->get(['id', 'code', 'name'])->keyBy('id');
        $pedidoFilas = array_filter($filas, fn ($f) => in_array($f['area'], self::AREAS_POR_PEDIDO, true));
        $costoPedido = $suma($pedidoFilas);
        $pedidos = self::pedidosEntregados($mes, $local, $hasta);
        // tendencia: 6 meses hasta el elegido
        $tendencia = [];
        for ($i = 5; $i >= 0; $i--) {
            $m = Base::sumarMeses($mes, -$i);
            if ($m > Base::mes($hoy)) {
                continue;
            }
            $h = min(Base::finDeMes($m), $hoy);
            $fs = array_filter(self::filasDelMes($m, $h), fn ($f) => (! $local || $f['establishment_id'] === $local) && (! $marca || $f['brand_id'] === $marca));
            $c = $suma(array_filter($fs, fn ($f) => in_array($f['area'], self::AREAS_POR_PEDIDO, true)));
            $p = self::pedidosEntregados($m, $local, $h);
            $tendencia[] = ['mes' => $m, 'total' => $suma($fs), 'por_pedido' => self::porPedido($c, $p), 'pedidos' => $p];
        }

        return [
            'mes' => $mes, 'nombre' => Base::nombreMes($mes), 'hasta' => $hasta, 'planilla_importada' => $importado ? ['proveedor' => Base::FUENTES[$importado->provider], 'fecha' => Asistencia::iso($importado->processed_at)] : null,
            'totales' => ['total' => $suma($filas), 'planilla' => $suma(array_filter($filas, fn ($f) => $f['kind'] === 'PAYROLL')),
                'comisiones' => $suma(array_filter($filas, fn ($f) => $f['kind'] === 'COMMISSION')), 'bonos' => $suma(array_filter($filas, fn ($f) => $f['kind'] === 'BONUS')),
                'costo_pedido' => $costoPedido, 'pedidos' => $pedidos, 'por_pedido' => self::porPedido($costoPedido, $pedidos)],
            'por_area' => $grupo('area', fn ($k) => Base::AREAS[$k] ?? $k),
            'por_local' => $grupo('establishment_id', fn ($k) => $locales[$k] ?? 'Sin local'),
            'por_marca' => $grupo('brand_id', fn ($k) => $marcas[$k] ?? 'Todas las marcas (sin marca propia)'),
            'por_centro' => $grupo('cost_center_id', fn ($k) => isset($centros[$k]) ? $centros[$k]->code.' · '.$centros[$k]->name : 'Sin centro'),
            'tendencia' => $tendencia,
        ];
    }
}
