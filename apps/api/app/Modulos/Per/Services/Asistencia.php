<?php

namespace App\Modulos\Per\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * PER-04 Turnos, PER-05 Programación (RN-PER-08), PER-06 Marcación (RN-PER-03/04/05/06), PER-07 QR del local (RN-PER-04)
 * y PER-08 Asistencia diaria (RN-PER-07/08), con permisos y vacaciones.
 */
final class Asistencia
{
    /** Segundos de gracia para un QR recién cambiado (lo que tarda en llegar la lectura). */
    private const GRACIA_QR = 10;

    /* ---------------- PER-04 Turnos ---------------- */

    public static function turnos(): array
    {
        $tol = (int) Base::num('per_late_tolerance_minutes', 10);
        $hoy = Base::hoy();
        $n = DB::table('shift_assignments')->whereBetween('work_date', [CarbonImmutable::parse($hoy)->startOfWeek()->toDateString(), CarbonImmutable::parse($hoy)->endOfWeek()->toDateString()])
            ->whereIn('status', ['PLANNED', 'SWAPPED'])->groupBy('shift_id')->selectRaw('shift_id, count(*) n')->pluck('n', 'shift_id');

        return DB::table('shifts as s')->join('establishments as e', 'e.id', '=', 's.establishment_id')->orderBy('e.code')->orderBy('s.start_time')
            ->get(['s.*', 'e.short as local'])->map(fn ($s) => [
                'id' => $s->id, 'establishment_id' => $s->establishment_id, 'local' => $s->local, 'code' => $s->code, 'name' => $s->name,
                'start_time' => substr($s->start_time, 0, 5), 'end_time' => substr($s->end_time, 0, 5), 'break_minutes' => (int) $s->break_minutes,
                'crosses_midnight' => (bool) $s->crosses_midnight, 'late_tolerance_minutes' => $s->late_tolerance_minutes === null ? null : (int) $s->late_tolerance_minutes,
                'tolerancia' => $s->late_tolerance_minutes === null ? $tol : (int) $s->late_tolerance_minutes, 'horas' => Base::r(self::largo($s) / 60, 2),
                'status' => $s->status, 'semana' => (int) ($n[$s->id] ?? 0),
            ])->all();
    }

    private static function largo(object $s): int
    {
        $a = Base::minutos($s->start_time);
        $b = Base::minutos($s->end_time);
        if ($b <= $a) {
            $b += 1440;
        }

        return $b - $a - (int) $s->break_minutes;
    }

