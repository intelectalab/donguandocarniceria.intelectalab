<?php

namespace App\Modulos\Seg\Services;

use App\Models\User;
use App\Support\Params;
use App\Support\RuleError;
use App\Support\TenantContext;
use App\Support\Totp;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Segundo factor de las empresas (SEG-02, SEG-03, SEG-06): códigos de 6 dígitos de una app autenticadora (TOTP) y
 * códigos de recuperación de un solo uso.
 *  - RN-SEG-05: activarlo muestra el QR del secreto, se confirma con un código y entrega seg_recovery_codes_count (10)
 *    códigos de recuperación, que se ven una sola vez. El secreto se guarda cifrado; de los códigos, solo su huella.
 *  - RN-SEG-06: al ingresar, con la contraseña correcta se pide el código (o uno de recuperación). Un mismo código no
 *    sirve dos veces. Los intentos fallidos cuentan para el bloqueo de la cuenta.
 *  - RN-SEG-07: con seg_mfa_enforce encendido, los roles que lo exigen deben activarlo en su próximo ingreso y no lo
 *    pueden apagar. Hoy el parámetro viene apagado: cada persona lo activa si quiere.
 * El paso intermedio del ingreso es un «desafío»: un valor al azar de un solo uso que vale 5 minutos y no da acceso a
 * nada más que a verificar (o activar) el segundo factor. Se guarda en la caché, solo como huella.
 */
final class SegundoFactor
{
    public const MINUTOS_DESAFIO = 5;

    public const MINUTOS_ACTIVACION = 15;

    public const INTENTOS = 5;

    /** Letras y números sin los que se confunden (0/O, 1/I/L). */
    private const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public static function tiene(User $u): bool
    {
        return (bool) $u->twofa_enabled && (string) $u->totp_secret_enc !== '';
    }

