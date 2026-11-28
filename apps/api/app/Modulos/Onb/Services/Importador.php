<?php

namespace App\Modulos\Onb\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * ONB · Importadores de datos e inventario inicial (ONB-11, ONB-12 y ONB-13; RN-ONB-08 a 16; CA-ONB-04 a 06).
 */
final class Importador
{
    public const LOTE_FILAS = 500; // RN-ONB-16

    public const DEFINICIONES = [
        'PRODUCTS' => [
            'label' => 'Productos y presentaciones',
            'step' => 'IMPORT_PRODUCTS',
            'perm' => 'onb.import.run',
            'needs' => ['brand'],
            'fields' => [
                ['codigo', 'Código del producto', true],
                ['nombre', 'Nombre del producto', true],
                ['categoria', 'Categoría (código)', true],
                ['sku', 'SKU de la presentación', true],
                ['presentacion', 'Presentación', true],
                ['modo_venta', 'Modo de venta (UNIDAD, KG, PESO_VARIABLE)', true],
                ['peso_nominal_kg', 'Peso nominal (kg)', false],
                ['tolerancia_pct', 'Tolerancia de peso (%)', false],
                ['precio', 'Precio con IGV', true],
                ['costo', 'Costo estándar', false],
                ['requiere_lote', 'Requiere lote (SI/NO)', false],
                ['conservacion', 'Conservación (REFRIGERADO, CONGELADO, AMBIENTE)', false],
                ['vida_util_dias', 'Vida útil (días)', false],
                ['codigo_barras', 'Código de barras', false],
            ],
            'example' => ['CUY-ENT', 'Cuy entero', 'CUY', 'CUY-ENT-09', 'Cuy entero beneficiado', 'PESO_VARIABLE', '0,9', '10', '42', '26,5', 'SI', 'REFRIGERADO', '7', ''],
        ],
        'CUSTOMERS' => [
            'label' => 'Clientes con dirección',
            'step' => 'IMPORT_CUSTOMERS',
            'perm' => 'onb.import.run',
            'needs' => [],
            'fields' => [
                ['tipo_doc', 'Tipo de documento (DNI, RUC, CE, NINGUNO)', false],
                ['num_doc', 'Número de documento', false],
                ['nombre', 'Nombre o razón social', true],
                ['celular', 'Celular (9 dígitos)', true],
                ['correo', 'Correo', false],
                ['direccion', 'Dirección', true],
                ['referencia', 'Referencia', true],
                ['distrito', 'Distrito', false],
                ['lat', 'Latitud', false],
                ['lng', 'Longitud', false],
                ['confianza_geo', 'Confianza de geocodificación (0 a 1)', false],
                ['consentimiento', 'Acepta publicidad (SI/NO)', false],
            ],
            'example' => ['DNI', '45128833', 'Javier Cusi Mamani', '954112233', 'jcusi@correo.pe', 'Av. Benavides 4120 dpto 302', 'Frente al parque Reducto, edificio verde', 'Miraflores', '-12.1260', '-77.0190', '0,93', 'SI'],
        ],
        'SUPPLIERS' => [
            'label' => 'Proveedores',
            'step' => null,
            'perm' => 'onb.import.run',
            'needs' => [],
            'fields' => [
                ['tipo_doc', 'Tipo de documento (RUC, DNI)', true],
                ['num_doc', 'Número de documento', true],
                ['razon_social', 'Razón social', true],
                ['nombre_comercial', 'Nombre comercial', false],
                ['tipo', 'Tipo (PRODUCTOR, INSUMOS, EMPAQUES, SERVICIOS, DELIVERY, OTRO)', false],
                ['plazo_dias', 'Plazo de pago (días)', false],
                ['celular', 'Celular', false],
                ['correo', 'Correo', false],
            ],
            'example' => ['RUC', '20554187237', 'CAMAL SAN PEDRO DE LURÍN SAC', 'Camal San Pedro', 'PRODUCTOR', '15', '987654321', 'ventas@camal.pe'],
        ],
        'PRICES' => [
            'label' => 'Precios',
            'step' => null,
            'perm' => 'onb.import.run',
            'needs' => ['brand'],
            'fields' => [
                ['lista', 'Lista de precios (código)', false],
                ['sku', 'SKU', true],
                ['precio', 'Precio con IGV', true],
                ['base', 'Base (UNIDAD o KG)', true],
                ['vigente_desde', 'Vigente desde (dd/mm/aaaa)', false],
            ],
            'example' => ['PUB', 'CUY-ENT', '43', 'KG', '01/11/2026'],
        ],
        'STOCK' => [
            'label' => 'Stock inicial',
            'step' => 'IMPORT_STOCK',
            'perm' => 'onb.import.run',
            'needs' => ['warehouse', 'cutover'],
            'fields' => [
                ['almacen', 'Almacén (código)', false],
                ['sku', 'SKU', true],
                ['lote', 'Lote', false],
                ['vencimiento', 'Vencimiento (dd/mm/aaaa)', false],
                ['cantidad', 'Cantidad', true],
                ['peso_kg', 'Peso (kg)', false],
                ['costo_unitario', 'Costo unitario', true],
            ],
            'example' => ['CAM-L1', 'CUY-ENT', 'L261030-01', '06/11/2026', '40', '36,4', '26,5'],
        ],
        'CUSTOMER_BALANCES' => [
            'label' => 'Saldos por cobrar',
            'step' => 'IMPORT_BALANCES',
            'perm' => 'onb.balance.import',
            'needs' => ['company', 'cutover'],
            'fields' => [
                ['num_doc', 'Documento del cliente', true],
                ['tipo', 'Tipo (FACTURA, BOLETA, NC, ND, OTRO)', true],
                ['referencia', 'Número del documento', true],
                ['emision', 'Emisión (dd/mm/aaaa)', true],
                ['vencimiento', 'Vencimiento (dd/mm/aaaa)', false],
                ['importe', 'Importe', true],
                ['saldo', 'Saldo', true],
            ],
            'example' => ['20512345678', 'FACTURA', 'F001-00003310', '15/10/2026', '14/11/2026', '1250', '850'],
        ],
        'SUPPLIER_BALANCES' => [
            'label' => 'Saldos por pagar',
            'step' => 'IMPORT_BALANCES',
            'perm' => 'onb.balance.import',
            'needs' => ['company', 'cutover'],
            'fields' => [
                ['num_doc', 'RUC del proveedor', true],
                ['tipo', 'Tipo (FACTURA, BOLETA, NC, ND, OTRO)', true],
                ['referencia', 'Número del documento', true],
                ['emision', 'Emisión (dd/mm/aaaa)', true],
                ['vencimiento', 'Vencimiento (dd/mm/aaaa)', false],
                ['importe', 'Importe', true],
                ['saldo', 'Saldo', true],
            ],
            'example' => ['20554187237', 'FACTURA', 'E001-00000981', '20/10/2026', '04/11/2026', '3200', '3200'],
        ],
    ];

    private const MODOS_VENTA = [
        'UNIDAD' => 'UNIT',
        'UNIT' => 'UNIT',
        'KG' => 'KG',
        'PESO_VARIABLE' => 'UNIT_VARIABLE_WEIGHT',
        'UNIT_VARIABLE_WEIGHT' => 'UNIT_VARIABLE_WEIGHT',
    ];

    private const CONSERVACION = [
        'REFRIGERADO' => 'CHILLED',
        'CONGELADO' => 'FROZEN',
        'AMBIENTE' => 'AMBIENT',
        'CHILLED' => 'CHILLED',
        'FROZEN' => 'FROZEN',
        'AMBIENT' => 'AMBIENT',
    ];

    private const TIPOS_PROVEEDOR = [
        'PRODUCTOR' => 'PRODUCER',
        'INSUMOS' => 'INPUTS',
        'EMPAQUES' => 'PACKAGING',
        'SERVICIOS' => 'SERVICES',
        'DELIVERY' => 'DELIVERY_COMPANY',
        'OTRO' => 'SERVICES',
    ];

    private const TIPOS_DOC_SALDO = [
        'FACTURA' => 'INVOICE',
        'BOLETA' => 'RECEIPT',
        'NC' => 'CREDIT_NOTE',
        'ND' => 'DEBIT_NOTE',
        'OTRO' => 'OTHER',
    ];

    /* ------------------------------------------------------------------ utilidades CSV */

    public static function parseCsv(string $text): array
    {
        $text = preg_replace('/^\xEF\xBB\xBF/', '', $text);
        $firstLine = strtok($text, "\r\n") ?: '';
        $counts = [
            ';' => substr_count($firstLine, ';'),
            "\t" => substr_count($firstLine, "\t"),
            ',' => substr_count($firstLine, ','),
        ];
        arsort($counts);
        $sep = array_key_first($counts) ?: ';';

        $rows = [];
        $row = [];
        $f = '';
        $q = false;
        $len = strlen($text);

        for ($i = 0; $i < $len; $i++) {
            $c = $text[$i];
            if ($q) {
                if ($c === '"') {
                    if ($i + 1 < $len && $text[$i + 1] === '"') {
                        $f .= '"';
                        $i++;
                    } else {
                        $q = false;
                    }
                } else {
                    $f .= $c;
                }
            } elseif ($c === '"') {
                $q = true;
            } elseif ($c === $sep) {
                $row[] = $f;
                $f = '';
            } elseif ($c === "\n" || $c === "\r") {
                if ($c === "\r" && $i + 1 < $len && $text[$i + 1] === "\n") {
                    $i++;
                }
                $row[] = $f;
                $rows[] = $row;
                $row = [];
                $f = '';
            } else {
                $f .= $c;
            }
        }
        if ($f !== '' || ! empty($row)) {
            $row[] = $f;
            $rows[] = $row;
        }

        return array_values(array_filter($rows, fn ($r) => collect($r)->contains(fn ($x) => trim((string) $x) !== '')));
    }

    public static function joinCsv(array $rows): string
    {
        $cell = function ($v): string {
            $s = (string) ($v ?? '');

            return preg_match('/[;"\n,]/', $s) ? '"'.str_replace('"', '""', $s).'"' : $s;
        };

        return implode("\r\n", array_map(fn ($r) => implode(';', array_map($cell, $r)), $rows));
    }

    private static function normalizarClave(string $s): string
    {
        $ascii = strtr(mb_strtolower($s), ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);

        return trim((string) preg_replace('/[^a-z0-9]+/', '_', $ascii), '_');
    }

