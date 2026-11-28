<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Modulos\Int\Services\Archivos;
use App\Support\RuleError;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/** Fotos del tablero, vales, comprobantes y documentos: archivo del formulario o imagen en base64 (cámara del celular). */
final class Archivo
{
    /** Devuelve el id del adjunto (el mismo archivo ya guardado se reutiliza) o null si no vino. */
    public static function guardar(UploadedFile|string|null $f, ?string $tabla, ?string $id, User $u, string $regla, string $falta = ''): ?string
    {
        if (is_string($f)) {
            if (! preg_match('#^data:image/(jpeg|jpg|png|webp);base64,(.+)$#s', $f, $m)) {
                RuleError::fail($regla, 'La foto no es una imagen válida.');
            }
            $bytes = base64_decode($m[2], true);
            if ($bytes === false || strlen($bytes) < 50) {
                RuleError::fail($regla, 'La foto no es una imagen válida.');
            }
            $ext = $m[1] === 'png' ? 'png' : ($m[1] === 'webp' ? 'webp' : 'jpg');
            $tmp = tempnam(sys_get_temp_dir(), 'flo');
            file_put_contents($tmp, $bytes);
            $f = new UploadedFile($tmp, 'foto.'.$ext, 'image/'.($ext === 'jpg' ? 'jpeg' : $ext), null, true);
        }
        if (! $f) {
            if ($falta !== '') {
                RuleError::fail($regla, $falta);
            }

            return null;
        }
        $huella = hash_file('sha256', $f->getRealPath());
        $ya = DB::table('file_attachments')->where('sha256', $huella)->where('status', 'ACTIVE')->whereNull('entity')->value('id');

        return $ya ?? Archivos::subir($f, null, null, 'INTERNAL', $u)['id'];
    }

    /** Enlace temporal para ver el archivo (RN-INT-17). */
    public static function enlace(?string $fileId, User $u): array
    {
        if (! $fileId) {
            RuleError::fail('RN-INT-17', 'No hay archivo adjunto.');
        }

        return Archivos::enlace($fileId, $u);
    }
}
