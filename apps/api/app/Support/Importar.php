<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Cell\DataValidation;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Reader\IReadFilter;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Importaciones desde Excel o CSV, como en erp-saas: cada importador ofrece una plantilla .xlsx con los colores
 * de la empresa, instrucciones, ejemplos y listas desplegables, y acepta el archivo lleno (.xlsx, .xls o .csv).
 *
 * El archivo se convierte al mismo texto separado por «;» que ya validan los importadores (MAE-10, CLI-12):
 * la cabecera se reconoce por sus títulos (con o sin tildes, en cualquier orden), las filas que empiezan con «#»
 * son instrucciones y se saltan, y las fechas de Excel pasan a AAAA-MM-DD. Las fórmulas no se calculan: se lee
 * el valor guardado, y nada del archivo se ejecuta.
 *
 *   Importar::plantilla('plantilla-trabajadores', 'Importar trabajadores', $columnas, ejemplos: [[…]], notas: […])
 *   $texto = Importar::aTexto($request->file('archivo'), $columnas, maxFilas: 500);
 *
 * Columna: clave (la del CSV), titulo (el de la plantilla), ancho, lista (opciones del desplegable), fecha (bool),
 * otros (otros títulos aceptados al leer).
 */
final class Importar
{
    /** Validación del archivo subido, igual para todos los importadores. */
    public const REGLAS_ARCHIVO = ['required', 'file', 'max:2048', 'mimes:xlsx,xls,csv,txt'];

    private const FILAS_EN_BLANCO = 200;

    /** "Fecha de ingreso" → "fecha_de_ingreso". */
    public static function normalizar(string $titulo): string
    {
        $t = trim(str_replace("\xEF\xBB\xBF", '', $titulo));

        return trim(preg_replace('/[^a-z0-9]+/', '_', strtolower(Str::ascii($t))) ?? '', '_');
    }

    /**
     * El archivo como texto «;» con la cabecera en el orden de $columnas. Falla si no reconoce la cabecera,
     * si no hay filas o si pasa de $maxFilas.
     *
     * @param  array<int, array{clave: string, titulo: string, fecha?: bool, otros?: string[]}>  $columnas
     */
    public static function aTexto(UploadedFile $archivo, array $columnas, int $maxFilas): string
    {
        $ext = strtolower($archivo->getClientOriginalExtension() ?: $archivo->extension() ?: '');
        $crudo = in_array($ext, ['xlsx', 'xls'], true) ? self::celdasDeExcel($archivo->getRealPath(), $maxFilas) : self::celdasDeCsv($archivo->getRealPath());

        $alias = [];
        foreach ($columnas as $c) {
            foreach (array_merge([$c['clave'], $c['titulo']], $c['otros'] ?? []) as $t) {
                $alias[self::normalizar($t)] = $c['clave'];
            }
        }
        $fechas = array_column(array_filter($columnas, fn ($c) => $c['fecha'] ?? false), 'clave');

        $posiciones = null;
        $lineas = [implode(';', array_column($columnas, 'clave'))];
        foreach ($crudo as $celdas) {
            $celdas = array_map(fn ($v) => trim((string) ($v ?? '')), $celdas);
            if (implode('', $celdas) === '' || str_starts_with($celdas[0] ?? '', '#')) {
                continue;
            }
            if ($posiciones === null) {
                $claves = array_map(fn ($v) => $alias[self::normalizar($v)] ?? null, $celdas);
                if (count(array_filter($claves)) >= min(2, count($columnas))) {
                    $posiciones = array_flip(array_filter($claves));
                }

                continue;
            }
            if (count($lineas) > $maxFilas) {
                RuleError::fail('IMPORTAR', "El archivo tiene más de {$maxFilas} filas: divídelo en partes.");
            }
            $lineas[] = implode(';', array_map(function ($c) use ($posiciones, $celdas, $fechas) {
                $v = isset($posiciones[$c['clave']]) ? ($celdas[$posiciones[$c['clave']]] ?? '') : '';
                if (in_array($c['clave'], $fechas, true)) {
                    $v = self::fecha($v);
                }

                // El separador y los saltos de línea dentro de un valor romperían la fila.
                return trim(preg_replace('/[;\s]+/u', ' ', $v));
            }, $columnas));
        }
        if ($posiciones === null) {
            RuleError::fail('IMPORTAR', 'No se encontró la fila de títulos de las columnas. Usa la plantilla.');
        }
        if (count($lineas) === 1) {
            RuleError::fail('IMPORTAR', 'El archivo no tiene filas para importar.');
        }

        return implode("\n", $lineas);
    }

