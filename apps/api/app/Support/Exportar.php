<?php

namespace App\Support;

use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Drawing;
use PhpOffice\PhpSpreadsheet\Worksheet\PageSetup;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Exportaciones del sistema en Excel con diseño de reporte gerencial: banda con el nombre y logo del
 * cliente en los colores de su marca, título y descripción, quién y cuándo lo generó, cifras de
 * resumen, encabezados con color, filas alternadas, filtros, paneles fijos y lista para imprimir.
 * Toda exportación usa esta clase, queda en la bitácora de accesos y lleva el nombre de quien la
 * descargó en el pie de página. Nunca CSV plano.
 *
 *   return Exportar::libro('Matriz de roles y permisos', $request->user())
 *       ->hoja('Permisos', columnas: [['titulo' => 'Permiso', 'ancho' => 30], …], filas: [[…], …],
 *           descripcion: 'Qué rol tiene cada permiso especial', resumen: ['Roles' => 22], fijas: 2)
 *       ->descargar('matriz-roles-permisos');
 *
 * Columna: titulo, ancho (en caracteres), tipo (texto, numero, soles, porcentaje, fecha, marca,
 * centro), girar (encabezado vertical, para matrices). Tipo «marca»: true se ve como ● y false vacío.
 */
final class Exportar
{
    private Spreadsheet $libro;

    private array $colores;

    private int $filas = 0;

    private function __construct(private string $titulo, private User $quien)
    {
        $this->libro = new Spreadsheet;
        $this->libro->removeSheetByIndex(0);
        $this->colores = self::colores();
        $cliente = TenantContext::tenant()['name'] ?? 'Aycha';
        $this->libro->getProperties()->setCreator("{$quien->name} · Aycha")->setCompany($cliente)->setTitle($titulo)
            ->setSubject($titulo)->setDescription("Exportado desde Aycha por {$quien->name}");
        $this->libro->getDefaultStyle()->getFont()->setName('Calibri')->setSize(10);
    }

    public static function libro(string $titulo, User $quien): self
    {
        return new self($titulo, $quien);
    }

