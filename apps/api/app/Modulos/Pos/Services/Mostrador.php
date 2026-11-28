<?php

namespace App\Modulos\Pos\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Cat\Services\Balanza;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Ped\Services\Pedidos;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * La venta del mostrador (POS-02 a POS-04): precio de la caja, peso digitado o de etiqueta,
 * carrito y cobro. Cada venta es un pedido COUNTER de PED por marca (D-POS-03) que descuenta del
 * almacén de la caja por FEFO con ALM, sin tocar lo reservado para pedidos (RN-POS-10), y que
 * emite su boleta o factura y registra sus cobros en el turno abierto, todo en una transacción.
 *
 * Reglas: RN-POS-03 (venta en turno abierto), RN-POS-04 (peso), RN-POS-06 (etiqueta de balanza),
 * RN-POS-10 (stock de la caja sin lo reservado), RN-POS-11 (pagos), RN-POS-12 (comprobante al
 * cobrar), RN-PED-02 (solo productos activos del catálogo) y RN-CAT-05 (precio vigente).
 */
final class Mostrador
{
    public const CANAL = 'COUNTER';

    public const ORIGENES_PESO = ['MANUAL' => 'Digitado', 'SCALE' => 'Balanza conectada', 'LABEL' => 'Etiqueta de balanza'];

    /** Accesos rápidos por línea (POS-02). */
    public const LINEAS = ['CUY' => 'Cuy', 'CONEJO' => 'Conejo', 'AVES' => 'Aves', 'EMBUTIDOS' => 'Embutidos', 'CALDOS' => 'Caldos',
        'CORTES' => 'Cortes', 'DESPENSA' => 'Despensa', 'GOURMET' => 'Gourmet'];

    private const GRUPO = ['CERDO' => 'CORTES', 'RES' => 'CORTES', 'CORDERO' => 'CORTES', 'MANTECA' => 'DESPENSA', 'ABARROTES' => 'DESPENSA',
        'CAFE' => 'GOURMET', 'FRUTOS_SECOS' => 'GOURMET', 'MERMELADAS' => 'GOURMET', 'INFUSIONES' => 'GOURMET'];

    public const EPS = 0.0005;

    public static function grupo(?string $linea): string
    {
        return self::GRUPO[$linea] ?? (string) $linea;
    }

