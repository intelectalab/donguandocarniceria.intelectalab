<?php

namespace App\Modulos\Per\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * PER-13 Supervisión (RN-PER-16): toda alerta de control del CRM, TEL o FLO queda vinculada al trabajador y a su supervisor,
 * con la acción tomada (que no se cambia ni se borra). RN-PER-20: alertas graves abiertas retienen el pago de comisiones.
 */
final class Supervision
{
    /** Vincula las alertas nuevas: control_alerts (CRM y TEL), alertas de FLO con conductor y multas de tránsito. Idempotente. */
    public static function vincular(): int
    {
        $n = 0;
        $alertas = DB::table('control_alerts as a')->join('users as u', 'u.id', '=', 'a.user_id')->whereNotNull('u.employee_id')
            ->whereNotExists(fn ($q) => $q->from('supervision_actions as s')->whereColumn('s.control_alert_id', 'a.id'))
            ->get(['a.*', 'u.employee_id']);
        foreach ($alertas as $a) {
            $n += DB::table('supervision_actions')->insertOrIgnore([
                'employee_id' => $a->employee_id, 'supervisor_employee_id' => Personal::supervisorDe($a->employee_id), 'source' => $a->source_type === 'CALL_TRANSCRIPT' || $a->call_id ? 'TEL_CALL' : 'CRM_CONTROL_ALERT',
                'source_ref_id' => $a->id, 'control_alert_id' => $a->id, 'severity' => in_array($a->severity, ['LOW', 'MEDIUM', 'HIGH'], true) ? $a->severity : 'MEDIUM',
                'summary' => trim(($a->rule_code ? "{$a->rule_code}: " : '').($a->matched_text ?? 'Alerta de control').($a->excerpt ? ' · «'.$a->excerpt.'»' : '')),
                'status' => 'OPEN', 'raised_at' => $a->raised_at ?? $a->created_at,
            ]);
        }
        if (DB::getSchemaBuilder()->hasTable('fleet_alerts')) {
            $flota = DB::table('fleet_alerts as f')->whereNotNull('f.employee_id')->where('f.severity', '<>', 'info')
                ->whereNotExists(fn ($q) => $q->from('supervision_actions as s')->where('s.source', 'FLO_ALERT')->whereColumn('s.source_ref_id', 'f.id'))->get();
            foreach ($flota as $f) {
                $n += DB::table('supervision_actions')->insertOrIgnore([
                    'employee_id' => $f->employee_id, 'supervisor_employee_id' => Personal::supervisorDe($f->employee_id), 'source' => 'FLO_ALERT', 'source_ref_id' => $f->id,
                    'severity' => $f->severity === 'bad' ? 'HIGH' : 'MEDIUM', 'summary' => trim("{$f->number}: {$f->title}".($f->detail ? ' · '.$f->detail : '')),
                    'status' => 'OPEN', 'raised_at' => $f->first_at,
                ]);
            }
            $multas = DB::table('traffic_fines as t')->whereNotNull('t.employee_id')->where('t.status', '<>', 'VOIDED')
                ->whereNotExists(fn ($q) => $q->from('supervision_actions as s')->where('s.source', 'FLO_FINE')->whereColumn('s.source_ref_id', 't.id'))->get();
            foreach ($multas as $t) {
                $n += DB::table('supervision_actions')->insertOrIgnore([
                    'employee_id' => $t->employee_id, 'supervisor_employee_id' => Personal::supervisorDe($t->employee_id), 'source' => 'FLO_FINE', 'source_ref_id' => $t->id,
                    'severity' => 'MEDIUM', 'summary' => "Papeleta {$t->ballot_number}: ".($t->infraction ?? 'infracción de tránsito').' ('.Base::soles((float) $t->amount).')',
                    'status' => 'OPEN', 'raised_at' => $t->fine_date.' 12:00:00-05',
                ]);
            }
        }

        return $n;
    }

