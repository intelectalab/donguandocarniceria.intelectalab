<?php

namespace App\Modulos\Tab\Services;

use App\Models\User;
use App\Modulos\Tab\Calculadores\Periodo;
use App\Modulos\Tab\Calculadores\Reparto;
use App\Modulos\Tab\Calculadores\Ventas;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * TAB-01 a TAB-06: los tableros por rol (D-TAB-02). Cada uno muestra sus tarjetas con semáforo, los gráficos de su spec y
 * la tabla con todos sus indicadores. Solo lo ven sus roles (y gerencia y auditoría), con su alcance de SEG (RN-TAB-06);
 * los indicadores de un módulo apagado no se muestran (RN-TAB-07).
 */
final class Tableros
{
    public static function puedeVer(object $tablero, User $u): bool
    {
        return Base::veTodo($u) || (bool) array_intersect(Base::roles($u), json_decode($tablero->role_codes ?? '[]', true) ?: []);
    }

    /** Los tableros que el usuario puede abrir (para el menú y los enlaces). */
    public static function delUsuario(User $u): array
    {
        return DB::table('dashboards')->orderByRaw("layout->>'screen'")->get()->filter(fn ($d) => self::puedeVer($d, $u))
            ->map(fn ($d) => ['code' => $d->code, 'name' => $d->name, 'screen' => json_decode($d->layout, true)['screen'] ?? null])->values()->all();
    }

    public static function datos(string $codigo, ?string $mes, User $u, ?string $marca, ?string $local): array
    {
        $t = DB::table('dashboards')->where('code', $codigo)->first() ?? RuleError::fail('RN-TAB-06', 'Ese tablero no existe.');
        if (! self::puedeVer($t, $u)) {
            RuleError::fail('RN-TAB-06', 'Este tablero no es de tu rol. Cada rol ve su tablero: abre el tuyo desde el menú de Tablero e indicadores.');
        }
        $mes = Base::mes($mes ?: Base::mesActual());
        $sc = Base::alcance($u, $marca, $local);
        $widgets = DB::table('dashboard_widgets')->where('dashboard_id', $t->id)->orderBy('position')->get();
        $tarjetas = [];
        $tabla = [];
        $ocultos = [];
        foreach ($widgets as $w) {
            $d = Catalogo::def($w->kpi_code);
            if (! $d) {
                continue;
            }
            if (! Catalogo::visible($d, $u)) {
                if ($d->status === 'ACTIVE' && ! Catalogo::moduloEncendido($d)) {
                    $ocultos[$d->requires_module ?: $d->module_code] = true;
                }
                continue;
            }
            $x = Motor::tarjeta($d, $mes, $sc['marca'], $sc['local']);
            $tabla[] = $x;
            if ($w->viz === 'TILE') {
                $tarjetas[] = $x;
            }
        }
        [$desde, $hasta] = Base::rango($mes);
        $p = new Periodo($desde, max($desde, $hasta), $sc['marca'], $sc['local']);
        $run = Motor::corridaVigente($mes);
        $conDatos = array_filter($tabla, fn ($x) => $x['value'] !== null && (float) $x['value'] !== 0.0);

        return [
            'tablero' => ['code' => $t->code, 'name' => $t->name, 'screen' => json_decode($t->layout, true)['screen'] ?? null, 'roles' => json_decode($t->role_codes, true)],
            'mes' => $mes, 'nombre_mes' => Base::nombreMes($mes), 'desde' => $desde, 'hasta' => $hasta, 'terminado' => Base::terminado($mes),
            'futuro' => $desde > Base::hoy(),
            'corrida' => $run ? ['run_no' => (int) $run->run_no, 'finished_at' => $run->finished_at, 'reason' => $run->reason] : null,
            'marca' => $sc['marca'], 'local' => $sc['local'], 'nombre_marca' => Base::nombreMarca($sc['marca']), 'nombre_local' => Base::nombreLocal($sc['local']),
            'notas' => $sc['notas'], 'modulos_apagados' => array_keys($ocultos),
            'tarjetas' => $tarjetas, 'tabla' => $tabla, 'sin_datos' => ! $conDatos,
            'ultimo_congelado' => DB::table('kpi_snapshot_runs')->where('status', 'OK')->max('period'),
            'meses' => self::meses(),
            'extras' => $desde > Base::hoy() ? [] : self::extras($t->code, $p, $mes),
            'puede' => ['exportar' => \App\Support\Access::can($u, 'tab.export.run'), 'congelar' => \App\Support\Access::can($u, 'tab.snapshot.run')],
        ];
    }

