<?php

namespace App\Modulos\Prs\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/** Datos de cada pantalla de PRS, ya calculados en la API (montos en soles sin IGV). */
final class Pantallas
{
    public static function opciones(User $u): array
    {
        $empresa = Base::empresaPorDefecto();

        return [
            'empresa_id' => $empresa,
            'empresas' => DB::table('companies')->orderBy('legal_name')->get(['id', 'legal_name as nombre'])->all(),
            'anios' => DB::table('budgets')->where('company_id', $empresa)->orderByDesc('year')->pluck('year')->map(fn ($x) => (int) $x)->all(),
            'versiones' => DB::table('budget_versions as v')->join('budgets as b', 'b.id', '=', 'v.budget_id')->where('b.company_id', $empresa)
                ->orderByDesc('b.year')->orderByDesc('v.version_no')->get(['v.id', 'v.version_no', 'v.status', 'v.name', 'b.year', 'b.id as budget_id'])
                ->map(fn ($v) => ['id' => $v->id, 'budget_id' => $v->budget_id, 'year' => (int) $v->year, 'version_no' => (int) $v->version_no, 'status' => $v->status,
                    'etiqueta' => "{$v->year} · v{$v->version_no}", 'name' => $v->name, 'estado' => Base::ESTADOS[$v->status] ?? $v->status])->all(),
            'conceptos' => DB::table('budget_concepts')->orderBy('sort_order')->get(['id', 'code', 'name', 'parent_id', 'is_group', 'concept_type', 'behavior', 'status', 'default_cost_center_id'])->all(),
            'marcas' => DB::table('brands')->orderBy('code')->get(['id', 'code', 'name'])->all(),
            'locales' => DB::table('establishments')->orderBy('code')->get(['id', 'code', 'name'])->all(),
            'centros' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'area', 'brand_id', 'establishment_id'])->all(),
            'categorias' => DB::table('expense_categories')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'code', 'name', 'category_group'])->all(),
            'puede' => [
                'editar' => Access::can($u, 'prs.budget.edit'), 'enviar' => Access::can($u, 'prs.budget.submit'), 'aprobar' => Access::can($u, 'prs.budget.approve'),
                'conceptos' => Access::can($u, 'prs.concept.manage'), 'ver_todo' => Base::veTodo($u),
            ],
            'parametros' => ['ambar' => Base::ambar(), 'alerta' => Base::umbralAlerta(), 'metodo' => Base::metodo(), 'mes_inicio' => Base::mesInicio()],
            'hoy' => Base::hoy(),
            'tipos' => Base::TIPOS, 'fuentes' => Base::FUENTES, 'personal' => Base::PERSONAL, 'estados' => Base::ESTADOS,
        ];
    }

    /** PRS-01: presupuestos de la empresa con sus versiones y totales. */
    public static function presupuestos(User $u, ?string $empresa = null): array
    {
        $empresa ??= Base::empresaPorDefecto();
        $alcance = Base::alcance($u);
        $out = [];
        foreach (DB::table('budgets')->where('company_id', $empresa)->orderByDesc('year')->get() as $b) {
            $vs = DB::table('budget_versions as v')->join('budgets as b', 'b.id', '=', 'v.budget_id')->where('v.budget_id', $b->id)->orderByDesc('v.version_no')
                ->get(['v.*', 'b.year', 'b.company_id', 'b.name as budget_name']);
            $versiones = $vs->map(function ($v) use ($alcance) {
                $r = Versiones::resumen($v);
                unset($r['history']);
                $r['totales'] = Versiones::totales($v->id, null, $alcance);
                $r['lineas'] = DB::table('budget_lines')->where('version_id', $v->id)->count();

                return $r;
            })->all();
            $vig = collect($versiones)->firstWhere('status', 'APPROVED');
            $out[] = ['id' => $b->id, 'year' => (int) $b->year, 'name' => $b->name, 'vigente' => $vig, 'versiones' => $versiones,
                'por_aprobar' => collect($versiones)->where('status', 'SUBMITTED')->count()];
        }
        $pend = collect($out)->sum('por_aprobar');
        $abiertas = DB::table('budget_alerts')->whereIn('status', ['OPEN', 'ACK'])->get()->filter(fn ($a) => Base::visible($alcance, $a))->count();

        return ['presupuestos' => $out, 'por_aprobar' => $pend, 'alertas' => $abiertas, 'empresa_id' => $empresa];
    }

    /** PRS-03: la matriz concepto × mes de una versión, con filtros por marca, local y centro de costo. */
    public static function matriz(string $versionId, array $f, User $u): array
    {
        $v = Versiones::version($versionId);
        $alcance = Base::alcance($u);
        $meses = Base::meses((int) $v->year);
        $conceptos = Conceptos::porId();
        $q = DB::table('budget_lines')->where('version_id', $v->id)
            ->when($f['marca'] ?? null, fn ($w, $x) => $w->where('brand_id', $x))
            ->when($f['local'] ?? null, fn ($w, $x) => $w->where('establishment_id', $x))
            ->when($f['centro'] ?? null, fn ($w, $x) => $w->where('cost_center_id', $x));
        $filas = [];
        foreach ($q->get() as $l) {
            if (! Base::visible($alcance, $l)) {
                continue;
            }
            $k = Ejecucion::clave($l);
            $c = $conceptos[$l->concept_id] ?? [];
            $filas[$k] ??= ['key' => $k, 'concept_id' => $l->concept_id, 'code' => $c['code'] ?? '', 'name' => $c['name'] ?? '', 'type' => $c['concept_type'] ?? 'EXPENSE',
                'parent_id' => $c['parent_id'] ?? null, 'sort' => $c['sort_order'] ?? 999, 'brand_id' => $l->brand_id, 'establishment_id' => $l->establishment_id,
                'cost_center_id' => $l->cost_center_id, 'celdas' => array_fill(0, 12, null), 'total' => 0.0];
            $i = array_search($l->month, $meses, true);
            if ($i !== false) {
                $filas[$k]['celdas'][$i] = ['id' => $l->id, 'amount' => (float) $l->amount, 'note' => $l->note];
                $filas[$k]['total'] += (float) $l->amount;
            }
        }
        $filas = array_values($filas);
        usort($filas, fn ($a, $b) => $a['sort'] <=> $b['sort'] ?: strcmp(Alertas::dimTexto($a), Alertas::dimTexto($b)));
        $nombres = self::nombres();
        foreach ($filas as &$x) {
            $x['dimension'] = self::dimension($x, $nombres);
            $x['total'] = Base::r($x['total']);
        }
        unset($x);
        $porMes = array_fill(0, 12, ['ingreso' => 0.0, 'gasto' => 0.0]);
        foreach ($filas as $x) {
            foreach ($x['celdas'] as $i => $c) {
                if ($c) {
                    $porMes[$i][$x['type'] === 'INCOME' ? 'ingreso' : 'gasto'] += $c['amount'];
                }
            }
        }
        $grupos = [];
        foreach ($filas as $x) {
            $g = $x['parent_id'] ?? $x['concept_id'];
            $grupos[$g] ??= ['id' => $g, 'name' => $conceptos[$g]['name'] ?? '', 'code' => $conceptos[$g]['code'] ?? '', 'type' => $x['type'], 'sort' => $conceptos[$g]['sort_order'] ?? 999,
                'meses' => array_fill(0, 12, 0.0), 'total' => 0.0];
            foreach ($x['celdas'] as $i => $c) {
                $grupos[$g]['meses'][$i] += $c['amount'] ?? 0;
            }
            $grupos[$g]['total'] += $x['total'];
        }
        $grupos = array_values($grupos);
        usort($grupos, fn ($a, $b) => $a['sort'] <=> $b['sort']);

        return [
            'version' => Versiones::resumen($v), 'meses' => $meses, 'filas' => $filas, 'grupos' => $grupos,
            'por_mes' => array_map(fn ($m) => ['ingreso' => Base::r($m['ingreso']), 'gasto' => Base::r($m['gasto']), 'resultado' => Base::r($m['ingreso'] - $m['gasto'])], $porMes),
            'totales' => Versiones::totales($v->id, null, $alcance),
            'sin_mapeo' => Versiones::sinMapeo($v->id),
            'otras' => DB::table('budget_versions')->where('budget_id', $v->budget_id)->orderBy('version_no')->get(['id', 'version_no', 'status', 'name'])->all(),
        ];
    }

    public static function nombres(): array
    {
        return [
            'marcas' => DB::table('brands')->pluck('name', 'id')->all(),
            'locales' => DB::table('establishments')->pluck('name', 'id')->all(),
            'centros' => DB::table('cost_centers')->get(['id', 'code', 'name'])->keyBy('id')->all(),
        ];
    }

    public static function dimension(array $s, array $n): string
    {
        $p = [];
        if (! empty($s['brand_id'])) {
            $p[] = $n['marcas'][$s['brand_id']] ?? '';
        }
        if (! empty($s['establishment_id'])) {
            $p[] = preg_replace('/ · .*$/', '', $n['locales'][$s['establishment_id']] ?? '');
        }
        if (! empty($s['cost_center_id'])) {
            $p[] = $n['centros'][$s['cost_center_id']]->code ?? '';
        }

        return implode(' · ', array_filter($p)) ?: 'Sin dimensión';
    }

    /** Versión vigente del año (o la elegida) para PRS-06, 07, 08 y 10. */
    public static function versionPara(?string $versionId, int $anio, string $empresa): ?object
    {
        if ($versionId) {
            return Versiones::version($versionId);
        }
        $ap = Versiones::aprobadaDelAnio($anio, $empresa);

        return $ap ? Versiones::version($ap->id) : null;
    }

    /** Meses del período elegido: el mes, o el acumulado del año hasta ese mes. */
    private static function mesesDe(string $mes, string $modo, int $anio): array
    {
        $todos = Base::meses($anio);
        if ($modo !== 'ACUMULADO') {
            return [$mes];
        }

        return array_values(array_filter($todos, fn ($m) => $m <= $mes));
    }

    /** PRS-06: presupuesto, real, diferencia, % y semáforo por concepto y dimensión. */
    public static function ejecucion(array $f, User $u): array
    {
        $empresa = $f['empresa'] ?? Base::empresaPorDefecto();
        $mes = Base::mes($f['mes'] ?? Base::hoy());
        $al = $f['al'] ?? Base::hoy();
        $anio = (int) substr($mes, 0, 4);
        if (Base::mesInicio() > 1 && (int) substr($mes, 5, 2) < Base::mesInicio()) {
            $anio--;
        }
        $modo = ($f['modo'] ?? 'MES') === 'ACUMULADO' ? 'ACUMULADO' : 'MES';
        $dim = in_array($f['dim'] ?? '', ['marca', 'local', 'centro'], true) ? $f['dim'] : 'concepto';
        $v = self::versionPara($f['version'] ?? null, $anio, $empresa);
        $meses = self::mesesDe($mes, $modo, $anio);
        $ex = Ejecucion::calcular($v?->id, $meses, $al, $empresa, false, true, Base::alcance($u));
        $filas = Ejecucion::agrupar($ex['slots'], $dim);
        $conceptos = Conceptos::porId();
        $nombres = self::nombres();
        foreach ($filas as &$x) {
            $c = $conceptos[$x['concept_id']] ?? [];
            $x['code'] = $c['code'] ?? '';
            $x['name'] = $c['name'] ?? '';
            $x['dimension'] = $x['dim_value'] ? self::dimension([['marca' => 'brand_id', 'local' => 'establishment_id', 'centro' => 'cost_center_id'][$dim] => $x['dim_value']], $nombres)
                : ['concepto' => '', 'marca' => 'Sin marca', 'local' => 'Sin local', 'centro' => 'Sin centro'][$dim];
        }
        unset($x);
        $t = Ejecucion::totales($ex['slots']);
        $porConcepto = Ejecucion::agrupar($ex['slots'], 'concepto');
        $sinMapeo = array_sum(array_column($ex['sin_mapeo'], 'actual'));
        $corridas = [];
        foreach ($meses as $m) {
            if ($ex['estados'][$m] === 'CLOSED') {
                $corridas[$m] = Real::corridas($m, $empresa);
            }
        }

        return [
            'version' => $v ? Versiones::resumen($v) : null, 'mes' => $mes, 'al' => $al, 'modo' => $modo, 'dim' => $dim, 'anio' => $anio,
            'meses' => $meses, 'estados' => array_map(fn ($e) => ['estado' => $e, 'nombre' => Real::ESTADOS_MES[$e]], $ex['estados']),
            'filas' => $filas,
            'kpi' => [
                'gasto' => $t['gasto'] + ['pct' => Base::pct($t['gasto']['actual'], $t['gasto']['budget']), 'diff' => Base::r($t['gasto']['actual'] - $t['gasto']['budget']),
                    'light' => Base::semaforoDe($t['gasto']['budget'], $t['gasto']['forecast'], 'EXPENSE')],
                'ingreso' => $t['ingreso'] + ['pct' => Base::pct($t['ingreso']['actual'], $t['ingreso']['budget']),
                    'light' => Base::semaforoDe($t['ingreso']['budget'], $t['ingreso']['forecast'], 'INCOME')],
                'rojos' => count(array_filter($porConcepto, fn ($x) => $x['light'] === 'RED')),
                'ambar' => count(array_filter($porConcepto, fn ($x) => $x['light'] === 'AMBER')),
                'sin_mapeo' => Base::r($sinMapeo),
            ],
            'corridas' => $corridas,
        ];
    }

    /** PRS-07: las filas del real (documentos, gastos, planillas o snapshot) de un concepto, con el enlace de flota de cada gasto. */
    public static function detalle(array $f, User $u): array
    {
        $empresa = $f['empresa'] ?? Base::empresaPorDefecto();
        $mes = Base::mes($f['mes'] ?? Base::hoy());
        $al = $f['al'] ?? Base::hoy();
        $anio = (int) substr($mes, 0, 4);
        if (Base::mesInicio() > 1 && (int) substr($mes, 5, 2) < Base::mesInicio()) {
            $anio--;
        }
        $modo = ($f['modo'] ?? 'MES') === 'ACUMULADO' ? 'ACUMULADO' : 'MES';
        $v = self::versionPara($f['version'] ?? null, $anio, $empresa);
        $concepto = $f['concepto'] ?? null;
        if (! $concepto || ! DB::table('budget_concepts')->where('id', $concepto)->exists()) {
            RuleError::fail('RN-PRS-06', 'Elige un concepto.');
        }
        $ex = Ejecucion::calcular($v?->id, self::mesesDe($mes, $modo, $anio), $al, $empresa, true, true, Base::alcance($u));
        $campo = ['marca' => 'brand_id', 'local' => 'establishment_id', 'centro' => 'cost_center_id'][$f['dim'] ?? ''] ?? null;
        $valor = $f['valor'] ?? null;
        $slots = array_values(array_filter($ex['slots'], fn ($s) => $s['concept_id'] === $concepto && (! $campo || ($s[$campo] ?? '') === ($valor ?? ''))));
        $nombres = self::nombres();
        $filas = [];
        $presupuesto = 0.0;
        foreach ($slots as $s) {
            $presupuesto += $s['budget'];
            foreach ($s['rows'] as $r) {
                $filas[] = $r + ['dimension' => self::dimension($r, $nombres), 'linea' => self::dimension($s, $nombres).($s['unbudgeted'] ? ' (sin línea presupuestal)' : ''), 'sin_linea' => $s['unbudgeted']];
            }
        }
        // Gastos de flota: su carga de combustible, mantenimiento, multa u otro costo enlazado (RN-FLO-17).
        $gastos = array_values(array_unique(array_map(fn ($r) => $r['ref_id'], array_filter($filas, fn ($r) => $r['ref_type'] === 'expenses'))));
        $flota = $gastos ? self::flotaDe($gastos) : [];
        $users = DB::table('users')->pluck('name', 'id');
        foreach ($filas as &$r) {
            $r['flota'] = $r['ref_type'] === 'expenses' ? ($flota[$r['ref_id']] ?? null) : null;
            $r['origen'] = Base::ORIGENES[$r['source']] ?? $r['source'];
            if (($r['source'] ?? '') === 'SNAPSHOT') {
                $r['origen'] = 'Congelado · '.(Base::ORIGENES[$r['origin'] ?? ''] ?? '');
            }
        }
        unset($r);
        usort($filas, fn ($a, $b) => strcmp((string) $b['date'], (string) $a['date']) ?: abs($b['amount']) <=> abs($a['amount']));
        $real = array_sum(array_column($filas, 'amount'));
        $c = DB::table('budget_concepts')->where('id', $concepto)->first();
        $porOrigen = [];
        foreach ($filas as $r) {
            $porOrigen[$r['origen']] = ($porOrigen[$r['origen']] ?? 0) + $r['amount'];
        }

        return [
            'concepto' => ['id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'type' => $c->concept_type, 'behavior' => $c->behavior],
            'mapeos' => DB::table('budget_concept_mappings')->where('concept_id', $c->id)->where('status', 'ACTIVE')->get()->map(fn ($m) => Conceptos::etiqueta($m->source, $m->ref))->all(),
            'mes' => $mes, 'modo' => $modo, 'al' => $al, 'version' => $v ? Versiones::resumen($v) : null,
            'presupuesto' => Base::r($presupuesto), 'real' => Base::r($real), 'pct' => Base::pct($real, $presupuesto),
            'por_origen' => array_map(fn ($k, $x) => ['origen' => $k, 'monto' => Base::r($x)], array_keys($porOrigen), $porOrigen),
            'filas' => array_slice($filas, 0, 1500), 'total_filas' => count($filas),
            'estados' => $ex['estados'], 'dim' => $f['dim'] ?? null, 'valor' => $valor,
            'valor_nombre' => $campo && $valor ? self::dimension([$campo => $valor], $nombres) : null,
        ];
    }

    /** Enlace de flota de cada gasto (si FLO está instalado). */
    private static function flotaDe(array $gastos): array
    {
        $out = [];
        $tablas = [
            'fuel_loads' => ['Carga de combustible', "coalesce(t.number, '') || ' · ' || coalesce(t.gallons::text, '') || ' gal'"],
            'vehicle_maintenances' => ['Mantenimiento', "coalesce(t.number, '') || ' · ' || coalesce(t.description, '')"],
            'traffic_fines' => ['Multa', "coalesce(t.ballot_number, '') || ' · ' || coalesce(t.infraction, '')"],
            'vehicle_costs' => ['Costo de flota', "coalesce(t.cost_type, '')"],
        ];
        foreach ($tablas as $tabla => [$tipo, $texto]) {
            if (! DB::getSchemaBuilder()->hasTable($tabla)) {
                continue;
            }
            $cols = DB::getSchemaBuilder()->getColumnListing($tabla);
            $txt = self::textoSeguro($texto, $cols);
            $q = DB::table("{$tabla} as t")->leftJoin('vehicles as v', 'v.id', '=', 't.vehicle_id')->whereIn('t.expense_id', $gastos)
                ->selectRaw("t.id, t.expense_id, v.plate, {$txt} AS texto");
            foreach ($q->get() as $x) {
                $out[$x->expense_id] = ['tipo' => $tipo, 'id' => $x->id, 'placa' => $x->plate, 'texto' => trim((string) $x->texto, ' ·')];
            }
        }

        // Sin enlace en FLO: el vehículo y los galones que trae el propio gasto (GAS).
        $sin = array_values(array_diff($gastos, array_keys($out)));
        if ($sin) {
            $q = DB::table('expenses as e')->join('vehicles as v', 'v.id', '=', 'e.vehicle_id')->whereIn('e.id', $sin)->get(['e.id', 'v.plate', 'e.fuel_gallons', 'e.fuel_voucher_no']);
            foreach ($q as $x) {
                $out[$x->id] = ['tipo' => $x->fuel_gallons ? 'Combustible del vehículo' : 'Gasto del vehículo', 'id' => null, 'placa' => $x->plate,
                    'texto' => trim(($x->fuel_gallons ? rtrim(rtrim(number_format((float) $x->fuel_gallons, 3, '.', ''), '0'), '.').' gal' : '').($x->fuel_voucher_no ? ' · vale '.$x->fuel_voucher_no : ''), ' ·')];
            }
        }

        return $out;
    }

    /** Arma el texto del enlace solo con columnas que existen. */
    private static function textoSeguro(string $expr, array $cols): string
    {
        preg_match_all('/t\.([a-z_]+)/', $expr, $m);
        foreach (array_unique($m[1]) as $c) {
            if (! in_array($c, $cols, true)) {
                $expr = str_replace("t.{$c}", 'NULL', $expr);
            }
        }

        return $expr;
    }

    /** PRS-08: proyección de cierre del mes por concepto y línea. */
    public static function proyeccion(array $f, User $u): array
    {
        $empresa = $f['empresa'] ?? Base::empresaPorDefecto();
        $mes = Base::mes($f['mes'] ?? Base::hoy());
        $al = $f['al'] ?? Base::hoy();
        $anio = (int) substr($mes, 0, 4);
        if (Base::mesInicio() > 1 && (int) substr($mes, 5, 2) < Base::mesInicio()) {
            $anio--;
        }
        $v = self::versionPara($f['version'] ?? null, $anio, $empresa);
        $ex = Ejecucion::calcular($v?->id, [$mes], $al, $empresa, false, true, Base::alcance($u));
        $conceptos = Conceptos::porId();
        $nombres = self::nombres();
        $umbral = Base::umbralAlerta();
        $filas = array_map(function ($s) use ($mes, $conceptos, $nombres, $umbral) {
            $x = $s['months'][$mes];
            $c = $conceptos[$s['concept_id']] ?? [];
            $fpct = Base::pct($x['forecast'], $x['budget']);

            return ['key' => $s['key'], 'concept_id' => $s['concept_id'], 'code' => $c['code'] ?? '', 'name' => $c['name'] ?? '', 'type' => $s['type'], 'fixed' => $s['fixed'],
                'dimension' => self::dimension($s, $nombres), 'sin_linea' => $s['unbudgeted'], 'budget' => $x['budget'], 'actual' => $x['actual'], 'forecast' => $x['forecast'],
                'pct_real' => Base::pct($x['actual'], $x['budget']), 'pct' => $fpct, 'light' => Base::semaforoDe($x['budget'], $x['forecast'], $s['type']),
                'alerta' => $s['type'] !== 'INCOME' && $x['budget'] > 0 && $x['forecast'] > $x['budget'] * (1 + $umbral / 100) + Base::EPS,
                'sort' => $c['sort_order'] ?? 999];
        }, $ex['slots']);
        usort($filas, fn ($a, $b) => $a['sort'] <=> $b['sort'] ?: strcmp($a['dimension'], $b['dimension']));
        $t = Ejecucion::totales($ex['slots']);
        $guardadas = $v ? DB::table('budget_forecasts')->where('version_id', $v->id)->where('period', $mes)
            ->groupBy('run_id', 'as_of')->selectRaw('run_id, as_of, min(created_at) AS creada, sum(forecast) FILTER (WHERE light IS NOT NULL) AS total, count(*) AS lineas')
            ->orderByDesc('creada')->limit(10)->get()->all() : [];

        return [
            'version' => $v ? Versiones::resumen($v) : null, 'mes' => $mes, 'al' => $al, 'estado' => Real::ESTADOS_MES[$ex['estados'][$mes]], 'estado_codigo' => $ex['estados'][$mes],
            'dias' => Base::diasDelMes($mes), 'transcurridos' => Base::transcurridos($mes, $al), 'metodo' => Base::metodo(), 'umbral' => $umbral,
            'filas' => $filas, 'totales' => $t,
            'kpi' => ['gasto_pct' => Base::pct($t['gasto']['forecast'], $t['gasto']['budget']), 'ingreso_pct' => Base::pct($t['ingreso']['forecast'], $t['ingreso']['budget']),
                'gasto_light' => Base::semaforoDe($t['gasto']['budget'], $t['gasto']['forecast'], 'EXPENSE'),
                'ingreso_light' => Base::semaforoDe($t['ingreso']['budget'], $t['ingreso']['forecast'], 'INCOME'),
                'alertando' => count(array_filter($filas, fn ($x) => $x['alerta']))],
            'guardadas' => $guardadas,
        ];
    }

    /** PRS-10: alertas de desviación (con su responsable y comentarios) y el semáforo actual por centro de costo. */
    public static function alertas(array $f, User $u): array
    {
        $alcance = Base::alcance($u);
        $users = DB::table('users')->pluck('name', 'id');
        $conceptos = Conceptos::porId();
        $nombres = self::nombres();
        $q = DB::table('budget_alerts')->orderByDesc('period')->orderByRaw("CASE status WHEN 'OPEN' THEN 0 WHEN 'ACK' THEN 1 ELSE 2 END")->orderByDesc('pct')
            ->when($f['estado'] ?? null, fn ($w, $x) => $x === 'ACTIVAS' ? $w->whereIn('status', ['OPEN', 'ACK']) : $w->where('status', $x))
            ->when($f['mes'] ?? null, fn ($w, $x) => $w->where('period', Base::mes($x)));
        $lista = $q->limit(500)->get()->filter(fn ($a) => Base::visible($alcance, $a) || $a->owner_user_id === $u->id)->map(function ($a) use ($users, $conceptos, $nombres, $u) {
            $c = $conceptos[$a->concept_id] ?? [];
            $avisados = json_decode($a->notified, true) ?: [];

            return ['id' => $a->id, 'version_id' => $a->version_id, 'period' => $a->period, 'mes' => Base::nombreMes($a->period), 'concept_id' => $a->concept_id, 'code' => $c['code'] ?? '',
                'name' => $c['name'] ?? '', 'dimension' => self::dimension((array) $a, $nombres), 'cost_center_id' => $a->cost_center_id,
                'level' => $a->level, 'status' => $a->status, 'estado' => Base::ESTADOS_ALERTA[$a->status] ?? $a->status, 'budget' => (float) $a->budget,
                'actual' => (float) $a->actual, 'forecast' => (float) $a->forecast, 'pct' => $a->pct !== null ? (float) $a->pct : null, 'as_of' => $a->as_of,
                'days_elapsed' => (int) $a->days_elapsed, 'responsable' => $users[$a->owner_user_id] ?? null, 'owner_user_id' => $a->owner_user_id,
                'avisados' => array_values(array_filter(array_map(fn ($x) => $users[$x] ?? null, $avisados))), 'comments' => json_decode($a->comments, true) ?: [],
                'raised_at' => $a->raised_at, 'closed_at' => $a->closed_at,
                'puede_comentar' => Base::veTodo($u) || $a->owner_user_id === $u->id || in_array($u->id, $avisados, true)];
        })->values()->all();
        $todas = DB::table('budget_alerts')->get(['status', 'brand_id', 'cost_center_id', 'owner_user_id'])->filter(fn ($a) => Base::visible($alcance, $a) || $a->owner_user_id === $u->id);

        return ['alertas' => $lista, 'conteo' => ['abiertas' => $todas->where('status', 'OPEN')->count(), 'seguimiento' => $todas->where('status', 'ACK')->count(),
            'cerradas' => $todas->whereIn('status', ['CLOSED', 'RESOLVED'])->count()], 'umbral' => Base::umbralAlerta()];
    }

    /** Semáforo del mes por centro de costo (ámbar y rojo), para PRS-10. */
    public static function semaforoPorCentro(array $f, User $u): array
    {
        $empresa = $f['empresa'] ?? Base::empresaPorDefecto();
        $mes = Base::mes($f['mes'] ?? Base::hoy());
        $al = $f['al'] ?? Base::hoy();
        $anio = (int) substr($mes, 0, 4);
        $v = self::versionPara(null, $anio, $empresa);
        if (! $v) {
            return ['filas' => [], 'mes' => $mes];
        }
        $ex = Ejecucion::calcular($v->id, [$mes], $al, $empresa, false, false, Base::alcance($u));
        $conceptos = Conceptos::porId();
        $nombres = self::nombres();
        $users = DB::table('users')->pluck('name', 'id');
        $filas = [];
        foreach (Ejecucion::agrupar(array_filter($ex['slots'], fn ($s) => $s['type'] !== 'INCOME'), 'centro') as $x) {
            if (! in_array($x['light'], ['AMBER', 'RED'], true)) {
                continue;
            }
            $filas[] = ['concept_id' => $x['concept_id'], 'name' => $conceptos[$x['concept_id']]['name'] ?? '', 'centro' => $x['dim_value'] ? self::dimension(['cost_center_id' => $x['dim_value']], $nombres) : 'Sin centro',
                'cost_center_id' => $x['dim_value'], 'responsable' => $users[Base::responsable($x['dim_value'])] ?? null, 'budget' => $x['budget'], 'forecast' => $x['forecast'],
                'fpct' => $x['fpct'], 'light' => $x['light']];
        }

        return ['filas' => $filas, 'mes' => $mes, 'al' => $al];
    }

    /** Diferencias de la versión con la vigente (PRS-05). */
    public static function diferencias(string $versionId, User $u): array
    {
        $v = Versiones::version($versionId);
        $vig = Versiones::aprobadaDe($v->budget_id);
        $base = $vig && $vig->id !== $v->id ? $vig : ($v->based_on_version_id ? DB::table('budget_versions')->where('id', $v->based_on_version_id)->first() : null);
        $cmp = $base ? Versiones::comparar($base->id, $v->id, Base::alcance($u)) : null;

        return ['version' => Versiones::resumen($v), 'base' => $cmp ? $cmp['a'] : null, 'comparacion' => $cmp, 'totales' => Versiones::totales($v->id, null, Base::alcance($u)),
            'sin_mapeo' => Versiones::sinMapeo($v->id), 'lineas' => DB::table('budget_lines')->where('version_id', $v->id)->count(),
            'meses' => Base::meses((int) $v->year)];
    }
}
