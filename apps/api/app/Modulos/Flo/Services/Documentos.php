<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/** FLO-09 Documentos del vehículo y licencias de los conductores, con vencimiento y semáforo (RN-FLO-12, RN-FLO-13). */
final class Documentos
{
    public static function vigente(string $vehiculoId, string $tipo): ?object
    {
        return DB::table('vehicle_documents')->where('vehicle_id', $vehiculoId)->where('doc_type', $tipo)->where('status', 'ACTIVE')->first();
    }

    public static function licencia(?string $empleadoId): ?object
    {
        return $empleadoId ? DB::table('vehicle_documents')->where('employee_id', $empleadoId)->where('doc_type', 'DRIVER_LICENSE')->where('status', 'ACTIVE')->first() : null;
    }

    /** Semáforo: EXPIRED, D7, D15, D30, VALID o NO_EXPIRY. */
    public static function estado(?string $vence, ?string $al = null): string
    {
        if (! $vence) {
            return 'NO_EXPIRY';
        }
        $dias = (int) CarbonImmutable::parse($al ?? Base::hoy())->diffInDays(CarbonImmutable::parse(substr($vence, 0, 10)), false);
        $a = Base::diasAviso();
        [$x, $y, $z] = [$a[0] ?? 30, $a[1] ?? 15, $a[2] ?? 7];

        return $dias < 0 ? 'EXPIRED' : ($dias <= $z ? 'D7' : ($dias <= $y ? 'D15' : ($dias <= $x ? 'D30' : 'VALID')));
    }

    /** RN-FLO-12: un conductor con licencia vencida (o sin licencia) no inicia jornada. */
    public static function exigirLicencia(string $userId, string $fecha): object
    {
        $u = DB::table('users')->where('id', $userId)->first(['id', 'name', 'employee_id', 'status']);
        if (! $u || $u->status !== 'ACTIVE') {
            RuleError::fail('RN-FLO-12', 'Elige un conductor activo.');
        }
        $l = self::licencia($u->employee_id);
        if (! $l) {
            RuleError::fail('RN-FLO-12', "{$u->name} no tiene licencia de conducir registrada en Documentos: no inicia jornada.");
        }
        if ($l->expires_on < $fecha) {
            RuleError::fail('RN-FLO-12', "La licencia {$l->number} de {$u->name} venció el ".Base::fecha($l->expires_on).': no inicia jornada hasta renovarla en Documentos.');
        }

        return $l;
    }

    /** Registra o renueva: el anterior del mismo tipo y dueño queda reemplazado (RN-FLO-13). */
    public static function guardar(array $d, UploadedFile|string|null $archivo, User $u): object
    {
        if (! Access::can($u, 'flo.document.manage')) {
            abort(403, 'Registrar documentos es del coordinador de delivery o de RR. HH.');
        }

        return DB::transaction(function () use ($d, $archivo, $u) {
            $tipo = (string) ($d['doc_type'] ?? '');
            $def = Base::DOCUMENTOS[$tipo] ?? null;
            if (! $def) {
                RuleError::fail('RN-FLO-13', 'Elige el tipo de documento.');
            }
            [$nombre, $duenio, $venceObligatorio] = $def;
            $vehiculo = null;
            $empleado = null;
            if ($duenio === 'EMPLOYEE') {
                $empleado = DB::table('employees')->where('id', $d['employee_id'] ?? null)->first(['id', 'full_name', 'establishment_id', 'status']);
                if (! $empleado) {
                    RuleError::fail('RN-FLO-13', 'La licencia de conducir pertenece a un trabajador: elige al conductor.');
                }
                $l = Base::locales($u);
                if ($l && $empleado->establishment_id && ! in_array($empleado->establishment_id, $l, true)) {
                    abort(404, 'No se encontró el trabajador.');
                }
            } else {
                if (empty($d['vehicle_id'])) {
                    RuleError::fail('RN-FLO-13', "{$nombre} pertenece a un vehículo: elige el vehículo.");
                }
                $vehiculo = Base::vehiculo($d['vehicle_id'], $u, 'RN-FLO-13');
            }
            $numero = Base::texto($d['number'] ?? null, 'RN-FLO-13', 'Indica el número del documento.', 1, 40);
            $emision = ! empty($d['issued_on']) ? (string) $d['issued_on'] : null;
            $vence = ! empty($d['expires_on']) ? (string) $d['expires_on'] : null;
            if ($venceObligatorio && ! $vence) {
                RuleError::fail('RN-FLO-13', "{$nombre} exige fecha de vencimiento.");
            }
            if ($emision && $vence && $vence <= $emision) {
                RuleError::fail('RN-FLO-13', 'El vencimiento debe ser posterior a la emisión.');
            }
            if ($tipo === 'RENTAL_CONTRACT' && $vehiculo && $vehiculo->ownership !== 'RENTED') {
                RuleError::fail('RN-FLO-13', "{$vehiculo->plate} es propio: el contrato de alquiler es para vehículos alquilados.");
            }
            $q = DB::table('vehicle_documents')->where('doc_type', $tipo)->where('status', 'ACTIVE')
                ->when($vehiculo, fn ($w) => $w->where('vehicle_id', $vehiculo->id), fn ($w) => $w->where('employee_id', $empleado->id));
            $anterior = $q->lockForUpdate()->first();
            if ($anterior) {
                DB::table('vehicle_documents')->where('id', $anterior->id)->update(['status' => 'REPLACED', 'updated_at' => now()]);
            }
            $id = DB::table('vehicle_documents')->insertGetId([
                'vehicle_id' => $vehiculo?->id, 'employee_id' => $empleado?->id, 'doc_type' => $tipo, 'number' => mb_strtoupper($numero),
                'issuer' => ! empty($d['issuer']) ? mb_substr(trim($d['issuer']), 0, 120) : null,
                'license_class' => $tipo === 'DRIVER_LICENSE' && ! empty($d['license_class']) ? mb_substr(mb_strtoupper(trim($d['license_class'])), 0, 20) : null,
                'issued_on' => $emision, 'expires_on' => $vence, 'status' => 'ACTIVE', 'replaces_id' => $anterior?->id,
                'notes' => ! empty($d['notes']) ? mb_substr(trim($d['notes']), 0, 1000) : null, 'created_by' => $u->id,
            ], 'id');
            $fileId = Archivo::guardar($archivo, 'vehicle_documents', $id, $u, 'RN-FLO-13');
            if ($fileId) {
                DB::table('vehicle_documents')->where('id', $id)->update(['file_id' => $fileId]);
            }
            if ($vehiculo) {
                self::sincronizar($vehiculo->id);
            }
            if ($anterior) {
                Alertas::cerrarPor('DOCUMENT', ['doc:'.$anterior->id], "Renovado con {$numero}".($vence ? ' (vence '.Base::fecha($vence).')' : ''), $u);
            }

            return DB::table('vehicle_documents')->where('id', $id)->first();
        });
    }

