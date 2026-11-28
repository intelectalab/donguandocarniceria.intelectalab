<?php

namespace App\Modulos\Tab\Services;

use App\Models\User;
use App\Modulos\Flo\Services\Base as FloBase;
use App\Modulos\Flo\Services\Costos as FloCostos;
use App\Modulos\Per\Services\CostoPersonal;
use App\Modulos\Tab\Calculadores\Finanzas;
use App\Modulos\Tab\Calculadores\Periodo;
use App\Modulos\Tab\Calculadores\Reparto;
use App\Modulos\Tab\Calculadores\Ventas;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * TAB-10 Detalle y exportación (RN-TAB-02): de cualquier valor se baja a las filas que lo forman, con los mismos filtros
 * (por ejemplo, del costo por entrega a las rutas con sus costos y entregas). El detalle no lleva datos personales de
 * clientes (nombres, teléfonos, direcciones): para esos está la exportación con aprobación de AUD-05 (RN-TAB-09).
 * Columnas: [clave, título, tipo] con los tipos de App\Support\Exportar (texto, numero, soles, porcentaje, fecha).
 */
final class Detalle
{
    public const LIMITE = 5000;

    public static function datos(string $codigo, ?string $mes, User $u, ?string $marca, ?string $local): array
    {
        $d = Catalogo::def($codigo) ?? RuleError::fail('RN-TAB-02', 'Ese indicador no está en el catálogo.');
        if (! Catalogo::visible($d, $u)) {
            RuleError::fail($d->status === 'ACTIVE' && ! Catalogo::moduloEncendido($d) ? 'RN-TAB-07' : 'RN-TAB-06',
                $d->status === 'ACTIVE' && ! Catalogo::moduloEncendido($d) ? 'El módulo de este indicador está apagado: no se calcula ni se muestra.' : 'Este indicador no es de tu rol.');
        }
        $mes = Base::mes($mes ?: Base::mesActual());
        $sc = Base::alcance($u, $marca, $local);
        $x = Motor::tarjeta($d, $mes, $sc['marca'], $sc['local']);
        $tendencia = [];
        for ($i = 5; $i >= 0; $i--) {
            $m = Base::sumarMeses($mes, -$i);
            $v = Motor::valor($codigo, $m, $sc['marca'], $sc['local']);
            $e = Metas::estado($d, $v['value'], $sc['marca'], $sc['local'], min(Base::finDeMes($m), Base::hoy()));
            $tendencia[] = ['mes' => $m, 'nombre' => Base::nombreMes($m), 'value' => $v['value'], 'source' => $v['source'], 'run_no' => $v['run_no'], 'meta' => $e['meta'], 'semaforo' => $e['semaforo']];
        }
        $det = self::filas($codigo, $mes, $sc['marca'], $sc['local']);
        $corridas = DB::table('kpi_snapshots as s')->join('kpi_snapshot_runs as r', 'r.id', '=', 's.snapshot_run_id')->where('s.kpi_code', $codigo)->where('s.period', $mes)
            ->where('s.dimension_key', Base::dimension($sc['marca'], $sc['local']))->orderBy('s.run_no')->get(['s.run_no', 's.value', 'r.finished_at', 'r.reason', 'r.user']);

        return [
            'indicador' => $x, 'mes' => $mes, 'nombre_mes' => Base::nombreMes($mes), 'marca' => $sc['marca'], 'local' => $sc['local'],
            'nombre_marca' => Base::nombreMarca($sc['marca']), 'nombre_local' => Base::nombreLocal($sc['local']), 'notas' => $sc['notas'],
            'tendencia' => $tendencia, 'corridas' => $corridas, 'meses' => Tableros::meses(),
            'detalle' => $det ? ['columnas' => $det['columnas'], 'filas' => array_slice($det['filas'], 0, 500), 'total_filas' => count($det['filas']), 'totales' => self::totales($det),
                'nota' => $det['nota'] ?? null] : null,
            'puede' => ['exportar' => \App\Support\Access::can($u, 'tab.export.run')],
        ];
    }

    /** Suma de las columnas que suman (soles y números), para la fila de totales. */
    public static function totales(array $det): array
    {
        $t = [];
        foreach ($det['columnas'] as [$k, , $tipo]) {
            if (in_array($k, $det['suma'] ?? [], true)) {
                $t[$k] = round(array_sum(array_map(fn ($f) => (float) ($f[$k] ?? 0), $det['filas'])), 2);
            }
        }

        return $t;
    }