    /** Alertas graves abiertas del trabajador: supervisión abierta HIGH y alertas de control HIGH sin cerrar en el CRM. */
    public static function gravesAbiertas(string $empleado): int
    {
        $sv = DB::table('supervision_actions')->where('employee_id', $empleado)->where('status', 'OPEN')->where('severity', 'HIGH')->pluck('control_alert_id')->all();
        $u = DB::table('users')->where('employee_id', $empleado)->pluck('id');
        $ca = $u->isEmpty() ? 0 : DB::table('control_alerts')->whereIn('user_id', $u)->where('severity', 'HIGH')->whereIn('status', ['OPEN', 'UNDER_REVIEW'])
            ->whereNotIn('id', array_filter($sv))->whereNotExists(fn ($q) => $q->from('supervision_actions as s')->whereColumn('s.control_alert_id', 'control_alerts.id')->where('s.status', 'CLOSED'))->count();

        return count($sv) + $ca;
    }

    /** Alertas graves con llamada de atención en el período (penalidad del plan sobre la comisión). */
    public static function confirmadas(string $empleado, string $periodo): int
    {
        return DB::table('supervision_actions')->where('employee_id', $empleado)->where('status', 'CLOSED')->where('severity', 'HIGH')
            ->whereIn('action', ['VERBAL_WARNING', 'WRITTEN_WARNING'])->whereBetween('raised_at', [$periodo.' 00:00:00-05', Base::finDeMes($periodo).' 23:59:59-05'])->count();
    }

    public static function lista(User $u, ?string $estado, ?string $origen): array
    {
        self::vincular();
        $vis = Base::visibles($u);
        $yo = Base::yo($u);
        $q = DB::table('supervision_actions as s')->join('employees as e', 'e.id', '=', 's.employee_id')->leftJoin('employees as sp', 'sp.id', '=', 's.supervisor_employee_id')
            ->leftJoin('users as ab', 'ab.id', '=', 's.action_by')
            ->when($vis !== null, fn ($w) => $w->where(fn ($x) => $x->whereIn('s.employee_id', $vis)->orWhere('s.supervisor_employee_id', $yo)))
            ->when($estado, fn ($w) => $w->where('s.status', $estado))->when($origen, fn ($w) => $w->where('s.source', $origen))
            ->orderByRaw("CASE WHEN s.status = 'OPEN' THEN 0 ELSE 1 END")->orderByRaw("CASE s.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END")->orderByDesc('s.raised_at')->limit(500)
            ->get(['s.*', 'e.full_name', 'sp.full_name as supervisor', 'ab.name as registro']);
        $puede = Access::can($u, 'per.supervision.manage');
        $todos = DB::table('supervision_actions')->when($vis !== null, fn ($w) => $w->where(fn ($x) => $x->whereIn('employee_id', $vis)->orWhere('supervisor_employee_id', $yo)));

        return ['data' => $q->map(fn ($s) => ['id' => $s->id, 'employee_id' => $s->employee_id, 'trabajador' => $s->full_name, 'supervisor' => $s->supervisor,
            'source' => $s->source, 'origen' => Base::ORIGENES[$s->source], 'severity' => $s->severity, 'summary' => $s->summary, 'action' => $s->action,
            'accion' => $s->action ? Base::ACCIONES[$s->action] : null, 'action_note' => $s->action_note, 'registro' => $s->registro, 'action_at' => Asistencia::iso($s->action_at),
            'status' => $s->status, 'raised_at' => Asistencia::iso($s->raised_at), 'puede_registrar' => $puede && $s->status === 'OPEN' && $s->employee_id !== $yo])->all(),
            'resumen' => ['abiertas' => (clone $todos)->where('status', 'OPEN')->count(), 'graves' => (clone $todos)->where('status', 'OPEN')->where('severity', 'HIGH')->count(),
                'cerradas_mes' => (clone $todos)->where('status', 'CLOSED')->where('action_at', '>=', Base::mes().' 00:00:00-05')->count(),
                'retenidos' => DB::table('staff_payouts')->where('status', 'HELD')->count()]];
    }