    /**
     * Precio de cada variante en la caja: primero la lista por defecto de la caja (POS-11); si no la
     * tiene o no tiene esa variante, el precio vigente del canal mostrador (Precios::vigente).
     *
     * @return array<string, array{price: float, basis: string, list_id: string, list_name: string}|null>
     */
    public static function precios(object $caja, array $variantIds): array
    {
        $variantIds = array_values(array_unique(array_filter($variantIds)));
        if (! $variantIds) {
            return [];
        }
        $hoy = now('America/Lima')->toDateString();
        $vs = DB::table('product_variants')->whereIn('id', $variantIds)->get(['id', 'brand_id', 'sale_mode'])->keyBy('id');
        $r = array_fill_keys($variantIds, null);
        if ($caja->default_price_list_id) {
            $l = DB::table('price_lists')->where('id', $caja->default_price_list_id)->where('status', 'ACTIVE')
                ->where(fn ($q) => $q->whereNull('valid_from')->orWhere('valid_from', '<=', $hoy))
                ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $hoy))->first(['id', 'name', 'brand_id']);
            if ($l) {
                $items = DB::table('price_list_items')->where('list_id', $l->id)->whereIn('variant_id', $variantIds)
                    ->where('valid_from', '<=', $hoy)->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $hoy))
                    ->where(fn ($q) => $q->whereNull('min_qty')->orWhere('min_qty', '<=', 0))
                    ->orderByDesc('valid_from')->get(['variant_id', 'price', 'basis'])->groupBy('variant_id')->map->first();
                foreach ($variantIds as $id) {
                    $v = $vs[$id] ?? null;
                    $it = $items[$id] ?? null;
                    if ($v && $it && ($l->brand_id === null || $l->brand_id === $v->brand_id)) {
                        $r[$id] = ['price' => (float) $it->price, 'basis' => $it->basis ?: ($v->sale_mode === 'UNIT' ? 'UNIT' : 'KG'), 'list_id' => $l->id, 'list_name' => $l->name];
                    }
                }
            }
        }
        $faltan = array_keys(array_filter($r, fn ($x) => $x === null));
        if ($faltan) {
            foreach (Precios::vigentes($faltan, ['canal' => self::CANAL, 'tipo_cliente' => 'PERSON']) as $id => $p) {
                if ($p) {
                    $r[$id] = ['price' => (float) $p['price'], 'basis' => $p['basis'], 'list_id' => $p['list_id'], 'list_name' => $p['list_name']];
                }
            }
        }

        return $r;
    }

    /** Disponible para vender en el almacén de la caja (lotes liberados y vigentes, sin lo reservado). */
    public static function stock(string $warehouseId, array $variantIds): array
    {
        if (! $variantIds) {
            return [];
        }
        $hoy = now('America/Lima')->toDateString();

        return DB::table('stock_balances as b')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')
            ->where('b.warehouse_id', $warehouseId)->whereIn('b.variant_id', $variantIds)
            ->where(fn ($w) => $w->whereNull('b.lot_id')->orWhere(fn ($x) => $x->where('l.qc_status', 'RELEASED')->where('l.expiry_date', '>=', $hoy)))
            ->groupBy('b.variant_id')->selectRaw('b.variant_id, sum(b.qty) q, sum(b.reserved_qty) r')->get()
            ->mapWithKeys(fn ($s) => [$s->variant_id => ['qty' => round((float) $s->q, 3), 'reservado' => round((float) $s->r, 3), 'disponible' => round(max(0, (float) $s->q - (float) $s->r), 3)]])
            ->all();
    }

    /** POS-02: productos de la caja con precio, stock disponible, PLU y rango de peso. */
    public static function productos(object $caja, User $u, ?string $q = null, ?string $linea = null, bool $conStock = false): Collection
    {
        $a = Access::for($u);
        $vs = DB::table('product_variants as v')->join('brands as b', 'b.id', '=', 'v.brand_id')
            ->where('v.status', 'ACTIVE')->where('v.sellable', true)->where('b.status', 'ACTIVE')
            ->when($a['brands'], fn ($w) => $w->whereIn('v.brand_id', $a['brands']))
            ->when($q !== null && trim($q) !== '', function ($w) use ($q) {
                $t = '%'.addcslashes(mb_strtolower(trim($q)), '%_\\').'%';
                $w->where(fn ($x) => $x->whereRaw("translate(lower(v.name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", [$t])->orWhereRaw('lower(v.sku) like ?', [$t])
                    ->orWhere('v.barcode', trim($q))->orWhere('v.scale_plu', ltrim(trim($q), '0')));
            })
            ->orderBy('v.name')->limit(300)
            ->get(['v.id', 'v.sku', 'v.name', 'v.barcode', 'v.sale_mode', 'v.nominal_weight_kg', 'v.min_weight_kg', 'v.max_weight_kg', 'v.scale_plu', 'v.line', 'v.brand_id', 'b.name as marca', 'b.code as marca_code']);
        if ($linea && $linea !== 'ALL') {
            $vs = $vs->filter(fn ($v) => self::grupo($v->line) === $linea)->values();
        }
        $precios = self::precios($caja, $vs->pluck('id')->all());
        $stock = self::stock($caja->warehouse_id, $vs->pluck('id')->all());

        return $vs->map(function ($v) use ($precios, $stock) {
            $p = $precios[$v->id] ?? null;
            $s = $stock[$v->id] ?? ['qty' => 0, 'reservado' => 0, 'disponible' => 0];

            return [
                'id' => $v->id, 'sku' => $v->sku, 'name' => $v->name, 'barcode' => $v->barcode, 'sale_mode' => $v->sale_mode,
                'nominal_weight_kg' => $v->nominal_weight_kg, 'min_weight_kg' => $v->min_weight_kg, 'max_weight_kg' => $v->max_weight_kg,
                'plu' => $v->scale_plu ? str_pad($v->scale_plu, 5, '0', STR_PAD_LEFT) : null, 'linea' => self::grupo($v->line),
                'brand_id' => $v->brand_id, 'marca' => $v->marca, 'marca_code' => $v->marca_code,
                'precio' => $p['price'] ?? null, 'base' => $p['basis'] ?? null, 'lista' => $p['list_name'] ?? null,
                'stock' => $s['qty'], 'reservado' => $s['reservado'], 'disponible' => $s['disponible'],
            ];
        })->when($conStock, fn ($c) => $c->filter(fn ($x) => $x['disponible'] > 0)->values());
    }

    /** RN-POS-04: el peso digitado. Devuelve el peso con 3 decimales. */
    public static function validarPeso(object $v, mixed $peso, int $unidades, bool $aceptarFuera, User $u): float
    {
        $w = round((float) $peso, 3);
        if (! is_numeric($peso) || $w <= 0) {
            RuleError::fail('RN-POS-04', "{$v->name}: el peso debe ser mayor que 0.");
        }
        $max = (float) (Params::get('pos_max_manual_weight_kg') ?? 30);
        if ($w > $max + self::EPS) {
            RuleError::fail('RN-POS-04', "{$v->name}: ".self::kg($w).' supera el máximo digitable por línea ('.self::kg($max, 0).').');
        }
        if ($v->sale_mode !== 'KG' && $v->min_weight_kg !== null && $v->max_weight_kg !== null) {
            $porUnidad = round($w / max(1, $unidades), 3);
            if ($porUnidad < (float) $v->min_weight_kg - self::EPS || $porUnidad > (float) $v->max_weight_kg + self::EPS) {
                if (! ($aceptarFuera && Access::can($u, 'pos.weight.override'))) {
                    RuleError::fail('RN-POS-04', "{$v->name}: ".self::kg($porUnidad).' por unidad está fuera del rango aceptado ('
                        .self::kg((float) $v->min_weight_kg).' a '.self::kg((float) $v->max_weight_kg).'). Revisa el peso o pide a la supervisora que lo acepte.');
                }
            }
        }

        return $w;
    }

    /**
     * RN-POS-06: lee una etiqueta de balanza (EAN-13 con prefijo 2). Con $variantId, el PLU debe ser
     * el de esa variante. Devuelve la variante y el peso del código.
     */
    public static function etiqueta(string $codigo, ?string $variantId = null): array
    {
        $r = Balanza::leer($codigo);
        if (! $r['ok']) {
            RuleError::fail('RN-POS-06', str_replace('RN-CAT-12: ', '', (string) $r['error']));
        }
        if ($r['value_type'] !== 'WEIGHT_G' || ! ($r['weight_kg'] > 0)) {
            RuleError::fail('RN-POS-06', 'La etiqueta no trae el peso: el formato de balanza del catálogo es por precio.');
        }
        if ($variantId) {
            $esperada = DB::table('product_variants')->where('id', $variantId)->first(['id', 'name', 'scale_plu']);
            $plu = $esperada?->scale_plu ? str_pad($esperada->scale_plu, strlen($r['plu']), '0', STR_PAD_LEFT) : null;
            if (! $esperada || $plu !== $r['plu']) {
                RuleError::fail('RN-POS-06', "La etiqueta es del PLU {$r['plu']}".($r['variant'] ? " ({$r['variant']->name})" : '')
                    .' y no de '.($esperada->name ?? 'ese producto').' (PLU '.($esperada?->scale_plu ?: 'sin PLU').').');
            }
        }
        if (! $r['variant']) {
            RuleError::fail('RN-POS-06', "El PLU {$r['plu']} de la etiqueta no corresponde a ningún producto activo.");
        }

        return ['variant_id' => $r['variant']->id, 'name' => $r['variant']->name, 'plu' => $r['plu'], 'weight_kg' => number_format($r['weight_kg'], 3, '.', ''),
            'barcode' => preg_replace('/\s+/', '', $codigo)];
    }

    /**
     * Precia y valida el carrito. Cada línea: variant_id, qty, weight_kg, weight_source (MANUAL,
     * SCALE, LABEL), barcode (con LABEL) y override (aceptar el peso fuera de rango).
     *
     * @return array{lineas: list<array>, marcas: list<array>, total: float, subtotal: float, igv: float}
     */
    public static function cotizar(object $caja, array $lineas, User $u): array
    {
        if (! $lineas) {
            RuleError::fail('RN-POS-11', 'El carrito está vacío.');
        }
        $a = Access::for($u);
        $ids = array_values(array_unique(array_filter(array_map(fn ($l) => $l['variant_id'] ?? null, $lineas))));
        $vs = DB::table('product_variants as v')->join('brands as b', 'b.id', '=', 'v.brand_id')->whereIn('v.id', $ids)
            ->get(['v.id', 'v.sku', 'v.name', 'v.brand_id', 'v.status', 'v.sellable', 'v.sale_mode', 'v.min_weight_kg', 'v.max_weight_kg', 'v.nominal_weight_kg', 'v.scale_plu', 'b.name as marca', 'b.status as marca_estado'])
            ->keyBy('id');
        $precios = self::precios($caja, $ids);
        $salida = [];
        foreach ($lineas as $i => $l) {
            $v = $vs[$l['variant_id'] ?? ''] ?? null;
            if (! $v || $v->status !== 'ACTIVE' || ! $v->sellable || $v->marca_estado !== 'ACTIVE') {
                RuleError::fail('RN-PED-02', 'Solo se venden productos activos del catálogo'.($v ? ": «{$v->name}» no está activo para la venta." : '.'));
            }
            if ($a['brands'] && ! in_array($v->brand_id, $a['brands'], true)) {
                RuleError::fail('RN-PED-02', "«{$v->name}» es de {$v->marca}, una marca fuera de tu alcance.");
            }
            $p = $precios[$v->id] ?? null;
            if (! $p) {
                RuleError::fail('RN-CAT-05', "«{$v->name}» no tiene precio vigente en la lista de la caja ni en el canal mostrador.");
            }
            $origen = $l['weight_source'] ?? 'MANUAL';
            if (! isset(self::ORIGENES_PESO[$origen])) {
                $origen = 'MANUAL';
            }
            $porKg = $p['basis'] === 'KG';
            $unidades = 1;
            if ($v->sale_mode !== 'KG') {
                $q = (float) ($l['qty'] ?? 1);
                if ($q < 1 || abs($q - round($q)) > 0.0001) {
                    RuleError::fail('RN-POS-04', "«{$v->name}» se vende por unidades: la cantidad va sin decimales.");
                }
                $unidades = (int) round($q);
            }
            $peso = null;
            $codigo = null;
            if ($porKg || $v->sale_mode === 'KG' || ($l['weight_kg'] ?? null)) {
                if (($l['weight_kg'] ?? null) === null || $l['weight_kg'] === '') {
                    RuleError::fail('RN-POS-04', "«{$v->name}» se vende por peso: registra el peso.");
                }
                if ($origen === 'LABEL') {
                    $codigo = (string) ($l['barcode'] ?? '');
                    $et = self::etiqueta($codigo, $v->id);
                    if (abs((float) $et['weight_kg'] - (float) $l['weight_kg']) > self::EPS) {
                        RuleError::fail('RN-POS-06', "El peso de «{$v->name}» debe ser el de la etiqueta (".self::kg((float) $et['weight_kg']).').');
                    }
                    $peso = round((float) $et['weight_kg'], 3);
                    $codigo = $et['barcode'];
                } else {
                    $peso = self::validarPeso($v, $l['weight_kg'], $unidades, (bool) ($l['override'] ?? false), $u);
                }
            }
            $cantidadStock = $v->sale_mode === 'KG' ? $peso : $unidades;
            $importe = round(($porKg ? $peso : $unidades) * $p['price'], 2);
            $salida[] = [
                'i' => $i, 'variant_id' => $v->id, 'sku' => $v->sku, 'name' => $v->name, 'brand_id' => $v->brand_id, 'marca' => $v->marca,
                'sale_mode' => $v->sale_mode, 'qty' => $unidades, 'weight_kg' => $peso, 'weight_source' => $peso !== null ? $origen : null, 'barcode' => $codigo,
                'override' => (bool) ($l['override'] ?? false), 'price' => $p['price'], 'basis' => $p['basis'], 'list_id' => $p['list_id'],
                'stock_qty' => $cantidadStock, 'amount' => $importe,
                'uom' => $porKg ? 'KGM' : 'NIU', 'doc_qty' => $porKg ? $peso : $unidades,
            ];
        }
        $marcas = [];
        foreach ($salida as $l) {
            $marcas[$l['brand_id']] ??= ['brand_id' => $l['brand_id'], 'marca' => $l['marca'], 'total' => 0.0, 'lineas' => 0];
            $marcas[$l['brand_id']]['total'] = round($marcas[$l['brand_id']]['total'] + $l['amount'], 2);
            $marcas[$l['brand_id']]['lineas']++;
        }
        foreach ($marcas as &$m) {
            [$m['subtotal'], $m['igv']] = Comprobantes::separar($m['total']);
        }
        unset($m);
        $total = round(array_sum(array_column($salida, 'amount')), 2);

        return ['lineas' => $salida, 'marcas' => array_values($marcas), 'total' => $total,
            'subtotal' => round(array_sum(array_column($marcas, 'subtotal')), 2), 'igv' => round(array_sum(array_column($marcas, 'igv')), 2)];
    }

    /** RN-POS-10 / RN-ALM-09: la venta no toma stock reservado para pedidos; antes de mover, por variante. */
    public static function revisarStock(object $caja, array $lineas): void
    {
        $necesita = [];
        foreach ($lineas as $l) {
            $necesita[$l['variant_id']] = round(($necesita[$l['variant_id']] ?? 0) + $l['stock_qty'], 3);
        }
        $alm = DB::table('warehouses')->where('id', $caja->warehouse_id)->value('name');
        foreach ($necesita as $vid => $q) {
            $d = InventarioService::disponible($vid, $caja->warehouse_id);
            $v = DB::table('product_variants')->where('id', $vid)->first(['name', 'sale_mode']);
            $hay = (float) $d['qty'];
            $libre = (float) $d['available_qty'];
            if ($q > $libre + self::EPS) {
                if ($q <= $hay + self::EPS) {
                    RuleError::fail('RN-ALM-09', "{$v->name}: hay ".self::cant($hay, $v->sale_mode)." en {$alm}, pero ".self::cant($hay - $libre, $v->sale_mode)
                        .' están reservados para pedidos de delivery; solo se pueden vender '.self::cant(max(0, $libre), $v->sale_mode).'.');
                }
                RuleError::fail('RN-ALM-03', "{$v->name}: stock insuficiente en {$alm} (disponible ".self::cant(max(0, $libre), $v->sale_mode).', se piden '.self::cant($q, $v->sale_mode).').');
            }
        }
    }

    /**
     * POS-04: cobra la venta. $d: lines, payments, customer_id (opcional: «Clientes varios»), doc_type
     * (RECEIPT o INVOICE). Un pedido y un comprobante por marca, cobrados en un solo paso.
     */
    public static function vender(array $d, User $u): array
    {
        return DB::transaction(function () use ($d, $u) {
            $turno = Turnos::exigirAbierto($u, $d['shift_id'] ?? null);
            $turno = Turnos::bloquear($turno->id);
            if ($turno->status !== 'OPEN') {
                RuleError::fail('RN-POS-03', 'El turno ya se cerró: abre otro para vender.');
            }
            $caja = Cajas::caja($turno->terminal_id);
            if ($caja->status !== 'ACTIVE') {
                RuleError::fail('RN-POS-03', "La caja «{$caja->name}» está inactiva.");
            }
            $empresa = DB::table('establishments')->where('id', $caja->establishment_id)->value('company_id');
            Periodos::abierto(now('America/Lima')->toDateString(), $empresa);

            $clienteId = ! empty($d['customer_id']) ? $d['customer_id'] : Cajas::clienteVarios();
            $cliente = Customer::find($clienteId) ?? RuleError::fail('RN-PED-01', 'El cliente no existe.');
            if ($motivo = Clientes::puedeComprar($cliente)) {
                RuleError::fail($motivo[0], $motivo[1]);
            }
            $tipo = $d['doc_type'] ?? (string) (Params::get('pos_receipt_default_doc') ?? 'RECEIPT');
            if (! in_array($tipo, ['RECEIPT', 'INVOICE'], true)) {
                RuleError::fail('RN-FAC-02', 'El comprobante del mostrador es boleta o factura.');
            }

            $c = self::cotizar($caja, $d['lines'] ?? [], $u);
            foreach ($c['marcas'] as $m) {
                Comprobantes::validarCliente($tipo, $cliente, $m['total'], $m['brand_id']);
            }
            $v = Cobros::validar($d['payments'] ?? [], $c['total'], $cliente->id);
            self::revisarStock($caja, $c['lineas']);

            $ticket = self::ticket();
            $principal = collect($v['pagos'])->where('medio.code', '<>', 'BALANCE')->sortByDesc('amount')->first();
            $medioPedido = $principal['medio']['id'] ?? DB::table('payment_methods')->where('code', 'CASH')->value('id');
            $series = [];
            foreach ($c['marcas'] as $m) {
                $series[$m['brand_id']] = Comprobantes::serieDeVenta($caja, $tipo, $m['brand_id']);
            }

            $pedidos = [];
            $docs = [];
            foreach ($c['marcas'] as $m) {
                $ls = array_values(array_filter($c['lineas'], fn ($l) => $l['brand_id'] === $m['brand_id']));
                $o = Pedidos::guardar(null, [
                    'brand_id' => $m['brand_id'], 'channel' => self::CANAL, 'fulfillment' => 'COUNTER', 'establishment_id' => $caja->establishment_id,
                    'customer_id' => $cliente->id, 'billing_customer_id' => $cliente->id, 'requested_doc_type' => $tipo,
                    'payment_method_id' => $medioPedido, 'seller_id' => $u->id, 'delivery_date' => now('America/Lima')->toDateString(),
                ], $u);
                $n = 0;
                foreach ($ls as $l) {
                    DB::table('sales_order_lines')->insert([
                        'sales_order_id' => $o->id, 'line_no' => ++$n, 'variant_id' => $l['variant_id'], 'qty' => $l['qty'],
                        'unit_price' => $l['price'], 'list_price' => $l['price'], 'price_basis' => $l['basis'], 'price_list_id' => $l['list_id'],
                        'est_weight_kg' => $l['weight_kg'], 'weighed_kg' => $l['weight_kg'], 'weight_source' => $l['weight_source'],
                        'discount_pct' => 0, 'discount_amount' => 0, 'est_amount' => $l['amount'], 'final_amount' => $l['amount'], 'created_at' => now(),
                    ]);
                }
                $o = Pedidos::recalcular($o->id);
                DB::table('sales_orders')->where('id', $o->id)->update([
                    'status' => 'CONFIRMED', 'confirmed_at' => now(), 'pos_shift_id' => $turno->id, 'pos_terminal_id' => $caja->id, 'pos_ticket' => $ticket,
                    'origin_locked' => true, 'prep_notes_ok' => true, 'last_activity_at' => now(), 'updated_at' => now(),
                ]);
                Estados::historial($o, 'DRAFT', 'CONFIRMED', "Venta del mostrador {$ticket}", $u);

                // RN-POS-10: sale del almacén de la caja por FEFO, solo lo disponible.
                $lineasPedido = DB::table('sales_order_lines')->where('sales_order_id', $o->id)->orderBy('line_no')->get();
                $docLineas = [];
                foreach ($lineasPedido as $k => $lp) {
                    $l = $ls[$k];
                    $mov = InventarioService::mover([
                        'type' => 'SALE', 'warehouse_id' => $caja->warehouse_id, 'variant_id' => $l['variant_id'], 'qty' => $l['stock_qty'],
                        'weight_kg' => $l['weight_kg'], 'source_type' => 'POS_SALE', 'source_id' => $o->id, 'reason' => "Venta del mostrador {$ticket}",
                    ], $u);
                    $lote = $mov['moves'][0]['lot_id'] ?? null;
                    DB::table('sales_order_lines')->where('id', $lp->id)->update(['lot_id' => $lote, 'updated_at' => now()]);
                    $costo = abs((float) $mov['total_cost']);
                    $docLineas[] = [
                        'variant_id' => $l['variant_id'], 'description' => $l['name'], 'qty' => $l['doc_qty'], 'uom_code' => $l['uom'],
                        'unit_price' => $l['price'], 'total' => $l['amount'], 'lot_id' => $lote,
                        'unit_cost' => $l['doc_qty'] > 0 ? round($costo / $l['doc_qty'], 2) : null, 'cost' => round($costo, 2),
                    ];
                }
                DB::table('sales_orders')->where('id', $o->id)->update(['status' => 'DELIVERED', 'delivered_at' => now(), 'updated_at' => now()]);
                Estados::historial($o, 'CONFIRMED', 'DELIVERED', 'Entregado en el mostrador', $u);

                $doc = Comprobantes::emitir([
                    'brand_id' => $m['brand_id'], 'establishment_id' => $caja->establishment_id, 'series_id' => $series[$m['brand_id']]->id,
                    'doc_type' => $tipo, 'customer' => $cliente, 'order_id' => $o->id, 'seller_id' => $u->id,
                    'pos_shift_id' => $turno->id, 'pos_terminal_id' => $caja->id, 'pos_ticket' => $ticket, 'balance' => $m['total'],
                ], $docLineas, $u);
                $pedidos[$o->id] = Pedidos::pedido($o->id);
                $docs[$o->id] = $doc;
            }

            $destinos = array_map(fn ($oid) => ['order_id' => $oid, 'document_id' => $docs[$oid]->id, 'amount' => (float) ($pedidos[$oid]->final_total ?? $pedidos[$oid]->estimated_total)], array_keys($pedidos));
            $r = Cobros::registrar($v, $destinos, $caja, $turno, $cliente->id, $ticket, $u);
            foreach ($pedidos as $oid => $o) {
                $pagado = $r['aplicado'][$oid] ?? 0;
                $total = (float) ($o->final_total ?? $o->estimated_total);
                if (abs($pagado - $total) > Cajas::EPS) {
                    RuleError::fail('RN-POS-11', 'La suma de pagos debe igualar el total de cada comprobante.');
                }
                DB::table('sales_documents')->where('id', $docs[$oid]->id)->update(['balance' => round($total - $pagado, 2), 'updated_at' => now()]);
                DB::table('sales_orders')->where('id', $oid)->update([
                    'paid_amount' => round($pagado, 2), 'cash_given' => $v['efectivo'] > 0 ? $v['efectivo'] : null, 'change_given' => $v['vuelto'],
                    'status' => 'CLOSED', 'closed_at' => now(), 'updated_at' => now(),
                ]);
                Estados::historial($o, 'DELIVERED', 'CLOSED', 'Venta del mostrador pagada', $u);
                Events::emit('order.closed', 'sales_orders', $oid, ['number' => $o->number, 'total' => $total, 'paid' => $pagado, 'channel' => self::CANAL]);
            }
            if ($cliente->id !== Cajas::clienteVarios()) {
                DB::table('customers')->where('id', $cliente->id)->update([
                    'first_order_at' => DB::raw('coalesce(first_order_at, now())'), 'last_order_at' => now(),
                    'orders_count' => DB::raw('coalesce(orders_count, 0) + '.count($pedidos)),
                ]);
            }
            Events::emit('pos.sale.completed', 'pos_shifts', $turno->id, [
                'ticket' => $ticket, 'total' => $c['total'], 'documents' => array_values(array_map(fn ($x) => $x->full_number, $docs)), 'change' => $v['vuelto'],
            ]);

            return [
                'ticket' => $ticket, 'total' => $c['total'], 'vuelto' => $v['vuelto'], 'efectivo' => $v['efectivo'],
                'comprobantes' => array_values(array_map(fn ($x) => DB::table('sales_documents')->where('id', $x->id)->first(['id', 'full_number', 'doc_type', 'brand_name', 'total', 'sunat_status']), $docs)),
                'pedidos' => array_values(array_map(fn ($o) => $o->number, $pedidos)),
                'cobros' => array_map(fn ($x) => ['number' => $x->number, 'amount' => $x->amount], $r['cobros']),
            ];
        });
    }

    /** TK-000001 por empresa, con candado. */
    private static function ticket(): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['pos:ticket:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table('sales_orders')->where('pos_ticket', 'like', 'TK-%')
            ->selectRaw("max(nullif(regexp_replace(substr(pos_ticket, 4), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return 'TK-'.str_pad((string) (((int) $max) + 1), 6, '0', STR_PAD_LEFT);
    }

    public static function kg(float $v, int $d = 3): string
    {
        return number_format($v, $d, ',', ' ').' kg';
    }

    public static function cant(float $v, string $modo): string
    {
        return $modo === 'KG' ? self::kg($v) : number_format($v, 0, ',', ' ').' u';
    }
}