    /** Las filas que forman el valor del indicador, o null si el indicador no tiene detalle propio (se abre su pantalla). */
    public static function filas(string $codigo, string $mes, ?string $marca, ?string $local): ?array
    {
        [$desde, $hasta] = Base::rango($mes);
        if ($desde > Base::hoy()) {
            return null;
        }
        $p = new Periodo($desde, $hasta, $marca, $local);
        $f = match ($codigo) {
            'KPI-DEL-04', 'KPI-DEL-05', 'KPI-DEL-07', 'KPI-DEL-08' => fn () => self::rutasConCosto($p),
            'KPI-DEL-01', 'KPI-DEL-02', 'KPI-DEL-03', 'KPI-DEL-14' => fn () => self::rutasConEntregas($p),
            'KPI-PED-01', 'KPI-PED-02', 'KPI-PED-07' => fn () => self::pedidos($p),
            'KPI-POS-01', 'KPI-POS-02' => fn () => self::pedidos($p, 'COUNTER'),
            'KPI-PED-05' => fn () => self::cancelados($p),
            'KPI-GAS-01', 'KPI-GAS-02', 'KPI-GAS-03' => fn () => self::gastos($p),
            'KPI-PRE-03' => fn () => self::errores($p),
            'KPI-CRM-15', 'KPI-PER-08' => fn () => self::porVendedora($p),
            'KPI-CRM-10' => fn () => self::alertas($p),
            'KPI-CAJ-01', 'KPI-DEL-13' => fn () => self::liquidaciones($p),
            'KPI-FLO-03', 'KPI-FLO-04', 'KPI-FLO-08', 'KPI-FLO-10' => fn () => self::vehiculos($p),
            'KPI-PER-01', 'KPI-PER-02', 'KPI-PER-03', 'KPI-PER-04' => fn () => self::personal($p),
            'KPI-FAC-01', 'KPI-FAC-03' => fn () => self::comprobantes($p, $codigo === 'KPI-FAC-01' ? 'REJECTED' : 'CREDIT_NOTE'),
            'KPI-TAB-01' => fn () => self::conMeta($p),
            default => null,
        };

        return $f ? $f() : null;
    }