    /**
     * @param  array<int, array{titulo: string, ancho?: int, tipo?: string, girar?: bool}>  $columnas
     * @param  iterable<int, array<int, mixed>>  $filas
     * @param  array<string, string|int|float>  $resumen  cifras que van sobre la tabla
     * @param  int  $fijas  columnas fijas a la izquierda al desplazarse
     */
    public function hoja(string $nombre, array $columnas, iterable $filas, ?string $descripcion = null, array $resumen = [], int $fijas = 1, ?string $notas = null): self
    {
        $h = $this->libro->createSheet();
        $h->setTitle(mb_substr(preg_replace('/[\\\\\/?*\[\]:]/', ' ', $nombre), 0, 31));
        $h->setShowGridlines(false);
        $n = max(count($columnas), 4);
        $ultima = Coordinate::stringFromColumnIndex($n);
        [$primario, $oscuro, $acento] = [$this->colores['primary'], $this->colores['primary_dark'], $this->colores['accent']];

        // Banda con el cliente (y su logo) en el color de la marca.
        $h->mergeCells("A1:{$ultima}1");
        self::poner($h, 'A1', TenantContext::tenant()['name'] ?? 'Aycha');
        $h->getStyle("A1:{$ultima}1")->applyFromArray([
            'font' => ['bold' => true, 'size' => 15, 'color' => ['rgb' => 'FFFFFF']],
            'fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['rgb' => $oscuro]],
            'alignment' => ['vertical' => Alignment::VERTICAL_CENTER, 'indent' => self::logo($h) ? 6 : 1],
        ]);
        $h->getRowDimension(1)->setRowHeight(38);
        // Línea del color de acento bajo la banda.
        $h->getStyle("A2:{$ultima}2")->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB($acento);
        $h->getRowDimension(2)->setRowHeight(4);

        $h->mergeCells("A3:{$ultima}3");
        self::poner($h, 'A3', $this->titulo.($nombre !== $this->titulo ? " · {$nombre}" : ''));
        $h->getStyle('A3')->getFont()->setBold(true)->setSize(14)->getColor()->setRGB($oscuro);
        $h->getRowDimension(3)->setRowHeight(24);
        $fila = 4;
        if ($descripcion) {
            $h->mergeCells("A{$fila}:{$ultima}{$fila}");
            self::poner($h, "A{$fila}", $descripcion);
            $h->getStyle("A{$fila}")->getFont()->setItalic(true)->getColor()->setRGB('6A5D5F');
            $h->getStyle("A{$fila}")->getAlignment()->setWrapText(true)->setVertical(Alignment::VERTICAL_TOP);
            $h->getRowDimension($fila)->setRowHeight(max(16, 15 * ceil(mb_strlen($descripcion) / max(60, $n * 9))));
            $fila++;
        }
        $h->mergeCells("A{$fila}:{$ultima}{$fila}");
        self::poner($h, "A{$fila}", 'Generado el '.now('America/Lima')->format('d/m/Y \a \l\a\s H:i')." por {$this->quien->name}".($this->quien->role ? ' · '.self::rol($this->quien->role) : ''));
        $h->getStyle("A{$fila}")->getFont()->setSize(9)->getColor()->setRGB('6A5D5F');
        $fila += 2;

        // Cifras de resumen: etiqueta pequeña arriba y valor grande abajo, en recuadros.
        if ($resumen) {
            $col = 1;
            // Cada cifra toma las columnas que necesite para tener unos 16 caracteres de ancho, desde la
            // izquierda: así se ven juntas al abrir, aunque la tabla sea muy ancha (una matriz).
            $anchos = array_map(fn ($c) => $c['ancho'] ?? 14, $columnas);
            foreach ($resumen as $etiqueta => $valor) {
                if ($col > $n) {
                    break;
                }
                $hasta = $col;
                $suma = $anchos[$col - 1] ?? 14;
                while ($suma < 16 && $hasta < $n) {
                    $suma += $anchos[$hasta] ?? 14;
                    $hasta++;
                }
                $a = Coordinate::stringFromColumnIndex($col);
                $b = Coordinate::stringFromColumnIndex($hasta);
                $anchoCifra = $hasta - $col + 1;
                $h->mergeCells("{$a}{$fila}:{$b}{$fila}");
                $h->mergeCells("{$a}".($fila + 1).":{$b}".($fila + 1));
                self::poner($h, "{$a}{$fila}", mb_strtoupper((string) $etiqueta));
                self::poner($h, "{$a}".($fila + 1), $valor);
                $h->getStyle("{$a}{$fila}:{$b}".($fila + 1))->applyFromArray([
                    'fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['rgb' => self::suave($primario, 0.08)]],
                    'borders' => ['left' => ['borderStyle' => Border::BORDER_THICK, 'color' => ['rgb' => $primario]]],
                    'alignment' => ['indent' => 1],
                ]);
                $h->getStyle("{$a}{$fila}")->getFont()->setSize(8)->setBold(true)->getColor()->setRGB('6A5D5F');
                $h->getStyle("{$a}".($fila + 1))->getFont()->setSize(16)->setBold(true)->getColor()->setRGB($oscuro);
                $h->getStyle("{$a}".($fila + 1))->getAlignment()->setHorizontal(Alignment::HORIZONTAL_LEFT);
                $col += $anchoCifra;
            }
            $h->getRowDimension($fila + 1)->setRowHeight(24);
            $fila += 3;
        }

        // Encabezados de la tabla.
        $encabezado = $fila;
        $girados = false;
        foreach ($columnas as $i => $c) {
            $letra = Coordinate::stringFromColumnIndex($i + 1);
            self::poner($h, "{$letra}{$fila}", $c['titulo']);
            $h->getColumnDimension($letra)->setWidth($c['ancho'] ?? 14);
            if (! empty($c['girar'])) {
                $h->getStyle("{$letra}{$fila}")->getAlignment()->setTextRotation(90);
                $girados = true;
            }
        }
        $finTabla = Coordinate::stringFromColumnIndex(count($columnas));
        $h->getStyle("A{$fila}:{$finTabla}{$fila}")->applyFromArray([
            'font' => ['bold' => true, 'color' => ['rgb' => 'FFFFFF']],
            'fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['rgb' => $primario]],
            'alignment' => ['vertical' => Alignment::VERTICAL_CENTER, 'horizontal' => Alignment::HORIZONTAL_CENTER, 'wrapText' => true],
            'borders' => ['allBorders' => ['borderStyle' => Border::BORDER_THIN, 'color' => ['rgb' => $primario]]],
        ]);
        $h->getRowDimension($fila)->setRowHeight($girados ? 135 : 30);

        // Filas, alternadas, con su formato por tipo.
        $cuenta = 0;
        foreach ($filas as $valores) {
            $fila++;
            $cuenta++;
            foreach ($columnas as $i => $c) {
                $v = $valores[$i] ?? null;
                $letra = Coordinate::stringFromColumnIndex($i + 1);
                $tipo = $c['tipo'] ?? 'texto';
                if ($tipo === 'marca') {
                    $v = $v ? '●' : '';
                }
                self::poner($h, "{$letra}{$fila}", $v);
                $estilo = $h->getStyle("{$letra}{$fila}");
                match ($tipo) {
                    'numero' => $estilo->getNumberFormat()->setFormatCode('#,##0.###'),
                    'soles' => $estilo->getNumberFormat()->setFormatCode('"S/ "#,##0.00'),
                    'porcentaje' => $estilo->getNumberFormat()->setFormatCode('0.0%'),
                    'fecha' => $estilo->getNumberFormat()->setFormatCode('dd/mm/yyyy'),
                    default => null,
                };
                if (in_array($tipo, ['marca', 'centro'], true)) {
                    $estilo->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
                }
                if ($tipo === 'marca' && $v) {
                    $estilo->getFont()->setBold(true)->getColor()->setRGB('2E7D4F');
                }
            }
            if ($cuenta % 2 === 0) {
                $h->getStyle("A{$fila}:{$finTabla}{$fila}")->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB(self::suave($primario, 0.05));
            }
        }
        $this->filas += $cuenta;
        if ($cuenta) {
            $h->getStyle('A'.($encabezado + 1).":{$finTabla}{$fila}")->applyFromArray([
                'borders' => ['allBorders' => ['borderStyle' => Border::BORDER_THIN, 'color' => ['rgb' => 'E6DCCB']]],
                'alignment' => ['vertical' => Alignment::VERTICAL_CENTER, 'wrapText' => true],
            ]);
            $h->setAutoFilter("A{$encabezado}:{$finTabla}{$fila}");
        } else {
            $fila++;
            $h->mergeCells("A{$fila}:{$finTabla}{$fila}");
            self::poner($h, "A{$fila}", 'Sin registros con esos filtros.');
            $h->getStyle("A{$fila}")->getFont()->setItalic(true)->getColor()->setRGB('6A5D5F');
        }

        // Total de filas y notas al pie de la tabla.
        $fila += 2;
        self::poner($h, "A{$fila}", $cuenta === 1 ? '1 registro' : "{$cuenta} registros");
        $h->getStyle("A{$fila}")->getFont()->setBold(true)->getColor()->setRGB($oscuro);
        if ($notas) {
            $fila++;
            $h->mergeCells("A{$fila}:{$ultima}{$fila}");
            self::poner($h, "A{$fila}", $notas);
            $h->getStyle("A{$fila}")->getFont()->setSize(9)->getColor()->setRGB('6A5D5F');
            $h->getStyle("A{$fila}")->getAlignment()->setWrapText(true);
            $h->getRowDimension($fila)->setRowHeight(max(15, 13 * ceil(mb_strlen($notas) / max(60, $n * 9))));
        }

        // Paneles fijos, impresión en horizontal ajustada al ancho, encabezado repetido y pie con quién exportó.
        $h->freezePane(Coordinate::stringFromColumnIndex($fijas + 1).($encabezado + 1));
        $h->getPageSetup()->setOrientation(PageSetup::ORIENTATION_LANDSCAPE)->setPaperSize(PageSetup::PAPERSIZE_A4)
            ->setFitToWidth(1)->setFitToHeight(0)->setRowsToRepeatAtTopByStartAndEnd($encabezado, $encabezado);
        $h->getPageMargins()->setTop(0.5)->setBottom(0.6)->setLeft(0.4)->setRight(0.4);
        $h->getHeaderFooter()->setOddFooter('&L&8Exportado por '.self::pie($this->quien->name).' · '.now('America/Lima')->format('d/m/Y H:i').'&R&8Página &P de &N');
        $h->setSelectedCell('A1');

        return $this;
    }

