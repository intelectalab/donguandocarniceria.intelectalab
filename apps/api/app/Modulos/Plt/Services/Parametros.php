<?php

namespace App\Modulos\Plt\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Cambiar parámetros (PLT-10). La definición es global (tipo, rango, ámbitos, valor por defecto);
 * el valor es de cada empresa y puede afinarse por local o marca (RN-PLT-12). Cada cambio exige
 * motivo (RN-PLT-06), se valida contra la definición (RN-PLT-11) y queda en parameter_history,
 * que es de solo inserción. Los cálculos ya hechos no se recalculan.
 *
 * Para leer un valor se sigue usando App\Support\Params::get('clave', ['brand' => $id, 'site' => $id]).
 */
final class Parametros
{
    public const AMBITOS = ['TENANT', 'ESTABLISHMENT', 'BRAND'];

    /** Definición del parámetro, con sus ámbitos y opciones ya decodificados. */
    public static function definicion(string $key): object
    {
        $d = DB::table('parameter_definitions')->where('key', $key)->first()
            ?? RuleError::fail('RN-PLT-11', "El parámetro {$key} no está definido.");
        $d->allowed_scopes = json_decode($d->allowed_scopes ?? '[]', true) ?: ['TENANT'];
        $d->options = $d->options ? json_decode($d->options, true) : null;

        return $d;
    }

    /**
     * Convierte el valor escrito al texto que se guarda, validándolo contra la definición
     * (RN-PLT-11): número dentro del rango, sí/no, hora HH:MM, una opción de la lista o JSON.
     */
    public static function validar(object $d, mixed $crudo): string
    {
        $t = is_string($crudo) ? trim($crudo) : $crudo;
        $unidad = $d->unit ? " {$d->unit}" : '';

        switch ($d->value_type) {
            case 'BOOL':
                if (in_array($t, [true, 'true', '1', 1, 'sí', 'si'], true)) {
                    return 'true';
                }
                if (in_array($t, [false, 'false', '0', 0, 'no'], true)) {
                    return 'false';
                }
                RuleError::fail('RN-PLT-11', 'El valor es sí o no.');
                // no break
            case 'INT':
            case 'DECIMAL':
                $n = is_numeric(str_replace(',', '.', (string) $t)) ? (float) str_replace(',', '.', (string) $t) : null;
                if ($t === '' || $t === null || $n === null) {
                    RuleError::fail('RN-PLT-11', 'El valor debe ser un número.');
                }
                if ($d->value_type === 'INT' && floor($n) != $n) {
                    RuleError::fail('RN-PLT-11', 'El valor debe ser un número entero.');
                }
                if ($d->min_value !== null && $n < (float) $d->min_value) {
                    RuleError::fail('RN-PLT-11', 'El valor debe ser al menos '.self::numero($d->min_value).$unidad.'.');
                }
                if ($d->max_value !== null && $n > (float) $d->max_value) {
                    RuleError::fail('RN-PLT-11', 'El valor debe ser como máximo '.self::numero($d->max_value).$unidad.'.');
                }

                return self::numero($n);
            case 'TIME':
                if (! preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) $t)) {
                    RuleError::fail('RN-PLT-11', 'El valor es una hora en formato HH:MM, por ejemplo 09:00.');
                }

                return (string) $t;
            case 'LIST':
                $validas = array_map(fn ($o) => is_array($o) ? $o[0] : $o, $d->options ?? []);
                if (! in_array($t, $validas, true)) {
                    RuleError::fail('RN-PLT-11', 'El valor debe ser una de las opciones: '.implode(', ', $validas).'.');
                }

                return (string) $t;
            case 'JSON':
                $v = is_string($t) ? json_decode($t, true) : $t;
                if ($v === null && $t !== 'null') {
                    RuleError::fail('RN-PLT-11', 'El valor debe ser JSON válido, por ejemplo [1, 5, 15].');
                }

                return json_encode($v, JSON_UNESCAPED_UNICODE);
            default:
                if ($t === '' || $t === null) {
                    RuleError::fail('RN-PLT-11', 'Escribe el valor.');
                }
                if (mb_strlen((string) $t) > 500) {
                    RuleError::fail('RN-PLT-11', 'El valor tiene como máximo 500 caracteres.');
                }

