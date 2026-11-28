<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/** FLO-07 Plan de mantenimiento y FLO-08 Órdenes (RN-FLO-09, RN-FLO-10; el bloqueo por vencido es RN-FLO-11). */
final class Mantenimiento
{
    public const ESTADOS_PLAN = ['OK' => 'Al día', 'DUE_SOON' => 'Próximo', 'OVERDUE' => 'Vencido', 'OVERDUE_BLOCK' => 'Bloquea el vehículo'];

    /** RN-FLO-09: vence lo que ocurra primero (km o días); aviso flo_maint_alert_km o flo_maint_alert_days antes. */
    public static function estado(object $p, float $odometro, ?string $al = null): array
    {
        $al ??= Base::hoy();
        $kmR = $p->next_due_km !== null ? round((float) $p->next_due_km - $odometro, 1) : null;
        $dR = $p->next_due_on ? (int) CarbonImmutable::parse($al)->diffInDays(CarbonImmutable::parse($p->next_due_on), false) : null;
        $ak = Base::num('flo_maint_alert_km', 500);
        $ad = Base::num('flo_maint_alert_days', 7);
        $blk = Base::num('flo_maint_overdue_block_km', 1000);
        $st = 'OK';
        if (($kmR !== null && $kmR <= $ak) || ($dR !== null && $dR <= $ad)) {
            $st = 'DUE_SOON';
        }
        if (($kmR !== null && $kmR < 0) || ($dR !== null && $dR < 0)) {
            $st = 'OVERDUE';
        }
        if ($kmR !== null && $kmR < -$blk) {
            $st = 'OVERDUE_BLOCK';
        }

        return [
            'estado' => $st, 'km_restante' => $kmR, 'dias_restantes' => $dR, 'odometro' => $odometro,
            'aviso_km' => $p->next_due_km !== null ? round((float) $p->next_due_km - $ak, 1) : null,
            'aviso_fecha' => $p->next_due_on ? CarbonImmutable::parse($p->next_due_on)->subDays((int) $ad)->toDateString() : null,
        ];
    }

    private static function exigirPermiso(User $u): void
    {
        if (! Access::can($u, 'flo.maintenance.manage')) {
            abort(403, 'Los planes y órdenes de mantenimiento son del coordinador de delivery.');
        }
    }

