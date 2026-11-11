<?php

namespace App\Modulos\Seg\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Dispositivos registrados (SEG-09, SEG-13). Permiso seg.device.approve (administrador del sistema y
 * coordinador de delivery).
 *  RN-SEG-11  la app móvil solo inicia sesión desde un dispositivo aprobado; revocarlo cierra al
 *             instante las sesiones abiertas desde él.
 *  RN-SEG-16  nadie aprueba su propio dispositivo, salvo la gerencia cuando es la única persona
 *             activa con el permiso; esa aprobación queda marcada en la bitácora.
 */
final class Dispositivos
{
    public const PERMISO = 'seg.device.approve';

    public static function aprobar(string $id, User $quien): object
    {
        return DB::transaction(function () use ($id, $quien) {
            $d = self::fila($id);
            if ($d->status !== 'PENDING') {
                RuleError::fail('RN-SEG-11', 'Solo se aprueba un dispositivo pendiente.');
            }
            $propia = $d->user_id === $quien->id;
            if ($propia && ! self::gerenciaUnica($quien)) {
                RuleError::fail('RN-SEG-16', 'Nadie aprueba su propio dispositivo: pide la aprobación a otra persona con el permiso '.self::PERMISO.'.');
            }
            DB::table('user_devices')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(), 'updated_at' => now()]);
            Bitacora::registrar('DEVICE_APPROVED', ['user' => $quien, 'device_id' => $id, 'entity' => 'users', 'entity_id' => $d->user_id,
                'detail' => "Aprobó «{$d->name}»".($propia ? ' (propio: única persona con el permiso)' : ''), 'details' => ['self_approval' => $propia]]);
            Events::emit('device.approved', 'user_devices', $id, ['user_id' => $d->user_id, 'by' => $quien->id]);

            return self::fila($id);
        });
    }

    /** @return array{device: object, sesiones_cerradas: int} */
    public static function revocar(string $id, string $motivo, User $quien): array
    {
        $motivo = trim($motivo);
        if (mb_strlen($motivo) < 5) {
            RuleError::fail('RN-SEG-11', 'Indica el motivo (por ejemplo: celular perdido).');
        }

        return DB::transaction(function () use ($id, $motivo, $quien) {
            $d = self::fila($id);
            if ($d->status === 'REVOKED') {
                RuleError::fail('RN-SEG-11', 'El dispositivo ya está revocado.');
            }
            DB::table('user_devices')->where('id', $id)->update(['status' => 'REVOKED', 'revoked_at' => now(),
                'revoke_reason' => mb_substr($motivo, 0, 80), 'updated_at' => now()]);
            // Las sesiones abiertas desde ese dispositivo se cierran en ese momento.
            $n = Sesiones::cerrando('REVOKED', "Dispositivo revocado: {$motivo}", fn () => DB::table('personal_access_tokens')->where('device_id', $id)->delete());
            Bitacora::registrar('DEVICE_REVOKED', ['user' => $quien, 'device_id' => $id, 'entity' => 'users', 'entity_id' => $d->user_id,
                'detail' => "Revocó «{$d->name}»: {$motivo}", 'details' => ['sessions_closed' => $n]], denegado: true);
            Events::emit('device.revoked', 'user_devices', $id, ['user_id' => $d->user_id, 'reason' => $motivo, 'by' => $quien->id]);

            return ['device' => self::fila($id), 'sesiones_cerradas' => $n];
        });
    }

    private static function fila(string $id): object
    {
        return DB::table('user_devices')->where('id', $id)->first() ?? RuleError::fail('RN-SEG-11', 'Dispositivo no encontrado.');
    }

    /** La gerencia, cuando nadie más activo tiene el permiso de aprobar dispositivos. */
    private static function gerenciaUnica(User $quien): bool
    {
        if (! in_array('GERENTE', Access::for($quien)['roles'], true)) {
            return false;
        }
        $otros = User::where('status', 'ACTIVE')->where('id', '<>', $quien->id)->get();

        return ! $otros->contains(fn (User $u) => Access::can($u, self::PERMISO));
    }
}