    /** Los 12 meses que se pueden elegir (el actual y los anteriores). */
    public static function meses(): array
    {
        $out = [];
        for ($i = 0; $i < 12; $i++) {
            $m = Base::sumarMeses(Base::mesActual(), -$i);
            $out[] = ['value' => substr($m, 0, 7), 'label' => ucfirst(Base::nombreMes($m))];
        }

        return $out;
    }

    /** Barras: [{label, value}] ordenadas de mayor a menor. */
    private static function barras(iterable $filas, ?array $nombres = null, int $n = 10): array
    {
        $out = [];
        foreach ($filas as $f) {
            $k = (string) ($f->clave ?? '');
            $out[] = ['label' => $nombres ? ($nombres[$k] ?? ($k !== '' ? $k : 'Sin dato')) : ($k !== '' ? $k : 'Sin dato'), 'value' => round((float) $f->total, 2)];
        }
        usort($out, fn ($a, $b) => $b['value'] <=> $a['value']);

        return array_slice($out, 0, $n);
    }

    private static function extras(string $codigo, Periodo $p, string $mes): array
    {
        $canales = ['WHATSAPP' => 'WhatsApp', 'WEB' => 'Web', 'FACEBOOK' => 'Facebook', 'INSTAGRAM' => 'Instagram', 'TIKTOK' => 'TikTok', 'PHONE' => 'Teléfono',
            'COUNTER' => 'Mostrador', 'B2B' => 'Empresas (B2B)'];
        $usuarios = fn () => DB::table('users')->pluck('name', 'id')->all();

        return match ($codigo) {
            'GERENCIA' => [
                ['tipo' => 'barras', 'titulo' => 'Ventas cobradas por marca', 'formato' => 'soles',
                    'filas' => self::barras(Ventas::cobradoPor($p, 'o.brand_id')->get(), DB::table('brands')->pluck('name', 'id')->all())],
                ['tipo' => 'barras', 'titulo' => 'Ventas cobradas por canal', 'formato' => 'soles', 'filas' => self::barras(Ventas::cobradoPor($p, 'o.channel')->get(), $canales)],
            ],
            'VENTAS' => self::extrasVentas($p, $canales, $usuarios()),
            'SUPERVISORA' => [
                ['tipo' => 'barras', 'titulo' => 'Ventas cobradas por vendedora', 'formato' => 'soles', 'filas' => self::barras(Ventas::cobradoPor($p, 'o.seller_id')->get(), $usuarios())],
                ['tipo' => 'cifras', 'titulo' => 'Alertas de control del mes', 'filas' => self::alertas($p)],
            ],
            'DELIVERY' => self::extrasDelivery($p),
            'ALMACEN' => self::extrasAlmacen($p, $mes),
            'MARKETING' => self::extrasMarketing($p),
            default => [],
        };
    }

    private static function extrasVentas(Periodo $p, array $canales, array $usuarios): array
    {
        $pedidos = fn () => Ventas::porEntrega($p)->whereNotIn('o.status', ['DRAFT', 'CANCELLED']);
        $wa = DB::table('messaging_channels')->pluck('display_name', 'number')->all();
        $clientes = $pedidos()->whereNotNull('o.customer_id')->distinct()->count('o.customer_id');
        $nuevos = (int) (Motor::calcular('KPI-CLI-01', $p->desde, $p->hasta, $p->marca, $p->local)['value'] ?? 0);

        return [
            ['tipo' => 'cifras', 'titulo' => 'Clientes del mes', 'filas' => [
                ['label' => 'Pedidos', 'value' => $pedidos()->count(), 'formato' => 'numero'],
                ['label' => 'Clientes que compraron', 'value' => $clientes, 'formato' => 'numero'],
                ['label' => 'Nuevos', 'value' => min($nuevos, $clientes), 'formato' => 'numero'],
                ['label' => 'Recurrentes', 'value' => max(0, $clientes - $nuevos), 'formato' => 'numero'],
            ]],
            ['tipo' => 'barras', 'titulo' => 'Pedidos por canal', 'formato' => 'numero',
                'filas' => self::barras($pedidos()->groupBy('o.channel')->selectRaw('o.channel AS clave, count(*) AS total')->get(), $canales)],
            ['tipo' => 'barras', 'titulo' => 'Pedidos por número de WhatsApp', 'formato' => 'numero',
                'filas' => self::barras($pedidos()->whereNotNull('o.origin_wa_number')->groupBy('o.origin_wa_number')->selectRaw('o.origin_wa_number AS clave, count(*) AS total')->get(),
                    array_map(fn ($n) => $n, $wa))],
            ['tipo' => 'barras', 'titulo' => 'Ventas cobradas por vendedora', 'formato' => 'soles', 'filas' => self::barras(Ventas::cobradoPor($p, 'o.seller_id')->get(), $usuarios)],
            ['tipo' => 'barras', 'titulo' => 'Pedidos por franja', 'formato' => 'numero', 'orden' => 'label',
                'filas' => self::barras($pedidos()->whereNotNull('o.slot_from')->groupByRaw("to_char(o.slot_from, 'HH24:MI') || '–' || to_char(o.slot_to, 'HH24:MI')")
                    ->selectRaw("to_char(o.slot_from, 'HH24:MI') || '–' || to_char(o.slot_to, 'HH24:MI') AS clave, count(*) AS total")->get(), null, 12)],
        ];
    }