    public static function guardarTurno(?string $id, array $d): array
    {
        if (empty($d['establishment_id']) || ! DB::table('establishments')->where('id', $d['establishment_id'])->exists()) {
            RuleError::fail('RN-PER-07', 'Elige el local del turno.');
        }
        $code = strtoupper(Base::obligatorio($d['code'] ?? '', 'RN-PER-07', 'Indica el código del turno.', 1, 12));
        $name = Base::obligatorio($d['name'] ?? '', 'RN-PER-07', 'Indica el nombre del turno.', 2, 80);
        foreach (['start_time' => 'entrada', 'end_time' => 'salida'] as $k => $l) {
            if (! preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', substr((string) ($d[$k] ?? ''), 0, 5))) {
                RuleError::fail('RN-PER-07', "Indica la hora de {$l} (HH:MM).");
            }
        }
        $cruza = Base::minutos($d['end_time']) <= Base::minutos($d['start_time']);
        if ($cruza && empty($d['crosses_midnight'])) {
            RuleError::fail('RN-PER-07', 'La salida es anterior a la entrada: marca «Cruza la medianoche».');
        }
        if (! $cruza && ! empty($d['crosses_midnight'])) {
            RuleError::fail('RN-PER-07', 'Con esas horas el turno no cruza la medianoche.');
        }
        $brk = (int) ($d['break_minutes'] ?? 0);
        if ($brk < 0 || $brk > 240) {
            RuleError::fail('RN-PER-07', 'El refrigerio va de 0 a 240 minutos.');
        }
        $tol = ($d['late_tolerance_minutes'] ?? null) === null || $d['late_tolerance_minutes'] === '' ? null : (int) $d['late_tolerance_minutes'];
        if ($tol !== null && ($tol < 0 || $tol > 120)) {
            RuleError::fail('RN-PER-07', 'La tolerancia va de 0 a 120 minutos.');
        }
        if (DB::table('shifts')->where('establishment_id', $d['establishment_id'])->whereRaw('upper(code) = ?', [$code])->when($id, fn ($w) => $w->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-PER-07', "Ya hay un turno {$code} en ese local.");
        }
        $fila = ['establishment_id' => $d['establishment_id'], 'code' => $code, 'name' => $name, 'start_time' => substr($d['start_time'], 0, 5), 'end_time' => substr($d['end_time'], 0, 5),
            'break_minutes' => $brk, 'crosses_midnight' => $cruza, 'late_tolerance_minutes' => $tol, 'status' => ($d['status'] ?? 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'];
        if ($id) {
            if (! DB::table('shifts')->where('id', $id)->exists()) {
                abort(404, 'No se encontró el turno.');
            }
            DB::table('shifts')->where('id', $id)->update($fila + ['updated_at' => now()]);
        } else {
            $id = DB::table('shifts')->insertGetId($fila);
        }

        return collect(self::turnos())->firstWhere('id', $id);
    }

    /* ---------------- PER-05 Programación ---------------- */

    public static function programado(string $empleadoId, string $fecha): ?object
    {
        return DB::table('shift_assignments')->where('employee_id', $empleadoId)->where('work_date', $fecha)->where('status', '<>', 'CANCELLED')->first();
    }

    public static function semana(string $local, string $lunes, User $u): array
    {
        $lunes = CarbonImmutable::parse($lunes)->startOfWeek()->toDateString();
        $dias = array_map(fn ($i) => CarbonImmutable::parse($lunes)->addDays($i)->toDateString(), range(0, 6));
        $vis = Base::visibles($u);
        $mapa = Personal::mapa($dias[6]);
        $emps = DB::table('employees')->where('status', 'ACTIVE')->when($vis !== null, fn ($w) => $w->whereIn('id', $vis))->orderBy('full_name')->get(['id', 'full_name'])
            ->filter(fn ($e) => ($mapa[$e->id]['principal']->establishment_id ?? null) === $local)->values();
        $ids = $emps->pluck('id')->all();
        $plan = DB::table('shift_assignments as a')->join('shifts as s', 's.id', '=', 'a.shift_id')->whereIn('a.employee_id', $ids)
            ->whereBetween('a.work_date', [$dias[0], $dias[6]])->where('a.status', '<>', 'CANCELLED')
            ->get(['a.*', 's.code', 's.start_time', 's.end_time', 's.break_minutes'])->keyBy(fn ($a) => $a->employee_id.'|'.$a->work_date);
        $lic = DB::table('leave_requests')->whereIn('employee_id', $ids)->where('status', 'APPROVED')->where('date_from', '<=', $dias[6])->where('date_to', '>=', $dias[0])->get();
        $filas = $emps->map(function ($e) use ($dias, $plan, $lic, $mapa) {
            $min = 0;
            $celdas = array_map(function ($d) use ($e, $plan, $lic, &$min) {
                $a = $plan[$e->id.'|'.$d] ?? null;
                $l = $lic->first(fn ($x) => $x->employee_id === $e->id && $x->date_from <= $d && $x->date_to >= $d);
                if ($a && $a->status !== 'REST' && ! $l) {
                    $min += self::largo($a) + (int) $a->overtime_authorized_minutes;
                }

                return ['fecha' => $d, 'id' => $a?->id, 'shift_id' => $a?->shift_id, 'codigo' => $a?->code, 'status' => $a?->status,
                    'horario' => $a && $a->status !== 'REST' ? substr($a->start_time, 0, 5).'–'.substr($a->end_time, 0, 5) : null,
                    'horas_extra' => (int) ($a?->overtime_authorized_minutes ?? 0), 'permiso' => $l ? Base::PERMISOS[$l->leave_type] : null, 'nota' => $a?->note];
            }, $dias);

            return ['employee_id' => $e->id, 'trabajador' => $e->full_name, 'puesto' => $mapa[$e->id]['principal']->puesto ?? null, 'dias' => $celdas, 'horas' => Base::r($min / 60, 1)];
        })->all();

        return ['lunes' => $dias[0], 'dias' => array_map(fn ($d) => ['fecha' => $d, 'feriado' => Base::feriado($d)], $dias), 'filas' => $filas,
            'cobertura' => array_map(fn ($i) => count(array_filter($filas, fn ($f) => in_array($f['dias'][$i]['status'], ['PLANNED', 'SWAPPED'], true) && ! $f['dias'][$i]['permiso'])), range(0, 6))];
    }

    /** Programa (o cambia) el turno de un día. Un cambio deja la programación anterior anulada con su nota. */
    public static function programar(string $empleadoId, string $fecha, array $d, User $u): ?array
    {
        Base::trabajador($empleadoId);
        $estado = $d['status'] ?? 'PLANNED';
        if (! in_array($estado, ['PLANNED', 'REST', 'CANCELLED'], true)) {
            RuleError::fail('RN-PER-08', 'Estado de la programación no válido.');
        }
        $nota = trim((string) ($d['note'] ?? '')) ?: null;
        $he = max(0, (int) ($d['overtime_authorized_minutes'] ?? 0));
        if ($he > 0) {
            self::puedeAutorizar($u, $empleadoId);
        }

        return DB::transaction(function () use ($empleadoId, $fecha, $estado, $nota, $he, $d, $u) {
            $cur = DB::table('shift_assignments')->where('employee_id', $empleadoId)->where('work_date', $fecha)->where('status', '<>', 'CANCELLED')->lockForUpdate()->first();
            $turno = ($d['shift_id'] ?? null) ?: $cur?->shift_id;
            if ($estado === 'CANCELLED') {
                if ($cur) {
                    DB::table('shift_assignments')->where('id', $cur->id)->update(['status' => 'CANCELLED', 'note' => $nota ?? 'Sin turno', 'updated_at' => now()]);
                }
                self::consolidar($empleadoId, $fecha);

                return null;
            }
            if (! $turno || ! DB::table('shifts')->where('id', $turno)->where('status', 'ACTIVE')->exists()) {
                RuleError::fail('RN-PER-07', 'Elige el turno.');
            }
            if ($cur && $cur->shift_id === $turno && $cur->status === ($estado === 'PLANNED' && $cur->status === 'SWAPPED' ? 'SWAPPED' : $estado)) {
                if ((int) $cur->overtime_authorized_minutes !== $he) {
                    DB::table('shift_assignments')->where('id', $cur->id)->update(['overtime_authorized_minutes' => $he, 'overtime_authorized_by' => $he ? $u->id : null,
                        'note' => $nota ?? $cur->note, 'updated_at' => now()]);
                }
                $id = $cur->id;
            } else {
                if ($cur) {
                    DB::table('shift_assignments')->where('id', $cur->id)->update(['status' => 'CANCELLED', 'note' => $nota ?? 'Cambio de programación', 'updated_at' => now()]);
                }
                $id = DB::table('shift_assignments')->insertGetId([
                    'employee_id' => $empleadoId, 'shift_id' => $turno, 'work_date' => $fecha,
                    'status' => $cur && $estado === 'PLANNED' && $cur->status !== 'REST' && $cur->shift_id !== $turno ? 'SWAPPED' : $estado,
                    'overtime_authorized_minutes' => $estado === 'REST' ? 0 : $he, 'overtime_authorized_by' => $estado !== 'REST' && $he ? $u->id : null,
                    'note' => $nota, 'created_by' => $u->id,
                ]);
            }
            if ($fecha <= Base::hoy()) {
                self::consolidar($empleadoId, $fecha);
            }

            return (array) DB::table('shift_assignments')->where('id', $id)->first();
        });
    }

    /** Copia la programación de la semana anterior en los días que aún no tienen turno. */
    public static function copiarSemana(string $local, string $lunes, User $u): int
    {
        $n = 0;
        $sem = self::semana($local, $lunes, $u);
        foreach ($sem['filas'] as $f) {
            foreach ($f['dias'] as $c) {
                if ($c['id']) {
                    continue;
                }
                $prev = self::programado($f['employee_id'], CarbonImmutable::parse($c['fecha'])->subWeek()->toDateString());
                if ($prev) {
                    self::programar($f['employee_id'], $c['fecha'], ['shift_id' => $prev->shift_id, 'status' => $prev->status === 'REST' ? 'REST' : 'PLANNED', 'note' => 'Copiado de la semana anterior'], $u);
                    $n++;
                }
            }
        }

        return $n;
    }

    /** RN-PER-08: las horas extra las autoriza antes un supervisor (per.attendance.approve), nunca el propio trabajador. */
    private static function puedeAutorizar(User $u, string $empleadoId): void
    {
        if (! Access::can($u, 'per.attendance.approve')) {
            RuleError::fail('RN-PER-08', 'Autorizar horas extra lo hace el supervisor (per.attendance.approve).');
        }
        if (Base::yo($u) === $empleadoId) {
            RuleError::fail('RN-PER-08', 'Nadie autoriza sus propias horas extra.');
        }
    }

    /* ---------------- PER-07 QR rotativo del local (RN-PER-04) ---------------- */

    public static function qr(string $local, ?CarbonImmutable $en = null): object
    {
        $est = DB::table('establishments')->where('id', $local)->first(['id', 'code', 'short', 'name']);
        if (! $est) {
            abort(404, 'No se encontró el local.');
        }
        $rot = max(15, (int) Base::num('per_qr_rotation_seconds', 60));
        $t = ($en ?? Base::ahora())->getTimestamp();
        $b = intdiv($t, $rot) * $rot;
        $tenant = DB::selectOne('SELECT app_tenant_id() AS t')->t;
        $hash = strtoupper(preg_replace('/[^A-Z0-9]/i', '', $est->code)).'-'.strtoupper(substr(hash_hmac('sha256', "{$tenant}|{$local}|{$b}", (string) config('app.key')), 0, 8));
        $tk = DB::table('establishment_qr_tokens')->where('token_hash', $hash)->first();
        if (! $tk) {
            DB::table('establishment_qr_tokens')->insertOrIgnore([
                'establishment_id' => $local, 'token_hash' => $hash,
                'valid_from' => CarbonImmutable::createFromTimestamp($b, 'America/Lima')->toIso8601String(),
                'valid_to' => CarbonImmutable::createFromTimestamp($b + $rot, 'America/Lima')->toIso8601String(),
            ]);
            $tk = DB::table('establishment_qr_tokens')->where('token_hash', $hash)->first();
        }
        $tk->local = $est->name;

        return $tk;
    }

    public static function pantallaQr(string $local): array
    {
        $tk = self::qr($local);
        $ultimas = DB::table('attendance_marks as m')->join('employees as e', 'e.id', '=', 'm.employee_id')->where('m.establishment_id', $local)->where('m.method', 'QR')
            ->orderByDesc('m.marked_at')->limit(12)->get(['m.id', 'm.marked_at', 'm.mark_type', 'e.full_name']);

        return ['codigo' => $tk->token_hash, 'contenido' => 'GCARNICA-ASIST|'.$tk->token_hash, 'local' => $tk->local, 'desde' => self::iso($tk->valid_from), 'hasta' => self::iso($tk->valid_to),
            'segundos' => max(0, CarbonImmutable::parse($tk->valid_to)->getTimestamp() - Base::ahora()->getTimestamp()),
            'ultimas' => $ultimas->map(fn ($m) => ['id' => $m->id, 'hora' => self::iso($m->marked_at), 'trabajador' => $m->full_name, 'tipo' => Base::MARCAS[$m->mark_type]])->all()];
    }

    /* ---------------- PER-06 Marcación ---------------- */

    /**
     * Registra una marcación (solo inserción, RN-PER-06). Con offline_uuid un reenvío desde el celular no duplica.
     * GEO: fuera del radio queda inválida con su distancia (RN-PER-03). QR: código vigente del mismo local (RN-PER-04).
     * MANUAL: con motivo y aprobada por otra persona (RN-PER-05).
     */
    public static function marcar(array $d, User $u): array
    {
        $propio = Base::yo($u);
        $empleado = ($d['employee_id'] ?? null) ?: $propio;
        $metodo = $d['method'] ?? null;
        if (! $empleado) {
            RuleError::fail('RN-PER-01', 'Tu usuario no está vinculado a un trabajador: pide a RR. HH. que lo vincule.');
        }
        if ($metodo !== 'MANUAL' && $empleado !== $propio) {
            RuleError::fail('RN-PER-05', 'Cada trabajador marca desde su celular. Para marcar por otra persona usa la marcación manual con motivo (PER-08).');
        }
        $e = Base::trabajador($empleado);
        if ($e->status !== 'ACTIVE') {
            RuleError::fail('RN-PER-01', 'El trabajador no está activo.');
        }
        $off = trim((string) ($d['offline_uuid'] ?? '')) ?: null;
        if ($off && ($ya = DB::table('attendance_marks')->where('offline_uuid', $off)->first())) {
            return self::marca($ya) + ['repetida' => true];
        }
        $tipo = $d['mark_type'] ?? 'IN';
        if (! isset(Base::MARCAS[$tipo])) {
            RuleError::fail('RN-PER-06', 'Tipo de marcación no válido.');
        }
        $ahora = Base::ahora();
        $en = $ahora;
        $tarde = false;
        if (! empty($d['marked_at'])) {
            try {
                $en = CarbonImmutable::parse((string) $d['marked_at'], 'America/Lima')->setTimezone('America/Lima');
            } catch (\Throwable) {
                RuleError::fail('RN-PER-06', 'La hora de la marcación no es válida.');
            }
            if ($metodo !== 'MANUAL') {
                // Guardada sin señal en el celular: vale su hora si llega dentro de 48 h y no es futura.
                if ($en->greaterThan($ahora->addMinutes(2)) || $en->lessThan($ahora->subHours(48))) {
                    RuleError::fail('RN-PER-06', 'La marcación guardada en el celular es de hace más de 48 horas o tiene una hora futura: regístrala como manual con motivo.');
                }
                $tarde = $ahora->diffInSeconds($en, true) > 120;
            }
        }
        $local = ($d['establishment_id'] ?? null) ?: (Personal::principal($e->id, $en->toDateString())?->establishment_id ?? $e->establishment_id);
        $est = DB::table('establishments')->where('id', $local)->first();
        if (! $est) {
            RuleError::fail('RN-PER-01', 'El trabajador no tiene local principal (PER-02).');
        }
        $fila = ['employee_id' => $e->id, 'establishment_id' => $local, 'mark_type' => $tipo, 'marked_at' => $en->toIso8601String(), 'method' => $metodo,
            'device_id' => mb_substr((string) ($d['device_id'] ?? ''), 0, 80) ?: null, 'offline_uuid' => $off, 'synced_late' => $tarde, 'recorded_by' => $u->id,
            'is_valid' => true];
        if ($metodo === 'GEO') {
            if (! isset($d['lat'], $d['lng']) || ! is_numeric($d['lat']) || ! is_numeric($d['lng'])) {
                RuleError::fail('RN-PER-03', 'La marcación por GPS necesita la ubicación del celular. Activa la ubicación y vuelve a intentar.');
            }
            if ($est->lat === null || $est->lng === null) {
                RuleError::fail('RN-PER-03', "El local {$est->short} no tiene ubicación en el mapa (PLT-04): marca con el QR.");
            }
            $dist = Base::r(Base::metros((float) $d['lat'], (float) $d['lng'], (float) $est->lat, (float) $est->lng), 1);
            $radio = Base::num('per_geofence_radius_m', 100);
            $fila += ['lat' => Base::r($d['lat'], 7), 'lng' => Base::r($d['lng'], 7), 'distance_m' => $dist];
            if ($dist > $radio) {
                $fila['is_valid'] = false;
                $fila['invalid_reason'] = 'RN-PER-03: marcación a '.number_format($dist, 0, ',', '.')." m de {$est->short}; el radio permitido es ".number_format($radio, 0)." m.";
            }
        } elseif ($metodo === 'QR') {
            $codigo = strtoupper(trim((string) ($d['qr_token'] ?? '')));
            $codigo = str_starts_with($codigo, 'GCARNICA-ASIST|') ? substr($codigo, 15) : $codigo;
            if ($codigo === '') {
                RuleError::fail('RN-PER-04', 'Lee el QR de la pantalla del local.');
            }
            $tk = DB::table('establishment_qr_tokens')->where('token_hash', $codigo)->first();
            if (! $tk) {
                RuleError::fail('RN-PER-04', 'El código QR no corresponde a ningún local.');
            }
            if ($tk->establishment_id !== $local) {
                $otro = DB::table('establishments')->where('id', $tk->establishment_id)->value('short');
                RuleError::fail('RN-PER-04', "El QR es de {$otro} y marcas en {$est->short}.");
            }
            $t = $en->getTimestamp();
            $fin = CarbonImmutable::parse($tk->valid_to)->getTimestamp();
            if ($t < CarbonImmutable::parse($tk->valid_from)->getTimestamp() - 5 || $t > $fin + self::GRACIA_QR) {
                $hace = max(1, (int) round(($t - $fin) / 60));
                RuleError::fail('RN-PER-04', 'El QR leído venció a las '.Base::hora($tk->valid_to)." (hace {$hace} min); el código cambia cada "
                    .(int) Base::num('per_qr_rotation_seconds', 60).' segundos. Lee el QR vigente en la pantalla del local.');
            }
            $fila['qr_token_id'] = $tk->id;
        } elseif ($metodo === 'MANUAL') {
            $motivo = Base::obligatorio($d['manual_reason'] ?? '', 'RN-PER-05', 'La marcación manual exige motivo (al menos 10 letras).', 10);
            if (! Access::can($u, 'per.attendance.approve')) {
                RuleError::fail('RN-PER-05', 'La marcación manual la registra y aprueba un supervisor (per.attendance.approve).');
            }
            if (! $propio) {
                RuleError::fail('RN-PER-05', 'Tu usuario no está vinculado a un trabajador, así que no puede aprobar la marcación manual.');
            }
            if ($propio === $e->id) {
                RuleError::fail('RN-PER-05', 'La marcación manual la aprueba una persona distinta del trabajador.');
            }
            if ($en->greaterThan($ahora->addMinutes(5))) {
                RuleError::fail('RN-PER-05', 'La marcación manual no puede tener una hora futura.');
            }
            $fila += ['manual_reason' => $motivo, 'approved_by_employee_id' => $propio];
        } else {
            RuleError::fail('RN-PER-03', 'Elige cómo marcar: GPS, QR o manual.');
        }
        if (! empty($d['foto'])) {
            $fila['photo_file_id'] = \App\Modulos\Flo\Services\Archivo::guardar($d['foto'], null, null, $u, 'RN-PER-06');
        }

        return DB::transaction(function () use ($fila, $e, $en) {
            $id = DB::table('attendance_marks')->insertGetId($fila);
            Events::emit('attendance.marked', 'attendance_marks', $id, ['employee_id' => $e->id, 'mark_type' => $fila['mark_type'], 'valid' => $fila['is_valid']]);
            $dia = $en->toDateString();
            self::consolidar($e->id, $dia);
            // una salida de madrugada puede cerrar el turno nocturno del día anterior
            if ($en->hour < 12) {
                self::consolidar($e->id, $en->subDay()->toDateString());
            }

            return self::marca(DB::table('attendance_marks')->where('id', $id)->first());
        });
    }

    private static function marca(object $m): array
    {
        return ['id' => $m->id, 'employee_id' => $m->employee_id, 'mark_type' => $m->mark_type, 'tipo' => Base::MARCAS[$m->mark_type], 'marked_at' => self::iso($m->marked_at),
            'method' => $m->method, 'distance_m' => $m->distance_m === null ? null : (float) $m->distance_m, 'is_valid' => (bool) $m->is_valid, 'invalid_reason' => $m->invalid_reason,
            'manual_reason' => $m->manual_reason, 'synced_late' => (bool) $m->synced_late, 'offline_uuid' => $m->offline_uuid];
    }

    public static function iso(?string $t): ?string
    {
        return $t ? CarbonImmutable::parse($t)->setTimezone('America/Lima')->toIso8601String() : null;
    }

    /** Lo que ve el trabajador en su app: turno de hoy, marcaciones de hoy, consolidado y local. */
    public static function app(User $u): array
    {
        $yo = Base::yo($u);
        if (! $yo) {
            return ['vinculado' => false];
        }
        $e = Base::trabajador($yo);
        $hoy = Base::hoy();
        $p = Personal::principal($yo);
        $est = DB::table('establishments')->where('id', $p?->establishment_id ?? $e->establishment_id)->first(['id', 'short', 'name', 'lat', 'lng']);
        $sa = self::programado($yo, $hoy);
        $sh = $sa && $sa->status !== 'REST' ? DB::table('shifts')->where('id', $sa->shift_id)->first() : null;
        $marcas = DB::table('attendance_marks')->where('employee_id', $yo)->whereRaw('(marked_at AT TIME ZONE ?)::date = ?', ['America/Lima', $hoy])->orderBy('marked_at')->get();
        $dia = DB::table('attendance_days')->where('employee_id', $yo)->where('work_date', $hoy)->first();
        $mes = DB::table('attendance_days')->where('employee_id', $yo)->whereBetween('work_date', [Base::mes(), $hoy])->get();

        return ['vinculado' => true, 'trabajador' => $e->full_name, 'local' => $est, 'radio_m' => Base::num('per_geofence_radius_m', 100),
            'turno' => $sh ? ['code' => $sh->code, 'name' => $sh->name, 'inicio' => substr($sh->start_time, 0, 5), 'fin' => substr($sh->end_time, 0, 5)] : null,
            'descanso' => $sa && $sa->status === 'REST', 'marcas' => $marcas->map(fn ($m) => self::marca($m))->all(), 'dia' => $dia ? self::dia($dia) : null,
            'siguiente' => self::siguiente($marcas),
            'mes' => ['trabajados' => $mes->whereIn('status', ['PRESENT', 'LATE'])->count(), 'tardanzas' => $mes->where('late_minutes', '>', 0)->count(),
                'min_tardanza' => (int) $mes->sum('late_minutes'), 'faltas' => $mes->where('status', 'ABSENT')->count()]];
    }

    /** Siguiente marcación esperada según las válidas de hoy. */
    private static function siguiente($marcas): string
    {
        $v = $marcas->where('is_valid', true)->pluck('mark_type')->all();
        $ult = end($v) ?: null;

        return match ($ult) {
            null, 'OUT' => in_array('OUT', $v, true) ? 'IN' : 'IN',
            'IN', 'BREAK_IN' => in_array('BREAK_OUT', $v, true) ? 'OUT' : 'BREAK_OUT',
            'BREAK_OUT' => 'BREAK_IN',
            default => 'IN',
        };
    }

    /* ---------------- Consolidado diario (RN-PER-07/08) ---------------- */

    public static function consolidar(string $empleadoId, string $fecha): ?object
    {
        $hoy = Base::hoy();
        $sa = DB::table('shift_assignments')->where('employee_id', $empleadoId)->where('work_date', $fecha)->whereIn('status', ['PLANNED', 'SWAPPED', 'REST'])->first();
        $sh = $sa && $sa->status !== 'REST' ? DB::table('shifts')->where('id', $sa->shift_id)->first() : null;
        $desde = CarbonImmutable::parse($fecha.' 00:00:00', 'America/Lima');
        $hasta = $sh && $sh->crosses_midnight ? $desde->addDay()->setTime(12, 0) : $desde->setTime(23, 59, 59);
        // un turno nocturno del día anterior se queda con las marcas de esta madrugada
        $previo = DB::table('shift_assignments as a')->join('shifts as s', 's.id', '=', 'a.shift_id')->where('a.employee_id', $empleadoId)
            ->where('a.work_date', $desde->subDay()->toDateString())->whereIn('a.status', ['PLANNED', 'SWAPPED'])->where('s.crosses_midnight', true)->exists();
        if ($previo) {
            $desde = $desde->setTime(12, 0);
        }
        $ms = DB::table('attendance_marks')->where('employee_id', $empleadoId)->where('is_valid', true)
            ->whereBetween('marked_at', [$desde->toIso8601String(), $hasta->toIso8601String()])->orderBy('marked_at')->get();
        $ins = $ms->where('mark_type', 'IN')->values();
        $outs = $ms->where('mark_type', 'OUT')->values();
        $cur = DB::table('attendance_days')->where('employee_id', $empleadoId)->where('work_date', $fecha)->first();
        $fila = ['shift_assignment_id' => $sa?->id, 'first_in' => $ins->first()?->marked_at, 'last_out' => $outs->last()?->marked_at,
            'worked_minutes' => 0, 'late_minutes' => 0, 'overtime_minutes' => 0, 'unauthorized_minutes' => 0];
        if ($fila['first_in'] && $fila['last_out'] && $fila['last_out'] > $fila['first_in']) {
            $bo = $ms->firstWhere('mark_type', 'BREAK_OUT');
            $bi = $ms->firstWhere('mark_type', 'BREAK_IN');
            $brk = $bo && $bi && $bi->marked_at > $bo->marked_at
                ? (CarbonImmutable::parse($bi->marked_at)->getTimestamp() - CarbonImmutable::parse($bo->marked_at)->getTimestamp()) / 60
                : ($sh ? (int) $sh->break_minutes : 0);
            $fila['worked_minutes'] = max(0, (int) round((CarbonImmutable::parse($fila['last_out'])->getTimestamp() - CarbonImmutable::parse($fila['first_in'])->getTimestamp()) / 60 - $brk));
        }
        if ($sh && $fila['first_in']) {
            $tol = $sh->late_tolerance_minutes === null ? (int) Base::num('per_late_tolerance_minutes', 10) : (int) $sh->late_tolerance_minutes;
            $fila['late_minutes'] = self::tardanza(substr($sh->start_time, 0, 5), CarbonImmutable::parse($fila['first_in'])->setTimezone('America/Lima')->format('H:i'), $tol);
        }
        if ($sh && $fila['last_out']) {
            $fin = CarbonImmutable::parse(($sh->crosses_midnight ? $desde->addDay()->toDateString() : $fecha).' '.$sh->end_time, 'America/Lima');
            $extra = max(0, (int) round((CarbonImmutable::parse($fila['last_out'])->getTimestamp() - $fin->getTimestamp()) / 60));
            $aut = min($extra, (int) $sa->overtime_authorized_minutes);
            $fila['overtime_minutes'] = $aut;
            $fila['unauthorized_minutes'] = $extra - $aut;
        }
        $lic = DB::table('leave_requests')->where('employee_id', $empleadoId)->where('status', 'APPROVED')->where('date_from', '<=', $fecha)->where('date_to', '>=', $fecha)->exists();
        if ($lic) {
            $estado = 'LEAVE';
        } elseif ($fila['first_in']) {
            $estado = $fila['late_minutes'] > 0 ? 'LATE' : 'PRESENT';
        } elseif (Base::feriado($fecha)) {
            $estado = 'HOLIDAY';
        } elseif (! $sa || $sa->status === 'REST') {
            $estado = 'REST';
        } elseif ($fecha < $hoy) {
            $estado = 'ABSENT';
        } else {
            return $cur;   // hoy, aún sin entrada: no se adelanta la falta
        }
        if ($cur && $cur->justification_approved && in_array($estado, ['LATE', 'ABSENT'], true)) {
            $estado = $estado === 'ABSENT' ? 'LEAVE' : 'PRESENT';
        }
        $fila['status'] = $estado;
        if ($cur) {
            DB::table('attendance_days')->where('id', $cur->id)->update($fila + ['updated_at' => now()]);
        } else {
            DB::table('attendance_days')->insert($fila + ['employee_id' => $empleadoId, 'work_date' => $fecha]);
        }

        return DB::table('attendance_days')->where('employee_id', $empleadoId)->where('work_date', $fecha)->first();
    }

    /** RN-PER-07: tardanza = entrada − inicio del turno − tolerancia, si es positiva. */
    public static function tardanza(string $inicio, string $entrada, int $tolerancia): int
    {
        return max(0, Base::minutos($entrada) - Base::minutos($inicio) - $tolerancia);
    }

    /** Consolida el día de todos los trabajadores con turno o marcaciones. */
    public static function consolidarDia(string $fecha): int
    {
        $ids = DB::table('shift_assignments')->where('work_date', $fecha)->where('status', '<>', 'CANCELLED')->pluck('employee_id')
            ->merge(DB::table('attendance_marks')->whereRaw('(marked_at AT TIME ZONE ?)::date = ?', ['America/Lima', $fecha])->pluck('employee_id'))->unique();
        $n = 0;
        foreach ($ids as $id) {
            if (self::consolidar($id, $fecha)) {
                $n++;
            }
        }

        return $n;
    }

    public static function dia(object $a): array
    {
        return ['id' => $a->id, 'employee_id' => $a->employee_id, 'work_date' => $a->work_date, 'first_in' => self::iso($a->first_in), 'last_out' => self::iso($a->last_out),
            'worked_minutes' => (int) $a->worked_minutes, 'late_minutes' => (int) $a->late_minutes, 'overtime_minutes' => (int) $a->overtime_minutes,
            'unauthorized_minutes' => (int) $a->unauthorized_minutes, 'status' => $a->status, 'justification' => $a->justification,
            'justification_approved' => (bool) $a->justification_approved];
    }

    /* ---------------- PER-08 Asistencia diaria ---------------- */

    public static function diaria(string $fecha, ?string $local, User $u): array
    {
        $vis = Base::visibles($u);
        $mapa = Personal::mapa($fecha);
        $dias = DB::table('attendance_days as a')->join('employees as e', 'e.id', '=', 'a.employee_id')->leftJoin('shift_assignments as sa', 'sa.id', '=', 'a.shift_assignment_id')
            ->leftJoin('shifts as s', 's.id', '=', 'sa.shift_id')->where('a.work_date', $fecha)->when($vis !== null, fn ($w) => $w->whereIn('a.employee_id', $vis))
            ->orderBy('e.full_name')->get(['a.*', 'e.full_name', 's.code as turno', 's.start_time', 's.end_time', 'sa.overtime_authorized_minutes as he_autorizadas']);
        $dias = $dias->filter(fn ($a) => ! $local || ($mapa[$a->employee_id]['principal']->establishment_id ?? null) === $local)->values();
        $marcas = DB::table('attendance_marks as m')->join('employees as e', 'e.id', '=', 'm.employee_id')->leftJoin('employees as ap', 'ap.id', '=', 'm.approved_by_employee_id')
            ->whereRaw('(m.marked_at AT TIME ZONE ?)::date = ?', ['America/Lima', $fecha])->when($vis !== null, fn ($w) => $w->whereIn('m.employee_id', $vis))
            ->when($local, fn ($w) => $w->where('m.establishment_id', $local))->orderByDesc('m.marked_at')->get(['m.*', 'e.full_name', 'ap.full_name as aprobo']);
        $c = fn ($s) => $dias->where('status', $s)->count();

        return [
            'fecha' => $fecha, 'feriado' => Base::feriado($fecha),
            'resumen' => ['presentes' => $c('PRESENT') + $c('LATE'), 'tardanzas' => $c('LATE'), 'min_tardanza' => (int) $dias->sum('late_minutes'), 'faltas' => $c('ABSENT'),
                'permisos' => $c('LEAVE'), 'horas_extra' => Base::r($dias->sum('overtime_minutes') / 60, 1), 'no_autorizado' => (int) $dias->sum('unauthorized_minutes'),
                'invalidas' => $marcas->where('is_valid', false)->count()],
            'dias' => $dias->map(fn ($a) => self::dia($a) + ['trabajador' => $a->full_name, 'turno' => $a->turno ? $a->turno.' '.substr($a->start_time, 0, 5).'–'.substr($a->end_time, 0, 5) : null,
                'puesto' => $mapa[$a->employee_id]['principal']->puesto ?? null])->all(),
            'marcas' => $marcas->map(fn ($m) => self::marca($m) + ['trabajador' => $m->full_name, 'aprobo' => $m->aprobo])->all(),
        ];
    }

    public static function justificar(string $diaId, string $texto, User $u): array
    {
        $a = DB::table('attendance_days')->where('id', $diaId)->first() ?? abort(404, 'No se encontró el día.');
        $texto = Base::obligatorio($texto, 'RN-PER-05', 'La justificación exige el motivo (al menos 10 letras).', 10);
        if (! Access::can($u, 'per.attendance.approve')) {
            RuleError::fail('RN-PER-05', 'Aprobar justificaciones requiere per.attendance.approve.');
        }
        if (Base::yo($u) === $a->employee_id) {
            RuleError::fail('RN-PER-05', 'La justificación la aprueba una persona distinta del trabajador.');
        }
        if (! in_array($a->status, ['LATE', 'ABSENT'], true)) {
            RuleError::fail('RN-PER-05', 'Solo se justifican tardanzas y faltas.');
        }

        return DB::transaction(function () use ($a, $texto, $u) {
            DB::table('attendance_days')->where('id', $a->id)->update(['justification' => $texto, 'justification_approved' => true, 'approved_by' => $u->id, 'updated_at' => now()]);

            return self::dia(self::consolidar($a->employee_id, $a->work_date));
        });
    }

    /** Resumen del mes por trabajador (días, tardanzas, faltas, horas extra). */
    public static function resumenMes(string $mes, User $u): array
    {
        $vis = Base::visibles($u);
        $fin = Base::finDeMes($mes);
        $filas = DB::table('attendance_days as a')->join('employees as e', 'e.id', '=', 'a.employee_id')->whereBetween('a.work_date', [$mes, $fin])
            ->when($vis !== null, fn ($w) => $w->whereIn('a.employee_id', $vis))->groupBy('a.employee_id', 'e.full_name')->orderBy('e.full_name')
            ->selectRaw("a.employee_id, e.full_name, count(*) FILTER (WHERE a.status IN ('PRESENT','LATE')) AS trabajados, count(*) FILTER (WHERE a.status IN ('PRESENT','LATE','ABSENT')) AS programados,
                count(*) FILTER (WHERE a.status = 'LATE') AS tardanzas, coalesce(sum(a.late_minutes) FILTER (WHERE a.status = 'LATE'), 0) AS min_tardanza,
                count(*) FILTER (WHERE a.status = 'ABSENT') AS faltas, count(*) FILTER (WHERE a.status = 'LEAVE') AS permisos,
                coalesce(sum(a.overtime_minutes), 0) AS he, coalesce(sum(a.unauthorized_minutes), 0) AS no_aut")->get();

        return array_map(fn ($f) => ['employee_id' => $f->employee_id, 'trabajador' => $f->full_name, 'trabajados' => (int) $f->trabajados, 'programados' => (int) $f->programados,
            'asistencia_pct' => $f->programados ? Base::r($f->trabajados / $f->programados * 100, 1) : null, 'tardanzas' => (int) $f->tardanzas, 'min_tardanza' => (int) $f->min_tardanza,
            'faltas' => (int) $f->faltas, 'permisos' => (int) $f->permisos, 'horas_extra' => Base::r($f->he / 60, 1), 'no_autorizado' => (int) $f->no_aut], $filas->all());
    }

    /* ---------------- Permisos y vacaciones ---------------- */

    public static function permisos(User $u): array
    {
        $vis = Base::visibles($u);

        return DB::table('leave_requests as l')->join('employees as e', 'e.id', '=', 'l.employee_id')->leftJoin('users as a', 'a.id', '=', 'l.approved_by')
            ->when($vis !== null, fn ($w) => $w->whereIn('l.employee_id', $vis))->orderByDesc('l.date_from')->limit(300)
            ->get(['l.*', 'e.full_name', 'a.name as aprobo'])->map(fn ($l) => ['id' => $l->id, 'employee_id' => $l->employee_id, 'trabajador' => $l->full_name,
                'leave_type' => $l->leave_type, 'tipo' => Base::PERMISOS[$l->leave_type], 'date_from' => $l->date_from, 'date_to' => $l->date_to, 'days' => (int) $l->days,
                'reason' => $l->reason, 'status' => $l->status, 'aprobo' => $l->aprobo, 'decision_note' => $l->decision_note,
                'puede_decidir' => $l->status === 'REQUESTED' && Access::can($u, 'per.attendance.approve') && $l->requested_by !== $u->id && $l->employee_id !== Base::yo($u)])->all();
    }

    public static function pedirPermiso(array $d, User $u): array
    {
        $emp = ($d['employee_id'] ?? null) ?: Base::yo($u);
        $e = Base::trabajador($emp);
        if ($e->id !== Base::yo($u) && ! Access::can($u, 'per.attendance.approve') && ! Base::gestiona($u)) {
            RuleError::fail('RN-PER-19', 'Solo pides permisos para ti.');
        }
        if (! isset(Base::PERMISOS[$d['leave_type'] ?? ''])) {
            RuleError::fail('RN-PER-05', 'Elige el tipo: vacaciones, permiso o descanso médico.');
        }
        if (empty($d['date_from']) || empty($d['date_to'])) {
            RuleError::fail('RN-PER-05', 'Indica las fechas.');
        }
        if ($d['date_to'] < $d['date_from']) {
            RuleError::fail('RN-PER-05', 'La fecha final es anterior a la inicial.');
        }
        $motivo = Base::obligatorio($d['reason'] ?? '', 'RN-PER-05', 'Indica el motivo.', 3);
        if (DB::table('leave_requests')->where('employee_id', $e->id)->whereIn('status', ['REQUESTED', 'APPROVED'])->where('date_from', '<=', $d['date_to'])->where('date_to', '>=', $d['date_from'])->exists()) {
            RuleError::fail('RN-PER-05', 'Ya hay un permiso o vacaciones en esas fechas.');
        }
        $dias = CarbonImmutable::parse($d['date_from'])->diffInDays(CarbonImmutable::parse($d['date_to'])) + 1;
        $id = DB::table('leave_requests')->insertGetId(['employee_id' => $e->id, 'leave_type' => $d['leave_type'], 'date_from' => $d['date_from'], 'date_to' => $d['date_to'],
            'days' => (int) $dias, 'reason' => $motivo, 'status' => 'REQUESTED', 'requested_by' => $u->id]);

        return collect(self::permisos($u))->firstWhere('id', $id) ?? ['id' => $id];
    }

    public static function decidirPermiso(string $id, bool $aprobar, ?string $nota, User $u): array
    {
        $l = DB::table('leave_requests')->where('id', $id)->first() ?? abort(404, 'No se encontró la solicitud.');
        if ($l->status !== 'REQUESTED') {
            RuleError::fail('RN-PER-05', 'La solicitud ya fue resuelta.');
        }
        if (! Access::can($u, 'per.attendance.approve')) {
            RuleError::fail('RN-PER-05', 'Aprobar permisos requiere per.attendance.approve.');
        }
        if ($l->requested_by === $u->id || $l->employee_id === Base::yo($u)) {
            RuleError::fail('RN-PER-05', 'Quien pide el permiso no lo aprueba.');
        }

        return DB::transaction(function () use ($l, $aprobar, $nota, $u) {
            DB::table('leave_requests')->where('id', $l->id)->update(['status' => $aprobar ? 'APPROVED' : 'REJECTED', 'approved_by' => $u->id, 'decided_at' => now(),
                'decision_note' => trim((string) $nota) ?: null, 'updated_at' => now()]);
            if ($aprobar) {
                $hoy = Base::hoy();
                for ($d = CarbonImmutable::parse($l->date_from); $d->toDateString() <= $l->date_to && $d->toDateString() <= $hoy; $d = $d->addDay()) {
                    self::consolidar($l->employee_id, $d->toDateString());
                }
            }

            return collect(self::permisos($u))->firstWhere('id', $l->id) ?? ['id' => $l->id];
        });
    }
}