                return (string) $t;
        }
    }

    /**
     * Fija el valor de un parámetro en un ámbito (la empresa, un local o una marca), con motivo.
     * Devuelve el valor guardado.
     */
    public static function cambiar(string $key, mixed $valor, string $motivo, User $quien, string $ambito = 'TENANT', ?string $ambitoId = null): string
    {
        self::exigirMotivo($motivo);
        $d = self::definicion($key);
        [$ambito, $ambitoId] = self::ambito($d, $ambito, $ambitoId);
        $nuevo = self::validar($d, $valor);

        return DB::transaction(function () use ($d, $key, $nuevo, $motivo, $quien, $ambito, $ambitoId) {
            $antes = self::vigente($key, $ambito, $ambitoId);
            if ($antes === $nuevo) {
                RuleError::fail('RN-PLT-11', 'El valor nuevo es igual al vigente.');
            }
            $fila = DB::table('parameters')->where('key', $key)->where('scope', $ambito)
                ->where(fn ($q) => $ambitoId ? $q->where('scope_id', $ambitoId) : $q->whereNull('scope_id'))->lockForUpdate()->first();
            $datos = ['value' => $nuevo, 'reason' => mb_substr(trim($motivo), 0, 255), 'updated_at' => now()];
            if ($fila) {
                DB::table('parameters')->where('id', $fila->id)->update($datos);
            } else {
                DB::table('parameters')->insert($datos + ['key' => $key, 'scope' => $ambito, 'scope_id' => $ambitoId, 'description' => $d->description]);
            }
            self::historial($d, $key, $ambito, $ambitoId, $antes, $nuevo, $motivo, $quien);

            return $nuevo;
        });
    }

    /**
     * Quita el valor propio de un ámbito: vuelve a regir el del ámbito más general (la empresa o el
     * valor por defecto). También queda en el historial.
     */
    public static function quitar(string $key, string $motivo, User $quien, string $ambito = 'TENANT', ?string $ambitoId = null): ?string
    {
        self::exigirMotivo($motivo);
        $d = self::definicion($key);
        [$ambito, $ambitoId] = self::ambito($d, $ambito, $ambitoId);

        return DB::transaction(function () use ($d, $key, $motivo, $quien, $ambito, $ambitoId) {
            $fila = DB::table('parameters')->where('key', $key)->where('scope', $ambito)
                ->where(fn ($q) => $ambitoId ? $q->where('scope_id', $ambitoId) : $q->whereNull('scope_id'))->lockForUpdate()->first()
                ?? RuleError::fail('RN-PLT-11', 'Ese ámbito no tiene un valor propio.');
            DB::table('parameters')->where('id', $fila->id)->delete();
            $ahora = self::vigente($key, $ambito, $ambitoId);
            self::historial($d, $key, $ambito, $ambitoId, $fila->value, $ahora, $motivo, $quien);

            return $ahora;
        });
    }

    /** Valor que rige en ese ámbito: el propio, el de la empresa o el por defecto. */
    public static function vigente(string $key, string $ambito = 'TENANT', ?string $ambitoId = null): ?string
    {
        $alcance = match ($ambito) {
            'BRAND' => ['brand' => $ambitoId],
            'ESTABLISHMENT' => ['site' => $ambitoId],
            default => [],
        };
        $v = Params::get($key, $alcance);

        return $v === null ? null : (string) $v;
    }

    private static function exigirMotivo(string $motivo): void
    {
        $min = (int) (Params::get('plt_parameter_reason_min_length') ?? 10);
        if (mb_strlen(trim($motivo)) < $min) {
            RuleError::fail('RN-PLT-06', "Cambiar un parámetro exige un motivo de al menos {$min} caracteres.");
        }
    }

    /** Revisa que el ámbito esté permitido y que el local o la marca existan. */
    private static function ambito(object $d, string $ambito, ?string $ambitoId): array
    {
        if (! in_array($ambito, $d->allowed_scopes, true)) {
            $nombres = ['TENANT' => 'la empresa', 'ESTABLISHMENT' => 'un local', 'BRAND' => 'una marca'];
            RuleError::fail('RN-PLT-11', "Este parámetro no se puede fijar para {$nombres[$ambito]}.");
        }
        if ($ambito === 'TENANT') {
            return ['TENANT', null];
        }
        $tabla = $ambito === 'BRAND' ? 'brands' : 'establishments';
        if (! $ambitoId || ! DB::table($tabla)->where('id', $ambitoId)->exists()) {
            RuleError::fail('RN-PLT-11', $ambito === 'BRAND' ? 'Elige la marca.' : 'Elige el local.');
        }

        return [$ambito, $ambitoId];
    }

    private static function historial(object $d, string $key, string $ambito, ?string $ambitoId, ?string $antes, ?string $nuevo, string $motivo, User $quien): void
    {
        DB::table('parameter_history')->insert([
            'key' => $key, 'scope' => $ambito, 'scope_id' => $ambitoId, 'old_value' => $antes, 'new_value' => $nuevo ?? '',
            'reason' => mb_substr(trim($motivo), 0, 255), 'changed_by' => $quien->name, 'changed_by_id' => $quien->id,
            'changed_at' => now(), 'module_code' => $d->module_code,
        ]);
        Events::emit('parameter.changed', 'parameters', null, ['key' => $key, 'scope' => $ambito, 'scope_id' => $ambitoId, 'old' => $antes, 'value' => $nuevo]);
    }

    /** 5.0 → «5»; 2.50 → «2.5». */
    private static function numero(float|string $n): string
    {
        $s = rtrim(rtrim(number_format((float) $n, 4, '.', ''), '0'), '.');

        return $s === '-0' ? '0' : $s;
    }
}
