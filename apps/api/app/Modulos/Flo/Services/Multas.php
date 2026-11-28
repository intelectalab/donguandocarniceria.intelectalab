<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * FLO-10 Multas: papeleta, conductor (sale de la jornada del día), pronto pago, pago y descuento al conductor.
 * RN-FLO-15 (D-FLO-03): el descuento exige el acta firmada y la aprobación de RR. HH. o gerencia, y se hace una sola vez;
 * deja la línea para el pago del personal (PER la lee de deduct_from_payout cuando exista).
 */
final class Multas
{
    public const ESTADOS = ['PENDING' => 'Pendiente', 'PAID' => 'Pagada', 'APPEALED' => 'Apelada', 'VOIDED' => 'Anulada'];

    private static function exigir(User $u): void
    {
        if (! Access::can($u, 'flo.fine.manage')) {
            abort(403, 'Registrar y pagar multas es del coordinador de delivery o de administración.');
        }
    }

    /** Conductor del vehículo ese día (de la jornada, o de la ruta de DEL). */
    public static function conductorDel(string $vehiculoId, string $fecha): ?string
    {
        return DB::table('vehicle_trips')->where('vehicle_id', $vehiculoId)->where('trip_date', $fecha)->whereNotNull('driver_user_id')->whereIn('status', ['OPEN', 'CLOSED'])->value('driver_user_id')
            ?? DB::table('delivery_routes')->where('vehicle_id', $vehiculoId)->where('route_date', $fecha)->whereNotNull('driver_user_id')->where('status', '<>', 'CANCELLED')->value('driver_user_id');
    }

    /** Importe a pagar hoy: con el descuento por pronto pago si sigue vigente. */
    public static function aPagar(object $f, ?string $al = null): float
    {
        $al ??= Base::hoy();
        if ($f->early_discount_until && $al <= $f->early_discount_until && (float) $f->early_discount_pct > 0) {
            return round((float) $f->amount * (1 - (float) $f->early_discount_pct / 100), 2);
        }

        return (float) $f->amount;
    }

