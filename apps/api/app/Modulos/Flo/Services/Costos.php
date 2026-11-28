<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Modulos\Del\Services\Terceros;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * FLO-11 Otros costos del vehículo y FLO-12 Costo total y comparativo.
 * RN-FLO-16: costo del mes = combustible + mantenimiento + multas a cargo de la empresa + alquiler + peajes y cochera
 * + seguros e impuestos + otros + depreciación (propio) + costo del conductor. Costo por km = total / km reales.
 */
final class Costos
{
    public static function registrar(array $d, UploadedFile|string|null $foto, User $u): object
    {
        if (! Access::can($u, 'flo.fuel.manage') && ! Access::can($u, 'flo.maintenance.manage')) {
            abort(403, 'Registrar costos del vehículo es del coordinador de delivery o de administración.');
        }

        return DB::transaction(function () use ($d, $foto, $u) {
            $v = Base::vehiculo($d['vehicle_id'] ?? null, $u, 'RN-FLO-16');
            $tipo = (string) ($d['cost_type'] ?? '');
            if (! isset(Base::COSTOS[$tipo])) {
                RuleError::fail('RN-FLO-16', 'Elige el tipo de costo.');
            }
            if ($tipo === 'RENT' && $v->ownership !== 'RENTED') {
                RuleError::fail('RN-FLO-16', "{$v->plate} es propio: el alquiler es de los vehículos alquilados.");
            }
            $fecha = (string) ($d['cost_date'] ?? '');
            if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha) || $fecha > Base::hoy()) {
                RuleError::fail('RN-FLO-16', 'Indica la fecha del costo (no puede ser futura).');
            }
            $monto = Base::decimal($d['amount'] ?? null);
            if (! $monto || $monto <= 0) {
                RuleError::fail('RN-FLO-16', 'El importe debe ser mayor que cero.');
            }
            $periodo = ! empty($d['period']) ? CarbonImmutable::parse(substr((string) $d['period'], 0, 7).'-01')->toDateString() : CarbonImmutable::parse($fecha)->startOfMonth()->toDateString();
            $empresa = DB::table('establishments')->where('id', $v->establishment_id)->value('company_id');
            if ($empresa) {
                Periodos::abierto($fecha, $empresa);
            }
            $prov = ! empty($d['supplier_id']) ? DB::table('suppliers')->where('id', $d['supplier_id'])->value('id') : null;
            $fileId = Archivo::guardar($foto, null, null, $u, 'RN-FLO-16');
            $id = DB::table('vehicle_costs')->insertGetId([
                'vehicle_id' => $v->id, 'cost_type' => $tipo, 'cost_date' => $fecha, 'period' => $periodo, 'amount' => round($monto, 2), 'supplier_id' => $prov,
                'doc_type' => ! empty($d['doc_type']) ? mb_substr($d['doc_type'], 0, 20) : null,
                'doc_number' => ! empty($d['doc_number']) ? mb_substr(mb_strtoupper(trim(($d['doc_series'] ?? '') ? $d['doc_series'].'-'.$d['doc_number'] : $d['doc_number'])), 0, 30) : null,
                'receipt_file_id' => $fileId, 'notes' => ! empty($d['notes']) ? mb_substr(trim($d['notes']), 0, 1000) : null, 'status' => 'ACTIVE', 'created_by' => $u->id,
            ], 'id');
            Gastos::alRegistrar('vehicle_costs', $id, $d, [
                'tipo' => $tipo, 'vehiculo' => $v, 'monto' => round($monto, 2), 'fecha' => $fecha, 'proveedor' => $prov, 'foto' => $fileId,
                'descripcion' => Base::COSTOS[$tipo]." · {$v->plate}".(! empty($d['notes']) ? ' · '.trim($d['notes']) : ''),
            ], $u);

            return DB::table('vehicle_costs')->where('id', $id)->first();
        });
    }

    public static function anular(string $id, string $motivo, User $u): object
    {
        if (! Access::can($u, 'flo.fuel.manage') && ! Access::can($u, 'flo.maintenance.manage')) {
            abort(403, 'Anular costos es del coordinador de delivery o de administración.');
        }

        return DB::transaction(function () use ($id, $motivo, $u) {
            $c = DB::table('vehicle_costs')->where('id', $id)->lockForUpdate()->first();
            if (! $c) {
                abort(404, 'No se encontró el costo.');
            }
            Base::vehiculo($c->vehicle_id, $u, 'RN-FLO-16');
            if ($c->status !== 'ACTIVE') {
                RuleError::fail('RN-FLO-16', 'El costo ya está anulado.');
            }
            $m = Base::texto($motivo, 'RN-FLO-16', 'Anular un costo exige un motivo de al menos 10 caracteres.', 10, 500);
            DB::table('vehicle_costs')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => $m, 'updated_at' => now()]);

            return DB::table('vehicle_costs')->where('id', $id)->first();
        });
    }

    public static function lista(User $u, array $f): array
    {
        $vs = Base::flota($u)->pluck('v.id')->all();
        $desde = $f['desde'] ?? CarbonImmutable::parse(Base::hoy())->subMonths(2)->startOfMonth()->toDateString();
        $hasta = $f['hasta'] ?? Base::hoy();
        $filas = DB::table('vehicle_costs as c')->join('vehicles as v', 'v.id', '=', 'c.vehicle_id')->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 'c.vehicle_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'c.supplier_id')->leftJoin('expenses as e', 'e.id', '=', 'c.expense_id')
            ->whereIn('c.vehicle_id', $vs ?: ['00000000-0000-0000-0000-000000000000'])->whereBetween('c.cost_date', [$desde, $hasta])
            ->when($f['tipo'] ?? null, fn ($w) => $w->where('c.cost_type', $f['tipo']))
            ->when($f['vehiculo'] ?? null, fn ($w) => $w->where('c.vehicle_id', $f['vehiculo']))
            ->when(($f['estado'] ?? 'ACTIVE') !== 'TODOS', fn ($w) => $w->where('c.status', $f['estado'] ?? 'ACTIVE'))
            ->orderByDesc('c.cost_date')->limit(500)
            ->get(['c.*', 'v.plate', 'p.internal_code', 's.trade_name as proveedor', 'e.number as gasto'])
            ->map(fn ($x) => array_replace((array) $x, ['vehiculo' => $x->internal_code && $x->internal_code !== $x->plate ? "{$x->internal_code} · {$x->plate}" : $x->plate,
                'tipo' => Base::COSTOS[$x->cost_type] ?? $x->cost_type, 'amount' => (float) $x->amount]))->all();
        $act = array_filter($filas, fn ($x) => $x['status'] === 'ACTIVE');
        $porTipo = [];
        foreach ($act as $x) {
            $porTipo[$x['cost_type']] = round(($porTipo[$x['cost_type']] ?? 0) + $x['amount'], 2);
        }

        return ['data' => $filas, 'desde' => $desde, 'hasta' => $hasta, 'resumen' => ['total' => round(array_sum(array_column($act, 'amount')), 2), 'por_tipo' => $porTipo,
            'sin_gasto' => count(array_filter($act, fn ($x) => ! $x['expense_id']))]];
    }

    /** RN-FLO-16: total, por km real y por entrega. */
    public static function formula(array $c): array
    {
        $total = round(array_sum(array_map(fn ($k) => (float) ($c[$k] ?? 0), ['combustible', 'mantenimiento', 'multas', 'alquiler', 'peajes', 'seguros', 'otros', 'depreciacion', 'conductor'])), 2);

        return ['total' => $total, 'por_km' => ($c['km'] ?? 0) > 0 ? round($total / $c['km'], 2) : null, 'por_entrega' => ($c['entregas'] ?? 0) > 0 ? round($total / $c['entregas'], 2) : null];
    }

    /** Días hábiles del mes (lunes a sábado). */
    public static function diasHabiles(string $desde, string $hasta): int
    {
        $n = 0;
        for ($d = CarbonImmutable::parse($desde); $d->lessThanOrEqualTo(CarbonImmutable::parse($hasta)); $d = $d->addDay()) {
            if ($d->dayOfWeek !== 0) {
                $n++;
            }
        }

        return $n;
    }

    /** Costo de un vehículo en el mes (hasta hoy si es el mes en curso). */
    public static function mensual(object $v, string $mes): array
    {
        $desde = CarbonImmutable::parse(substr($mes, 0, 7).'-01');
        $fin = $desde->endOfMonth();
        $hasta = $fin->greaterThan(CarbonImmutable::parse(Base::hoy())) ? CarbonImmutable::parse(Base::hoy()) : $fin;
        $d = $desde->toDateString();
        $h = $hasta->toDateString();
        $p = Base::perfil($v);
        $ini = $desde->setTimezone('America/Lima')->startOfDay();
        $c = ['vehicle_id' => $v->id, 'vehiculo' => Base::etiqueta($v), 'ownership' => $v->ownership, 'modalidad' => Base::MODALIDAD[$v->ownership] ?? $v->ownership, 'mes' => $d];
        $c['combustible'] = round((float) DB::table('fuel_loads')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')->where('source', '<>', 'BASELINE')
            ->whereBetween('loaded_at', [CarbonImmutable::parse($d, 'America/Lima')->startOfDay(), CarbonImmutable::parse($h, 'America/Lima')->endOfDay()])->sum('amount'), 2);
        $c['mantenimiento'] = round((float) DB::table('vehicle_maintenances')->where('vehicle_id', $v->id)->where('status', 'DONE')->whereBetween('done_on', [$d, $h])->sum('total_amount'), 2);
        $c['multas'] = round(DB::table('traffic_fines')->where('vehicle_id', $v->id)->where('charged_to_driver', false)->whereIn('status', ['PENDING', 'PAID'])
            ->whereBetween('fine_date', [$d, $h])->get()->sum(fn ($f) => $f->paid_amount !== null ? (float) $f->paid_amount : Multas::aPagar($f)), 2);
        $vc = DB::table('vehicle_costs')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')->where('period', $d)->get();
        $s = fn (array $t) => round((float) $vc->whereIn('cost_type', $t)->sum('amount'), 2);
        $trips = DB::table('vehicle_trips')->where('vehicle_id', $v->id)->where('status', 'CLOSED')->whereBetween('trip_date', [$d, $h])->get(['driver_user_id', 'km_odometer', 'deliveries', 'trip_date']);
        $c['alquiler'] = $s(['RENT']);
        $c['alquiler_devengado'] = false;
        if ($v->ownership === 'RENTED' && ! $c['alquiler'] && $v->rental_daily_rate) {
            $c['alquiler'] = round((float) $v->rental_daily_rate * $trips->count(), 2);   // tarifa diaria × jornadas, sin factura aún
            $c['alquiler_devengado'] = $c['alquiler'] > 0;
        }
        $c['peajes'] = $s(['TOLL', 'PARKING']);
        $c['seguros'] = $s(['INSURANCE', 'TAX']);
        $c['otros'] = $s(['WASH', 'TIRES', 'OTHER']);
        $diasMes = $desde->daysInMonth;
        $transcurridos = (int) $desde->diffInDays($hasta) + 1;
        $c['depreciacion'] = $v->ownership === 'OWN' && $p->purchase_cost && $p->useful_life_months && (! $p->purchase_date || $p->purchase_date <= $h)
            ? round(((float) $p->purchase_cost - (float) ($p->residual_value ?? 0)) / (int) $p->useful_life_months * ($transcurridos / $diasMes), 2) : 0.0;
        // Costo del conductor (mientras PER no exponga el costo del personal): sueldo ÷ días hábiles del mes × jornadas en el vehículo.
        $habiles = max(1, self::diasHabiles($d, $fin->toDateString()));
        $c['conductor'] = 0.0;
        foreach ($trips->groupBy('driver_user_id') as $uid => $ts) {
            $sueldo = (float) DB::table('users as u')->join('employees as e', 'e.id', '=', 'u.employee_id')->where('u.id', $uid)->value('e.monthly_salary');
            $c['conductor'] += $sueldo > 0 ? $sueldo / $habiles * $ts->count() : 0;
        }
        $c['conductor'] = round($c['conductor'], 2);
        $c['km'] = round((float) $trips->sum('km_odometer'), 1);
        $c['entregas'] = (int) $trips->sum('deliveries');
        $c['jornadas'] = $trips->count();
        // Días con jornada frente a los días hábiles del mes (un domingo trabajado no pasa del 100 %).
        $c['utilizacion'] = min(100.0, round($trips->pluck('trip_date')->unique()->count() / max(1, self::diasHabiles($d, $h)) * 100, 1));

        return $c + self::formula($c);
    }

    /** FLO-12: costo del mes por vehículo, totales y comparativo propio, alquilado y tercero por zona. */
    public static function tablero(User $u, string $mes, ?string $local = null): array
    {
        if (! Access::can($u, 'flo.cost.view')) {
            abort(403, 'El costo total es de gerencia, administración y auditoría.');
        }
        $vs = Base::flota($u)->when($local, fn ($w) => $w->where('v.establishment_id', $local))->orderBy('v.plate')->get(['v.*']);
        $filas = $vs->map(fn ($v) => self::mensual($v, $mes))->filter(fn ($c) => $c['total'] > 0 || $c['jornadas'] > 0)->values()->all();
        $suma = [];
        foreach (['combustible', 'mantenimiento', 'multas', 'alquiler', 'peajes', 'seguros', 'otros', 'depreciacion', 'conductor', 'km', 'entregas', 'jornadas'] as $k) {
            $suma[$k] = round(array_sum(array_column($filas, $k)), 2);
        }
        $suma += self::formula($suma);
        $mant = $suma['mantenimiento'];
        $porModo = [];
        foreach ($filas as $f) {
            $porModo[$f['ownership']] ??= ['total' => 0.0, 'entregas' => 0, 'km' => 0.0];
            $porModo[$f['ownership']]['total'] += $f['total'];
            $porModo[$f['ownership']]['entregas'] += $f['entregas'];
            $porModo[$f['ownership']]['km'] += $f['km'];
        }

        return [
            'mes' => CarbonImmutable::parse(substr($mes, 0, 7).'-01')->toDateString(), 'filas' => $filas, 'totales' => $suma,
            'kpis' => [
                'costo_km' => $suma['por_km'], 'costo_entrega' => $suma['por_entrega'], 'mant_km' => $suma['km'] > 0 ? round($mant / $suma['km'], 3) : null,
                'km_entrega' => $suma['entregas'] > 0 ? round($suma['km'] / $suma['entregas'], 2) : null,
                'por_modalidad' => array_map(fn ($m) => ['por_entrega' => $m['entregas'] ? round($m['total'] / $m['entregas'], 2) : null, 'por_km' => $m['km'] ? round($m['total'] / $m['km'], 2) : null] + $m, $porModo),
            ],
            'comparativo' => self::comparativo($vs->all(), $filas, $mes),
        ];
    }

    /**
     * Comparativo por zona: el costo del mes de cada vehículo se reparte entre sus entregas, pesando más las zonas lejanas
     * del local; el tercero es la mejor tarifa vigente de una empresa de delivery para esa zona (DEL).
     */
    public static function comparativo(array $vehiculos, array $filas, string $mes): array
    {
        $desde = CarbonImmutable::parse(substr($mes, 0, 7).'-01');
        $hasta = $desde->endOfMonth()->greaterThan(CarbonImmutable::parse(Base::hoy())) ? CarbonImmutable::parse(Base::hoy()) : $desde->endOfMonth();
        $costo = collect($filas)->keyBy('vehicle_id');
        $zonas = [];
        foreach ($vehiculos as $v) {
            $c = $costo[$v->id] ?? null;
            if (! $c || $c['total'] <= 0) {
                continue;
            }
            $local = DB::table('establishments')->where('id', $v->establishment_id)->first(['lat', 'lng']);
            $items = DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')->leftJoin('delivery_zones as z', 'z.id', '=', 's.zone_id')
                ->where('r.vehicle_id', $v->id)->whereBetween('r.route_date', [$desde->toDateString(), $hasta->toDateString()])->whereIn('s.status', ['DELIVERED', 'HANDED_OFF'])
                ->whereNotNull('s.zone_id')->get(['s.zone_id', 's.kg', 'z.name', 'z.lat', 'z.lng']);
            $w = fn ($x) => $local && $local->lat !== null && $x->lat !== null ? max(1.0, Base::distancia((float) $local->lat, (float) $local->lng, (float) $x->lat, (float) $x->lng)) : 1.0;
            $peso = $items->sum($w);
            if ($peso <= 0) {
                continue;
            }
            foreach ($items as $x) {
                $z = &$zonas[$x->zone_id];
                $z ??= ['zone_id' => $x->zone_id, 'zona' => $x->name, 'OWN' => ['c' => 0.0, 'n' => 0], 'RENTED' => ['c' => 0.0, 'n' => 0], 'kg' => 0.0, 'kgn' => 0];
                $z[$v->ownership]['c'] += $c['total'] * $w($x) / $peso;
                $z[$v->ownership]['n']++;
                $z['kg'] += (float) $x->kg;
                $z['kgn']++;
                unset($z);
            }
        }
        $out = [];
        foreach ($zonas as $z) {
            $tarifa = Terceros::mejorTarifa($z['zone_id'], $hasta->toDateString(), $z['kgn'] ? $z['kg'] / $z['kgn'] : 0);
            $propio = $z['OWN']['n'] ? round($z['OWN']['c'] / $z['OWN']['n'], 2) : null;
            $alq = $z['RENTED']['n'] ? round($z['RENTED']['c'] / $z['RENTED']['n'], 2) : null;
            $ter = $tarifa['por_entrega'] ?? null;
            $op = array_filter(['Propio' => $propio, 'Alquilado' => $alq, 'Tercero' => $ter], fn ($x) => $x !== null);
            asort($op);
            $out[] = ['zone_id' => $z['zone_id'], 'zona' => $z['zona'] ?? '—', 'entregas_propio' => $z['OWN']['n'], 'propio' => $propio, 'entregas_alquilado' => $z['RENTED']['n'],
                'alquilado' => $alq, 'tercero' => $ter, 'empresa' => $tarifa['empresa'] ?? null, 'mejor' => $op ? array_key_first($op) : null];
        }
        usort($out, fn ($a, $b) => ($b['entregas_propio'] + $b['entregas_alquilado']) <=> ($a['entregas_propio'] + $a['entregas_alquilado']));

        return $out;
    }
}
