<?php

namespace App\Modulos\Cli\Services;

use App\Modulos\Plt\Services\Ruc;
use Illuminate\Support\Facades\DB;

/**
 * RN-CLI-03: formato del documento. RN-CLI-12: la validación guarda fuente y fecha.
 * D-CLI-01: todavía no hay proveedor de consulta de DNI y RUC contratado; consultar() es un
 * adaptador de prueba que responde como lo harían RENIEC y SUNAT (nombre, estado, condición y
 * dirección fiscal). Cuando se contrate, solo cambia consultar().
 */
final class Documentos
{
    public const TIPOS = ['DNI', 'RUC', 'CE', 'PASSPORT', 'NONE'];

    public const NOMBRES = ['DNI' => 'DNI', 'RUC' => 'RUC', 'CE' => 'Carné de extranjería', 'PASSPORT' => 'Pasaporte', 'NONE' => 'Sin documento'];

    public static function limpiar(?string $numero): ?string
    {
        $n = strtoupper(preg_replace('/\s+/', '', (string) $numero));

        return $n === '' ? null : $n;
    }

    /** null si el formato es correcto; si no, qué está mal. El dígito del RUC se revisa al consultar y al facturar. */
    public static function problema(string $tipo, ?string $numero): ?string
    {
        $n = (string) self::limpiar($numero);

        return match ($tipo) {
            'NONE' => null,
            'DNI' => preg_match('/^\d{8}$/', $n) ? null : 'El DNI tiene 8 dígitos.',
            'RUC' => preg_match('/^(10|15|17|20)\d{9}$/', $n) ? null : 'El RUC tiene 11 dígitos y empieza con 10, 15, 17 o 20.',
            'CE' => preg_match('/^[A-Z0-9]{8,12}$/', $n) ? null : 'El carné de extranjería tiene de 8 a 12 letras o números.',
            'PASSPORT' => preg_match('/^[A-Z0-9]{6,12}$/', $n) ? null : 'El pasaporte tiene de 6 a 12 letras o números.',
            default => 'Elige el tipo de documento.',
        };
    }

    private const NOMBRES_PRUEBA = ['Rosa', 'Juan', 'María', 'Carlos', 'Lucía', 'Pedro', 'Elena', 'Víctor'];

    private const APELLIDOS_PRUEBA = ['Huamán', 'Quispe', 'Torres', 'Salazar', 'Paredes', 'Rojas', 'Mendoza', 'Cárdenas'];

    /**
     * Respuesta del proveedor (adaptador de prueba). ok=false con el motivo si el número no pasa.
     *
     * @return array{ok: bool, error?: string, source?: string, name?: string, state?: string, condition?: ?string, fiscal_address?: ?string}
     */
    public static function consultar(string $tipo, ?string $numero): array
    {
        $n = (string) self::limpiar($numero);
        if ($e = self::problema($tipo, $n)) {
            return ['ok' => false, 'error' => $e];
        }
        if (! in_array($tipo, ['DNI', 'RUC'], true)) {
            return ['ok' => false, 'error' => 'El proveedor solo consulta DNI y RUC: usa la validación manual.'];
        }
        if ($tipo === 'RUC' && ($e = Ruc::problema($n))) {
            return ['ok' => false, 'error' => $e.' Revisa el número con el cliente.'];
        }
        $conocido = DB::table('customers')->where(['doc_type' => $tipo, 'doc_number' => $n])->first(['full_name', 'fiscal_address']);
        $k = array_sum(array_map('ord', str_split($n)));
        if ($tipo === 'DNI') {
            return ['ok' => true, 'source' => 'RENIEC', 'state' => 'VIGENTE', 'condition' => null, 'fiscal_address' => null,
                'name' => $conocido->full_name ?? self::NOMBRES_PRUEBA[$k % 8].' '.self::APELLIDOS_PRUEBA[($k >> 1) % 8].' '.self::APELLIDOS_PRUEBA[($k >> 2) % 8]];
        }

        return ['ok' => true, 'source' => 'SUNAT', 'state' => 'ACTIVO',
            'condition' => str_ends_with($n, '7') && ! $conocido ? 'NO HABIDO' : 'HABIDO',
            'name' => $conocido->full_name ?? 'EMPRESA '.substr($n, 2, 4).(str_starts_with($n, '10') ? ' PERSONA NATURAL' : ' SAC'),
            'fiscal_address' => $conocido->fiscal_address ?? 'Av. Principal '.(100 + $k % 900).', Lima'];
    }
}
