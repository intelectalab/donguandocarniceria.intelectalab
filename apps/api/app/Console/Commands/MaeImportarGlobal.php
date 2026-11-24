<?php

namespace App\Console\Commands;

use App\Modulos\Mae\Services\CatalogosGlobales;
use Illuminate\Console\Command;

/**
 * MAE · RN-MAE-11: el operador de la plataforma actualiza los catálogos globales (SUNAT, ubigeo, entidades financieras)
 * desde un archivo. Hace lo mismo que la pantalla «Catálogos globales» de la consola (App\Modulos\Mae\Services\CatalogosGlobales).
 * Formatos en docs/catalogos-globales.md.
 */
class MaeImportarGlobal extends Command
{
    protected $signature = 'mae:importar-global {tabla : sunat, ubigeo o entidades} {archivo : Ruta del archivo} {--probar : Solo revisa, no graba}';

    protected $description = 'Importa catálogos globales de MAE (SUNAT, ubigeo, entidades financieras) como operador de la plataforma';

    public function handle(): int
    {
        $tabla = $this->argument('tabla');
        $archivo = $this->argument('archivo');
        if (! isset(CatalogosGlobales::TABLAS[$tabla]) || ! is_file($archivo) || filesize($archivo) > CatalogosGlobales::MAX_BYTES) {
            $this->error('Tabla no válida o archivo inexistente (máximo 5 MB).');

            return self::FAILURE;
        }
        ['filas' => $filas, 'errores' => $errores] = CatalogosGlobales::leer($tabla, (string) file_get_contents($archivo));
        foreach ($errores as $e) {
            $this->error("Línea {$e['linea']}: {$e['mensaje']}");
        }
        if ($errores) {
            return self::FAILURE;
        }
        $previa = CatalogosGlobales::vistaPrevia($tabla, $filas);
        $this->info(count($filas)." filas válidas: {$previa['nuevas']} nuevas, {$previa['cambian']} cambian, {$previa['iguales']} quedan igual.");
        if ($this->option('probar') || ! $filas) {
            return self::SUCCESS;
        }
        CatalogosGlobales::importar($tabla, $filas);
        $this->info('Importadas.');

        return self::SUCCESS;
    }
}