    /** Fecha de una celda: número de serie de Excel o texto (15/09/2026, 2026-09-15). */
    public static function fecha(string $v): string
    {
        if (is_numeric($v) && (float) $v > 20000 && (float) $v < 80000) {
            return gmdate('Y-m-d', (int) round(((float) $v - 25569) * 86400));
        }

        return $v;
    }

    private static function celdasDeExcel(string $ruta, int $maxFilas): array
    {
        try {
            $lector = IOFactory::createReaderForFile($ruta);
            $lector->setReadDataOnly(true);
            $tope = $maxFilas + 60; // título, notas y cabecera caben de sobra
            // Solo se leen las filas que pueden importarse: un archivo con miles de filas no carga el servidor.
            $lector->setReadFilter(new class($tope) implements IReadFilter
            {
                public function __construct(private int $tope) {}

                public function readCell(string $columnAddress, int $row, string $worksheetName = ''): bool
                {
                    return $row <= $this->tope;
                }
            });
            $hoja = $lector->load($ruta)->getSheet(0);
        } catch (\Throwable) {
            RuleError::fail('IMPORTAR', 'No se pudo leer el Excel. Guárdalo de nuevo como .xlsx o usa la plantilla.');
        }
        $ultima = min($hoja->getHighestDataRow(), $tope);
        $col = $hoja->getHighestDataColumn();

        return $hoja->rangeToArray("A1:{$col}{$ultima}", null, false, false, false);
    }

    private static function celdasDeCsv(string $ruta): array
    {
        $texto = (string) file_get_contents($ruta);
        if (! mb_check_encoding($texto, 'UTF-8')) {
            $texto = mb_convert_encoding($texto, 'UTF-8', 'Windows-1252'); // CSV guardado desde Excel en Windows
        }
        $lineas = preg_split('/\r\n|\r|\n/', str_replace("\xEF\xBB\xBF", '', $texto));
        $muestra = implode("\n", array_slice($lineas, 0, 5));
        $sep = substr_count($muestra, ';') >= substr_count($muestra, ',') ? ';' : ',';

        return array_map(fn ($l) => str_getcsv($l, $sep), $lineas);
    }