    public static function registrar(array $d, User $u): object
    {
        self::exigir($u);

        return DB::transaction(function () use ($d, $u) {
            $v = Base::vehiculo($d['vehicle_id'] ?? null, $u, 'RN-FLO-15');
            $pap = mb_strtoupper(preg_replace('/\s+/', '', Base::texto($d['ballot_number'] ?? null, 'RN-FLO-15', 'Indica el número de papeleta.', 3, 30)));
            if (DB::table('traffic_fines')->whereRaw('upper(ballot_number) = ?', [$pap])->where('status', '<>', 'VOIDED')->exists()) {
                RuleError::fail('RN-FLO-15', "La papeleta {$pap} ya está registrada.");
            }
            $fecha = (string) ($d['fine_date'] ?? '');
            if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha) || $fecha > Base::hoy()) {
                RuleError::fail('RN-FLO-15', 'Indica la fecha de la papeleta (no puede ser futura).');
            }
            $entidad = (string) ($d['entity'] ?? 'SAT');
            if (! isset(Base::ENTIDADES[$entidad])) {
                RuleError::fail('RN-FLO-15', 'Elige la entidad.');
            }
            $infr = Base::texto($d['infraction'] ?? null, 'RN-FLO-15', 'Describe la infracción.', 3, 255);
            $monto = Base::decimal($d['amount'] ?? null);
            if (! $monto || $monto <= 0) {
                RuleError::fail('RN-FLO-15', 'Indica el importe de la multa.');
            }
            $pct = Base::decimal($d['early_discount_pct'] ?? null) ?? 0.0;
            if ($pct < 0 || $pct > 100) {
                RuleError::fail('RN-FLO-15', 'El descuento por pronto pago va de 0 a 100 %.');
            }
            $hasta = ! empty($d['early_discount_until']) ? (string) $d['early_discount_until'] : null;
            if ($pct > 0 && (! $hasta || $hasta < $fecha)) {
                RuleError::fail('RN-FLO-15', 'Con descuento por pronto pago indica hasta qué fecha vale (desde la papeleta).');
            }
            $uid = ! empty($d['driver_user_id']) ? (string) $d['driver_user_id'] : self::conductorDel($v->id, $fecha);
            $emp = $uid ? Base::empleadoDe($uid) : (! empty($d['employee_id']) ? (string) $d['employee_id'] : null);
            $id = DB::table('traffic_fines')->insertGetId([
                'ballot_number' => $pap, 'fine_date' => $fecha, 'entity' => $entidad, 'infraction_code' => ! empty($d['infraction_code']) ? mb_strtoupper(mb_substr(trim($d['infraction_code']), 0, 20)) : null,
                'infraction' => $infr, 'vehicle_id' => $v->id, 'driver_user_id' => $uid, 'employee_id' => $emp, 'amount' => round($monto, 2), 'early_discount_pct' => round($pct, 2),
                'early_discount_until' => $pct > 0 ? $hasta : null, 'status' => 'PENDING', 'notes' => ! empty($d['notes']) ? mb_substr(trim($d['notes']), 0, 1000) : null, 'created_by' => $u->id,
            ], 'id');

            return DB::table('traffic_fines')->where('id', $id)->first();
        });
    }

    private static function fila(string $id, User $u): object
    {
        $f = DB::table('traffic_fines')->where('id', $id)->lockForUpdate()->first();
        if (! $f) {
            abort(404, 'No se encontró la multa.');
        }
        Base::vehiculo($f->vehicle_id, $u, 'RN-FLO-15');

        return $f;
    }

    /** Pago: con descuento si aún vale; el comprobante se enlaza o crea en GAS una sola vez (RN-FLO-17). */
    public static function pagar(string $id, array $d, User $u): object
    {
        self::exigir($u);

        return DB::transaction(function () use ($id, $d, $u) {
            $f = self::fila($id, $u);
            if ($f->status !== 'PENDING') {
                RuleError::fail('RN-FLO-15', 'Solo se paga una multa pendiente.');
            }
            $dia = ! empty($d['paid_on']) ? (string) $d['paid_on'] : Base::hoy();
            if ($dia > Base::hoy() || $dia < $f->fine_date) {
                RuleError::fail('RN-FLO-15', 'La fecha de pago va entre la papeleta y hoy.');
            }
            $v = DB::table('vehicles')->where('id', $f->vehicle_id)->first();
            $empresa = DB::table('establishments')->where('id', $v->establishment_id)->value('company_id');
            if ($empresa) {
                Periodos::abierto($dia, $empresa);
            }
            $monto = self::aPagar($f, $dia);
            DB::table('traffic_fines')->where('id', $id)->update(['status' => 'PAID', 'paid_on' => $dia, 'paid_amount' => $monto, 'discount_amount' => round((float) $f->amount - $monto, 2), 'updated_at' => now()]);
            Gastos::alRegistrar('traffic_fines', $id, $d + ['doc_type' => $d['doc_type'] ?? 'SIMPLE_RECEIPT', 'doc_number' => $d['doc_number'] ?? $f->ballot_number], [
                'tipo' => 'FINE', 'vehiculo' => $v, 'monto' => $monto, 'fecha' => $dia, 'empleado' => $f->employee_id,
                'descripcion' => "Multa {$f->ballot_number} · {$f->infraction} · {$v->plate}",
            ], $u);

            return DB::table('traffic_fines')->where('id', $id)->first();
        });
    }

    /** D-FLO-03: aprueban el descuento RR. HH. y gerencia. */
    public static function apruebaDescuento(User $u): bool
    {
        return (bool) array_intersect($u->roles()->pluck('code')->all(), ['RRHH', 'GERENTE']);
    }

    /** RN-FLO-15: descuento al conductor con el acta firmada; lo aprueba RR. HH. o gerencia; una sola vez. */
    public static function descontar(string $id, UploadedFile|string|null $acta, User $u): object
    {
        if (! self::apruebaDescuento($u)) {
            abort(403, 'El descuento al conductor lo aprueba RR. HH. o gerencia (D-FLO-03).');
        }

        return DB::transaction(function () use ($id, $acta, $u) {
            $f = self::fila($id, $u);
            if ($f->charged_to_driver || $f->deducted_payout_id) {
                RuleError::fail('RN-FLO-15', "La multa {$f->ballot_number} ya se descontó al conductor: no se descuenta más de una vez.");
            }
            if (in_array($f->status, ['VOIDED', 'APPEALED'], true)) {
                RuleError::fail('RN-FLO-15', "La multa {$f->ballot_number} está ".mb_strtolower(self::ESTADOS[$f->status]).'.');
            }
            if (! $f->employee_id) {
                RuleError::fail('RN-FLO-15', 'La multa no tiene conductor identificado: indícalo antes de descontar.');
            }
            $fileId = Archivo::guardar($acta, null, null, $u, 'RN-FLO-15', 'El descuento exige el acta de reconocimiento firmada por el conductor: adjúntala.');
            DB::table('traffic_fines')->where('id', $id)->update([
                'charged_to_driver' => true, 'deduct_from_payout' => true, 'acknowledgment_signed' => true, 'acknowledgment_file_id' => $fileId,
                'hr_approved_by' => $u->id, 'hr_approved_at' => now(), 'updated_at' => now(),
            ]);

            return DB::table('traffic_fines')->where('id', $id)->first();
        });
    }

    /** Apelar (queda fuera del costo mientras se resuelve) o anular con motivo. */
    public static function cambiar(string $id, string $accion, ?string $nota, User $u): object
    {
        self::exigir($u);

        return DB::transaction(function () use ($id, $accion, $nota, $u) {
            $f = self::fila($id, $u);
            $n = Base::texto($nota, 'RN-FLO-15', 'Indica el motivo (al menos 10 caracteres).', 10, 1000);
            if ($f->charged_to_driver) {
                RuleError::fail('RN-FLO-15', 'La multa ya se descontó al conductor: no se apela ni se anula aquí.');
            }
            if ($accion === 'apelar') {
                if ($f->status !== 'PENDING') {
                    RuleError::fail('RN-FLO-15', 'Solo se apela una multa pendiente.');
                }
                DB::table('traffic_fines')->where('id', $id)->update(['status' => 'APPEALED', 'appeal_note' => $n, 'updated_at' => now()]);
            } elseif ($accion === 'reactivar') {
                if ($f->status !== 'APPEALED') {
                    RuleError::fail('RN-FLO-15', 'Solo vuelve a pendiente una multa apelada.');
                }
                DB::table('traffic_fines')->where('id', $id)->update(['status' => 'PENDING', 'appeal_note' => trim(($f->appeal_note ? $f->appeal_note.' · ' : '').'Apelación perdida: '.$n), 'updated_at' => now()]);
            } else {
                if ($f->status === 'PAID') {
                    RuleError::fail('RN-FLO-15', 'Una multa pagada no se anula.');
                }
                DB::table('traffic_fines')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => $n, 'updated_at' => now()]);
            }

            return DB::table('traffic_fines')->where('id', $id)->first();
        });
    }

    public static function lista(User $u, array $f): array
    {
        $vs = Base::flota($u)->pluck('v.id')->all();
        $filas = DB::table('traffic_fines as m')->join('vehicles as v', 'v.id', '=', 'm.vehicle_id')->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 'm.vehicle_id')
            ->leftJoin('users as u', 'u.id', '=', 'm.driver_user_id')->leftJoin('employees as e', 'e.id', '=', 'm.employee_id')->leftJoin('users as h', 'h.id', '=', 'm.hr_approved_by')
            ->leftJoin('expenses as g', 'g.id', '=', 'm.expense_id')
            ->whereIn('m.vehicle_id', $vs ?: ['00000000-0000-0000-0000-000000000000'])
            ->when($f['estado'] ?? null, fn ($w) => $w->where('m.status', $f['estado']), fn ($w) => $w->where('m.status', '<>', 'VOIDED'))
            ->when($f['vehiculo'] ?? null, fn ($w) => $w->where('m.vehicle_id', $f['vehiculo']))
            ->orderByDesc('m.fine_date')->limit(300)
            ->get(['m.*', 'v.plate', 'p.internal_code', 'u.name as conductor_usuario', 'e.full_name as conductor', 'h.name as aprobo', 'g.number as gasto'])
            ->map(fn ($x) => array_replace((array) $x, [
                'vehiculo' => $x->internal_code && $x->internal_code !== $x->plate ? "{$x->internal_code} · {$x->plate}" : $x->plate,
                'entidad' => Base::ENTIDADES[$x->entity] ?? $x->entity, 'amount' => (float) $x->amount, 'a_pagar' => $x->status === 'PENDING' ? self::aPagar($x) : null,
                'paid_amount' => $x->paid_amount !== null ? (float) $x->paid_amount : null, 'discount_amount' => (float) $x->discount_amount,
                'early_discount_pct' => (float) $x->early_discount_pct, 'conductor' => $x->conductor ?? $x->conductor_usuario,
                'a_cargo_empresa' => ! $x->charged_to_driver && in_array($x->status, ['PENDING', 'PAID'], true),
            ]))->all();
        $vig = array_filter($filas, fn ($x) => $x['status'] !== 'VOIDED');

        return ['data' => $filas, 'resumen' => [
            'pendientes' => count(array_filter($vig, fn ($x) => $x['status'] === 'PENDING')),
            'por_pagar' => round(array_sum(array_map(fn ($x) => $x['a_pagar'] ?? 0, $vig)), 2),
            'empresa' => round(array_sum(array_map(fn ($x) => $x['status'] === 'PAID' && ! $x['charged_to_driver'] ? $x['paid_amount'] : 0, $vig)), 2),   // KPI-FLO-09
            'descontadas' => count(array_filter($vig, fn ($x) => $x['charged_to_driver'])),
        ]];
    }
}