    /** Anula un documento mal registrado (vuelve a regir el que reemplazó, si sigue). */
    public static function anular(string $id, string $motivo, User $u): object
    {
        if (! Access::can($u, 'flo.document.manage')) {
            abort(403, 'Anular documentos es del coordinador de delivery o de RR. HH.');
        }

        return DB::transaction(function () use ($id, $motivo, $u) {
            $doc = DB::table('vehicle_documents')->where('id', $id)->lockForUpdate()->first();
            if (! $doc) {
                abort(404, 'No se encontró el documento.');
            }
            if ($doc->vehicle_id) {
                Base::vehiculo($doc->vehicle_id, $u, 'RN-FLO-13');
            }
            if ($doc->status !== 'ACTIVE') {
                RuleError::fail('RN-FLO-13', 'Solo se anula el documento vigente.');
            }
            $m = Base::texto($motivo, 'RN-FLO-13', 'Anular un documento exige un motivo de al menos 10 caracteres.', 10, 500);
            DB::table('vehicle_documents')->where('id', $id)->update(['status' => 'VOIDED', 'notes' => trim(($doc->notes ? $doc->notes.' · ' : '').'Anulado: '.$m), 'updated_at' => now()]);
            if ($doc->replaces_id) {
                $previo = DB::table('vehicle_documents')->where('id', $doc->replaces_id)->first();
                $hayOtro = DB::table('vehicle_documents')->where('doc_type', $doc->doc_type)->where('status', 'ACTIVE')
                    ->when($doc->vehicle_id, fn ($w) => $w->where('vehicle_id', $doc->vehicle_id), fn ($w) => $w->where('employee_id', $doc->employee_id))->exists();
                if ($previo && $previo->status === 'REPLACED' && ! $hayOtro) {
                    DB::table('vehicle_documents')->where('id', $previo->id)->update(['status' => 'ACTIVE', 'updated_at' => now()]);
                }
            }
            Alertas::cerrarPor('DOCUMENT', ['doc:'.$id], 'Documento anulado', $u);
            if ($doc->vehicle_id) {
                self::sincronizar($doc->vehicle_id);
            }

            return DB::table('vehicle_documents')->where('id', $id)->first();
        });
    }