    private static function alertas(Periodo $p): array
    {
        $q = fn () => $p->enRango($p->filtrar(DB::table('control_alerts as a'), 'a.brand_id', null), 'a.raised_at');

        return [
            ['label' => 'Abiertas', 'value' => $q()->whereIn('a.status', ['OPEN', 'UNDER_REVIEW'])->count(), 'formato' => 'numero', 'tono' => 'warn'],
            ['label' => 'Confirmadas', 'value' => $q()->where('a.status', 'CONFIRMED')->count(), 'formato' => 'numero', 'tono' => 'bad'],
            ['label' => 'Descartadas', 'value' => $q()->where('a.status', 'DISMISSED')->count(), 'formato' => 'numero'],
        ];
    }

    private static function extrasDelivery(Periodo $p): array
    {
        $zonas = DB::table('delivery_zones')->pluck('name', 'id')->all();
        $hoy = Base::hoy();
        $limite = \Carbon\CarbonImmutable::parse($hoy)->addDays(30)->toDateString();
        $docs = [];
        $vehiculos = DB::table('vehicles')->where('status', 'ACTIVE')->when($p->local, fn ($q, $v) => $q->where('establishment_id', $v))->get();
        foreach ($vehiculos as $v) {
            foreach ([['SOAT', $v->soat_expires_on], ['Revisión técnica', $v->tech_inspection_expires_on]] as [$k, $f]) {
                if ($f && $f <= $limite) {
                    $docs[] = ['vehiculo' => $v->plate.' · '.$v->vehicle_type, 'documento' => $k, 'vence' => $f, 'dias' => (int) \Carbon\CarbonImmutable::parse($hoy)->diffInDays($f, false)];
                }
            }
        }
        foreach (DB::table('vehicle_documents as d')->leftJoin('vehicles as v', 'v.id', '=', 'd.vehicle_id')->leftJoin('employees as e', 'e.id', '=', 'd.employee_id')
            ->where('d.status', 'ACTIVE')->whereNotNull('d.expires_on')->where('d.expires_on', '<=', $limite)
            ->when($p->local, fn ($q, $x) => $q->where(fn ($w) => $w->where('v.establishment_id', $x)->orWhere('e.establishment_id', $x)))
            ->get(['d.doc_type', 'd.expires_on', 'v.plate', 'v.vehicle_type', 'e.full_name']) as $d) {
            $docs[] = ['vehiculo' => $d->plate ? $d->plate.' · '.$d->vehicle_type : ($d->full_name ?? '—'), 'documento' => ucfirst(strtolower(str_replace('_', ' ', $d->doc_type))),
                'vence' => $d->expires_on, 'dias' => (int) \Carbon\CarbonImmutable::parse($hoy)->diffInDays($d->expires_on, false)];
        }
        usort($docs, fn ($a, $b) => $a['dias'] <=> $b['dias']);

        return [
            ['tipo' => 'barras', 'titulo' => 'Entregas por zona', 'formato' => 'numero',
                'filas' => self::barras(Reparto::paradas($p)->where('s.status', 'DELIVERED')->groupBy('s.zone_id')->selectRaw('s.zone_id AS clave, count(*) AS total')->get(), $zonas)],
            ['tipo' => 'tabla', 'titulo' => 'Vehículos y documentos por vencer (30 días)', 'columnas' => [['vehiculo', 'Vehículo o conductor', 'texto'], ['documento', 'Documento', 'texto'],
                ['vence', 'Vence', 'fecha'], ['dias', 'Días', 'dias']], 'filas' => array_slice($docs, 0, 20)],
        ];
    }