    /** Crea o edita un plan. Con último servicio, el próximo se calcula (km + intervalo, fecha + días). */
    public static function guardarPlan(?string $id, array $d, User $u): object
    {
        self::exigirPermiso($u);

        return DB::transaction(function () use ($id, $d, $u) {
            $antes = $id ? DB::table('vehicle_maintenance_plans')->where('id', $id)->lockForUpdate()->first() : null;
            if ($id && ! $antes) {
                abort(404, 'No se encontró el plan.');
            }
            $v = Base::vehiculo($antes->vehicle_id ?? ($d['vehicle_id'] ?? null), $u, 'RN-FLO-09');
            $tarea = Base::texto($d['task'] ?? null, 'RN-FLO-09', 'Indica la tarea (cambio de aceite, llantas, frenos…).', 3, 120);
            $ik = Base::decimal($d['interval_km'] ?? null);
            $id_ = isset($d['interval_days']) && $d['interval_days'] !== '' && $d['interval_days'] !== null ? (int) $d['interval_days'] : null;
            if (($ik !== null && $ik <= 0) || ($id_ !== null && $id_ <= 0)) {
                RuleError::fail('RN-FLO-09', 'Los intervalos deben ser mayores que cero.');
            }
            if ($ik === null && $id_ === null) {
                RuleError::fail('RN-FLO-09', 'El plan necesita intervalo por km, por días o ambos.');
            }
            $lk = Base::decimal($d['last_done_km'] ?? null);
            $lo = ! empty($d['last_done_on']) ? (string) $d['last_done_on'] : null;
            if ($lo && $lo > Base::hoy()) {
                RuleError::fail('RN-FLO-09', 'El último servicio no puede tener fecha futura.');
            }
            $actual = Odometro::actual($v);
            if ($lk !== null && $lk > $actual + 0.05) {
                RuleError::fail('RN-FLO-04', 'El km del último servicio ('.Base::km($lk).') no puede ser mayor que el odómetro actual ('.Base::km($actual).').');
            }
            $fila = [
                'vehicle_id' => $v->id, 'task' => $tarea, 'interval_km' => $ik, 'interval_days' => $id_, 'last_done_km' => $lk, 'last_done_on' => $lo,
                'next_due_km' => $ik !== null ? round(($lk ?? $actual) + $ik, 1) : null,
                'next_due_on' => $id_ !== null ? CarbonImmutable::parse($lo ?? Base::hoy())->addDays($id_)->toDateString() : null,
                'status' => in_array($d['status'] ?? 'ACTIVE', ['ACTIVE', 'INACTIVE'], true) ? ($d['status'] ?? 'ACTIVE') : 'ACTIVE',
                'notes' => ! empty($d['notes']) ? mb_substr(trim($d['notes']), 0, 1000) : null, 'updated_at' => now(),
            ];
            if ($antes) {
                DB::table('vehicle_maintenance_plans')->where('id', $antes->id)->update($fila);
                $pid = $antes->id;
            } else {
                $pid = DB::table('vehicle_maintenance_plans')->insertGetId($fila + ['code' => Base::numero('vehicle_maintenance_plans', 'PM-', 3, 'code')], 'id');
            }
            $p = DB::table('vehicle_maintenance_plans')->where('id', $pid)->first();
            if ($p->status !== 'ACTIVE' || self::estado($p, $actual)['estado'] === 'OK') {
                Alertas::cerrarPor('MAINTENANCE', ['plan:'.$pid], $p->status !== 'ACTIVE' ? 'Plan desactivado' : 'Plan al día', $u);
            }

            return (object) (array_replace((array) $p, ['estado' => $p->status === 'ACTIVE' ? self::estado($p, $actual) : null]));
        });
    }

    /** Abre una orden preventiva (de un plan) o correctiva. «En taller» deja el vehículo en mantenimiento (RN-FLO-11). */
    public static function abrir(array $d, User $u): object
    {
        self::exigirPermiso($u);

        return DB::transaction(function () use ($d, $u) {
            $v = Base::vehiculo($d['vehicle_id'] ?? null, $u, 'RN-FLO-09');
            $tipo = $d['kind'] ?? 'CORRECTIVE';
            if (! in_array($tipo, ['PREVENTIVE', 'CORRECTIVE'], true)) {
                RuleError::fail('RN-FLO-09', 'Elige preventivo o correctivo.');
            }
            $plan = ! empty($d['plan_id']) ? DB::table('vehicle_maintenance_plans')->where('id', $d['plan_id'])->where('vehicle_id', $v->id)->first() : null;
            if ($tipo === 'PREVENTIVE' && ! $plan) {
                RuleError::fail('RN-FLO-10', 'Un mantenimiento preventivo sale de un plan del vehículo (Plan de mantenimiento).');
            }
            if ($plan && DB::table('vehicle_maintenances')->where('plan_id', $plan->id)->where('status', 'IN_PROGRESS')->exists()) {
                RuleError::fail('RN-FLO-10', "«{$plan->task}» ya tiene una orden abierta.");
            }
            $desc = Base::texto($d['description'] ?? ($plan->task ?? null), 'RN-FLO-09', 'Describe el trabajo o la falla.', 3, 2000);
            $abre = ! empty($d['opened_on']) ? (string) $d['opened_on'] : Base::hoy();
            if ($abre > Base::hoy()) {
                RuleError::fail('RN-FLO-09', 'La orden no puede abrirse con fecha futura.');
            }
            $taller = ! empty($d['workshop_supplier_id']) ? DB::table('suppliers')->where('id', $d['workshop_supplier_id'])->first(['id', 'trade_name', 'legal_name']) : null;
            $enTaller = filter_var($d['in_workshop'] ?? true, FILTER_VALIDATE_BOOLEAN);
            if ($enTaller && Jornadas::abiertaDe($v->id)) {
                RuleError::fail('RN-FLO-11', "{$v->plate} está en jornada: abre la orden cuando la cierre o márcala «sin entrar al taller».");
            }
            $id = DB::table('vehicle_maintenances')->insertGetId([
                'number' => Base::numero('vehicle_maintenances', 'MV-', 4), 'vehicle_id' => $v->id, 'plan_id' => $plan?->id, 'kind' => $tipo, 'description' => $desc,
                'workshop_supplier_id' => $taller?->id, 'workshop_name' => $taller ? ($taller->trade_name ?: $taller->legal_name) : (! empty($d['workshop_name']) ? mb_substr(trim($d['workshop_name']), 0, 120) : null),
                'opened_on' => $abre, 'in_workshop' => $enTaller, 'due_km' => $plan?->next_due_km, 'due_on' => $plan?->next_due_on, 'status' => 'IN_PROGRESS', 'opened_by' => $u->id,
            ], 'id');
            if ($enTaller) {
                Vehiculos::estadoOperativo($v, 'IN_MAINTENANCE');
            }

            return DB::table('vehicle_maintenances')->where('id', $id)->first();
        });
    }