    /**
     * Plantilla .xlsx: banda con el título, instrucciones (filas «#»), cabecera, ejemplos y filas en blanco
     * en formato texto (los DNI y celulares no pierden ceros), con listas desplegables donde corresponde.
     *
     * @param  array<int, array{clave: string, titulo: string, ancho?: int, lista?: string[]}>  $columnas
     * @param  array<int, array<int, string>>  $ejemplos
     * @param  string[]  $notas
     */
    public static function plantilla(string $archivo, string $titulo, array $columnas, array $ejemplos, array $notas): StreamedResponse
    {
        $libro = self::libroDePlantilla($titulo, $columnas, $ejemplos, $notas);

        return response()->streamDownload(fn () => (new Xlsx($libro))->save('php://output'), "{$archivo}.xlsx",
            ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    }

    public static function libroDePlantilla(string $titulo, array $columnas, array $ejemplos, array $notas): Spreadsheet
    {
        $color = Exportar::coloresDeLaEmpresa();
        $suave = fn (string $rgb, float $k) => implode('', array_map(fn ($i) => sprintf('%02X', (int) round(255 - (255 - hexdec(substr($rgb, $i, 2))) * $k)), [0, 2, 4]));
        $libro = new Spreadsheet;
        $libro->getProperties()->setCreator('GestionCarnica')->setTitle($titulo);
        $libro->getDefaultStyle()->getFont()->setName('Calibri')->setSize(10);
        $h = $libro->getActiveSheet();
        $h->setTitle('Plantilla');
        $h->setShowGridlines(false);
        $ult = Coordinate::stringFromColumnIndex(count($columnas));
        $borde = ['borders' => ['allBorders' => ['borderStyle' => Border::BORDER_THIN, 'color' => ['rgb' => $suave($color['primary'], 0.25)]]]];

        $h->mergeCells("A1:{$ult}1");
        $h->setCellValue('A1', "# {$titulo}");
        $h->getStyle('A1')->applyFromArray([
            'font' => ['size' => 14, 'bold' => true, 'color' => ['rgb' => 'FFFFFF']],
            'fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['rgb' => $color['primary_dark']]],
            'alignment' => ['vertical' => Alignment::VERTICAL_CENTER, 'indent' => 1],
        ]);
        $h->getRowDimension(1)->setRowHeight(28);

        $fila = 2;
        foreach ($notas as $nota) {
            $h->mergeCells("A{$fila}:{$ult}{$fila}");
            $h->setCellValueExplicit("A{$fila}", "# {$nota}", DataType::TYPE_STRING);
            $h->getStyle("A{$fila}")->applyFromArray([
                'font' => ['size' => 9, 'color' => ['rgb' => $color['primary_dark']]],
                'fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['rgb' => $suave($color['primary'], 0.08)]],
                'alignment' => ['vertical' => Alignment::VERTICAL_CENTER, 'indent' => 1, 'wrapText' => true],
            ]);
            $fila++;
        }

        foreach ($columnas as $i => $c) {
            $h->setCellValueExplicit(Coordinate::stringFromColumnIndex($i + 1).$fila, $c['titulo'], DataType::TYPE_STRING);
            $h->getColumnDimensionByColumn($i + 1)->setWidth($c['ancho'] ?? max(14, mb_strlen($c['titulo']) + 4));
        }
        $h->getStyle("A{$fila}:{$ult}{$fila}")->applyFromArray([
            'font' => ['bold' => true, 'color' => ['rgb' => 'FFFFFF']],
            'fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['rgb' => $color['primary']]],
            'alignment' => ['horizontal' => Alignment::HORIZONTAL_CENTER, 'vertical' => Alignment::VERTICAL_CENTER],
        ] + $borde);
        $h->getRowDimension($fila)->setRowHeight(22);
        $h->freezePane('A'.($fila + 1));

        $primera = $fila + 1;
        foreach ($ejemplos as $ej) {
            $fila++;
            foreach (array_values($ej) as $i => $v) {
                $h->setCellValueExplicit(Coordinate::stringFromColumnIndex($i + 1).$fila, (string) $v, DataType::TYPE_STRING);
            }
        }
        $fin = $fila + self::FILAS_EN_BLANCO;
        $h->getStyle("A{$primera}:{$ult}{$fin}")->applyFromArray(['numberFormat' => ['formatCode' => '@']] + $borde);

        // Listas desplegables: las opciones van en una hoja oculta.
        $listas = array_filter($columnas, fn ($c) => ! empty($c['lista']));
        if ($listas) {
            $op = $libro->createSheet();
            $op->setTitle('Listas');
            $n = 0;
            foreach ($columnas as $i => $c) {
                if (empty($c['lista'])) {
                    continue;
                }
                $fuente = Coordinate::stringFromColumnIndex(++$n);
                foreach (array_values($c['lista']) as $k => $v) {
                    $op->setCellValueExplicit($fuente.($k + 1), (string) $v, DataType::TYPE_STRING);
                }
                $v = new DataValidation;
                $v->setType(DataValidation::TYPE_LIST)->setErrorStyle(DataValidation::STYLE_STOP)->setAllowBlank(true)
                    ->setShowDropDown(true)->setShowErrorMessage(true)->setErrorTitle('Valor no válido')->setError('Elige una opción de la lista.')
                    ->setFormula1("Listas!\${$fuente}\$1:\${$fuente}\$".count($c['lista']));
                $col = Coordinate::stringFromColumnIndex($i + 1);
                $h->setDataValidation("{$col}{$primera}:{$col}{$fin}", $v);
            }
            $op->setSheetState(Worksheet::SHEETSTATE_HIDDEN);
            $libro->setActiveSheetIndex(0);
        }

        return $libro;
    }
}
