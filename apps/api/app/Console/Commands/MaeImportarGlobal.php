<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * MAE · RN-MAE-11: el operador de la plataforma actualiza los catálogos globales (SUNAT, ubigeo, entidades financieras)
 * desde un archivo. La aplicación solo puede leerlos; este comando escribe con la conexión del dueño de la base.
 *
 * Formatos (una fila por línea, separadas por punto y coma):
 *   sunat     catálogo;código;descripción;vigente desde (AAAA-MM-DD);vigente hasta (vacío = sin fin)
 *   ubigeo    ubigeo de 6 dígitos;departamento;provincia;distrito
 *   entidades código;nombre;tipo (BANK, WALLET, ACQUIRER, GATEWAY, CAJA);RUC;código CCI
 */
class MaeImportarGlobal extends Command
{
    protected $signature = 'mae:importar-global {tabla : sunat, ubigeo o entidades} {archivo : Ruta del archivo} {--probar : Solo revisa, no graba}';

    protected $description = 'Importa catálogos globales de MAE (SUNAT, ubigeo, entidades financieras) como operador de la plataforma';

    private const CATALOGOS = [
        '01' => 'Tipo de documento', '03' => 'Unidad de medida', '06' => 'Documento de identidad', '07' => 'Afectación del IGV',
        '09' => 'Tipo de nota de crédito', '10' => 'Tipo de nota de débito', '12' => 'Documentos relacionados', '18' => 'Modalidad de transporte',
        '20' => 'Motivo de traslado',
    ];

    public function handle(): int
    {
        $tabla = $this->argument('tabla');
        $archivo = $this->argument('archivo');
        if (! in_array($tabla, ['sunat', 'ubigeo', 'entidades'], true) || ! is_file($archivo) || filesize($archivo) > 5_000_000) {
            $this->error('Tabla no válida o archivo inexistente (máximo 5 MB).');

            return self::FAILURE;
        }
        $filas = [];
        foreach (preg_split('/\r\n|\r|\n/', (string) file_get_contents($archivo)) as $k => $linea) {
            if (trim($linea) === '') {
                continue;
            }
            $c = array_map('trim', explode(';', $linea));
            $fila = match ($tabla) {
                'sunat' => $this->sunat($c),
                'ubigeo' => $this->ubigeo($c),
                'entidades' => $this->entidad($c),
            };
            if (is_string($fila)) {
                $this->error('Línea '.($k + 1).": {$fila}");

                return self::FAILURE;
            }
            $filas[] = $fila;
        }
        $this->info(count($filas).' filas válidas.');
        if ($this->option('probar') || ! $filas) {
            return self::SUCCESS;
        }
        [$destino, $clave] = match ($tabla) {
            'sunat' => ['sunat_catalog_items', ['catalog', 'code']],
            'ubigeo' => ['ubigeo', ['code']],
            'entidades' => ['financial_institutions', ['code']],
        };
        $db = DB::connection('pgsql_owner');
        $db->transaction(function () use ($db, $destino, $clave, $filas) {
            foreach (array_chunk($filas, 500) as $parte) {
                $parte = array_map(fn ($f) => $f + ['updated_at' => now()], $parte);
                $db->table($destino)->upsert($parte, $clave, array_keys($parte[0]));
            }
        });
        $this->info("Importadas en {$destino}.");

        return self::SUCCESS;
    }

    private function sunat(array $c): array|string
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

    private function ubigeo(array $c): array|string
    {
        [$code, $dep, $prov, $dis] = array_pad($c, 4, '');
        if (! preg_match('/^\d{6}$/', $code) || $dep === '' || $prov === '' || $dis === '') {
            return 'el ubigeo tiene 6 dígitos y trae departamento, provincia y distrito.';
        }

        return ['code' => $code, 'level' => 'DISTRICT', 'department' => mb_substr($dep, 0, 40), 'province' => mb_substr($prov, 0, 40), 'district' => mb_substr($dis, 0, 80)];
    }

    private function entidad(array $c): array|string
    {
        [$code, $name, $kind, $ruc, $cci] = array_pad($c, 5, '');
        if (! preg_match('/^[A-Z0-9-]{2,40}$/', $code) || $name === '' || ! in_array($kind, ['BANK', 'WALLET', 'ACQUIRER', 'GATEWAY', 'CAJA'], true)
            || ($ruc !== '' && ! preg_match('/^\d{11}$/', $ruc))) {
            return 'código en mayúsculas, nombre, tipo válido y RUC de 11 dígitos si lo trae.';
        }

        return ['code' => $code, 'name' => mb_substr($name, 0, 255), 'kind' => $kind, 'ruc' => $ruc ?: null, 'cci_code' => $cci ?: null, 'status' => 'ACTIVE'];
    }
}