    /**
     * Cierra la orden con odómetro, repuestos, mano de obra y comprobante. RN-FLO-10: el preventivo mueve su plan;
     * RN-FLO-17: el comprobante se enlaza a un gasto de GAS una sola vez (o se crea su borrador).
     */
    public static function cerrar(string $id, array $d, UploadedFile|string|null $foto, User $u): object
    {
        self::exigirPermiso($u);

        return DB::transaction(function () use ($id, $d, $foto, $u) {
            $m = DB::table('vehicle_maintenances')->where('id', $id)->lockForUpdate()->first();
            if (! $m) {
                abort(404, 'No se encontró la orden.');
            }
            $v = Base::vehiculo($m->vehicle_id, $u, 'RN-FLO-10');
            if ($m->status !== 'IN_PROGRESS') {
                RuleError::fail('RN-FLO-10', "La orden {$m->number} ya está ".($m->status === 'DONE' ? 'hecha' : 'anulada').'.');
            }
            $hecho = ! empty($d['done_on']) ? (string) $d['done_on'] : Base::hoy();
            if ($hecho > Base::hoy() || $hecho < $m->opened_on) {
                RuleError::fail('RN-FLO-10', 'La fecha del servicio va entre la apertura ('.Base::fecha($m->opened_on).') y hoy.');
            }
            $empresa = DB::table('establishments')->where('id', $v->establishment_id)->value('company_id');
            if ($empresa) {
                Periodos::abierto($hecho, $empresa);
            }
            $en = $hecho === Base::hoy() ? Base::ahora() : CarbonImmutable::parse($hecho.' 17:30', 'America/Lima');
            $odo = Odometro::exigir($v, $d['odometer_km'] ?? null, $en);
            $partes = [];
            foreach ((array) ($d['parts'] ?? []) as $p) {
                $desc = trim((string) ($p['description'] ?? ''));
                if ($desc === '') {
                    continue;
                }
                $q = (float) ($p['qty'] ?? 0);
                $c = (float) ($p['unit_cost'] ?? 0);
                if ($q <= 0 || $c < 0) {
                    RuleError::fail('RN-FLO-16', "Revisa la cantidad y el costo de «{$desc}».");
                }
                $partes[] = ['description' => mb_substr($desc, 0, 120), 'qty' => $q, 'unit_cost' => round($c, 2), 'total' => round($q * $c, 2)];
            }
            $pa = round(array_sum(array_column($partes, 'total')), 2);
            $mo = Base::r($d['labor_amount'] ?? 0);
            if ($mo < 0) {
                RuleError::fail('RN-FLO-16', 'La mano de obra no puede ser negativa.');
            }
            $fuera = isset($d['days_out_of_service']) && $d['days_out_of_service'] !== '' ? max(0, (int) $d['days_out_of_service'])
                : ($m->in_workshop ? (int) CarbonImmutable::parse($m->opened_on)->diffInDays(CarbonImmutable::parse($hecho)) : 0);
            $aTiempo = $m->kind === 'PREVENTIVE' ? (($m->due_on ? $hecho <= $m->due_on : true) && ($m->due_km !== null ? $odo <= (float) $m->due_km : true)) : null;
            $fileId = Archivo::guardar($foto, null, null, $u, 'RN-FLO-17');
            DB::table('vehicle_maintenances')->where('id', $id)->update([
                'status' => 'DONE', 'done_on' => $hecho, 'odometer_km' => $odo, 'parts' => json_encode($partes, JSON_UNESCAPED_UNICODE), 'parts_amount' => $pa,
                'labor_amount' => $mo, 'total_amount' => round($pa + $mo, 2), 'days_out_of_service' => $fuera,
                'doc_type' => ! empty($d['doc_type']) ? mb_substr($d['doc_type'], 0, 20) : null, 'doc_number' => ! empty($d['doc_number']) ? mb_substr(mb_strtoupper(trim($d['doc_number'])), 0, 30) : null,
                'receipt_file_id' => $fileId ?? $m->receipt_file_id, 'on_time' => $aTiempo, 'closed_by' => $u->id, 'updated_at' => now(),
            ]);
            Odometro::registrar($v, $odo, $en, 'MAINTENANCE', $id, $u);
            if ($m->plan_id) {
                $p = DB::table('vehicle_maintenance_plans')->where('id', $m->plan_id)->first();
                DB::table('vehicle_maintenance_plans')->where('id', $p->id)->update([
                    'last_done_km' => $odo, 'last_done_on' => $hecho,
                    'next_due_km' => $p->interval_km !== null ? round($odo + (float) $p->interval_km, 1) : null,
                    'next_due_on' => $p->interval_days !== null ? CarbonImmutable::parse($hecho)->addDays((int) $p->interval_days)->toDateString() : null,
                    'updated_at' => now(),
                ]);
                Alertas::cerrarPor('MAINTENANCE', ['plan:'.$m->plan_id], "Hecho en {$m->number}", $u);
            }
            $total = round($pa + $mo, 2);
            if ($total > 0) {
                Gastos::alRegistrar('vehicle_maintenances', $id, $d, [
                    'tipo' => $m->kind === 'PREVENTIVE' ? 'MAINTENANCE_PREVENTIVE' : 'MAINTENANCE_CORRECTIVE', 'vehiculo' => $v, 'monto' => $total, 'fecha' => $hecho,
                    'descripcion' => "{$m->number} · {$m->description} · {$v->plate}", 'proveedor' => $m->workshop_supplier_id, 'odometro' => $odo, 'foto' => $fileId,
                ], $u);
            }
            if (! DB::table('vehicle_maintenances')->where('vehicle_id', $v->id)->where('status', 'IN_PROGRESS')->where('in_workshop', true)->exists()) {
                Vehiculos::estadoOperativo($v, 'ACTIVE');
            }

            return DB::table('vehicle_maintenances')->where('id', $id)->first();
        });
    }