    /** Si su rol lo exige y la empresa lo hace obligatorio (seg_mfa_enforce). */
    public static function exigido(User $u): bool
    {
        if (! filter_var(Params::get('seg_mfa_enforce') ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return false;
        }

        return DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->where('ur.user_id', $u->id)->where('r.requires_mfa', true)->exists();
    }

    /** Lo que se muestra en Mi cuenta. */
    public static function estado(User $u): array
    {
        $exige = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->where('ur.user_id', $u->id)->where('r.requires_mfa', true)->exists();

        return ['activo' => self::tiene($u), 'desde' => self::tiene($u) ? $u->mfa_enrolled_at : null, 'rol_lo_exige' => $exige, 'obligatorio' => self::exigido($u),
            'codigos_disponibles' => self::tiene($u) ? self::codigosDisponibles($u) : 0, 'codigos_por_lote' => self::porLote()];
    }

    /** SEG-03 paso 1: un secreto nuevo (todavía no activa nada) y el enlace para el QR. */
    public static function preparar(User $u): array
    {
        if (self::tiene($u)) {
            RuleError::fail('RN-SEG-05', 'Ya tienes el segundo factor activo. Para cambiar de celular, desactívalo y vuelve a activarlo.');
        }
        $secreto = Totp::secreto();
        $u->forceFill(['totp_pending_enc' => Crypt::encryptString($secreto), 'totp_pending_at' => now()])->save();
        $empresa = TenantContext::tenant()['short'] ?? TenantContext::tenant()['name'] ?? 'GestionCarnica';

        return ['secreto' => $secreto, 'enlace' => Totp::enlace($secreto, $u->email, "GestionCarnica · {$empresa}"), 'vence_en_minutos' => self::MINUTOS_ACTIVACION];
    }

    /** SEG-03 paso 2: con el primer código de la app queda activo y entrega los códigos de recuperación (una sola vez). */
    public static function activar(User $u, string $codigo): array
    {
        if (self::tiene($u)) {
            RuleError::fail('RN-SEG-05', 'Ya tienes el segundo factor activo.');
        }
        if (! $u->totp_pending_enc || ! $u->totp_pending_at || now()->diffInMinutes($u->totp_pending_at, true) > self::MINUTOS_ACTIVACION) {
            throw ValidationException::withMessages(['codigo' => ['El código QR venció o no se generó. Vuelve a empezar la activación.']]);
        }
        $secreto = Crypt::decryptString($u->totp_pending_enc);
        $paso = Totp::verificar($secreto, self::soloDigitos($codigo));
        if ($paso === null) {
            Bitacora::registrar('MFA_FAILED', ['user' => $u, 'details' => ['etapa' => 'activación']], denegado: true);
            throw ValidationException::withMessages(['codigo' => ['El código no es correcto o ya venció. Escribe el que muestra la app ahora.']]);
        }
        $codigos = DB::transaction(function () use ($u, $secreto, $paso) {
            $u->forceFill(['totp_secret_enc' => Crypt::encryptString($secreto), 'totp_pending_enc' => null, 'totp_pending_at' => null, 'twofa_enabled' => true,
                'mfa_enrolled_at' => now(), 'totp_last_step' => (string) $paso])->save();

            return self::nuevoLote($u);
        });
        Bitacora::registrar('MFA_ENABLED', ['user' => $u, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => 'Activó el segundo factor']);

        return ['codigos' => $codigos, 'estado' => self::estado($u->fresh())];
    }

    /** SEG-06: códigos nuevos (los anteriores dejan de servir). Pide un código de la app para confirmar que es la persona. */
    public static function regenerar(User $u, string $codigo): array
    {
        self::exigirActivo($u);
        self::comprobar($u, $codigo, soloApp: true);
        $codigos = DB::transaction(fn () => self::nuevoLote($u));
        Bitacora::registrar('MFA_CODES_REGENERATED', ['user' => $u, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => 'Generó códigos de recuperación nuevos']);

        return ['codigos' => $codigos, 'estado' => self::estado($u->fresh())];
    }

    /** SEG-06: apagarlo, con un código de la app o de recuperación. No se puede si es obligatorio para su rol (RN-SEG-07). */
    public static function desactivar(User $u, string $codigo): array
    {
        self::exigirActivo($u);
        if (self::exigido($u)) {
            RuleError::fail('RN-SEG-07', 'Tu rol exige el segundo factor: no lo puedes desactivar. Si cambiaste de celular, pide a un administrador que lo reinicie.');
        }
        self::comprobar($u, $codigo);
        DB::transaction(function () use ($u) {
            $u->forceFill(['twofa_enabled' => false, 'totp_secret_enc' => null, 'mfa_enrolled_at' => null, 'totp_last_step' => null])->save();
            self::anularCodigos($u);
        });
        Bitacora::registrar('MFA_DISABLED', ['user' => $u, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => 'Desactivó su segundo factor']);

        return self::estado($u->fresh());
    }

    /* ------------------------------------------------------------------ ingreso (desafío) */

    /** Después de la contraseña correcta: el desafío para el paso siguiente. $modo VERIFY (pedir código) o ENROLL (activar). */
    public static function desafio(User $u, string $modo, bool $recordar): string
    {
        $valor = bin2hex(random_bytes(32));
        Cache::put(self::clave($valor), ['user' => $u->id, 'tenant' => TenantContext::id(), 'modo' => $modo, 'recordar' => $recordar, 'intentos' => 0],
            now()->addMinutes(self::MINUTOS_DESAFIO));
        Bitacora::registrar('MFA_CHALLENGE', ['user' => $u, 'details' => ['modo' => $modo]]);

        return $valor;
    }

    /**
     * Abre el desafío: fija la empresa, devuelve el usuario y los datos. No lo borra (eso pasa al completarlo o al
     * agotar los intentos). Si no existe o venció, el mismo mensaje.
     *
     * @return array{0: User, 1: array}
     */
    public static function abrir(string $valor, string $modo): array
    {
        $d = Cache::get(self::clave($valor));
        if (! $d || $d['modo'] !== $modo) {
            throw ValidationException::withMessages(['codigo' => ['El ingreso venció. Vuelve a escribir tu correo y contraseña.']]);
        }
        TenantContext::set(TenantContext::find($d['tenant']));
        $u = User::find($d['user']);
        if (! $u || $u->status !== 'ACTIVE') {
            Cache::forget(self::clave($valor));
            throw ValidationException::withMessages(['codigo' => ['El ingreso venció. Vuelve a escribir tu correo y contraseña.']]);
        }

        return [$u, $d];
    }

    /** SEG-02: verifica el código del desafío. Al quinto fallo el desafío se borra y cuenta para el bloqueo. */
    public static function verificarDesafio(string $valor, string $codigo, callable $fallo): array
    {
        [$u, $d] = self::abrir($valor, 'VERIFY');
        try {
            $como = self::comprobar($u, $codigo);
        } catch (ValidationException $e) {
            $d['intentos']++;
            if ($d['intentos'] >= self::INTENTOS) {
                Cache::forget(self::clave($valor));
                $fallo($u);
                throw ValidationException::withMessages(['codigo' => ['Demasiados códigos incorrectos. Vuelve a escribir tu correo y contraseña.']]);
            }
            Cache::put(self::clave($valor), $d, now()->addMinutes(self::MINUTOS_DESAFIO));
            throw $e;
        }
        Cache::forget(self::clave($valor));

        return [$u, $d, $como];
    }

    public static function cerrarDesafio(string $valor): void
    {
        Cache::forget(self::clave($valor));
    }

    /* ------------------------------------------------------------------ apoyo */

    /**
     * Comprueba un código de la app (6 dígitos, nunca el mismo paso dos veces) o uno de recuperación (se gasta).
     * Devuelve cómo pasó: APP o RECOVERY.
     */
    private static function comprobar(User $u, string $codigo, bool $soloApp = false): string
    {
        // Solo 6 dígitos (con o sin espacio) es un código de la app; lo demás, uno de recuperación (letras y números).
        $digitos = self::soloDigitos($codigo);
        if (preg_match('/^\d{6}$/', preg_replace('/\s+/', '', $codigo))) {
            $ultimo = $u->totp_last_step !== null ? (int) $u->totp_last_step : null;
            $paso = Totp::verificar(Crypt::decryptString($u->totp_secret_enc), $digitos, $ultimo);
            if ($paso !== null) {
                $u->forceFill(['totp_last_step' => (string) $paso])->save();
                Bitacora::registrar('MFA_OK', ['user' => $u, 'details' => ['como' => 'APP']]);

                return 'APP';
            }
        } elseif (! $soloApp) {
            $limpio = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $codigo));
            $fila = DB::table('mfa_recovery_codes')->where('user_id', $u->id)->where('code_hash', hash('sha256', $limpio))->whereNull('used_at')->whereNull('voided_at')->first();
            if ($fila && DB::table('mfa_recovery_codes')->where('id', $fila->id)->whereNull('used_at')->update(['used_at' => now(), 'updated_at' => now()])) {
                Bitacora::registrar('RECOVERY_CODE_USED', ['user' => $u, 'details' => ['quedan' => self::codigosDisponibles($u)]]);

                return 'RECOVERY';
            }
        }
        Bitacora::registrar('MFA_FAILED', ['user' => $u], denegado: true);
        throw ValidationException::withMessages(['codigo' => [$soloApp ? 'El código de la app no es correcto o ya se usó. Escribe el que se ve ahora.'
            : 'El código no es correcto o ya se usó. Escribe el de la app o uno de tus códigos de recuperación.']]);
    }

    /** Un lote nuevo de códigos (los vigentes se anulan). Devuelve los códigos en claro: se muestran una sola vez. */
    private static function nuevoLote(User $u): array
    {
        self::anularCodigos($u);
        $lote = 1 + (int) DB::table('mfa_recovery_codes')->where('user_id', $u->id)->max('batch_no');
        $codigos = [];
        while (count($codigos) < self::porLote()) {
            $c = '';
            for ($i = 0; $i < 8; $i++) {
                $c .= self::ALFABETO[random_int(0, strlen(self::ALFABETO) - 1)];
            }
            $codigos[$c] = substr($c, 0, 4).'-'.substr($c, 4);
        }
        DB::table('mfa_recovery_codes')->insert(array_map(fn ($c) => ['user_id' => $u->id, 'code_hash' => hash('sha256', $c), 'batch_no' => $lote,
            'created_at' => now(), 'updated_at' => now()], array_keys($codigos)));

        return array_values($codigos);
    }

    private static function anularCodigos(User $u): void
    {
        DB::table('mfa_recovery_codes')->where('user_id', $u->id)->whereNull('used_at')->whereNull('voided_at')->update(['voided_at' => now(), 'updated_at' => now()]);
    }

    private static function codigosDisponibles(User $u): int
    {
        return DB::table('mfa_recovery_codes')->where('user_id', $u->id)->whereNull('used_at')->whereNull('voided_at')->count();
    }

    private static function porLote(): int
    {
        return max(5, min(20, (int) (Params::get('seg_recovery_codes_count') ?? 10)));
    }

    private static function exigirActivo(User $u): void
    {
        if (! self::tiene($u)) {
            RuleError::fail('RN-SEG-05', 'No tienes el segundo factor activo.');
        }
    }

    private static function soloDigitos(string $c): string
    {
        return preg_replace('/\D/', '', $c);
    }

    private static function clave(string $valor): string
    {
        return 'seg:mfa:'.hash('sha256', $valor);
    }
}