    public static function autoMapear(string $type, array $headers): array
    {
        $def = self::DEFINICIONES[$type] ?? null;
        if (! $def) {
            return [];
        }
        $hn = array_map(fn ($h) => self::normalizarClave((string) $h), $headers);
        $map = [];
        foreach ($def['fields'] as [$k, $label]) {
            $i = array_search($k, $hn, true);
            if ($i === false) {
                $i = array_search(self::normalizarClave($label), $hn, true);
            }
            if ($i === false) {
                foreach ($hn as $idx => $x) {
                    if ($x !== '' && (str_starts_with($x, $k) || (strlen($x) > 3 && str_starts_with($k, $x)))) {
                        $i = $idx;
                        break;
                    }
                }
            }
            if ($i !== false) {
                $map[$k] = (int) $i;
            }
        }

        return $map;
    }

    private static function numero(mixed $v): ?float
    {
        if ($v === null) {
            return null;
        }
        $s = preg_replace('/\s+/', '', trim((string) $v));
        if ($s === '') {
            return null;
        }
        if (str_contains($s, '.') && str_contains($s, ',')) {
            $s = strrpos($s, ',') > strrpos($s, '.')
                ? str_replace(',', '.', str_replace('.', '', $s))
                : str_replace(',', '', $s);
        } else {
            $s = str_replace(',', '.', $s);
        }

        return is_numeric($s) ? (float) $s : null;
    }

    private static function fechaIso(mixed $v): ?string
    {
        $s = trim((string) ($v ?? ''));
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
            return $s;
        }
        if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/', $s, $m)) {
            $d = str_pad($m[1], 2, '0', STR_PAD_LEFT);
            $mo = str_pad($m[2], 2, '0', STR_PAD_LEFT);