    public static function registrar(string $id, array $d, User $u): array
    {
        if (! Access::can($u, 'per.supervision.manage')) {
            RuleError::fail('RN-PER-16', 'Registrar acciones requiere per.supervision.manage.');
        }
        $s = DB::table('supervision_actions')->where('id', $id)->first() ?? abort(404, 'No se encontró la alerta.');
        if ($s->status === 'CLOSED') {
            RuleError::fail('RN-PER-16', 'La acción ya está registrada y no se cambia; registra una nueva observación si hace falta.');
        }
        if ($s->employee_id === Base::yo($u)) {
            RuleError::fail('RN-PER-16', 'Nadie registra la acción sobre sus propias alertas.');
        }
        $accion = $d['action'] ?? null;
        if (! isset(Base::ACCIONES[$accion])) {
            RuleError::fail('RN-PER-16', 'Elige la acción tomada.');
        }
        $nota = trim((string) ($d['note'] ?? ''));
        if ($accion !== 'NO_ACTION' && mb_strlen($nota) < 10) {
            RuleError::fail('RN-PER-16', 'Describe la acción tomada (al menos 10 letras).');
        }

        return DB::transaction(function () use ($s, $accion, $nota, $u) {
            DB::table('supervision_actions')->where('id', $s->id)->update(['action' => $accion, 'action_note' => $nota ?: null, 'action_by' => $u->id, 'action_at' => now(),
                'status' => 'CLOSED', 'updated_at' => now()]);
            // la alerta del CRM queda revisada con la misma decisión
            if ($s->control_alert_id) {
                DB::table('control_alerts')->where('id', $s->control_alert_id)->whereIn('status', ['OPEN', 'UNDER_REVIEW'])->update([
                    'status' => in_array($accion, ['NO_ACTION'], true) ? 'DISMISSED' : 'CONFIRMED', 'reviewed_by' => $u->id, 'reviewed_at' => now(),
                    'resolution_note' => mb_substr('PER-13 · '.Base::ACCIONES[$accion].($nota ? ': '.$nota : ''), 0, 255), 'updated_at' => now(),
                ]);
            }
            Events::emit('supervision.action_recorded', 'supervision_actions', $s->id, ['employee_id' => $s->employee_id, 'action' => $accion]);

            return ['id' => $s->id, 'status' => 'CLOSED', 'retenidos' => Pagos::liberables($s->employee_id)];
        });
    }

    /** Observación nueva sobre un trabajador (asistencia u otro), que entra abierta a la bandeja. */
    public static function nueva(array $d, User $u): array
    {
        if (! Access::can($u, 'per.supervision.manage') && ! Access::can($u, 'per.attendance.approve')) {
            RuleError::fail('RN-PER-16', 'Registrar observaciones requiere per.supervision.manage.');
        }
        $e = Base::trabajador($d['employee_id'] ?? null);
        $origen = in_array($d['source'] ?? 'OTHER', ['ATTENDANCE', 'OTHER'], true) ? ($d['source'] ?? 'OTHER') : 'OTHER';
        $id = DB::table('supervision_actions')->insertGetId(['employee_id' => $e->id, 'supervisor_employee_id' => Personal::supervisorDe($e->id), 'source' => $origen,
            'severity' => in_array($d['severity'] ?? 'MEDIUM', ['LOW', 'MEDIUM', 'HIGH'], true) ? $d['severity'] : 'MEDIUM',
            'summary' => Base::obligatorio($d['summary'] ?? '', 'RN-PER-16', 'Describe la alerta (al menos 10 letras).', 10, 1000), 'status' => 'OPEN', 'raised_at' => now(), 'created_by' => $u->id]);

        return ['id' => $id];
    }
}