    /** FLO mantiene al día el SOAT y la revisión técnica del vehículo (los lee DEL en RN-DEL-03). */
    public static function sincronizar(string $vehiculoId): void
    {
        $s = self::vigente($vehiculoId, 'SOAT');
        $t = self::vigente($vehiculoId, 'TECH_INSPECTION');
        $cambio = [];
        if ($s) {
            $cambio['soat_expires_on'] = $s->expires_on;
            $cambio['soat_policy_no'] = mb_substr($s->number, 0, 40);
        }
        if ($t) {
            $cambio['tech_inspection_expires_on'] = $t->expires_on;
        }
        if ($cambio) {
            DB::table('vehicles')->where('id', $vehiculoId)->update($cambio + ['updated_at' => now()]);
        }
    }

    /** FLO-09: documentos vigentes de la flota y licencias de los conductores, con su semáforo. */
    public static function lista(User $u, ?string $tipo = null, ?string $estado = null): array
    {
        $vehiculos = Base::flota($u)->pluck('v.id')->all();
        $filas = DB::table('vehicle_documents as d')->leftJoin('vehicles as v', 'v.id', '=', 'd.vehicle_id')->leftJoin('employees as e', 'e.id', '=', 'd.employee_id')
            ->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 'd.vehicle_id')
            ->where('d.status', 'ACTIVE')
            ->where(fn ($w) => $w->whereIn('d.vehicle_id', $vehiculos ?: ['00000000-0000-0000-0000-000000000000'])->orWhereNotNull('d.employee_id'))
            ->when($tipo, fn ($w) => $w->where('d.doc_type', $tipo))
            ->orderByRaw('d.expires_on NULLS LAST')
            ->get(['d.*', 'v.plate', 'p.internal_code', 'e.full_name as conductor', 'e.status as estado_conductor'])
            ->map(function ($d) {
                $st = self::estado($d->expires_on);

                return [
                    'id' => $d->id, 'doc_type' => $d->doc_type, 'tipo' => Base::DOCUMENTOS[$d->doc_type][0] ?? $d->doc_type, 'number' => $d->number,
                    'issuer' => $d->issuer, 'license_class' => $d->license_class, 'issued_on' => $d->issued_on, 'expires_on' => $d->expires_on,
                    'vehicle_id' => $d->vehicle_id, 'employee_id' => $d->employee_id, 'file_id' => $d->file_id, 'notes' => $d->notes,
                    'duenio' => $d->vehicle_id ? (($d->internal_code && $d->internal_code !== $d->plate) ? "{$d->internal_code} · {$d->plate}" : $d->plate) : $d->conductor,
                    'semaforo' => $st, 'dias' => $d->expires_on ? (int) CarbonImmutable::parse(Base::hoy())->diffInDays(CarbonImmutable::parse($d->expires_on), false) : null,
                    'bloquea' => $st === 'EXPIRED' && in_array($d->doc_type, ['SOAT', 'TECH_INSPECTION', 'DRIVER_LICENSE'], true),
                ];
            });
        if ($estado) {
            $filas = $filas->filter(fn ($x) => $estado === 'ALERT' ? in_array($x['semaforo'], ['EXPIRED', 'D7', 'D15', 'D30'], true) : $x['semaforo'] === $estado);
        }
        $filas = $filas->values();

        // Vehículos sin SOAT o sin revisión técnica registrados en FLO (los lee de DEL mientras tanto).
        $faltan = [];
        foreach (Base::flota($u)->where('v.status', '<>', 'INACTIVE')->get(['v.*']) as $v) {
            foreach (['SOAT', 'TECH_INSPECTION'] as $t) {
                if (! self::vigente($v->id, $t)) {
                    $faltan[] = ['vehicle_id' => $v->id, 'vehiculo' => Base::etiqueta($v), 'doc_type' => $t, 'tipo' => Base::DOCUMENTOS[$t][0]];
                }
            }
        }
        // Conductores (repartidores activos) sin licencia.
        $sinLicencia = DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as ro', 'ro.id', '=', 'ur.role_id')
            ->where('ro.code', 'REPARTIDOR')->where('u.status', 'ACTIVE')->whereNotNull('u.employee_id')
            ->whereNotExists(fn ($q) => $q->from('vehicle_documents as d')->whereColumn('d.employee_id', 'u.employee_id')->where('d.doc_type', 'DRIVER_LICENSE')->where('d.status', 'ACTIVE'))
            ->distinct()->get(['u.id', 'u.name', 'u.employee_id'])->map(fn ($x) => (array) $x)->all();

        return [
            'data' => $filas->all(), 'faltan' => $faltan, 'sin_licencia' => $sinLicencia,
            'resumen' => [
                'vencidos' => $filas->where('semaforo', 'EXPIRED')->count(), 'por_vencer' => $filas->whereIn('semaforo', ['D7', 'D15', 'D30'])->count(),
                'vigentes' => $filas->whereIn('semaforo', ['VALID', 'NO_EXPIRY'])->count(), 'bloquean' => $filas->where('bloquea', true)->count(),
            ],
        ];
    }
}
