<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * RN-FLO-11: no se asigna a una ruta, ni abre jornada, un vehículo inactivo o en mantenimiento, con SOAT o revisión
 * técnica vencidos, o con un mantenimiento vencido por más de flo_maint_overdue_block_km. DEL lo llama al asignar y al
 * salir (después de su propia revisión de documentos, RN-DEL-03) cuando FLO está encendido.
 */
final class Operable
{
    /** Motivos por los que no sale esa fecha (vacío = puede salir). */
    public static function motivos(object $v, string $fecha): array
    {
        $out = [];
        $p = Base::perfil($v);
        if ($v->status === 'INACTIVE' || $p->op_status === 'INACTIVE') {
            $out[] = ['tipo' => 'INACTIVE', 'msg' => "{$v->plate} está inactivo."];
        }
        if ($v->status === 'MAINTENANCE' || $p->op_status === 'IN_MAINTENANCE') {
            $m = DB::table('vehicle_maintenances')->where('vehicle_id', $v->id)->where('status', 'IN_PROGRESS')->where('in_workshop', true)->orderBy('opened_on')->first(['number', 'description']);
            $out[] = ['tipo' => 'MAINT', 'msg' => "{$v->plate} está en mantenimiento".($m ? " ({$m->number}: {$m->description})" : '').'.'];
        }
        $soat = Documentos::vigente($v->id, 'SOAT');
        $vSoat = $soat ? $soat->expires_on : $v->soat_expires_on;
        if (! $vSoat) {
            $out[] = ['tipo' => 'SOAT', 'msg' => "{$v->plate} no tiene SOAT registrado."];
        } elseif ($vSoat < $fecha) {
            $out[] = ['tipo' => 'SOAT', 'msg' => "El SOAT de {$v->plate} venció el ".Base::fecha($vSoat).'.'];
        }
        $rt = Documentos::vigente($v->id, 'TECH_INSPECTION');
        $vRt = $rt ? $rt->expires_on : $v->tech_inspection_expires_on;
        if ($vRt && $vRt < $fecha) {
            $out[] = ['tipo' => 'RT', 'msg' => "La revisión técnica de {$v->plate} venció el ".Base::fecha($vRt).'.'];
        }
        $odo = null;
        foreach (DB::table('vehicle_maintenance_plans')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')->whereNotNull('next_due_km')->get() as $pl) {
            $odo ??= Odometro::actual($v);
            $e = Mantenimiento::estado($pl, $odo, $fecha);
            if ($e['estado'] === 'OVERDUE_BLOCK') {
                $out[] = ['tipo' => 'PLAN', 'msg' => "«{$pl->task}» de {$v->plate} está vencido por ".Base::km(-$e['km_restante']).' km (más de '.Base::km(Base::num('flo_maint_overdue_block_km', 1000)).' km).'];
            }
        }

        return $out;
    }

    public static function exigir(object $v, string $fecha): void
    {
        $m = self::motivos($v, $fecha);
        if ($m) {
            RuleError::fail('RN-FLO-11', implode(' ', array_column($m, 'msg')).' No se asigna a una ruta ni abre jornada el '.Base::fecha($fecha).'.');
        }
    }

    /** Lo llama DEL (asignar y salir) solo si FLO está encendido para la empresa. */
    public static function paraDel(string $vehiculoId, string $fecha, ?User $u): void
    {
        if (! Base::activo($u)) {
            return;
        }
        $v = DB::table('vehicles')->where('id', $vehiculoId)->first();
        if ($v && in_array($v->ownership, ['OWN', 'RENTED'], true) && $v->vehicle_type !== 'BICYCLE') {
            self::exigir($v, $fecha);
        }
    }
}