    /** Descarga el libro como .xlsx y deja la descarga en la bitácora de accesos. */
    public function descargar(string $archivo): StreamedResponse
    {
        $this->libro->setActiveSheetIndex(0);
        $nombre = preg_replace('/[^a-z0-9-]+/', '-', mb_strtolower($archivo)).'-'.now('America/Lima')->format('Y-m-d').'.xlsx';
        Bitacora::registrar('EXPORT_DOWNLOADED', ['user' => $this->quien, 'detail' => "Exportó «{$this->titulo}» ({$this->filas} filas)",
            'details' => ['report' => $this->titulo, 'file' => $nombre, 'rows' => $this->filas]]);
        $libro = $this->libro;

        return response()->streamDownload(function () use ($libro) {
            (new Xlsx($libro))->save('php://output');
            $libro->disconnectWorksheets();
        }, $nombre, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /* ------------------------------------------------------------------ apoyo */

    /** Colores del tema de la empresa (PLT-06), o los de Aycha. Solo #RRGGBB. */
    private static function colores(): array
    {
        $base = ['primary' => '922242', 'primary_dark' => '6D102B', 'accent' => 'B9781A'];
        $tema = DB::table('ui_themes')->whereNull('brand_id')->where('status', 'ACTIVE')->orderByDesc('created_at')->value('light');
        foreach (array_keys($base) as $k) {
            $c = $tema ? (json_decode($tema, true)[$k] ?? null) : null;
            if (is_string($c) && preg_match('/^#([0-9A-Fa-f]{6})$/', $c, $m)) {
                $base[$k] = strtoupper($m[1]);
            }
        }

        return $base;
    }

    /**
     * Escribe una celda. Los textos van siempre como texto: uno que empiece con «=», «+», «-» o «@»
     * no se convierte en fórmula al abrir el archivo (inyección de fórmulas).
     */
    private static function poner(Worksheet $h, string $celda, mixed $valor): void
    {
        if (is_int($valor) || is_float($valor)) {
            $h->setCellValue($celda, $valor);
        } elseif ($valor !== null && $valor !== '') {
            $h->setCellValueExplicit($celda, (string) $valor, DataType::TYPE_STRING);
        }
    }

    /** Mezcla el color con blanco: 0.05 = muy suave. */
    private static function suave(string $rgb, float $cuanto): string
    {
        return implode('', array_map(fn ($i) => sprintf('%02X', (int) round(255 - (255 - hexdec(substr($rgb, $i, 2))) * $cuanto)), [0, 2, 4]));
    }

    /** Logo del cliente en la banda (PNG o JPG; Excel no muestra WEBP). */
    private static function logo(Worksheet $h): bool
    {
        $archivo = Logos::archivo('cliente', DB::table('tenant_branding')->value('logo_url'));
        if (! $archivo || ! preg_match('/\.(png|jpe?g)$/i', $archivo)) {
            return false;
        }
        $d = new Drawing;
        $d->setPath($archivo)->setHeight(36)->setCoordinates('A1')->setOffsetX(6)->setOffsetY(4)->setWorksheet($h);

        return true;
    }

    private static function rol(string $codigo): string
    {
        return DB::table('roles')->where('code', $codigo)->value('name') ?? $codigo;
    }

    /** Texto seguro para el pie de página (el & tiene significado en los códigos del pie). */
    private static function pie(string $texto): string
    {
        return str_replace('&', '&&', $texto);
    }
}
