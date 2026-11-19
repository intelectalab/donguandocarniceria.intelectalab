<?php

namespace App\Modulos\Mae\Services;

use Illuminate\Support\Facades\DB;

/**
 * RN-MAE-11: catálogos globales (SUNAT, ubigeo y entidades financieras). La aplicación de las empresas solo los lee;
 * los actualiza Intelectalab desde la consola (OPS) o con el comando mae:importar-global. Los dos usan este servicio:
 * leer() revisa el archivo línea por línea, vistaPrevia() dice qué filas son nuevas, cuáles cambian y cuáles quedan
 * igual, e importar() graba con la conexión del dueño de la base (la de las empresas no puede escribir aquí).
 *
 * Formatos (una fila por línea, separadas por punto y coma):
 *   sunat     catálogo;código;descripción;vigente desde (AAAA-MM-DD);vigente hasta (vacío = sin fin)
 *   ubigeo    ubigeo de 6 dígitos;departamento;provincia;distrito
 *   entidades código;nombre;tipo (BANK, WALLET, ACQUIRER, GATEWAY, CAJA);RUC;código CCI
 */
final class CatalogosGlobales
{
    public const TABLAS = ['sunat' => 'Catálogos SUNAT', 'ubigeo' => 'Ubigeo', 'entidades' => 'Entidades financieras'];

    public const MAX_BYTES = 5_000_000;

    private const CATALOGOS = [
        '01' => 'Tipo de documento', '03' => 'Unidad de medida', '06' => 'Documento de identidad', '07' => 'Afectación del IGV',
        '09' => 'Tipo de nota de crédito', '10' => 'Tipo de nota de débito', '12' => 'Documentos relacionados', '18' => 'Modalidad de transporte',
        '20' => 'Motivo de traslado',
    ];

    /** Destino y clave de cada tabla. */
    private const DESTINO = [
        'sunat' => ['sunat_catalog_items', ['catalog', 'code']],
        'ubigeo' => ['ubigeo', ['code']],
        'entidades' => ['financial_institutions', ['code']],
    ];

    /** @return array{filas: array<int, array>, errores: array<int, array{linea: int, mensaje: string}>} */
    public static function leer(string $tabla, string $contenido): array
    {
        $contenido = preg_replace('/^\xEF\xBB\xBF/', '', $contenido);   // sin BOM de Excel
        $filas = [];
        $errores = [];
        foreach (preg_split('/\r\n|\r|\n/', $contenido) as $k => $linea) {
            if (trim($linea) === '' || str_starts_with(trim($linea), '#')) {
                continue;
            }
            $c = array_map('trim', explode(';', $linea));
            $fila = match ($tabla) {
                'sunat' => self::sunat($c),
                'ubigeo' => self::ubigeo($c),
                'entidades' => self::entidad($c),
            };
            if (is_string($fila)) {
                $errores[] = ['linea' => $k + 1, 'mensaje' => $fila];
            } else {
                $filas[] = $fila;
            }
        }

        return ['filas' => $filas, 'errores' => $errores];
    }

    /**
     * Qué pasaría al importar: filas nuevas, las que cambian (con lo de antes y lo de después) y las que quedan igual.
     *
     * @return array{nuevas: int, cambian: int, iguales: int, ejemplos: array}
     */
    public static function vistaPrevia(string $tabla, array $filas): array
    {
        [$destino, $clave] = self::DESTINO[$tabla];
        $llave = fn (array|object $f) => implode('|', array_map(fn ($c) => ((array) $f)[$c], $clave));
        $actuales = DB::table($destino)->get()->keyBy(fn ($f) => $llave($f));
        $r = ['nuevas' => 0, 'cambian' => 0, 'iguales' => 0, 'ejemplos' => []];
        foreach ($filas as $f) {
            $antes = $actuales[$llave($f)] ?? null;
            if (! $antes) {
                $r['nuevas']++;
                if (count($r['ejemplos']) < 20) {
                    $r['ejemplos'][] = ['tipo' => 'nueva', 'clave' => $llave($f), 'despues' => $f];
                }

                continue;
            }
            $distinto = array_filter($f, fn ($v, $c) => (string) (((array) $antes)[$c] ?? '') !== (string) ($v ?? ''), ARRAY_FILTER_USE_BOTH);
            if ($distinto) {
                $r['cambian']++;
                if (count($r['ejemplos']) < 20) {
                    $r['ejemplos'][] = ['tipo' => 'cambia', 'clave' => $llave($f), 'campos' => array_map(fn ($c) => ['campo' => $c,
                        'antes' => ((array) $antes)[$c] ?? null, 'despues' => $f[$c]], array_keys($distinto))];
                }
            } else {
                $r['iguales']++;
            }
        }

        return $r;
    }

    /** Graba (inserta o actualiza por su clave) con la conexión del dueño de la base, en una transacción. */
    public static function importar(string $tabla, array $filas): int
    {
        [$destino, $clave] = self::DESTINO[$tabla];
        $db = DB::connection('pgsql_owner');
        $db->transaction(function () use ($db, $destino, $clave, $filas) {
            foreach (array_chunk($filas, 500) as $parte) {
                $parte = array_map(fn ($f) => $f + ['updated_at' => now()], $parte);
                $db->table($destino)->upsert($parte, $clave, array_keys($parte[0]));
            }
        });

        return count($filas);
    }

    private static function sunat(array $c): array|string
    {
        [$cat, $code, $desc, $desde, $hasta] = array_pad($c, 5, '');
        $cat = str_pad($cat, 2, '0', STR_PAD_LEFT);
        if ($code === '' || $desc === '' || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $desde) || ($hasta !== '' && ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $hasta))) {
            return 'faltan catálogo, código, descripción o las fechas (AAAA-MM-DD).';
        }

        return [
            'catalog' => $cat, 'catalog_name' => self::CATALOGOS[$cat] ?? "Catálogo {$cat}", 'code' => mb_substr($code, 0, 20),
            'description' => $desc, 'valid_from' => $desde, 'valid_to' => $hasta ?: null, 'status' => 'ACTIVE',
        ];
    }

    private static function ubigeo(array $c): array|string
    {
        [$code, $dep, $prov, $dis] = array_pad($c, 4, '');
        if (! preg_match('/^\d{6}$/', $code) || $dep === '' || $prov === '' || $dis === '') {
            return 'el ubigeo tiene 6 dígitos y trae departamento, provincia y distrito.';
        }

        return ['code' => $code, 'level' => 'DISTRICT', 'department' => mb_substr($dep, 0, 40), 'province' => mb_substr($prov, 0, 40), 'district' => mb_substr($dis, 0, 80)];
    }

    private static function entidad(array $c): array|string
    {
        [$code, $name, $kind, $ruc, $cci] = array_pad($c, 5, '');
        if (! preg_match('/^[A-Z0-9-]{2,40}$/', $code) || $name === '' || ! in_array($kind, ['BANK', 'WALLET', 'ACQUIRER', 'GATEWAY', 'CAJA'], true)
            || ($ruc !== '' && ! preg_match('/^\d{11}$/', $ruc))) {
            return 'código en mayúsculas, nombre, tipo válido y RUC de 11 dígitos si lo trae.';
        }

        return ['code' => $code, 'name' => mb_substr($name, 0, 255), 'kind' => $kind, 'ruc' => $ruc ?: null, 'cci_code' => $cci ?: null, 'status' => 'ACTIVE'];
    }
}
