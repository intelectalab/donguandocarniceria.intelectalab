<?php

namespace App\Modulos\Int\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * INT-03 Credenciales.
 *  - RN-INT-02: el secreto se cifra con la clave de la aplicación (APP_KEY, fuera de la base) en formato enc:v2:…, y
 *    nunca vuelve a la pantalla ni a la bitácora: solo se muestran sus últimos 4 caracteres.
 *  - RN-INT-03: una sola credencial vigente por conector y nombre (además, la base lo impide). Rotar crea la versión
 *    siguiente y revoca la anterior; revocar pide un motivo de al menos 10 caracteres.
 *  - RN-INT-20: las que vencen avisan int_credential_expiry_warn_days (7) días antes.
 * Las credenciales de demostración traen un valor cifrado de ejemplo (enc:v1:…) que no se puede descifrar.
 */
final class Credenciales
{
    public const ESTADOS = ['ACTIVE' => 'Vigente', 'REVOKED' => 'Revocada'];

    public static function lista(?string $conector = null): array
    {
        $q = DB::table('integration_credentials as k')->join('integration_connectors as c', 'c.id', '=', 'k.connector_id')
            ->select('k.*', 'c.name as connector_name');
        if ($conector) {
            $q->where('k.connector_id', $conector);
        }
        $filas = $q->orderBy('c.name')->orderBy('k.name')->orderByDesc('k.version')->get()->map(fn ($k) => self::presentar($k))->all();
        $aviso = self::diasDeAviso();

        return [
            'data' => $filas,
            'por_vencer' => array_values(array_filter($filas, fn ($k) => $k['status'] === 'ACTIVE' && $k['dias_para_vencer'] !== null && $k['dias_para_vencer'] <= $aviso)),
            'dias_aviso' => $aviso,
            'conectores' => DB::table('integration_connectors')->orderBy('name')->get(['id', 'name']),
            'estados' => self::ESTADOS,
        ];
    }

    public static function cargar(array $d, User $quien): array
    {
        $c = Conectores::fila($d['connector_id']);
        $nombre = trim($d['name']);
        self::validarSecreto($d['secret']);
        if (DB::table('integration_credentials')->where('connector_id', $c->id)->where('name', $nombre)->where('status', 'ACTIVE')->exists()) {
            $v = DB::table('integration_credentials')->where('connector_id', $c->id)->where('name', $nombre)->where('status', 'ACTIVE')->value('version');
            RuleError::fail('RN-INT-03', "Ya hay una credencial vigente «{$nombre}» (versión {$v}): usa «Rotar» para reemplazarla.");
        }
        $version = 1 + (int) DB::table('integration_credentials')->where('connector_id', $c->id)->where('name', $nombre)->max('version');
        $id = self::insertar($c->id, $nombre, $version, $d['secret'], $d['expires_at'] ?? null, $quien, null);
        Events::emit('credential.loaded', 'integration_credentials', $id, ['by' => $quien->id, 'connector' => $c->code, 'name' => $nombre, 'version' => $version,
            'value' => self::mascara(self::ultimos4($d['secret']))]);

        return self::presentar(self::fila($id));
    }

    public static function rotar(string $id, array $d, User $quien): array
    {
        $vieja = self::fila($id);
        if ($vieja->status !== 'ACTIVE') {
            RuleError::fail('RN-INT-03', 'Solo se rota una credencial vigente.');
        }
        self::validarSecreto($d['secret']);
        $nueva = DB::transaction(function () use ($vieja, $d, $quien) {
            DB::table('integration_credentials')->where('id', $vieja->id)->update(['status' => 'REVOKED', 'revoked_at' => now(), 'revoked_reason' => 'Rotación', 'updated_at' => now()]);

            return self::insertar($vieja->connector_id, $vieja->name, $vieja->version + 1, $d['secret'], $d['expires_at'] ?? null, $quien, $vieja->id);
        });
        Events::emit('credential.rotated', 'integration_credentials', $nueva, ['by' => $quien->id, 'name' => $vieja->name,
            'from' => ['version' => $vieja->version, 'value' => self::mascara($vieja->last4)], 'to' => ['version' => $vieja->version + 1, 'value' => self::mascara(self::ultimos4($d['secret']))]]);

        return self::presentar(self::fila($nueva));
    }