    private static function rutasConCosto(Periodo $p): array
    {
        $a = Reparto::reparto($p);
        $modos = ['OWN' => 'Propia', 'RENTED' => 'Alquilada', 'THIRD_PARTY' => 'Tercero'];
        if ($a) {
            $filas = $a->leftJoin('establishments as e', 'e.id', '=', 'r.establishment_id')->leftJoin('vehicles as v', 'v.id', '=', 'r.vehicle_id')
                ->groupBy('a.route_id', 'r.code', 'r.route_date', 'e.short', 'r.mode', 'v.plate')
                ->selectRaw('r.code, r.route_date, e.short AS local, r.mode, v.plate, sum(a.total_cost) AS costo, count(*) AS entregas, sum(a.kg_delivered) AS kg,
                    sum(a.fee_charged) AS cobrado, sum(a.subsidy) AS subsidio')->orderBy('r.route_date')->orderBy('r.code')->get();
            $nota = 'Del reparto de costos de DEL (corrida '.DB::table('delivery_cost_allocations')->where('period', $p->mes())->max('run_no').' del mes): costo de cada ruta repartido entre sus entregas.';
        } else {
            $filas = Reparto::rutas($p)->leftJoin('establishments as e', 'e.id', '=', 'r.establishment_id')->leftJoin('vehicles as v', 'v.id', '=', 'r.vehicle_id')
                ->selectRaw("r.code, r.route_date, e.short AS local, r.mode, v.plate,
                    (SELECT coalesce(sum(c.amount), 0) FROM delivery_costs c WHERE c.route_id = r.id AND c.status = 'ACTIVE') AS costo,
                    (SELECT count(*) FROM delivery_stops s LEFT JOIN sales_orders o ON o.id = s.order_id WHERE s.route_id = r.id AND s.status = 'DELIVERED'".($p->marca ? ' AND o.brand_id = ?' : '').') AS entregas,
                    (SELECT coalesce(sum(s.kg), 0) FROM delivery_stops s WHERE s.route_id = r.id AND s.status = \'DELIVERED\') AS kg, NULL AS cobrado, NULL AS subsidio', $p->marca ? [$p->marca] : [])
                ->orderBy('r.route_date')->orderBy('r.code')->get();
            $nota = 'El mes aún no tiene reparto de costos de DEL: costos cargados a cada ruta entre sus entregas.';
        }

        return ['columnas' => [['ruta', 'Ruta', 'texto'], ['fecha', 'Fecha', 'fecha'], ['local', 'Local', 'texto'], ['modalidad', 'Modalidad', 'texto'], ['vehiculo', 'Vehículo', 'texto'],
            ['costo', 'Costo', 'soles'], ['entregas', 'Entregas', 'numero'], ['por_entrega', 'Costo por entrega', 'soles'], ['kg', 'Kg entregados', 'numero'], ['subsidio', 'Subsidio', 'soles']],
            'filas' => $filas->map(fn ($r) => ['ruta' => $r->code, 'fecha' => $r->route_date, 'local' => $r->local, 'modalidad' => $modos[$r->mode] ?? $r->mode, 'vehiculo' => $r->plate ?? '—',
                'costo' => round((float) $r->costo, 2), 'entregas' => (int) $r->entregas, 'por_entrega' => $r->entregas ? round($r->costo / $r->entregas, 2) : null,
                'kg' => round((float) $r->kg, 1), 'subsidio' => $r->subsidio === null ? null : round((float) $r->subsidio, 2)])->all(),
            'suma' => ['costo', 'entregas', 'kg', 'subsidio'], 'razon' => ['costo', 'entregas'], 'nota' => $nota];
    }

    private static function rutasConEntregas(Periodo $p): array
    {
        $filas = Reparto::paradas($p)->leftJoin('establishments as e', 'e.id', '=', 'r.establishment_id')->groupBy('r.id', 'r.code', 'r.route_date', 'e.short')
            ->selectRaw("r.code, r.route_date, e.short AS local, count(*) FILTER (WHERE s.status = 'DELIVERED') AS entregadas, count(*) FILTER (WHERE s.status = 'FAILED') AS fallidas,
                count(*) FILTER (WHERE s.status = 'DELIVERED' AND o.slot_to IS NOT NULL AND (s.closed_at AT TIME ZONE 'America/Lima') <= (o.delivery_date + o.slot_to)) AS a_tiempo,
                count(*) FILTER (WHERE s.status = 'DELIVERED' AND s.pod_distance_m > 300) AS fuera")->orderBy('r.route_date')->orderBy('r.code')->get();

        return ['columnas' => [['ruta', 'Ruta', 'texto'], ['fecha', 'Fecha', 'fecha'], ['local', 'Local', 'texto'], ['entregadas', 'Entregadas', 'numero'], ['a_tiempo', 'A tiempo', 'numero'],
            ['fallidas', 'No entregadas', 'numero'], ['fuera', 'Fuera del radio', 'numero']],
            'filas' => $filas->map(fn ($r) => ['ruta' => $r->code, 'fecha' => $r->route_date, 'local' => $r->local, 'entregadas' => (int) $r->entregadas, 'a_tiempo' => (int) $r->a_tiempo,
                'fallidas' => (int) $r->fallidas, 'fuera' => (int) $r->fuera])->all(), 'suma' => ['entregadas', 'a_tiempo', 'fallidas', 'fuera']];
    }

    private static function pedidos(Periodo $p, ?string $canal = null): array
    {
        $filas = Ventas::entregados($p)->when($canal, fn ($q, $v) => $q->where('o.channel', $v))->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->leftJoin('establishments as e', 'e.id', '=', 'o.establishment_id')->orderBy('o.delivery_date')->orderBy('o.number')->limit(self::LIMITE)
            ->get(['o.number', 'o.delivery_date', 'o.channel', 'b.name as marca', 'e.short as local', DB::raw('coalesce(o.final_total, o.estimated_total) AS total'), 'o.discount_total']);

        return ['columnas' => [['pedido', 'Pedido', 'texto'], ['fecha', 'Entrega', 'fecha'], ['canal', 'Canal', 'texto'], ['marca', 'Marca', 'texto'], ['local', 'Local', 'texto'],
            ['total', 'Total', 'soles'], ['descuento', 'Descuento', 'soles']],
            'filas' => $filas->map(fn ($o) => ['pedido' => $o->number, 'fecha' => $o->delivery_date, 'canal' => self::canal($o->channel), 'marca' => $o->marca, 'local' => $o->local,
                'total' => round((float) $o->total, 2), 'descuento' => round((float) $o->discount_total, 2)])->all(), 'suma' => ['total', 'descuento'], 'razon' => ['total', null]];
    }

    private static function cancelados(Periodo $p): array
    {
        $filas = Ventas::confirmados($p)->where('o.status', 'CANCELLED')->leftJoin('order_cancel_reasons as m', 'm.code', '=', 'o.cancel_reason')
            ->orderBy('o.delivery_date')->get(['o.number', 'o.delivery_date', 'o.channel', 'm.name as motivo', 'o.cancel_note']);

        return ['columnas' => [['pedido', 'Pedido', 'texto'], ['fecha', 'Entrega', 'fecha'], ['canal', 'Canal', 'texto'], ['motivo', 'Motivo', 'texto']],
            'filas' => $filas->map(fn ($o) => ['pedido' => $o->number, 'fecha' => $o->delivery_date, 'canal' => self::canal($o->channel), 'motivo' => $o->motivo ?? 'Sin motivo'])->all(), 'suma' => []];
    }

    private static function gastos(Periodo $p): array
    {
        $filas = $p->enFechas($p->filtrar(DB::table('expenses as e'), 'e.brand_id', 'e.establishment_id'), 'e.issue_date')->whereIn('e.status', ['APPROVED', 'PAID'])
            ->leftJoin('expense_categories as c', 'c.id', '=', 'e.category_id')->leftJoin('suppliers as s', 's.id', '=', 'e.supplier_id')
            ->orderBy('e.issue_date')->orderBy('e.number')->limit(self::LIMITE)
            ->get(['e.number', 'e.issue_date', 'c.name as categoria', DB::raw('coalesce(s.trade_name, e.supplier_name, s.legal_name) AS proveedor'), 'e.description', 'e.accounting_flag', 'e.amount_pen']);

        return ['columnas' => [['gasto', 'Gasto', 'texto'], ['fecha', 'Fecha', 'fecha'], ['categoria', 'Categoría', 'texto'], ['proveedor', 'Proveedor', 'texto'], ['detalle', 'Detalle', 'texto'],
            ['comprobante', 'Comprobante', 'texto'], ['monto', 'Monto (S/)', 'soles']],
            'filas' => $filas->map(fn ($e) => ['gasto' => $e->number, 'fecha' => $e->issue_date, 'categoria' => $e->categoria, 'proveedor' => $e->proveedor, 'detalle' => mb_substr((string) $e->description, 0, 120),
                'comprobante' => $e->accounting_flag === 'NO_VALID_RECEIPT' ? 'Sin comprobante válido' : 'Válido', 'monto' => round((float) $e->amount_pen, 2)])->all(), 'suma' => ['monto']];
    }

    private static function errores(Periodo $p): array
    {
        $filas = $p->enRango(DB::table('packing_errors as e')->join('sales_orders as o', 'o.id', '=', 'e.order_id')->whereIn('e.detected_at_stage', \App\Modulos\Pre\Services\Errores::LLEGARON_AL_CLIENTE), 'e.detected_at')
            ->when($p->marca, fn ($q, $v) => $q->where('o.brand_id', $v))->when($p->local, fn ($q, $v) => $q->where('o.establishment_id', $v))
            ->orderBy('e.detected_at')->get(['o.number', 'e.detected_at', 'e.detected_at_stage', 'e.error_type', 'e.cost_amount', 'e.status']);
        $etapas = ['DELIVERY' => 'En la entrega', 'CUSTOMER_CLAIM' => 'Reclamo del cliente'];

        return ['columnas' => [['pedido', 'Pedido', 'texto'], ['fecha', 'Detectado', 'fecha'], ['etapa', 'Dónde', 'texto'], ['tipo', 'Error', 'texto'], ['costo', 'Costo', 'soles']],
            'filas' => $filas->map(fn ($e) => ['pedido' => $e->number, 'fecha' => substr((string) $e->detected_at, 0, 10), 'etapa' => $etapas[$e->detected_at_stage] ?? $e->detected_at_stage,
                'tipo' => ucfirst(strtolower(str_replace('_', ' ', (string) $e->error_type))), 'costo' => round((float) $e->cost_amount, 2)])->all(), 'suma' => ['costo']];
    }

    private static function porVendedora(Periodo $p): array
    {
        $nombres = DB::table('users')->pluck('name', 'id');
        $filas = Ventas::cobradoPor($p, 'o.seller_id')->get()->map(fn ($r) => ['vendedora' => $nombres[$r->clave] ?? '—', 'cobrado' => round((float) $r->total, 2)])
            ->sortByDesc('cobrado')->values()->all();

        return ['columnas' => [['vendedora', 'Vendedora', 'texto'], ['cobrado', 'Cobrado (S/)', 'soles']], 'filas' => $filas, 'suma' => ['cobrado'],
            'nota' => 'Cobros confirmados del mes aplicados a pedidos con vendedora.'];
    }

    private static function alertas(Periodo $p): array
    {
        $filas = $p->enRango($p->filtrar(DB::table('control_alerts as a'), 'a.brand_id', null)->where('a.status', 'CONFIRMED'), 'a.reviewed_at')
            ->leftJoin('users as u', 'u.id', '=', 'a.user_id')->orderBy('a.reviewed_at')->get(['a.rule_code', 'a.severity', 'a.reviewed_at', 'u.name', 'a.source_type']);

        return ['columnas' => [['fecha', 'Revisada', 'fecha'], ['regla', 'Regla', 'texto'], ['gravedad', 'Gravedad', 'texto'], ['vendedora', 'Vendedora', 'texto']],
            'filas' => $filas->map(fn ($a) => ['fecha' => substr((string) $a->reviewed_at, 0, 10), 'regla' => $a->rule_code, 'gravedad' => $a->severity, 'vendedora' => $a->name ?? '—'])->all(), 'suma' => []];
    }

    private static function liquidaciones(Periodo $p): array
    {
        $filas = Reparto::liquidaciones($p)->leftJoin('users as u', 'u.id', '=', 'l.driver_user_id')->orderBy('l.settlement_date')
            ->get(['l.number', 'l.settlement_date', 'u.name', 'l.expected_cash', 'l.delivered_cash', 'l.difference', 'l.difference_reason']);

        return ['columnas' => [['liquidacion', 'Liquidación', 'texto'], ['fecha', 'Fecha', 'fecha'], ['repartidor', 'Repartidor', 'texto'], ['esperado', 'Efectivo esperado', 'soles'],
            ['entregado', 'Entregado', 'soles'], ['diferencia', 'Diferencia', 'soles'], ['motivo', 'Motivo', 'texto']],
            'filas' => $filas->map(fn ($l) => ['liquidacion' => $l->number, 'fecha' => $l->settlement_date, 'repartidor' => $l->name ?? '—', 'esperado' => round((float) $l->expected_cash, 2),
                'entregado' => round((float) $l->delivered_cash, 2), 'diferencia' => round((float) $l->difference, 2), 'motivo' => $l->difference_reason])->all(), 'suma' => ['esperado', 'entregado', 'diferencia']];
    }

    private static function vehiculos(Periodo $p): array
    {
        if ($p->marca) {
            return ['columnas' => [['vehiculo', 'Vehículo', 'texto']], 'filas' => [], 'suma' => [], 'nota' => 'Los costos de vehículos no van por marca: quita el filtro de marca.'];
        }
        $filas = [];
        foreach (FloBase::flota()->where('v.status', 'ACTIVE')->when($p->local, fn ($q, $x) => $q->where('v.establishment_id', $x))->orderBy('v.plate')->get(['v.*']) as $v) {
            $c = FloCostos::mensual($v, $p->mes());
            $filas[] = ['vehiculo' => $c['vehiculo'], 'modalidad' => $c['modalidad'], 'km' => $c['km'], 'entregas' => $c['entregas'], 'combustible' => $c['combustible'],
                'mantenimiento' => $c['mantenimiento'], 'otros' => round($c['alquiler'] + $c['peajes'] + $c['seguros'] + $c['otros'] + $c['multas'] + $c['depreciacion'] + $c['conductor'], 2),
                'total' => $c['total'], 'por_km' => $c['por_km'], 'por_entrega' => $c['por_entrega'], 'utilizacion' => $c['utilizacion']];
        }

        return ['columnas' => [['vehiculo', 'Vehículo', 'texto'], ['modalidad', 'Modalidad', 'texto'], ['km', 'Km', 'numero'], ['entregas', 'Entregas', 'numero'], ['combustible', 'Combustible', 'soles'],
            ['mantenimiento', 'Mantenimiento', 'soles'], ['otros', 'Alquiler, conductor y otros', 'soles'], ['total', 'Costo total', 'soles'], ['por_km', 'Por km', 'soles'],
            ['por_entrega', 'Por entrega', 'soles'], ['utilizacion', 'Utilización', 'porcentaje']], 'filas' => $filas,
            'suma' => ['km', 'entregas', 'combustible', 'mantenimiento', 'otros', 'total'], 'nota' => 'Costo mensual de cada vehículo de FLO (RN-FLO-16).'];
    }

    private static function personal(Periodo $p): array
    {
        $areas = ['SALES' => 'Ventas', 'WAREHOUSE' => 'Almacén y preparación', 'DELIVERY' => 'Reparto', 'PRODUCTION' => 'Producción', 'QUALITY' => 'Calidad', 'ADMIN' => 'Administración',
            'FINANCE' => 'Finanzas', 'MARKETING' => 'Marketing', 'HR' => 'Personal', 'OTHER' => 'Otras'];
        $g = [];
        foreach (CostoPersonal::filasDelMes($p->mes(), $p->hasta) as $f) {
            if (($p->local && $f['establishment_id'] !== $p->local) || ($p->marca && $f['brand_id'] !== $p->marca)) {
                continue;
            }
            $k = $f['area'] ?? 'OTHER';
            $g[$k] ??= ['area' => $areas[$k] ?? $k, 'planilla' => 0.0, 'comisiones' => 0.0, 'bonos' => 0.0, 'total' => 0.0, 'por_pedido' => in_array($k, CostoPersonal::AREAS_POR_PEDIDO, true) ? 'Sí' : 'No'];
            $g[$k][['PAYROLL' => 'planilla', 'COMMISSION' => 'comisiones', 'BONUS' => 'bonos'][$f['kind']]] += $f['amount'];
            $g[$k]['total'] += $f['amount'];
        }
        $filas = array_values(array_map(fn ($x) => array_map(fn ($v) => is_float($v) ? round($v, 2) : $v, $x), $g));
        usort($filas, fn ($a, $b) => $b['total'] <=> $a['total']);

        return ['columnas' => [['area', 'Área', 'texto'], ['planilla', 'Planilla', 'soles'], ['comisiones', 'Comisiones', 'soles'], ['bonos', 'Bonos', 'soles'], ['total', 'Total', 'soles'],
            ['por_pedido', 'Cuenta por pedido', 'texto']], 'filas' => $filas, 'suma' => ['planilla', 'comisiones', 'bonos', 'total'],
            'nota' => 'De PER (costo de personal). Si la planilla del mes no se importó, se estima como sueldo × 1,215.'];
    }

    private static function comprobantes(Periodo $p, string $que): array
    {
        $q = Finanzas::comprobantes($p)->when($que === 'REJECTED', fn ($x) => $x->where('d.sunat_status', 'REJECTED'), fn ($x) => $x->where('d.doc_type', 'CREDIT_NOTE'));
        $filas = $q->orderBy('d.issue_date')->get(['d.full_number', 'd.issue_date', 'd.doc_type', 'd.total', 'd.sunat_status', 'd.sunat_message', 'd.note_reason']);

        return ['columnas' => [['numero', 'Comprobante', 'texto'], ['fecha', 'Emisión', 'fecha'], ['total', 'Total', 'soles'], ['detalle', 'Detalle', 'texto']],
            'filas' => $filas->map(fn ($d) => ['numero' => $d->full_number, 'fecha' => $d->issue_date, 'total' => round((float) $d->total, 2),
                'detalle' => mb_substr((string) ($que === 'REJECTED' ? $d->sunat_message : $d->note_reason), 0, 120)])->all(), 'suma' => ['total']];
    }

    private static function conMeta(Periodo $p): array
    {
        $filas = [];
        foreach (Catalogo::defs() as $d) {
            if (! Catalogo::calculable($d)) {
                continue;
            }
            $m = Metas::vigente($d->code, $p->marca, $p->local, $p->hasta);
            $filas[] = ['indicador' => $d->code.' · '.$d->name, 'modulo' => $d->module_code, 'meta' => $m ? (float) $m->target : null, 'con_meta' => $m ? 1 : 0];
        }

        return ['columnas' => [['indicador', 'Indicador', 'texto'], ['modulo', 'Módulo', 'texto'], ['meta', 'Meta vigente', 'numero'], ['con_meta', 'Con meta (1 = sí)', 'numero']],
            'filas' => $filas, 'suma' => ['con_meta']];
    }

    private static function canal(?string $c): string
    {
        return ['WHATSAPP' => 'WhatsApp', 'WEB' => 'Web', 'FACEBOOK' => 'Facebook', 'INSTAGRAM' => 'Instagram', 'TIKTOK' => 'TikTok', 'PHONE' => 'Teléfono', 'COUNTER' => 'Mostrador',
            'B2B' => 'Empresas (B2B)'][$c] ?? (string) $c;
    }
}