            return checkdate((int) $mo, (int) $d, (int) $m[3]) ? "{$m[3]}-{$mo}-{$d}" : null;
        }

        return null;
    }

    private static function esSi(mixed $v): bool
    {
        return (bool) preg_match('/^(si|sí|s|1|true|x)$/iu', trim((string) ($v ?? '')));
    }

    /* ------------------------------------------------------------------ ONB-11 Subir, plantillas y ejemplos */

    public static function catalogoImportador(): array
    {
        $run = Asistente::corridaActual();
        $imps = DB::table('data_imports as i')
            ->leftJoin('brands as b', 'b.id', '=', 'i.brand_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 'i.warehouse_id')
            ->orderByDesc('i.created_at')
            ->get(['i.*', 'b.name as brand_name', 'w.name as warehouse_name', 'w.code as warehouse_code'])
            ->map(function ($i) {
                $i->type_label = self::DEFINICIONES[$i->import_type]['label'] ?? $i->import_type;
                $i->batches = json_decode((string) $i->batches, true) ?: [];
                $i->opening_lots = json_decode((string) $i->opening_lots, true) ?: [];

                return $i;
            });

        return [
            'types' => collect(self::DEFINICIONES)->map(fn ($d, $k) => [
                'code' => $k,
                'label' => $d['label'],
                'step' => $d['step'],
                'perm' => $d['perm'],
                'needs' => $d['needs'],
                'fields' => array_map(fn ($f) => ['key' => $f[0], 'label' => $f[1], 'required' => $f[2]], $d['fields']),
            ])->values(),
            'max_rows' => (int) (Params::get('onb_import_max_rows') ?? 20000),
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'code', 'name']),
            'warehouses' => DB::table('warehouses')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'allows_sale']),
            'companies' => DB::table('companies')->orderBy('created_at')->get(['id', 'legal_name', 'trade_name', 'ruc']),
            'planned_go_live' => $run->go_live_at ?? $run->planned_go_live ?? now('America/Lima')->addDays(7)->toDateString(),
            'default_cutover' => Carbon::parse($run->go_live_at ?? $run->planned_go_live ?? now('America/Lima'))->subDay()->toDateString(),
            'imports' => $imps,
        ];
    }

    public static function plantillaCsv(string $type): string
    {
        $d = self::DEFINICIONES[$type] ?? RuleError::fail('RN-ONB-08', 'Tipo de importación no válido.');

        return self::joinCsv([
            array_map(fn ($f) => $f[0], $d['fields']),
            $d['example'],
        ]);
    }

    /** Genera un CSV de ejemplo determinista para pruebas y demostración (CA-ONB-04, CA-ONB-05, CA-ONB-06). */
    public static function ejemploCsv(string $type, array $o = []): string
    {
        $d = self::DEFINICIONES[$type] ?? RuleError::fail('RN-ONB-08', 'Tipo de importación no válido.');
        $head = array_map(fn ($f) => $f[0], $d['fields']);
        $rows = [];
        $seed = (int) ($o['seed'] ?? 4242);
        $rng = function () use (&$seed): float {
            $seed = ($seed * 1664525 + 1013904223) % 4294967296;

            return $seed / 4294967296;
        };
        $dec = fn (float $x, int $d2 = 2) => str_replace('.', ',', number_format($x, $d2, '.', ''));

        if ($type === 'PRODUCTS') {
            $cats = DB::table('product_categories')->orderBy('code')->pluck('code')->all();
            if (empty($cats)) {
                RuleError::fail('RN-ONB-08', 'No hay categorías: aplica la plantilla del rubro (ONB-10) antes de importar productos.');
            }
            $n = (int) ($o['n'] ?? 120);
            $nb = (int) ($o['errors'] ?? 3);
            $bad = [];
            for ($b = 0; $b < $nb && $b < $n; $b++) {
                $bad[3 + $b * max(1, intdiv($n - 4, max(1, $nb)))] = $b % 3;
            }
            $names = ['Cuy', 'Conejo', 'Pollo', 'Pato', 'Gallina', 'Cordero', 'Bondiola', 'Panceta', 'Chuleta', 'Lomo', 'Asado', 'Chorizo', 'Jamón', 'Morcilla', 'Caldo', 'Manteca'];
            for ($i = 1; $i <= $n; $i++) {
                $nm = $names[$i % count($names)];
                $mode = $i % 3 === 0 ? 'PESO_VARIABLE' : ($i % 3 === 1 ? 'KG' : 'UNIDAD');
                $row = [
                    'P'.str_pad((string) $i, 3, '0', STR_PAD_LEFT),
                    "{$nm} {$i}",
                    $cats[$i % count($cats)],
                    'IMP-'.str_pad((string) $i, 4, '0', STR_PAD_LEFT),
                    "{$nm} {$i} ".($mode === 'UNIDAD' ? '500 g' : ($mode === 'KG' ? 'por kg' : 'entero')),
                    $mode,
                    $mode === 'PESO_VARIABLE' ? $dec(0.8 + $rng() * 1.5) : '',
                    $mode === 'UNIDAD' ? '' : '10',
                    $dec(15 + floor($rng() * 60)),
                    $dec(8 + floor($rng() * 30)),
                    'SI',
                    'REFRIGERADO',
                    (string) (5 + (int) floor($rng() * 20)),
                    '',
                ];
                if (isset($bad[$i])) {
                    if ($bad[$i] === 0) {
                        $row[8] = '0';
                    } elseif ($bad[$i] === 1) {
                        $row[5] = 'CAJA';
                    } else {
                        $row[2] = 'NO_EXISTE';
                    }
                }
                $rows[] = $row;
            }
        } elseif ($type === 'CUSTOMERS') {
            $n = (int) ($o['n'] ?? 850);
            $noPin = (int) ($o['noPin'] ?? 40);
            $dups = (int) ($o['dups'] ?? 12);
            $first = ['Ana', 'Luis', 'Rosa', 'Jorge', 'Carmen', 'Miguel', 'Lucía', 'Pedro', 'Elena', 'Raúl', 'Sofía', 'Diego', 'Marta', 'Iván', 'Julia', 'César'];
            $last = ['Quispe', 'Huamán', 'Rojas', 'Flores', 'Torres', 'Ramos', 'Vargas', 'Chávez', 'Castillo', 'Mendoza', 'Salazar', 'Paredes', 'Cárdenas', 'León'];
            $dists = ['Santiago de Surco', 'Miraflores', 'San Borja', 'La Molina', 'San Isidro', 'Barranco', 'Chorrillos', 'Surquillo'];
            $uniq = $n - $dups;
            $phones = [];
            $lowCount = 0;
            $stepNoPin = $noPin > 0 ? max(1, intdiv($uniq, $noPin)) : 999999;

            for ($i = 1; $i <= $n; $i++) {
                if ($i > $uniq) {
                    $ph = $phones[(($i - $uniq - 1) * 7) % count($phones)];
                } else {
                    $ph = '9'.str_pad((string) ((10000000 + $i * 104729) % 89999999), 8, '0', STR_PAD_LEFT);
                    $phones[] = $ph;
                }
                $lowConf = $i <= $uniq && $noPin > 0 && ($i % $stepNoPin === 0) && $lowCount < $noPin;
                if ($lowConf) {
                    $lowCount++;
                }
                $rows[] = [
                    $i % 5 === 0 ? 'NINGUNO' : 'DNI',
                    $i % 5 === 0 ? '' : (string) (40000000 + $i * 7919),
                    $first[$i % count($first)].' '.$last[($i * 7) % count($last)].' '.$last[($i * 3) % count($last)],
                    $ph,
                    $i % 3 ? '' : "cliente{$i}@correo.pe",
                    "Calle {$i} n.° ".(100 + ($i % 900)),
                    'Frente al parque '.(($i % 40) + 1).', puerta verde',
                    $dists[$i % count($dists)],
                    number_format(-12.08 - $rng() * 0.12, 5, '.', ''),
                    number_format(-76.95 - $rng() * 0.10, 5, '.', ''),
                    $lowConf ? '0,55' : '0,93',
                    $i % 4 ? 'SI' : 'NO',
                ];
            }
        } elseif ($type === 'STOCK') {
            $vs = DB::table('product_variants')->where('status', 'ACTIVE')->where('sellable', true)->orderBy('sku')->get();
            if ($vs->isEmpty()) {
                RuleError::fail('RN-ONB-08', 'No hay productos: importa o aplica la plantilla antes del stock.');
            }
            $whs = ! empty($o['warehouses'])
                ? (array) $o['warehouses']
                : DB::table('warehouses')->where('allows_sale', true)->where('status', 'ACTIVE')->orderBy('code')->limit(2)->pluck('code')->all();
            if (empty($whs)) {
                RuleError::fail('RN-ONB-08', 'No hay almacenes de venta (ONB-05).');
            }
            $n = (int) ($o['lots'] ?? 230);
            $cut = (string) ($o['cutover'] ?? '2026-10-31');
            $cutCarbon = Carbon::parse($cut);
            for ($i = 1; $i <= $n; $i++) {
                $v = $vs[$i % $vs->count()];
                $q = $v->sale_mode === 'KG' ? (5 + (int) floor($rng() * 30)) : (4 + (int) floor($rng() * 40));
                $exp = $cutCarbon->copy()->addDays(5 + (int) floor($rng() * 60))->format('d/m/Y');
                $rows[] = [
                    $whs[$i % count($whs)],
                    $v->sku,
                    'AP'.substr($cut, 2, 2).substr($cut, 5, 2).'-'.str_pad((string) $i, 3, '0', STR_PAD_LEFT),
                    $exp,
                    (string) $q,
                    $v->sale_mode === 'UNIT_VARIABLE_WEIGHT' ? $dec($q * ((float) ($v->nominal_weight_kg ?: 1)), 3) : '',
                    $dec((float) ($v->std_cost ?: 10)),
                ];
            }
        } elseif ($type === 'PRICES') {
            $q = DB::table('product_variants')->where('sellable', true)->where('status', 'ACTIVE');
            if (! empty($o['brand_id'])) {
                $q->where('brand_id', $o['brand_id']);
            }
            foreach ($q->limit(30)->get() as $v) {
                $rows[] = ['PUB', $v->sku, $dec(round(((float) ($v->std_cost ?: 15)) * 1.45, 1)), $v->sale_mode === 'UNIT' ? 'UNIDAD' : 'KG', Carbon::parse($o['cutover'] ?? now())->addDay()->format('d/m/Y')];
            }
            if (! empty($rows)) {
                $rows[] = ['PUB', 'SKU-INEXISTENTE', '10', 'UNIDAD', ''];
            }
        } elseif ($type === 'CUSTOMER_BALANCES') {
            $cs = DB::table('customers')->whereNotNull('doc_number')->where('status', 'ACTIVE')->limit((int) ($o['n'] ?? 25))->get();
            $cut = Carbon::parse($o['cutover'] ?? now());
            foreach ($cs as $i => $c) {
                $amt = 200 + (int) floor($rng() * 1800);
                $rows[] = [
                    $c->doc_number,
                    $c->doc_type === 'RUC' ? 'FACTURA' : 'BOLETA',
                    ($c->doc_type === 'RUC' ? 'F001' : 'B001').'-'.str_pad((string) (3100 + $i), 8, '0', STR_PAD_LEFT),
                    $cut->copy()->subDays(10 + $i)->format('d/m/Y'),
                    $cut->copy()->addDays(20 - $i)->format('d/m/Y'),
                    (string) $amt,
                    (string) ($i === 3 ? $amt + 50 : round($amt * (0.3 + $rng() * 0.7))),
                ];
            }
        } elseif ($type === 'SUPPLIERS') {
            $ejemplos = [
                ['20554187237', 'CAMAL SAN PEDRO DE LURÍN SAC', 'PRODUCTOR', 15],
                ['20500118731', 'EMPAQUES Y BOLSAS DEL PERÚ SAC', 'EMPAQUES', 30],
                ['20522199748', 'INSUMOS CÁRNICOS LIMA SAC', 'INSUMOS', 30],
            ];
            foreach ($ejemplos as [$ruc, $razon, $t, $dias]) {
                $rows[] = ['RUC', $ruc, $razon, explode(' ', $razon)[0].' '.explode(' ', $razon)[1], $t, (string) $dias, '987654321', ''];
            }
            $rows[] = ['RUC', '20123456780', 'PROVEEDOR CON RUC ERRADO SAC', '', 'OTRO', '0', '', ''];
        } elseif ($type === 'SUPPLIER_BALANCES') {
            $sups = DB::table('suppliers')->where('status', 'ACTIVE')->limit(6)->get();
            $cut = Carbon::parse($o['cutover'] ?? now());
            foreach ($sups as $i => $s) {
                $amt = 500 + (int) floor($rng() * 4000);
                $rows[] = [
                    $s->doc_number,
                    'FACTURA',
                    'E001-'.str_pad((string) (900 + $i), 8, '0', STR_PAD_LEFT),
                    $cut->copy()->subDays(8 + $i)->format('d/m/Y'),
                    $cut->copy()->addDays(15)->format('d/m/Y'),
                    (string) $amt,
                    (string) $amt,
                ];
            }
        }

        return self::joinCsv([$head, ...$rows]);
    }

    /** ONB-11: sube el CSV, verifica duplicado por SHA-256 (RN-ONB-09), tope de filas (RN-ONB-12) y valida cada fila (ONB-12). */
    public static function crearYValidar(array $d, User $u): array
    {
        $type = strtoupper(trim((string) ($d['type'] ?? '')));
        $def = self::DEFINICIONES[$type] ?? RuleError::fail('RN-ONB-08', 'Tipo de importación no válido.');
        if (! Access::can($u, $def['perm'])) {
            RuleError::fail('RN-SEG-01', "No tienes el permiso {$def['perm']}.");
        }

        $run = Asistente::corridaActual();
        if ($def['step']) {
            Asistente::exigirPrerrequisitos($run, $def['step']);
        }

        $content = (string) ($d['content'] ?? '');
        $rows = self::parseCsv($content);
        if (count($rows) < 2) {
            RuleError::fail('RN-ONB-08', 'El archivo no tiene filas de datos (la fila 1 es la cabecera).');
        }
        $max = (int) (Params::get('onb_import_max_rows') ?? 20000);
        if (count($rows) - 1 > $max) {
            RuleError::fail('RN-ONB-12', 'El archivo tiene '.(count($rows) - 1)." filas y el máximo es {$max} (onb_import_max_rows): divídelo en partes.");
        }

        $hash = hash('sha256', $content);
        $dup = DB::table('data_imports')
            ->where('file_hash', $hash)
            ->where('import_type', $type)
            ->where('status', '<>', 'CANCELLED')
            ->first();
        if ($dup) {
            RuleError::fail('RN-ONB-09', "Este archivo ya se importó ({$dup->file_name}): no se importa dos veces salvo que se cancele o revierta la anterior.");
        }

        if (in_array('warehouse', $def['needs'], true) && empty($d['warehouse_id'])) {
            RuleError::fail('RN-ONB-10', 'El stock inicial exige el almacén por defecto.');
        }
        if (in_array('cutover', $def['needs'], true) && empty($d['cutover_date'])) {
            RuleError::fail('RN-ONB-10', 'Indica la fecha de corte.');
        }
        if (in_array('company', $def['needs'], true) && empty($d['company_id'])) {
            RuleError::fail('RN-ONB-10', 'Los saldos exigen la empresa.');
        }
        if (in_array('brand', $def['needs'], true) && empty($d['brand_id'])) {
            RuleError::fail('RN-ONB-08', 'Elige la marca.');
        }

        $goLiveRef = $run->go_live_at ?? $run->planned_go_live;
        if ($type === 'STOCK' && $goLiveRef && $d['cutover_date'] >= substr((string) $goLiveRef, 0, 10)) {
            RuleError::fail('RN-ONB-15', "La fecha de corte ({$d['cutover_date']}) debe ser anterior al primer día de operación (".substr((string) $goLiveRef, 0, 10).').');
        }

        $headers = array_map(fn ($x) => trim((string) $x), $rows[0]);
        $map = ! empty($d['map']) && is_array($d['map']) ? $d['map'] : self::autoMapear($type, $headers);
        $missing = [];
        foreach ($def['fields'] as [$k, $label, $req]) {
            if ($req && (! array_key_exists($k, $map) || $map[$k] === '' || $map[$k] === null)) {
                $missing[] = $label;
            }
        }

        $impId = DB::transaction(function () use ($run, $type, $def, $d, $content, $hash, $headers, $map, $rows, $missing, $u) {
            $fileName = mb_substr(trim((string) ($d['file_name'] ?? strtolower($type).'.csv')), 0, 160);
            $fileId = DB::table('file_attachments')->insertGetId([
                'module_code' => 'ONB',
                'entity_type' => 'data_imports',
                'entity_id' => null,
                'storage_key' => 'onb/'.substr($hash, 0, 16),
                'file_name' => $fileName,
                'mime_type' => 'text/csv',
                'size_bytes' => strlen($content),
                'sha256' => $hash,
                'classification' => in_array($type, ['CUSTOMERS', 'CUSTOMER_BALANCES'], true) ? 'PERSONAL_DATA' : 'INTERNAL',
                'status' => 'ACTIVE',
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');

            $impId = DB::table('data_imports')->insertGetId([
                'run_id' => $run->id,
                'import_type' => $type,
                'file_id' => $fileId,
                'file_hash' => $hash,
                'file_name' => $fileName,
                'template_version' => 'v1',
                'company_id' => $d['company_id'] ?? $run->company_id,
                'brand_id' => $d['brand_id'] ?? null,
                'warehouse_id' => $d['warehouse_id'] ?? null,
                'cutover_date' => $d['cutover_date'] ?? null,
                'mode' => $d['mode'] ?? 'INSERT_ONLY',
                'allow_partial' => false,
                'status' => $missing ? 'FAILED_VALIDATION' : 'UPLOADED',
                'file_error' => $missing ? 'Faltan columnas obligatorias: '.implode(', ', $missing) : null,
                'headers' => json_encode($headers, JSON_UNESCAPED_UNICODE),
                'map' => json_encode($map, JSON_UNESCAPED_UNICODE),
                'total_rows' => count($rows) - 1,
                'created_by' => mb_substr($u->name, 0, 120),
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');

            DB::table('file_attachments')->where('id', $fileId)->update(['entity_id' => $impId]);

            $lotesInsert = [];
            foreach (array_slice($rows, 1) as $idx => $r) {
                $raw = [];
                foreach ($def['fields'] as [$k]) {
                    $colIdx = $map[$k] ?? null;
                    $raw[$k] = ($colIdx !== null && $colIdx !== '' && isset($r[(int) $colIdx])) ? trim((string) $r[(int) $colIdx]) : '';
                }
                $lotesInsert[] = [
                    'import_id' => $impId,
                    'row_no' => $idx + 2,
                    'raw' => json_encode($raw, JSON_UNESCAPED_UNICODE),
                    'status' => 'PENDING',
                    'errors' => '[]',
                    'created_at' => now(),
                ];
                if (count($lotesInsert) >= 500) {
                    DB::table('data_import_rows')->insert($lotesInsert);
                    $lotesInsert = [];
                }
            }
            if (! empty($lotesInsert)) {
                DB::table('data_import_rows')->insert($lotesInsert);
            }

            return $impId;
        });

        if (empty($missing)) {
            self::validar($impId);
        }

        return self::ver($impId);
    }

    /* ------------------------------------------------------------------ ONB-12 Validación por fila */

    public static function validar(string $impId): array
    {
        $imp = DB::table('data_imports')->where('id', $impId)->first()
            ?? RuleError::fail('RN-ONB-08', 'Importación no encontrada.');
        if (! in_array($imp->status, ['UPLOADED', 'VALIDATED', 'FAILED_VALIDATION'], true)) {
            RuleError::fail('RN-ONB-08', 'Solo se valida una importación que no se ha ejecutado.');
        }

        DB::table('data_imports')->where('id', $imp->id)->update(['status' => 'VALIDATING', 'updated_at' => now()]);

        $ctx = self::contextoValidacion($imp);
        $filas = DB::table('data_import_rows')->where('import_id', $imp->id)->orderBy('row_no')->get();
        $v = 0;
        $w = 0;
        $e = 0;

        DB::transaction(function () use ($imp, $filas, &$ctx, &$v, &$w, &$e) {
            foreach ($filas as $row) {
                $raw = json_decode((string) $row->raw, true) ?: [];
                $res = self::validarFila($imp, (int) $row->row_no, $raw, $ctx);
                $hasError = collect($res['errors'])->contains(fn ($x) => $x['level'] === 'ERROR');
                $status = $hasError ? 'ERROR' : (! empty($res['errors']) ? 'WARNING' : 'VALID');
                if ($status === 'ERROR') {
                    $e++;
                } elseif ($status === 'WARNING') {
                    $w++;
                } else {
                    $v++;
                }

                DB::table('data_import_rows')->where('id', $row->id)->update([
                    'status' => $status,
                    'errors' => json_encode($res['errors'], JSON_UNESCAPED_UNICODE),
                    'norm' => json_encode($res['norm'], JSON_UNESCAPED_UNICODE),
                    'dup_of' => $res['dup_of'],
                ]);
            }

            DB::table('data_imports')->where('id', $imp->id)->update([
                'status' => ($v + $w > 0) ? 'VALIDATED' : 'FAILED_VALIDATION',
                'valid_rows' => $v,
                'warning_rows' => $w,
                'error_rows' => $e,
                'validated_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return self::ver($imp->id);
    }

    private static function contextoValidacion(object $imp): array
    {
        $ctx = [
            'seen' => [],
            'variants' => DB::table('product_variants')->get()->keyBy(fn ($v) => strtoupper($v->sku)),
            'products' => DB::table('products')->get()->keyBy('id'),
            'cats' => DB::table('product_categories')->get()->keyBy(fn ($c) => strtoupper($c->code)),
            'whs' => DB::table('warehouses')->get()->keyBy(fn ($w) => strtoupper($w->code)),
            'custDoc' => [],
            'custPhone' => [],
            'sups' => [],
            'obRefs' => [],
            'lists' => [],
        ];

        if (in_array($imp->import_type, ['CUSTOMERS', 'CUSTOMER_BALANCES'], true)) {
            foreach (DB::table('customers')->where('status', '<>', 'VOIDED')->get(['id', 'doc_number', 'phone', 'full_name']) as $c) {
                if ($c->doc_number) {
                    $ctx['custDoc'][$c->doc_number] = $c;
                }
                if ($c->phone) {
                    $ctx['custPhone'][$c->phone] = $c;
                }
            }
        }
        if (in_array($imp->import_type, ['SUPPLIERS', 'SUPPLIER_BALANCES'], true)) {
            foreach (DB::table('suppliers')->where('status', '<>', 'VOIDED')->get(['id', 'doc_number', 'legal_name']) as $s) {
                $ctx['sups'][$s->doc_number] = $s;
            }
        }
        if (in_array($imp->import_type, ['CUSTOMER_BALANCES', 'SUPPLIER_BALANCES'], true)) {
            foreach (DB::table('opening_balances')->where('status', '<>', 'VOIDED')->get(['party_type', 'customer_id', 'supplier_id', 'doc_reference']) as $ob) {
                $k = $ob->party_type.'|'.($ob->customer_id ?: $ob->supplier_id).'|'.$ob->doc_reference;
                $ctx['obRefs'][$k] = true;
            }
        }
        if ($imp->import_type === 'PRICES' && $imp->brand_id) {
            $ctx['lists'] = DB::table('price_lists')->where('brand_id', $imp->brand_id)->get()->keyBy(fn ($l) => strtoupper($l->code));
        }

        return $ctx;
    }

    private static function validarFila(object $imp, int $rowNo, array $r, array &$c): array
    {
        $errs = [];
        $n = [];
        $dupOf = null;
        $E = function (string $col, string $msg) use (&$errs) {
            $errs[] = ['col' => $col, 'msg' => $msg, 'level' => 'ERROR'];
        };
        $W = function (string $col, string $msg) use (&$errs) {
            $errs[] = ['col' => $col, 'msg' => $msg, 'level' => 'WARNING'];
        };

        $def = self::DEFINICIONES[$imp->import_type];
        foreach ($def['fields'] as [$k, $label, $req]) {
            if ($req && trim((string) ($r[$k] ?? '')) === '') {
                $E($k, "{$label}: dato obligatorio.");
            }
        }

        $T = $imp->import_type;
        if ($T === 'PRODUCTS') {
            $modeKey = strtoupper(trim((string) ($r['modo_venta'] ?? '')));
            $mode = self::MODOS_VENTA[$modeKey] ?? null;
            if ($modeKey !== '' && ! $mode) {
                $E('modo_venta', "Modo «{$r['modo_venta']}» no válido: usa UNIDAD, KG o PESO_VARIABLE.");
            }
            $catCode = strtoupper(trim((string) ($r['categoria'] ?? '')));
            $cat = $c['cats'][$catCode] ?? null;
            if ($catCode !== '' && ! $cat) {
                $E('categoria', "La categoría {$r['categoria']} no existe: créala o aplica la plantilla del rubro.");
            }
            $price = self::numero($r['precio'] ?? null);
            if (($r['precio'] ?? '') !== '' && ! ($price > 0)) {
                $E('precio', 'El precio debe ser mayor que 0.');
            }
            $kg = self::numero($r['peso_nominal_kg'] ?? null);
            if ($mode === 'UNIT_VARIABLE_WEIGHT' && ! ($kg > 0)) {
                $E('peso_nominal_kg', 'Un producto de peso variable necesita el peso nominal.');
            }
            $stKey = strtoupper(trim((string) ($r['conservacion'] ?? '')));
            $st = $stKey !== '' ? (self::CONSERVACION[$stKey] ?? null) : 'CHILLED';
            if (! $st) {
                $E('conservacion', 'Usa REFRIGERADO, CONGELADO o AMBIENTE.');
            }
            $sku = strtoupper(trim((string) ($r['sku'] ?? '')));
            if ($sku !== '') {
                if (isset($c['seen'][$sku])) {
                    $E('sku', 'SKU repetido en la fila '.$c['seen'][$sku].'.');
                } else {
                    $c['seen'][$sku] = $rowNo;
                }
                if (isset($c['variants'][$sku])) {
                    if ($imp->mode === 'UPSERT') {
                        $W('sku', 'Ya existe: se actualizará el precio, el costo y el nombre.');
                    } else {
                        $W('sku', 'Ya existe: se omite (modo solo nuevos).');
                        $dupOf = $c['variants'][$sku]->id;
                    }
                }
            }
            $tol = self::numero($r['tolerancia_pct'] ?? null);
            $cost = self::numero($r['costo'] ?? null);
            $shelf = self::numero($r['vida_util_dias'] ?? null);
            $n = [
                'mode' => $mode,
                'cat' => $cat?->id,
                'line' => $cat?->line,
                'price' => $price,
                'kg' => ($kg > 0) ? $kg : null,
                'tol' => ($tol > 0) ? $tol : ($mode === 'UNIT' ? null : 10),
                'cost' => ($cost > 0) ? $cost : 0,
                'lot' => ($r['requiere_lote'] ?? '') !== '' ? self::esSi($r['requiere_lote']) : true,
                'storage' => $st ?: 'CHILLED',
                'shelf' => ($shelf > 0) ? (int) $shelf : 7,
                'sku' => $sku,
            ];
        } elseif ($T === 'CUSTOMERS') {
            $dn = preg_replace('/\s+/', '', (string) ($r['num_doc'] ?? ''));
            $dt = strtoupper(trim((string) ($r['tipo_doc'] ?: ($dn !== '' ? 'DNI' : 'NINGUNO'))));
            if ($dt === 'DNI' && ! preg_match('/^\d{8}$/', $dn)) {
                $E('num_doc', 'El DNI tiene 8 dígitos.');
            }
            if ($dt === 'RUC' && ! Ruc::valido($dn)) {
                $E('num_doc', 'El RUC no cumple el dígito verificador.');
            }
            if ($dt === 'CE' && ! preg_match('/^[A-Z0-9]{8,12}$/i', $dn)) {
                $E('num_doc', 'El carné de extranjería tiene de 8 a 12 caracteres.');
            }
            $ph = preg_replace('/\D/', '', (string) ($r['celular'] ?? ''));
            if (strlen($ph) === 11 && str_starts_with($ph, '51')) {
                $ph = substr($ph, 2);
            }
            if (($r['celular'] ?? '') !== '' && ! preg_match('/^9\d{8}$/', $ph)) {
                $E('celular', 'El celular tiene 9 dígitos y empieza con 9.');
            }
            $prefix = (string) (Params::get('onb_import_phone_prefix') ?? '+51');
            $phone = preg_match('/^9\d{8}$/', $ph) ? ($prefix ?: '+51').$ph : null;
            if (! empty($r['correo']) && ! filter_var($r['correo'], FILTER_VALIDATE_EMAIL)) {
                $E('correo', 'Correo no válido.');
            }
            $minRef = (int) (Params::get('cli_min_reference_chars') ?? 10);
            if (! empty($r['direccion']) && mb_strlen(trim((string) ($r['referencia'] ?? ''))) < $minRef) {
                $E('referencia', "La dirección exige una referencia de al menos {$minRef} caracteres.");
            }
            $conf = self::numero($r['confianza_geo'] ?? null);
            $lat = self::numero($r['lat'] ?? null);
            $lng = self::numero($r['lng'] ?? null);
            $minConf = (float) (Params::get('onb_geocode_min_confidence') ?? 0.8);
            $pin = $lat !== null && $lng !== null && $conf !== null && $conf >= $minConf;
            if (! empty($r['direccion']) && ! $pin) {
                $W('lat', 'Sin pin: confianza menor que '.number_format($minConf, 1).'; se pedirá el pin en el primer pedido.');
            }
            $kDoc = ($dn !== '' && $dt !== 'NINGUNO') ? $dn : null;
            if ($kDoc && isset($c['custDoc'][$kDoc])) {
                $W('num_doc', "Duplicado: ya existe {$c['custDoc'][$kDoc]->full_name} con el documento {$kDoc}; no se crea otro cliente.");
                $dupOf = $c['custDoc'][$kDoc]->id;
            } elseif ($phone && isset($c['custPhone'][$phone])) {
                $W('celular', "Duplicado por celular con {$c['custPhone'][$phone]->full_name}: no se crea otro cliente.");
                $dupOf = $c['custPhone'][$phone]->id;
            } elseif ($kDoc && isset($c['seen']['D'.$kDoc])) {
                $W('num_doc', 'Duplicado por documento con la fila '.$c['seen']['D'.$kDoc].': no se crea otro cliente.');
                $dupOf = 'row:'.$c['seen']['D'.$kDoc];
            } elseif ($phone && isset($c['seen']['P'.$phone])) {
                $W('celular', 'Duplicado por celular con la fila '.$c['seen']['P'.$phone].': no se crea otro cliente.');
                $dupOf = 'row:'.$c['seen']['P'.$phone];
            }
            if (! $dupOf) {
                if ($kDoc) {
                    $c['seen']['D'.$kDoc] = $rowNo;
                }
                if ($phone) {
                    $c['seen']['P'.$phone] = $rowNo;
                }
            }
            $n = [
                'doc_type' => $dt === 'NINGUNO' ? 'NONE' : $dt,
                'doc_number' => $kDoc,
                'phone' => $phone,
                'pin' => $pin,
                'lat' => $pin ? $lat : null,
                'lng' => $pin ? $lng : null,
                'conf' => $conf,
                'optin' => self::esSi($r['consentimiento'] ?? ''),
            ];
        } elseif ($T === 'SUPPLIERS') {
            $dt = strtoupper(trim((string) ($r['tipo_doc'] ?: 'RUC')));
            $dn = trim((string) ($r['num_doc'] ?? ''));
            if ($dt === 'RUC' && ! Ruc::valido($dn)) {
                $E('num_doc', 'El RUC no cumple el dígito verificador.');
            }
            if ($dt === 'DNI' && ! preg_match('/^\d{8}$/', $dn)) {
                $E('num_doc', 'El DNI tiene 8 dígitos.');
            }
            if ($dn !== '' && isset($c['sups'][$dn])) {
                $W('num_doc', 'El proveedor ya existe: se omite.');
                $dupOf = $c['sups'][$dn]->id;
            } elseif ($dn !== '' && isset($c['seen'][$dn])) {
                $E('num_doc', 'Repetido en la fila '.$c['seen'][$dn].'.');
            } elseif ($dn !== '') {
                $c['seen'][$dn] = $rowNo;
            }
            $tpKey = strtoupper(trim((string) ($r['tipo'] ?? '')));
            $tp = $tpKey !== '' ? (self::TIPOS_PROVEEDOR[$tpKey] ?? null) : 'SERVICES';
            if (! $tp) {
                $E('tipo', 'Tipo de proveedor no válido.');
            }
            $terms = self::numero($r['plazo_dias'] ?? null);
            $n = [
                'doc_type' => $dt,
                'tp' => $tp ?: 'SERVICES',
                'terms' => ($terms !== null && $terms >= 0) ? (int) $terms : 0,
            ];
        } elseif ($T === 'PRICES') {
            $sku = strtoupper(trim((string) ($r['sku'] ?? '')));
            $v = $c['variants'][$sku] ?? null;
            if ($sku !== '' && ! $v) {
                $E('sku', "El SKU {$r['sku']} no existe en el catálogo.");
            }
            if ($v && $imp->brand_id && $v->brand_id !== $imp->brand_id) {
                $E('sku', "El SKU {$r['sku']} es de otra marca.");
            }
            $price = self::numero($r['precio'] ?? null);
            if (($r['precio'] ?? '') !== '' && ! ($price > 0)) {
                $E('precio', 'El precio debe ser mayor que 0.');
            }
            $basisKey = strtoupper(trim((string) ($r['base'] ?? '')));
            $basis = ['UNIDAD' => 'UNIT', 'UNIT' => 'UNIT', 'KG' => 'KG'][$basisKey] ?? null;
            if ($basisKey !== '' && ! $basis) {
                $E('base', 'Usa UNIDAD o KG.');
            }
            if ($v && $basis && (($v->sale_mode === 'UNIT') !== ($basis === 'UNIT'))) {
                $E('base', 'La presentación usa la base '.($v->sale_mode === 'UNIT' ? 'UNIDAD' : 'KG').'.');
            }
            $lc = strtoupper(trim((string) ($r['lista'] ?: 'PUB')));
            $list = $c['lists'][$lc] ?? null;
            if (! $list && $lc !== 'PUB') {
                $E('lista', "La lista {$lc} no existe para la marca.");
            }
            $from = ! empty($r['vigente_desde'])
                ? self::fechaIso($r['vigente_desde'])
                : ($imp->cutover_date ? Carbon::parse($imp->cutover_date)->addDay()->toDateString() : now('America/Lima')->toDateString());
            if (! empty($r['vigente_desde']) && ! $from) {
                $E('vigente_desde', 'Fecha no válida (dd/mm/aaaa).');
            }
            if ($v) {
                $k = $v->id.'|'.$lc;
                if (isset($c['seen'][$k])) {
                    $E('sku', 'Precio repetido en la fila '.$c['seen'][$k].'.');
                } else {
                    $c['seen'][$k] = $rowNo;
                }
            }
            $n = [
                'variant_id' => $v?->id,
                'price' => $price,
                'basis' => $basis,
                'list_id' => $list?->id,
                'list_code' => $lc,
                'from' => $from,
            ];
        } elseif ($T === 'STOCK') {
            $sku = strtoupper(trim((string) ($r['sku'] ?? '')));
            $v = $c['variants'][$sku] ?? null;
            if ($sku !== '' && ! $v) {
                $E('sku', "El SKU {$r['sku']} no existe: importa primero los productos.");
            }
            $whc = strtoupper(trim((string) ($r['almacen'] ?? '')));
            $wh = $whc !== '' ? ($c['whs'][$whc] ?? null) : ($imp->warehouse_id ? DB::table('warehouses')->where('id', $imp->warehouse_id)->first() : null);
            if (! $wh) {
                $E('almacen', "El almacén {$r['almacen']} no existe.");
            }
            $prod = $v ? ($c['products'][$v->product_id] ?? null) : null;
            $exp = ! empty($r['vencimiento']) ? self::fechaIso($r['vencimiento']) : null;
            if (! empty($r['vencimiento']) && ! $exp) {
                $E('vencimiento', 'Fecha no válida (dd/mm/aaaa).');
            }
            if ($prod && $prod->requires_lot && (empty($r['lote']) || ! $exp)) {
                $E(empty($r['lote']) ? 'lote' : 'vencimiento', 'El producto lleva lote: el lote y el vencimiento son obligatorios.');
            }
            if ($exp && $imp->cutover_date && $exp < substr((string) $imp->cutover_date, 0, 10)) {
                $W('vencimiento', 'El lote ya estaba vencido a la fecha de corte.');
            }
            $qty = self::numero($r['cantidad'] ?? null);
            if (($r['cantidad'] ?? '') !== '' && ! ($qty > 0)) {
                $E('cantidad', 'La cantidad debe ser mayor que 0.');
            }
            $cost = self::numero($r['costo_unitario'] ?? null);
            if (($r['costo_unitario'] ?? '') !== '' && ! ($cost > 0)) {
                $E('costo_unitario', 'El costo unitario debe ser mayor que 0.');
            }
            $w = self::numero($r['peso_kg'] ?? null);
            if ($v && $v->sale_mode === 'UNIT_VARIABLE_WEIGHT' && ! ($w > 0)) {
                $w = round(($qty ?: 0) * ((float) ($v->nominal_weight_kg ?: 0)), 3);
                $W('peso_kg', "Sin peso: se usa el nominal ({$w} kg).");
            }
            $k = ($wh?->id ?? '').'|'.($v?->id ?? '').'|'.($r['lote'] ?? '');
            if (isset($c['seen'][$k])) {
                $E('lote', 'Lote repetido en el mismo almacén (fila '.$c['seen'][$k].').');
            } else {
                $c['seen'][$k] = $rowNo;
            }
            $n = [
                'variant_id' => $v?->id,
                'wh' => $wh?->id,
                'lot' => ! empty($r['lote']) ? $r['lote'] : null,
                'exp' => $exp,
                'qty' => $qty,
                'weight' => ($v && $v->sale_mode === 'KG') ? $qty : (($w > 0) ? $w : null),
                'cost' => $cost,
            ];
        } elseif ($T === 'CUSTOMER_BALANCES' || $T === 'SUPPLIER_BALANCES') {
            $cust = $T === 'CUSTOMER_BALANCES';
            $dn = trim((string) ($r['num_doc'] ?? ''));
            $party = $cust ? ($c['custDoc'][$dn] ?? null) : ($c['sups'][$dn] ?? null);
            if ($dn !== '' && ! $party) {
                $E('num_doc', $cust ? "No existe el cliente con documento {$dn}: impórtalo primero." : "No existe el proveedor {$dn}.");
            }
            $dtKey = strtoupper(trim((string) ($r['tipo'] ?? '')));
            $dt = self::TIPOS_DOC_SALDO[$dtKey] ?? null;
            if ($dtKey !== '' && ! $dt) {
                $E('tipo', 'Usa FACTURA, BOLETA, NC, ND u OTRO.');
            }
            $iss = self::fechaIso($r['emision'] ?? null);
            $due = ! empty($r['vencimiento']) ? self::fechaIso($r['vencimiento']) : null;
            if (! empty($r['emision']) && ! $iss) {
                $E('emision', 'Fecha no válida.');
            }
            if ($due && $iss && $due < $iss) {
                $E('vencimiento', 'El vencimiento no es anterior a la emisión.');
            }
            if ($iss && $imp->cutover_date && $iss > substr((string) $imp->cutover_date, 0, 10)) {
                $W('emision', 'Emitido después de la fecha de corte.');
            }
            $amt = self::numero($r['importe'] ?? null);
            $bal = self::numero($r['saldo'] ?? null);
            if (($r['importe'] ?? '') !== '' && ! ($amt > 0)) {
                $E('importe', 'El importe debe ser positivo.');
            }
            if (($r['saldo'] ?? '') !== '' && ($bal === null || $bal < 0 || ($amt !== null && $bal > $amt + 0.005))) {
                $E('saldo', 'El saldo va de 0 al importe.');
            }
            $k = ($cust ? 'CUSTOMER' : 'SUPPLIER').'|'.($party?->id ?? '').'|'.($r['referencia'] ?? '');
            if ($party && (isset($c['obRefs'][$k]) || isset($c['seen'][$k]))) {
                $E('referencia', 'El documento ya tiene saldo inicial.');
            } else {
                $c['seen'][$k] = $rowNo;
            }
            $n = [
                'party_id' => $party?->id,
                'doc_type' => $dt,
                'iss' => $iss,
                'due' => $due,
                'amt' => $amt,
                'bal' => $bal,
            ];
        }

        return ['errors' => $errs, 'norm' => $n, 'dup_of' => $dupOf];
    }

    /* ------------------------------------------------------------------ ONB-13 Ejecución por lotes de 500 */

    public static function ejecutar(string $impId, array $opts, User $u): array
    {
        $imp = DB::table('data_imports')->where('id', $impId)->first()
            ?? RuleError::fail('RN-ONB-08', 'Importación no encontrada.');
        $def = self::DEFINICIONES[$imp->import_type];
        if (! Access::can($u, $def['perm'])) {
            RuleError::fail('RN-SEG-01', "No tienes el permiso {$def['perm']}.");
        }
        if ($imp->status !== 'VALIDATED') {
            RuleError::fail('RN-ONB-08', "Solo se ejecuta una importación validada (estado actual: {$imp->status}).");
        }
        $allow = array_key_exists('allow_partial', $opts) ? (bool) $opts['allow_partial'] : (bool) $imp->allow_partial;
        if ((int) $imp->error_rows > 0 && ! $allow) {
            $validas = (int) $imp->valid_rows + (int) $imp->warning_rows;
            RuleError::fail('RN-ONB-08', "Hay {$imp->error_rows} fila(s) con error: acepta importar solo las {$validas} válidas o corrige el archivo.");
        }

        $run = Asistente::corridaActual();
        if ($def['step']) {
            Asistente::exigirPrerrequisitos($run, $def['step']);
        }

        DB::table('data_imports')->where('id', $imp->id)->update([
            'status' => 'IMPORTING',
            'allow_partial' => $allow,
            'started_at' => now(),
            'updated_at' => now(),
        ]);

        $all = DB::table('data_import_rows')->where('import_id', $imp->id)->orderBy('row_no')->get()->all();
        $batches = [];
        $ctx = [
            'products' => [],
            'lists' => [],
            'rowTarget' => [],
            'lots' => [],
            'zones' => DB::table('delivery_zones')->get()->all(),
            'defaultCostCenterId' => DB::table('cost_centers')->value('id'),
        ];

        foreach (array_chunk($all, self::LOTE_FILAS) as $part) {
            $b = [
                'n' => count($batches) + 1,
                'rows' => count($part),
                'imported' => 0,
                'skipped' => 0,
                'failed' => 0,
                'status' => 'OK',
                'error' => null,
            ];
            try {
                DB::transaction(function () use ($imp, $part, $opts, $u, &$b, &$ctx) {
                    foreach ($part as $row) {
                        if ($row->status === 'ERROR') {
                            $b['failed']++;
                            continue;
                        }
                        if (! empty($opts['fail_at_row']) && (int) $row->row_no === (int) $opts['fail_at_row']) {
                            throw new \RuntimeException("Error simulado del servidor en la fila {$row->row_no}");
                        }
                        $r = self::ejecutarFila($imp, $row, $ctx, $u);
                        if (! empty($r['skipped'])) {
                            DB::table('data_import_rows')->where('id', $row->id)->update([
                                'status' => 'SKIPPED',
                                'target_id' => $r['target_id'] ?? null,
                            ]);
                            $b['skipped']++;
                            $ctx['rowTarget'][(int) $row->row_no] = $r['target_id'] ?? null;
                        } else {
                            DB::table('data_import_rows')->where('id', $row->id)->update([
                                'status' => 'IMPORTED',
                                'target_table' => $r['table'],
                                'target_id' => $r['id'],
                            ]);
                            $b['imported']++;
                            $ctx['rowTarget'][(int) $row->row_no] = $r['id'];
                        }
                    }
                });
            } catch (\Throwable $e) {
                $b['status'] = 'ROLLED_BACK';
                $b['error'] = $e->getMessage();
                $b['imported'] = 0;
                $b['skipped'] = 0;
                $b['failed'] = count($part);
                foreach ($part as $row) {
                    if ($row->status !== 'ERROR') {
                        $errs = json_decode((string) $row->errors, true) ?: [];
                        $errs[] = ['col' => '', 'msg' => "El lote {$b['n']} se revirtió ({$e->getMessage()}).", 'level' => 'ERROR'];
                        DB::table('data_import_rows')->where('id', $row->id)->update([
                            'status' => 'ERROR',
                            'errors' => json_encode($errs, JSON_UNESCAPED_UNICODE),
                            'target_id' => null,
                        ]);
                    }
                }
            }
            $batches[] = $b;
        }

        $imported = array_sum(array_column($batches, 'imported'));
        $skipped = array_sum(array_column($batches, 'skipped'));
        $errorRows = DB::table('data_import_rows')->where('import_id', $imp->id)->where('status', 'ERROR')->count();

        DB::table('data_imports')->where('id', $imp->id)->update([
            'status' => 'COMPLETED',
            'imported_rows' => $imported,
            'skipped_rows' => $skipped,
            'error_rows' => $errorRows,
            'batches' => json_encode($batches, JSON_UNESCAPED_UNICODE),
            'opening_lots' => json_encode($ctx['lots']),
            'finished_at' => now(),
            'executed_by' => mb_substr($u->name, 0, 120),
            'updated_at' => now(),
        ]);

        if ($def['step']) {
            Asistente::autoCompletar($run, $def['step'], $u);
        }
        Events::emit('import.completed', 'data_imports', $imp->id, [
            'import_id' => $imp->id,
            'type' => $imp->import_type,
            'imported' => $imported,
            'errors' => $errorRows,
        ]);

        return self::ver($imp->id);
    }

    private static function uomId(string $code): string
    {
        $id = DB::table('units_of_measure')->where('code', $code)->value('id');
        if ($id) {
            return $id;
        }

        return DB::table('units_of_measure')->insertGetId([
            'code' => $code,
            'name' => $code === 'NIU' ? 'Unidad' : 'Kilogramo',
            'kind' => $code === 'NIU' ? 'UNIT' : 'WEIGHT',
            'sunat_code' => $code,
            'status' => 'ACTIVE',
            'is_system' => true,
            'created_at' => now(),
        ], 'id');
    }

    private static function ejecutarFila(object $imp, object $row, array &$ctx, User $u): array
    {
        $n = json_decode((string) $row->norm, true) ?: [];
        $r = json_decode((string) $row->raw, true) ?: [];

        switch ($imp->import_type) {
            case 'PRODUCTS':
                $ex = DB::table('product_variants')->whereRaw('upper(sku) = ?', [$n['sku']])->first();
                if ($ex) {
                    if ($imp->mode !== 'UPSERT') {
                        return ['skipped' => true, 'target_id' => $ex->id];
                    }
                    DB::table('product_variants')->where('id', $ex->id)->update([
                        'name' => mb_substr($r['presentacion'], 0, 255),
                        'std_cost' => $n['cost'] ?? $ex->std_cost,
                        'updated_at' => now(),
                    ]);
                    self::fijarPrecio($imp->brand_id, $ex->id, (float) $n['price'], $n['mode'] === 'UNIT' ? 'UNIT' : 'KG', now('America/Lima')->toDateString(), $ctx);

                    return ['table' => 'product_variants', 'id' => $ex->id];
                }
                $code = strtoupper(trim((string) $r['codigo']));
                $pr = $ctx['products'][$code] ?? DB::table('products')->where('code', $code)->first();
                if (! $pr) {
                    $prId = DB::table('products')->insertGetId([
                        'brand_id' => $imp->brand_id,
                        'category_id' => $n['cat'],
                        'code' => mb_substr($code, 0, 40),
                        'name' => mb_substr($r['nombre'], 0, 255),
                        'line' => $n['line'] ?? 'GENERAL',
                        'product_type' => 'GOODS',
                        'origin' => 'PRODUCED',
                        'storage' => $n['storage'] ?? 'CHILLED',
                        'shelf_life_days' => (int) ($n['shelf'] ?? 7),
                        'requires_lot' => ! empty($n['lot']),
                        'igv_affectation' => '10',
                        'status' => 'ACTIVE',
                        'source' => 'IMPORT',
                        'created_at' => now(),
                        'updated_at' => now(),
                    ], 'id');
                    $pr = DB::table('products')->where('id', $prId)->first();
                    $ctx['products'][$code] = $pr;
                }
                $kg = $n['kg'] ?? null;
                $tol = $n['tol'] ?? null;
                $vId = DB::table('product_variants')->insertGetId([
                    'product_id' => $pr->id,
                    'brand_id' => $imp->brand_id,
                    'sku' => mb_substr($n['sku'], 0, 40),
                    'name' => mb_substr($r['presentacion'], 0, 255),
                    'barcode' => ! empty($r['codigo_barras']) ? mb_substr($r['codigo_barras'], 0, 40) : null,
                    'uom_id' => self::uomId($n['mode'] === 'UNIT' ? 'NIU' : 'KGM'),
                    'sale_mode' => $n['mode'],
                    'nominal_weight_kg' => $kg,
                    'weight_tolerance_pct' => $tol,
                    'min_weight_kg' => ($kg && $tol) ? round($kg * (1 - $tol / 100), 3) : null,
                    'max_weight_kg' => ($kg && $tol) ? round($kg * (1 + $tol / 100), 3) : null,
                    'status' => 'ACTIVE',
                    'std_cost' => (float) ($n['cost'] ?? 0),
                    'sellable' => true,
                    'line' => $n['line'] ?? 'GENERAL',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');
                self::fijarPrecio($imp->brand_id, $vId, (float) $n['price'], $n['mode'] === 'UNIT' ? 'UNIT' : 'KG', now('America/Lima')->toDateString(), $ctx);

                return ['table' => 'product_variants', 'id' => $vId];

            case 'CUSTOMERS':
                if ($row->dup_of) {
                    $targetId = str_starts_with((string) $row->dup_of, 'row:')
                        ? ($ctx['rowTarget'][(int) substr((string) $row->dup_of, 4)] ?? null)
                        : $row->dup_of;

                    return ['skipped' => true, 'target_id' => $targetId];
                }
                $cId = DB::table('customers')->insertGetId([
                    'doc_type' => $n['doc_type'],
                    'doc_number' => $n['doc_number'],
                    'full_name' => mb_substr($r['nombre'], 0, 80),
                    'phone' => $n['phone'],
                    'email' => ! empty($r['correo']) ? mb_substr($r['correo'], 0, 80) : null,
                    'customer_type' => $n['doc_type'] === 'RUC' ? 'BUSINESS' : 'PERSON',
                    'source_channel' => 'IMPORT',
                    'marketing_opt_in' => ! empty($n['optin']),
                    'consent_source' => ! empty($n['optin']) ? 'IMPORT' : null,
                    'status' => 'ACTIVE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                $dist = mb_strtolower(trim((string) ($r['distrito'] ?? '')));
                $zoneId = null;
                if ($dist !== '') {
                    foreach ($ctx['zones'] as $z) {
                        $zDists = is_string($z->districts) ? (json_decode($z->districts, true) ?: explode(',', $z->districts)) : ($z->districts ?? []);
                        foreach ($zDists as $zd) {
                            if (mb_strtolower(trim((string) $zd)) === $dist) {
                                $zoneId = $z->id;
                                break 2;
                            }
                        }
                    }
                }

                DB::table('customer_addresses')->insert([
                    'customer_id' => $cId,
                    'label' => 'Principal',
                    'address_line' => mb_substr($r['direccion'], 0, 255),
                    'reference' => mb_substr($r['referencia'], 0, 255),
                    'district' => ! empty($r['distrito']) ? mb_substr($r['distrito'], 0, 40) : null,
                    'lat' => $n['lat'],
                    'lng' => $n['lng'],
                    'zone_id' => $zoneId,
                    'contact_name' => mb_substr($r['nombre'], 0, 80),
                    'contact_phone' => $n['phone'],
                    'is_default' => true,
                    'pin_source' => ! empty($n['pin']) ? 'GEOCODE' : null,
                    'geocode_confidence' => $n['conf'],
                    'needs_pin' => empty($n['pin']),
                    'status' => 'ACTIVE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                return ['table' => 'customers', 'id' => $cId];

            case 'SUPPLIERS':
                if ($row->dup_of) {
                    return ['skipped' => true, 'target_id' => $row->dup_of];
                }
                $ccId = $ctx['defaultCostCenterId'];
                if (! $ccId) {
                    $coId = DB::table('companies')->value('id');
                    $ccId = DB::table('cost_centers')->insertGetId([
                        'company_id' => $coId,
                        'code' => 'CC-ADM',
                        'name' => 'Administración',
                        'area' => 'ADMIN',
                        'status' => 'ACTIVE',
                        'created_at' => now(),
                    ], 'id');
                    $ctx['defaultCostCenterId'] = $ccId;
                }
                $phDigits = preg_replace('/\D/', '', (string) ($r['celular'] ?? ''));
                $sId = DB::table('suppliers')->insertGetId([
                    'doc_type' => $n['doc_type'],
                    'doc_number' => mb_substr($r['num_doc'], 0, 40),
                    'legal_name' => mb_substr($r['razon_social'], 0, 255),
                    'trade_name' => mb_substr(trim((string) ($r['nombre_comercial'] ?: $r['razon_social'])), 0, 80),
                    'supplier_type' => $n['tp'],
                    'payment_terms_days' => (int) ($n['terms'] ?? 0),
                    'phone' => $phDigits !== '' ? '+51'.substr($phDigits, -9) : null,
                    'email' => ! empty($r['correo']) ? mb_substr($r['correo'], 0, 80) : null,
                    'status' => 'ACTIVE',
                    'sunat_status' => 'ACTIVE',
                    'rating' => 5,
                    'default_cost_center_id' => $ccId,
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['table' => 'suppliers', 'id' => $sId];

            case 'PRICES':
                $itId = self::fijarPrecio($imp->brand_id, $n['variant_id'], (float) $n['price'], $n['basis'], $n['from'], $ctx, $n['list_id'] ?? null);

                return ['table' => 'price_list_items', 'id' => $itId];

            case 'STOCK':
                $lotId = null;
                if (! empty($n['lot'])) {
                    $lot = DB::table('lots')->where('code', $n['lot'])->where('variant_id', $n['variant_id'])->first();
                    if (! $lot) {
                        $v = DB::table('product_variants')->where('id', $n['variant_id'])->first();
                        $reqRelease = Params::get('onb_opening_stock_requires_release');
                        $qcStatus = ($reqRelease === false || $reqRelease === 'false' || $reqRelease === '0' || $reqRelease === 0) ? 'RELEASED' : 'QUARANTINE';
                        $lotId = DB::table('lots')->insertGetId([
                            'product_id' => $v->product_id,
                            'variant_id' => $v->id,
                            'code' => mb_substr($n['lot'], 0, 40),
                            'origin' => 'OPENING',
                            'production_date' => null,
                            'expiry_date' => $n['exp'],
                            'qc_status' => $qcStatus,
                            'unit_cost' => (float) $n['cost'],
                            'released_at' => $qcStatus === 'RELEASED' ? now() : null,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ], 'id');
                        $ctx['lots'][] = $lotId;
                    } else {
                        $lotId = $lot->id;
                    }
                }
                $cutover = substr((string) ($imp->cutover_date ?? now('America/Lima')->toDateString()), 0, 10);
                $mv = InventarioService::mover([
                    'type' => 'ADJUSTMENT',
                    'warehouse_id' => $n['wh'],
                    'variant_id' => $n['variant_id'],
                    'lot_id' => $lotId,
                    'qty' => (float) $n['qty'],
                    'weight_kg' => $n['weight'],
                    'unit_cost' => (float) $n['cost'],
                    'source_type' => 'ONB_OPENING',
                    'source_id' => $imp->id,
                    'moved_at' => $cutover.' 23:59:00',
                    'reason' => 'Stock inicial: ajuste de apertura (ONB)',
                    'allow_unreleased' => true,
                ], $u);

                return ['table' => 'stock_movements', 'id' => $mv['moves'][0]['movement_id']];

            case 'CUSTOMER_BALANCES':
            case 'SUPPLIER_BALANCES':
                $cust = $imp->import_type === 'CUSTOMER_BALANCES';
                $obId = DB::table('opening_balances')->insertGetId([
                    'import_id' => $imp->id,
                    'company_id' => $imp->company_id ?? DB::table('companies')->value('id'),
                    'brand_id' => $imp->brand_id,
                    'party_type' => $cust ? 'CUSTOMER' : 'SUPPLIER',
                    'customer_id' => $cust ? $n['party_id'] : null,
                    'supplier_id' => $cust ? null : $n['party_id'],
                    'doc_type' => $n['doc_type'],
                    'doc_reference' => mb_substr($r['referencia'], 0, 60),
                    'issue_date' => $n['iss'],
                    'due_date' => $n['due'],
                    'currency' => 'PEN',
                    'amount' => (float) $n['amt'],
                    'balance' => (float) $n['bal'],
                    'status' => ((float) $n['bal'] > 0) ? 'OPEN' : 'SETTLED',
                    'cutover_date' => $imp->cutover_date,
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['table' => 'opening_balances', 'id' => $obId];
        }

        RuleError::fail('RN-ONB-08', 'Tipo no soportado.');
    }

    private static function fijarPrecio(?string $brandId, string $variantId, float $price, string $basis, string $from, array &$ctx, ?string $listId = null): string
    {
        $list = $listId ? DB::table('price_lists')->where('id', $listId)->first() : ($ctx['lists'][$brandId] ?? DB::table('price_lists')->where('brand_id', $brandId)->where('code', 'PUB')->first());
        if (! $list) {
            $b = $brandId ? DB::table('brands')->where('id', $brandId)->first() : null;
            $lId = DB::table('price_lists')->insertGetId([
                'brand_id' => $brandId,
                'code' => 'PUB',
                'name' => 'Lista pública '.($b->name ?? ''),
                'channels' => json_encode(['WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'COUNTER']),
                'includes_igv' => true,
                'status' => 'ACTIVE',
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');
            $list = DB::table('price_lists')->where('id', $lId)->first();
        }
        if ($brandId) {
            $ctx['lists'][$brandId] = $list;
        }
        $cur = DB::table('price_list_items')
            ->where('list_id', $list->id)
            ->where('variant_id', $variantId)
            ->whereNull('valid_to')
            ->first();
        if ($cur) {
            $closeTo = Carbon::parse($from)->subDay()->toDateString();
            if ($closeTo < $cur->valid_from) {
                $closeTo = $cur->valid_from;
            }
            DB::table('price_list_items')->where('id', $cur->id)->update(['valid_to' => $closeTo, 'updated_at' => now()]);
        }

        return DB::table('price_list_items')->insertGetId([
            'list_id' => $list->id,
            'variant_id' => $variantId,
            'price' => $price,
            'basis' => $basis,
            'valid_from' => $from,
            'valid_to' => null,
            'previous_price' => $cur ? (float) $cur->price : null,
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');
    }

    /** RN-ONB-14 (CA-ONB-06): Calidad libera el stock inicial en cuarentena. */
    public static function liberarStockInicial(string $impId, User $u): array
    {
        if (! Access::can($u, 'onb.import.release_opening_stock')) {
            RuleError::fail('RN-SEG-01', 'No tienes el permiso onb.import.release_opening_stock.');
        }
        $imp = DB::table('data_imports')->where('id', $impId)->first()
            ?? RuleError::fail('RN-ONB-08', 'Importación no encontrada.');
        $lotIds = json_decode((string) $imp->opening_lots, true) ?: [];
        $lots = $lotIds ? DB::table('lots')->whereIn('id', $lotIds)->where('qc_status', 'QUARANTINE')->get() : collect();
        if ($lots->isEmpty()) {
            RuleError::fail('RN-ONB-14', 'No hay lotes del stock inicial en cuarentena.');
        }

        DB::transaction(function () use ($imp, $lots, $u) {
            DB::select("SELECT set_config('app.cal_decision', 'on', true)");
            foreach ($lots as $l) {
                DB::table('lots')->where('id', $l->id)->update([
                    'qc_status' => 'RELEASED',
                    'released_at' => now(),
                    'released_by' => mb_substr($u->name, 0, 80),
                    'updated_at' => now(),
                ]);
                DB::table('lot_status_changes')->insert([
                    'lot_id' => $l->id,
                    'from_status' => 'QUARANTINE',
                    'to_status' => 'RELEASED',
                    'reason' => 'Liberación del stock inicial (ONB)',
                    'changed_by' => $u->id,
                    'changed_at' => now(),
                ]);
                Events::emit('lot.released', 'lots', $l->id, ['lot_id' => $l->id, 'source' => 'ONB']);
            }
            DB::table('data_imports')->where('id', $imp->id)->update([
                'released_at' => now(),
                'released_by' => mb_substr($u->name, 0, 120),
                'updated_at' => now(),
            ]);
        });

        return ['released_lots' => $lots->count()] + self::ver($imp->id);
    }

    /** Reversión de una importación ejecutada (deja la importación CANCELLED y permite reimportar, RN-ONB-09). */
    public static function revertir(string $impId, string $reason, User $u): array
    {
        $imp = DB::table('data_imports')->where('id', $impId)->first()
            ?? RuleError::fail('RN-ONB-08', 'Importación no encontrada.');
        $def = self::DEFINICIONES[$imp->import_type];
        if (! Access::can($u, $def['perm'])) {
            RuleError::fail('RN-SEG-01', "No tienes el permiso {$def['perm']}.");
        }
        $reason = trim($reason);
        if ($reason === '') {
            RuleError::fail('RN-ONB-08', 'La reversión exige motivo.');
        }
        if ($imp->status !== 'COMPLETED') {
            RuleError::fail('RN-ONB-08', 'Solo se revierte una importación ejecutada.');
        }

        $done = DB::table('data_import_rows')->where('import_id', $imp->id)->where('status', 'IMPORTED')->orderBy('row_no')->get();
        $blockers = [];

        if ($imp->import_type === 'CUSTOMERS') {
            $used = DB::table('sales_orders')->pluck('customer_id')->flip();
            foreach ($done as $r) {
                if ($r->target_id && isset($used[$r->target_id])) {
                    $blockers[] = "fila {$r->row_no}: el cliente ya tiene pedidos";
                }
            }
        } elseif ($imp->import_type === 'STOCK') {
            foreach ($done as $r) {
                $m = $r->target_id ? DB::table('stock_movements')->where('id', $r->target_id)->first() : null;
                if ($m) {
                    $b = DB::table('stock_balances')->where('warehouse_id', $m->warehouse_id)->where('variant_id', $m->variant_id)
                        ->when($m->lot_id, fn ($q) => $q->where('lot_id', $m->lot_id), fn ($q) => $q->whereNull('lot_id'))->first();
                    if (! $b || (float) $b->qty + 1e-6 < (float) $m->qty) {
                        $blockers[] = "fila {$r->row_no}: el stock ya se consumió";
                    }
                }
            }
        } elseif (str_ends_with($imp->import_type, 'BALANCES')) {
            foreach ($done as $r) {
                $o = $r->target_id ? DB::table('opening_balances')->where('id', $r->target_id)->first() : null;
                $norm = json_decode((string) $r->norm, true) ?: [];
                if ($o && (float) $o->balance < ((float) ($norm['bal'] ?? 0)) - 0.005) {
                    $blockers[] = "fila {$r->row_no}: el saldo ya tiene cobros o pagos";
                }
            }
        }

        if (! empty($blockers)) {
            $msg = implode('; ', array_slice($blockers, 0, 3)).(count($blockers) > 3 ? ' y '.(count($blockers) - 3).' más' : '');
            RuleError::fail('RN-ONB-08', "No se puede revertir: {$msg}.");
        }

        DB::transaction(function () use ($imp, $done, $reason, $u) {
            foreach ($done as $r) {
                if (! $r->target_id) {
                    continue;
                }
                if ($imp->import_type === 'PRODUCTS') {
                    DB::table('product_variants')->where('id', $r->target_id)->update(['status' => 'INACTIVE', 'sellable' => false, 'updated_at' => now()]);
                } elseif ($imp->import_type === 'CUSTOMERS') {
                    DB::table('customers')->where('id', $r->target_id)->update(['status' => 'INACTIVE', 'blocked_reason' => mb_substr($reason, 0, 255), 'updated_at' => now()]);
                } elseif ($imp->import_type === 'SUPPLIERS') {
                    DB::table('suppliers')->where('id', $r->target_id)->update(['status' => 'INACTIVE', 'updated_at' => now()]);
                } elseif ($imp->import_type === 'PRICES') {
                    DB::table('price_list_items')->where('id', $r->target_id)->update(['valid_to' => now('America/Lima')->toDateString(), 'closed_reason' => mb_substr($reason, 0, 80), 'updated_at' => now()]);
                } elseif ($imp->import_type === 'STOCK') {
                    InventarioService::reversar($r->target_id, 'Reversión del stock inicial: '.$reason, $u);
                } elseif (str_ends_with($imp->import_type, 'BALANCES')) {
                    DB::table('opening_balances')->where('id', $r->target_id)->update(['status' => 'VOIDED', 'updated_at' => now()]);
                }
            }

            $lotIds = json_decode((string) $imp->opening_lots, true) ?: [];
            if (! empty($lotIds)) {
                DB::select("SELECT set_config('app.cal_decision', 'on', true)");
                DB::table('lots')->whereIn('id', $lotIds)->update([
                    'qc_status' => 'BLOCKED',
                    'block_reason' => 'Importación revertida',
                    'updated_at' => now(),
                ]);
            }

            DB::table('data_imports')->where('id', $imp->id)->update([
                'status' => 'CANCELLED',
                'reverted_at' => now(),
                'reverted_by' => mb_substr($u->name, 0, 120),
                'revert_reason' => mb_substr($reason, 0, 300),
                'updated_at' => now(),
            ]);
        });

        return self::ver($imp->id);
    }

    public static function cancelar(string $impId, ?string $reason, User $u): array
    {
        $imp = DB::table('data_imports')->where('id', $impId)->first()
            ?? RuleError::fail('RN-ONB-08', 'Importación no encontrada.');
        $def = self::DEFINICIONES[$imp->import_type];
        if (! Access::can($u, $def['perm'])) {
            RuleError::fail('RN-SEG-01', "No tienes el permiso {$def['perm']}.");
        }
        if (! in_array($imp->status, ['UPLOADED', 'VALIDATED', 'FAILED_VALIDATION'], true)) {
            RuleError::fail('RN-ONB-08', 'Solo se cancela una importación sin ejecutar (las ejecutadas se revierten).');
        }

        DB::table('data_imports')->where('id', $imp->id)->update([
            'status' => 'CANCELLED',
            'revert_reason' => mb_substr(trim((string) $reason) ?: 'Cancelada antes de ejecutar', 0, 300),
            'updated_at' => now(),
        ]);

        return self::ver($imp->id);
    }

    /** CSV con las filas con error y la columna de errores para corregir en Excel (ONB-12, CA-ONB-04). */
    public static function archivoErrores(string $impId): array
    {
        $imp = DB::table('data_imports')->where('id', $impId)->first()
            ?? RuleError::fail('RN-ONB-08', 'Importación no encontrada.');
        $def = self::DEFINICIONES[$imp->import_type];
        $fields = array_map(fn ($f) => $f[0], $def['fields']);
        $head = array_merge($fields, ['fila', 'errores']);

        $errRows = DB::table('data_import_rows')
            ->where('import_id', $imp->id)
            ->where('status', 'ERROR')
            ->orderBy('row_no')
            ->get();

        $rows = [];
        foreach ($errRows as $r) {
            $raw = json_decode((string) $r->raw, true) ?: [];
            $errs = json_decode((string) $r->errors, true) ?: [];
            $errText = collect($errs)
                ->where('level', 'ERROR')
                ->map(fn ($e) => (! empty($e['col']) ? $e['col'].': ' : '').$e['msg'])
                ->join(' | ');
            $line = array_map(fn ($k) => $raw[$k] ?? '', $fields);
            $line[] = (string) $r->row_no;
            $line[] = $errText;
            $rows[] = $line;
        }

        return [
            'file_name' => 'errores-'.$imp->file_name,
            'csv' => self::joinCsv([$head, ...$rows]),
        ];
    }

    /** Detalle completo de una importación con sus filas, lotes y resumen de stock inicial. */
    public static function ver(string $impId, ?string $statusFilter = null): array
    {
        $imp = DB::table('data_imports as i')
            ->leftJoin('brands as b', 'b.id', '=', 'i.brand_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 'i.warehouse_id')
            ->where('i.id', $impId)
            ->first(['i.*', 'b.name as brand_name', 'w.name as warehouse_name', 'w.code as warehouse_code'])
            ?? RuleError::fail('RN-ONB-08', 'Importación no encontrada.');

        $def = self::DEFINICIONES[$imp->import_type];
        $imp->type_label = $def['label'];
        $imp->headers = json_decode((string) $imp->headers, true) ?: [];
        $imp->map = json_decode((string) $imp->map, true) ?: [];
        $imp->batches = json_decode((string) $imp->batches, true) ?: [];
        $lotIds = json_decode((string) $imp->opening_lots, true) ?: [];
        $imp->opening_lots = $lotIds;
        $imp->error_pct = ((int) $imp->total_rows) > 0 ? round(((int) $imp->error_rows) * 100 / ((int) $imp->total_rows), 2) : 0.0;

        $qRows = DB::table('data_import_rows')->where('import_id', $imp->id)->orderBy('row_no');
        if ($statusFilter && $statusFilter !== 'ALL') {
            $qRows->where('status', $statusFilter);
        }
        $rows = $qRows->limit(1000)->get()->map(function ($r) {
            $r->raw = json_decode((string) $r->raw, true) ?: [];
            $r->norm = json_decode((string) $r->norm, true) ?: [];
            $r->errors = json_decode((string) $r->errors, true) ?: [];

            return $r;
        });

        $stockSummary = null;
        if ($imp->import_type === 'STOCK') {
            $lots = $lotIds ? DB::table('lots')->whereIn('id', $lotIds)->get(['id', 'code', 'qc_status', 'expiry_date', 'unit_cost']) : collect();
            $val = (float) DB::table('stock_movements')
                ->where('source_type', 'ONB_OPENING')
                ->where('source_id', $imp->id)
                ->where('movement_type', 'ADJUSTMENT')
                ->sum('total_cost');
            $stockSummary = [
                'total_lots' => $lots->count(),
                'quarantine_lots' => $lots->where('qc_status', 'QUARANTINE')->count(),
                'released_lots' => $lots->where('qc_status', 'RELEASED')->count(),
                'inventory_value' => round($val, 2),
                'lots' => $lots,
            ];
        }

        return [
            'import' => $imp,
            'fields' => array_map(fn ($f) => ['key' => $f[0], 'label' => $f[1], 'required' => $f[2]], $def['fields']),
            'rows' => $rows,
            'stock_summary' => $stockSummary,
        ];
    }
}