    private static function extrasAlmacen(Periodo $p, string $mes): array
    {
        $out = [];
        if ($mes === Base::mesActual()) {
            $estados = ['CONFIRMED' => 'Por preparar', 'IN_PREPARATION' => 'En preparación', 'WEIGHED' => 'Pesados', 'READY' => 'Listos'];
            $hoy = $p->filtrar(DB::table('sales_orders as o'), 'o.brand_id', 'o.establishment_id')->where('o.delivery_date', Base::hoy())->whereIn('o.status', array_keys($estados))
                ->groupByRaw("coalesce(to_char(o.slot_from, 'HH24:MI') || '–' || to_char(o.slot_to, 'HH24:MI'), 'Sin franja'), o.status")
                ->selectRaw("coalesce(to_char(o.slot_from, 'HH24:MI') || '–' || to_char(o.slot_to, 'HH24:MI'), 'Sin franja') AS franja, o.status, count(*) AS n")->get();
            $franjas = $hoy->pluck('franja')->unique()->sort()->values();
            $out[] = ['tipo' => 'apiladas', 'titulo' => 'Pedidos de hoy por franja ('.$hoy->sum('n').')', 'etiquetas' => $franjas,
                'series' => collect($estados)->map(fn ($n, $s) => ['name' => $n, 'values' => $franjas->map(fn ($f) => (int) $hoy->where('franja', $f)->where('status', $s)->sum('n'))->all()])->values()];
        }
        $k = DB::table('sales_order_lines as l')->joinSub(Ventas::entregados($p)->select('o.id'), 'e', 'e.id', '=', 'l.sales_order_id')
            ->where('l.price_basis', 'KG')->whereNotNull('l.weighed_kg')->selectRaw('coalesce(sum(l.weighed_kg),0) r, coalesce(sum(l.est_weight_kg),0) e')->first();
        $pesados = Ventas::porEntrega($p)->whereIn('o.weight_diff_status', ['WITHIN_TOLERANCE', 'NOTICE_REQUIRED', 'NOTICE_SENT'])->count();
        $avisos = Ventas::porEntrega($p)->whereIn('o.weight_diff_status', ['NOTICE_REQUIRED', 'NOTICE_SENT'])->count();
        $dev = (float) $k->e > 0 ? ((float) $k->r - (float) $k->e) / (float) $k->e * 100 : null;
        $out[] = ['tipo' => 'cifras', 'titulo' => 'Peso pedido frente a real', 'filas' => [
            ['label' => 'Kg estimados', 'value' => round((float) $k->e, 1), 'formato' => 'kg'], ['label' => 'Kg reales', 'value' => round((float) $k->r, 1), 'formato' => 'kg'],
            ['label' => 'Desviación', 'value' => $dev === null ? null : round($dev, 2), 'formato' => 'porcentaje', 'tono' => $dev !== null && abs($dev) > 2 ? 'warn' : 'ok'],
            ['label' => 'Pedidos con aviso de peso', 'value' => $avisos, 'formato' => 'numero', 'detalle' => $pesados ? round($avisos / $pesados * 100, 1).' % de los pesados' : null],
        ]];

        return $out;
    }

    private static function extrasMarketing(Periodo $p): array
    {
        $q = fn () => $p->enFechas(DB::table('ad_spend_daily as s')->join('ad_campaigns as c', 'c.id', '=', 's.campaign_id'), 's.spend_date')
            ->when($p->marca, fn ($x, $v) => $x->where('c.brand_id', $v))->when($p->local, fn ($x) => $x->whereRaw('false'));
        $plat = ['META' => 'Meta (Facebook e Instagram)', 'GOOGLE' => 'Google', 'TIKTOK' => 'TikTok'];

        return [
            ['tipo' => 'barras', 'titulo' => 'Inversión por plataforma', 'formato' => 'soles', 'filas' => self::barras($q()->groupBy('c.platform')->selectRaw('c.platform AS clave, sum(s.spend_pen) AS total')->get(), $plat)],
            ['tipo' => 'barras', 'titulo' => 'Leads de las plataformas', 'formato' => 'numero', 'filas' => self::barras($q()->groupBy('c.platform')->selectRaw('c.platform AS clave, sum(s.platform_leads) AS total')->get(), $plat)],
            ['tipo' => 'nota', 'texto' => 'Los indicadores de ADS (retorno, costo por lead y por pedido) se calcularán cuando el módulo de publicidad esté construido; mientras tanto se ven los meses congelados.'],
        ];
    }
}