    public static function revocar(string $id, string $motivo, User $quien): array
    {
        $k = self::fila($id);
        if ($k->status !== 'ACTIVE') {
            RuleError::fail('RN-INT-03', 'La credencial ya está revocada.');
        }
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-INT-03', 'Revocar una credencial exige un motivo de al menos 10 caracteres.');
        }
        DB::table('integration_credentials')->where('id', $id)->update(['status' => 'REVOKED', 'revoked_at' => now(), 'revoked_reason' => trim($motivo), 'updated_at' => now()]);
        Events::emit('credential.revoked', 'integration_credentials', $id, ['by' => $quien->id, 'name' => $k->name, 'version' => $k->version,
            'value' => self::mascara($k->last4), 'reason' => trim($motivo)]);

        return self::presentar(self::fila($id));
    }

    /** Secreto en claro, solo para los adaptadores reales (nunca para la pantalla). */
    public static function secreto(string $conector, string $nombre): ?string
    {
        $enc = DB::table('integration_credentials')->where('connector_id', $conector)->where('name', $nombre)->where('status', 'ACTIVE')->value('secret_enc');

        return $enc && str_starts_with($enc, 'enc:v2:') ? Crypt::decryptString(substr($enc, 7)) : null;
    }

    /** Lo que ve la pantalla: sin el secreto, solo los últimos 4 caracteres. */
    public static function presentar(object $k): array
    {
        $vence = $k->expires_at ? now()->startOfDay()->diffInDays(Carbon::parse($k->expires_at)->startOfDay(), false) : null;

        return [
            'id' => $k->id, 'connector_id' => $k->connector_id, 'connector_name' => $k->connector_name ?? null, 'name' => $k->name, 'version' => (int) $k->version,
            'value' => self::mascara($k->last4), 'expires_at' => $k->expires_at, 'dias_para_vencer' => $vence === null ? null : (int) $vence,
            'status' => $k->status, 'status_name' => self::ESTADOS[$k->status] ?? $k->status, 'created_by' => $k->created_by, 'created_at' => $k->created_at,
            'revoked_at' => $k->revoked_at, 'revoked_reason' => $k->revoked_reason,
        ];
    }

    public static function mascara(?string $ultimos4): string
    {
        return '••••'.($ultimos4 ?: '????');
    }

    private static function insertar(string $conector, string $nombre, int $version, string $secreto, ?string $vence, User $quien, ?string $de): string
    {
        return DB::table('integration_credentials')->insertGetId([
            'connector_id' => $conector, 'name' => $nombre, 'version' => $version, 'secret_enc' => 'enc:v2:'.Crypt::encryptString($secreto),
            'last4' => self::ultimos4($secreto), 'expires_at' => $vence, 'status' => 'ACTIVE', 'created_by' => mb_substr($quien->name, 0, 120),
            'rotated_from' => $de, 'created_at' => now(), 'updated_at' => now(),
        ], 'id');
    }

    private static function validarSecreto(string $s): void
    {
        if (mb_strlen($s) < 8) {
            RuleError::fail('RN-INT-02', 'El secreto tiene al menos 8 caracteres.');
        }
    }

    private static function ultimos4(string $s): string
    {
        return mb_substr($s, -4);
    }

    private static function diasDeAviso(): int
    {
        return (int) (Params::get('int_credential_expiry_warn_days') ?? 7);
    }

    private static function fila(string $id): object
    {
        return DB::table('integration_credentials as k')->join('integration_connectors as c', 'c.id', '=', 'k.connector_id')->where('k.id', $id)
            ->select('k.*', 'c.name as connector_name')->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }
}