    /** Anula una orden abierta por error (no se borra). */
    public static function anular(string $id, string $motivo, User $u): object
    {
        self::exigirPermiso($u);

        return DB::transaction(function () use ($id, $motivo, $u) {
            $m = DB::table('vehicle_maintenances')->where('id', $id)->lockForUpdate()->first();
            if (! $m) {
                abort(404, 'No se encontró la orden.');
            }
            $v = Base::vehiculo($m->vehicle_id, $u, 'RN-FLO-10');
            if ($m->status !== 'IN_PROGRESS') {
                RuleError::fail('RN-FLO-10', 'Solo se anula una orden en taller. Una hecha ya movió el plan y el odómetro.');
            }
            $r = Base::texto($motivo, 'RN-FLO-10', 'Anular una orden exige un motivo de al menos 10 caracteres.', 10, 500);
            DB::table('vehicle_maintenances')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => $r, 'closed_by' => $u->id, 'updated_at' => now()]);
            if (! DB::table('vehicle_maintenances')->where('vehicle_id', $v->id)->where('status', 'IN_PROGRESS')->where('in_workshop', true)->exists()) {
                Vehiculos::estadoOperativo($v, 'ACTIVE');
            }

            return DB::table('vehicle_maintenances')->where('id', $id)->first();
        });
    }

    /** FLO-07: planes con su estado. */
    public static function planes(User $u, ?string $vehiculo = null, ?string $estado = null): array
    {
        $vs = Base::flota($u)->when($vehiculo, fn ($w) => $w->where('v.id', $vehiculo))->get(['v.*'])->keyBy('id');
        $planes = DB::table('vehicle_maintenance_plans')->whereIn('vehicle_id', $vs->keys()->all() ?: ['00000000-0000-0000-0000-000000000000'])
            ->orderBy('code')->get();
        $odo = [];
        $filas = [];
        foreach ($planes as $p) {
            $v = $vs[$p->vehicle_id];
            $odo[$v->id] ??= Odometro::actual($v);
            $e = $p->status === 'ACTIVE' ? self::estado($p, $odo[$v->id]) : ['estado' => 'INACTIVE', 'km_restante' => null, 'dias_restantes' => null, 'aviso_km' => null, 'aviso_fecha' => null];
            $orden = DB::table('vehicle_maintenances')->where('plan_id', $p->id)->where('status', 'IN_PROGRESS')->value('number');
            $filas[] = array_replace((array) $p, $e + ['vehiculo' => Base::etiqueta($v), 'odometro' => $odo[$v->id], 'orden_abierta' => $orden,
                'interval_km' => $p->interval_km !== null ? (float) $p->interval_km : null, 'next_due_km' => $p->next_due_km !== null ? (float) $p->next_due_km : null,
                'last_done_km' => $p->last_done_km !== null ? (float) $p->last_done_km : null]);
        }
        if ($estado) {
            $filas = array_values(array_filter($filas, fn ($x) => $x['estado'] === $estado || ($estado === 'ALERT' && in_array($x['estado'], ['DUE_SOON', 'OVERDUE', 'OVERDUE_BLOCK'], true))));
        }
        usort($filas, fn ($a, $b) => [array_search($a['estado'], ['OVERDUE_BLOCK', 'OVERDUE', 'DUE_SOON', 'OK', 'INACTIVE'], true), $a['code']]
            <=> [array_search($b['estado'], ['OVERDUE_BLOCK', 'OVERDUE', 'DUE_SOON', 'OK', 'INACTIVE'], true), $b['code']]);

        return $filas;
    }

    /** FLO-08: órdenes con su vehículo. */
    public static function ordenes(User $u, array $f): array
    {
        $vs = Base::flota($u)->pluck('v.id')->all();

        return DB::table('vehicle_maintenances as m')->join('vehicles as v', 'v.id', '=', 'm.vehicle_id')->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 'm.vehicle_id')
            ->leftJoin('vehicle_maintenance_plans as pl', 'pl.id', '=', 'm.plan_id')->leftJoin('expenses as e', 'e.id', '=', 'm.expense_id')
            ->whereIn('m.vehicle_id', $vs ?: ['00000000-0000-0000-0000-000000000000'])
            ->when($f['estado'] ?? null, fn ($w) => $w->where('m.status', $f['estado']))
            ->when($f['tipo'] ?? null, fn ($w) => $w->where('m.kind', $f['tipo']))
            ->when($f['vehiculo'] ?? null, fn ($w) => $w->where('m.vehicle_id', $f['vehiculo']))
            ->orderByRaw("CASE m.status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END")->orderByDesc('m.opened_on')->orderByDesc('m.number')->limit(300)
            ->get(['m.*', 'v.plate', 'p.internal_code', 'pl.task as plan', 'pl.code as plan_code', 'e.number as gasto', 'e.status as estado_gasto'])
            ->map(fn ($m) => array_replace((array) $m, [
                'vehiculo' => $m->internal_code && $m->internal_code !== $m->plate ? "{$m->internal_code} · {$m->plate}" : $m->plate,
                'parts' => json_decode($m->parts ?: '[]', true), 'total_amount' => (float) $m->total_amount, 'parts_amount' => (float) $m->parts_amount,
                'labor_amount' => (float) $m->labor_amount, 'odometer_km' => $m->odometer_km !== null ? (float) $m->odometer_km : null,
                'due_km' => $m->due_km !== null ? (float) $m->due_km : null,
            ]))->all();
    }
}
