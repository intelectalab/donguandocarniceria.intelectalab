<?php

namespace App\Modulos\Fac\Services;

use App\Models\User;
use App\Modulos\Plt\Models\DocumentSeries;
use App\Modulos\Plt\Services\Correlativo;
use App\Modulos\Plt\Services\Marcas;
use App\Modulos\Plt\Services\Periodos;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Emisión de comprobantes (FAC-02, FAC-03 y el emisor que usan POS, notas y reemisión).
 *
 * Un solo RUC (la empresa del local) emite para todas las marcas. El número lo da Correlativo dentro
 * de la misma transacción (sin saltos, RN-FAC-02); la cabecera sale de la suma de las líneas
 * (RN-FAC-01) y el envío al OSE es asíncrono (Envios, RN-FAC-06).
 */
final class Emision
{
    public const EPS = 0.005;

    /* ------------------------------------------------------------------ series (RN-FAC-02) */

    /**
     * Serie para emitir: la indicada (validada) o la de la marca en ese local.
     * $opc: series_id, applies_to (notas: INVOICE o RECEIPT), mostrador (serie sin marca del mostrador).
     */
    public static function serie(string $tipo, string $marca, string $local, array $opc = []): object
    {
        $empresa = DB::table('establishments')->where('id', $local)->value('company_id') ?? RuleError::fail('RN-FAC-02', 'El local no existe.');
        if (! empty($opc['series_id'])) {
            $s = DB::table('document_series')->where('id', $opc['series_id'])->first() ?? RuleError::fail('RN-FAC-02', 'La serie no existe.');
            self::validarSerie($s, $tipo, $marca, $local, $empresa, $opc);

            return $s;
        }
        $q = DB::table('document_series')->where('doc_type', $tipo)->where('status', 'ACTIVE')->where('company_id', $empresa)
            ->where('brand_id', $marca)
            ->where(fn ($w) => $w->whereNull('establishment_id')->orWhere('establishment_id', $local)->orWhere('all_sites', true))
            ->when(! empty($opc['applies_to']), fn ($w) => $w->where(fn ($x) => $x->where('applies_to', $opc['applies_to'])
                ->orWhere(fn ($y) => $y->whereNull('applies_to')->where('series', 'like', ($opc['applies_to'] === 'INVOICE' ? 'F' : 'B').'%'))))
            ->orderByRaw('establishment_id = ? desc nulls last', [$local])->orderBy('series');
        $s = $q->first();
        if (! $s) {
            $m = DB::table('brands')->where('id', $marca)->value('name');
            $para = ! empty($opc['applies_to']) ? ' de '.($opc['applies_to'] === 'INVOICE' ? 'facturas' : 'boletas') : '';
            RuleError::fail('RN-FAC-02', 'No hay una serie de '.mb_strtolower(Catalogos::TIPOS[$tipo] ?? $tipo)."{$para} activa para {$m} en este local: créala en Series (FAC-10).");
        }

        return $s;
    }

    public static function validarSerie(object $s, string $tipo, string $marca, string $local, string $empresa, array $opc = []): void
    {
        $nombre = fn (?string $id) => $id ? DB::table('brands')->where('id', $id)->value('name') : null;
        if ($s->company_id !== $empresa) {
            RuleError::fail('RN-FAC-02', "La serie {$s->series} no pertenece a la empresa emisora.");
        }
        if ($s->doc_type !== $tipo) {
            RuleError::fail('RN-FAC-02', "La serie {$s->series} es de ".mb_strtolower(Catalogos::TIPOS[$s->doc_type] ?? $s->doc_type).', no de '.mb_strtolower(Catalogos::TIPOS[$tipo] ?? $tipo).'.');
        }
        if ($s->status !== 'ACTIVE') {
            RuleError::fail('RN-FAC-02', "La serie {$s->series} está inactiva: actívala en Series (FAC-10) o usa otra.");
        }
        if ($s->brand_id && $s->brand_id !== $marca) {
            RuleError::fail('RN-FAC-02', "La serie {$s->series} está configurada para {$nombre($s->brand_id)}: un comprobante de {$nombre($marca)} usa la serie de su marca.");
        }
        if (! $s->brand_id && empty($opc['mostrador'])) {
            RuleError::fail('RN-FAC-02', "La serie {$s->series} no tiene marca: es del mostrador y solo la usa la caja.");
        }
        if ($s->establishment_id && $s->establishment_id !== $local && ! $s->all_sites) {
            RuleError::fail('RN-FAC-02', "La serie {$s->series} es de otro local.");
        }
        if (! empty($opc['applies_to'])) {
            $letra = $opc['applies_to'] === 'INVOICE' ? 'F' : 'B';
            if (($s->applies_to && $s->applies_to !== $opc['applies_to']) || ! str_starts_with($s->series, $letra)) {
                RuleError::fail('RN-FAC-07', "La serie {$s->series} no corresponde: la nota de una ".($letra === 'F' ? 'factura usa una serie F' : 'boleta usa una serie B').'.');
            }
        }
    }

    /* ------------------------------------------------------------------ cliente (RN-FAC-04, RN-FAC-05) */

    /** Datos del adquirente que se congelan en el comprobante. */
    public static function comprador(string $customerId, array $otro = []): object
    {
        $c = DB::table('customers')->where('id', $customerId)->first(['id', 'doc_type', 'doc_number', 'full_name', 'fiscal_address', 'status'])
            ?? RuleError::fail('RN-FAC-04', 'El cliente no existe.');
        $tipo = $otro['doc_type'] ?? $c->doc_type ?? 'NONE';
        $numero = array_key_exists('doc_number', $otro) ? $otro['doc_number'] : $c->doc_number;
        $tipo = $tipo === 'PASSPORT' ? 'PAS' : $tipo;
        if (! $numero) {
            $tipo = 'NONE';
        }
        $dir = $otro['address'] ?? $c->fiscal_address ?? DB::table('customer_addresses')->where('customer_id', $c->id)->orderByDesc('is_default')->value('address_line');

        return (object) ['id' => $c->id, 'doc_type' => $tipo, 'doc_number' => $tipo === 'NONE' ? null : $numero,
            'full_name' => trim((string) ($otro['name'] ?? $c->full_name)) ?: 'Clientes varios', 'fiscal_address' => $dir];
    }

    public static function validarCliente(string $tipo, object $cli, float $total, string $marca): void
    {
        if ($tipo === 'INVOICE') {
            if ($cli->doc_type !== 'RUC' || ! Ruc::valido($cli->doc_number)) {
                RuleError::fail('RN-FAC-04', "La factura exige un cliente con RUC de 11 dígitos y dígito verificador válido ({$cli->full_name}: ".($cli->doc_number ?: 'sin documento').'). Emite boleta o corrige el RUC en Clientes.');
            }

            return;
        }
        if ($tipo === 'RECEIPT') {
            $tope = (float) (Params::get('fac_receipt_id_required_above', ['brand' => $marca]) ?? 700);
            if ($total > $tope + self::EPS && ($cli->doc_type === 'NONE' || ! $cli->doc_number)) {
                RuleError::fail('RN-FAC-05', 'La boleta de S/ '.number_format($total, 2).' pasa de S/ '.number_format($tope, 2).': identifica al cliente con su DNI u otro documento.');
            }
        }
    }

    /* ------------------------------------------------------------------ montos (RN-FAC-01) */

    /**
     * Valor de venta e IGV por línea según su afectación (10 gravado; 20 y 30 sin IGV). Lo que sobra del
     * redondeo va a la línea gravada mayor, para que la cabecera (base del total gravado) cuadre.
     */
    public static function montos(array $lineas): array
    {
        $tasa = Catalogos::igv();
        $filas = [];
        foreach (array_values($lineas) as $i => $l) {
            $t = round((float) $l['total'], 2);
            $af = (string) ($l['igv_affectation'] ?? '10');
            $b = $af === '10' ? round($t / (1 + $tasa), 2) : $t;
            $filas[$i] = $l + ['subtotal' => $b, 'igv' => round($t - $b, 2), 'igv_affectation' => $af, 'total' => $t];
        }
        $gravadas = array_filter($filas, fn ($f) => $f['igv_affectation'] === '10');
        if ($gravadas) {
            $totalGravado = round(array_sum(array_column($gravadas, 'total')), 2);
            $base = round($totalGravado / (1 + $tasa), 2);
            $resto = round($base - array_sum(array_column($gravadas, 'subtotal')), 2);
            if (abs($resto) >= self::EPS) {
                $mayor = array_key_first($gravadas);
                foreach ($gravadas as $i => $f) {
                    if ($f['total'] > $filas[$mayor]['total']) {
                        $mayor = $i;
                    }
                }
                $filas[$mayor]['subtotal'] = round($filas[$mayor]['subtotal'] + $resto, 2);
                $filas[$mayor]['igv'] = round($filas[$mayor]['total'] - $filas[$mayor]['subtotal'], 2);
            }
        }
        $sub = round(array_sum(array_column($filas, 'subtotal')), 2);
        $igv = round(array_sum(array_column($filas, 'igv')), 2);
        $total = round(array_sum(array_column($filas, 'total')), 2);

        return ['lineas' => $filas, 'subtotal' => $sub, 'igv' => $igv, 'total' => $total];
    }

    /** RN-FAC-01 antes de cada envío: hay líneas y suman la cabecera. */
    public static function cuadra(object $d): void
    {
        $s = DB::table('sales_document_lines')->where('sales_document_id', $d->id)
            ->selectRaw('count(*) n, coalesce(sum(total),0) t, coalesce(sum(subtotal),0) b, coalesce(sum(igv),0) g')->first();
        if ((int) $s->n === 0) {
            RuleError::fail('RN-FAC-01', "{$d->full_number} no tiene líneas: necesita al menos una antes de enviarse.");
        }
        if (abs((float) $s->t - (float) $d->total) > 0.01) {
            RuleError::fail('RN-FAC-01', "Las líneas de {$d->full_number} suman S/ ".number_format((float) $s->t, 2).' y la cabecera dice S/ '.number_format((float) $d->total, 2).': no se envía.');
        }
        if (abs((float) $s->b - (float) $d->subtotal) > 0.01 || abs((float) $s->g - (float) $d->igv) > 0.01) {
            RuleError::fail('RN-FAC-01', "El valor de venta o el IGV de las líneas de {$d->full_number} no cuadra con la cabecera.");
        }
        if (abs(round((float) $d->subtotal + (float) $d->igv, 2) - (float) $d->total) > 0.01) {
            RuleError::fail('RN-FAC-01', "En {$d->full_number} el valor de venta más el IGV no es igual al total.");
        }
    }

    /* ------------------------------------------------------------------ registro */

    /**
     * Guarda el comprobante con su número y líneas y lo manda a la cola del OSE. Es el emisor común:
     * POS (mostrador, devoluciones), FAC-02, FAC-03, notas y reemisión pasan por aquí.
     *
     * $c: doc_type, series_id, brand_id, establishment_id, customer (objeto de comprador()), order_id,
     *     related_document_id, seller_id, pos_shift_id, pos_terminal_id, pos_ticket, balance,
     *     note_reason_code, note_reason, refund_mode, refund_method, refund_status, payment_terms,
     *     due_date, credit_days, issue_date, source, reissue_of, mostrador.
     * $lineas: variant_id, description, qty, uom_code, unit_price, total, igv_affectation, lot_id, unit_cost, cost.
     */
    public static function registrar(array $c, array $lineas, User $u, bool $enviar = true): object
    {
        if (! $lineas) {
            RuleError::fail('RN-FAC-01', 'El comprobante necesita al menos una línea.');
        }
        foreach ($lineas as $l) {
            $desc = trim((string) ($l['description'] ?? '')) ?: '—';
            if (! ((float) ($l['qty'] ?? 0) > 0)) {
                RuleError::fail('RN-FAC-01', "La línea «{$desc}» no tiene cantidad.");
            }
            if (! ((float) ($l['total'] ?? 0) > 0)) {
                RuleError::fail('RN-FAC-01', "La línea «{$desc}» no tiene importe.");
            }
        }
        $cli = $c['customer'];
        $marca = Marcas::activa($c['brand_id']);
        $local = DB::table('establishments')->where('id', $c['establishment_id'])->first(['id', 'company_id', 'address']);
        $fecha = $c['issue_date'] ?? now('America/Lima')->toDateString();
        $m = self::montos($lineas);
        $costo = round(array_sum(array_map(fn ($l) => (float) ($l['cost'] ?? 0), $lineas)), 2);
        $credito = ($c['payment_terms'] ?? 'CASH') === 'CREDIT';
        $resumen = $c['doc_type'] === 'RECEIPT' && Catalogos::modoBoletas() === 'SUMMARY';

        $doc = Correlativo::emitir($c['series_id'], function (DocumentSeries $serie, int $numero) use ($c, $cli, $marca, $local, $fecha, $m, $costo, $credito, $resumen, $u) {
            // RN-FAC-17: dentro de la misma transacción.
            try {
                Periodos::abierto($fecha, $local->company_id);
            } catch (RuleError $e) {
                RuleError::fail('RN-FAC-17', 'No se emite con fecha de un período cerrado: '.$e->getMessage());
            }
            if ($serie->doc_type !== $c['doc_type']) {
                RuleError::fail('RN-FAC-02', "La serie {$serie->series} no es de ".mb_strtolower(Catalogos::TIPOS[$c['doc_type']]).'.');
            }
            if ($serie->company_id !== $local->company_id) {
                RuleError::fail('RN-FAC-02', "La serie {$serie->series} no pertenece a la empresa emisora.");
            }
            $full = Correlativo::numeroCompleto($serie->series, $numero);
            $id = DB::table('sales_documents')->insertGetId([
                'company_id' => $local->company_id, 'establishment_id' => $local->id, 'brand_id' => $marca->id,
                'series_id' => $serie->id, 'doc_type' => $c['doc_type'], 'series' => $serie->series, 'number' => $numero, 'full_number' => $full,
                'issue_date' => $fecha, 'issued_at' => now(),
                'customer_id' => $cli->id, 'customer_doc_type' => $cli->doc_type ?: 'NONE', 'customer_doc_number' => $cli->doc_number ?: null,
                'customer_name' => mb_substr((string) $cli->full_name, 0, 200), 'buyer_address' => isset($cli->fiscal_address) ? mb_substr((string) $cli->fiscal_address, 0, 255) : null,
                'order_id' => $c['order_id'] ?? null, 'related_document_id' => $c['related_document_id'] ?? null,
                'currency' => 'PEN', 'subtotal' => $m['subtotal'], 'igv' => $m['igv'], 'total' => $m['total'], 'cost' => $costo,
                'payment_terms' => $credito ? 'CREDIT' : 'CASH', 'credit_days' => $credito ? ($c['credit_days'] ?? null) : null,
                'due_date' => $credito ? $c['due_date'] : null,
                'sunat_status' => 'PENDING', 'status' => 'ISSUED', 'seller_id' => $c['seller_id'] ?? null,
                'note_reason_code' => $c['note_reason_code'] ?? null, 'note_reason' => isset($c['note_reason']) ? mb_substr((string) $c['note_reason'], 0, 255) : null,
                'send_attempts' => 0, 'balance' => round((float) ($c['balance'] ?? $m['total']), 2),
                'xml_hash' => substr(base64_encode(hash('sha256', $full.'|'.$m['total'].'|'.$cli->id.'|'.microtime(true), true)), 0, 28),
                'brand_name' => mb_substr($marca->name, 0, 40), 'brand_logo' => mb_substr('logo-'.$marca->code, 0, 40),
                'pos_shift_id' => $c['pos_shift_id'] ?? null, 'pos_terminal_id' => $c['pos_terminal_id'] ?? null, 'pos_ticket' => $c['pos_ticket'] ?? null,
                'refund_mode' => $c['refund_mode'] ?? null, 'refund_method' => $c['refund_method'] ?? null, 'refund_status' => $c['refund_status'] ?? null,
                'summary_pending' => $resumen, 'reissue_of' => $c['reissue_of'] ?? null, 'issued_by_name' => mb_substr($u->name, 0, 120),
                'source' => $c['source'] ?? (! empty($c['pos_terminal_id']) ? 'POS' : (! empty($c['order_id']) ? 'ORDER' : 'DIRECT')),
                'created_at' => now(),
            ], 'id');
            $n = 0;
            foreach ($m['lineas'] as $l) {
                DB::table('sales_document_lines')->insert([
                    'sales_document_id' => $id, 'line_no' => ++$n, 'variant_id' => $l['variant_id'] ?? null, 'description' => trim((string) $l['description']),
                    'qty' => round((float) $l['qty'], 3), 'uom_code' => $l['uom_code'] ?? 'NIU', 'unit_price' => round((float) $l['unit_price'], 2),
                    'igv_affectation' => $l['igv_affectation'], 'total' => $l['total'], 'subtotal' => $l['subtotal'], 'igv' => $l['igv'],
                    'lot_id' => $l['lot_id'] ?? null, 'unit_cost' => isset($l['unit_cost']) ? round((float) $l['unit_cost'], 2) : null,
                    'cost' => round((float) ($l['cost'] ?? 0), 2), 'created_at' => now(),
                ]);
            }
            $doc = DB::table('sales_documents')->where('id', $id)->first();
            self::cuadra($doc);
            Events::emit('document.issued', 'sales_documents', $id, ['full_number' => $full, 'doc_type' => $c['doc_type'], 'total' => $m['total'],
                'order_id' => $c['order_id'] ?? null, 'source' => $doc->source]);

            return $doc;
        });

        if ($enviar && ! $doc->summary_pending) {
            Envios::enviar($doc->id);
        }

        return DB::table('sales_documents')->where('id', $doc->id)->first();
    }

    /* ------------------------------------------------------------------ FAC-03 Emisión directa */

    /**
     * Comprobante sin pedido. $d: doc_type, brand_id, establishment_id, customer_id, series_id, payment_terms,
     * credit_days, issue_date, buyer (doc_type, doc_number, name, address), lines (variant_id o descripción).
     */
    public static function directa(array $d, User $u): object
    {
        self::alcance($u, $d['brand_id'], $d['establishment_id']);
        $cli = self::comprador($d['customer_id'], $d['buyer'] ?? []);
        $lineas = [];
        foreach ($d['lines'] as $l) {
            $v = ! empty($l['variant_id']) ? DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')
                ->where('v.id', $l['variant_id'])->first(['v.id', 'v.name', 'v.brand_id', 'v.sale_mode', 'v.std_cost', 'p.igv_affectation']) : null;
            if (! empty($l['variant_id']) && ! $v) {
                RuleError::fail('RN-FAC-01', 'Un producto de la lista no existe.');
            }
            if ($v && $v->brand_id && $v->brand_id !== $d['brand_id']) {
                RuleError::fail('RN-FAC-02', "«{$v->name}» es de otra marca: el comprobante lleva productos de su marca.");
            }
            $qty = round((float) $l['qty'], 3);
            $precio = round((float) $l['unit_price'], 2);
            $lineas[] = [
                'variant_id' => $v?->id, 'description' => trim((string) ($l['description'] ?? '')) ?: ($v->name ?? 'Servicio'),
                'qty' => $qty, 'uom_code' => $l['uom_code'] ?? ($v ? ($v->sale_mode === 'KG' ? 'KGM' : 'NIU') : 'ZZ'),
                'unit_price' => $precio, 'total' => round($qty * $precio, 2), 'igv_affectation' => $l['igv_affectation'] ?? ($v->igv_affectation ?? '10'),
                'unit_cost' => $v ? (float) $v->std_cost : null, 'cost' => $v ? round((float) $v->std_cost * $qty, 2) : 0,
            ];
        }

        return self::emitir($d, $cli, $lineas, $u, ['source' => 'DIRECT']);
    }

    /** Valida tipo, cliente, serie y crédito y registra (directa y desde pedido). */
    public static function emitir(array $d, object $cli, array $lineas, User $u, array $extra = []): object
    {
        if (! in_array($d['doc_type'], ['INVOICE', 'RECEIPT'], true)) {
            RuleError::fail('RN-FAC-02', 'Aquí se emiten facturas y boletas; las notas salen desde el comprobante.');
        }
        $total = round(array_sum(array_map(fn ($l) => round((float) $l['total'], 2), $lineas)), 2);
        self::validarCliente($d['doc_type'], $cli, $total, $d['brand_id']);
        $credito = ($d['payment_terms'] ?? 'CASH') === 'CREDIT';
        $fecha = $d['issue_date'] ?? now('America/Lima')->toDateString();
        $due = null;
        if ($credito) {
            $dias = (int) ($d['credit_days'] ?? 0);
            $due = $d['due_date'] ?? ($dias > 0 ? CarbonImmutable::parse($fecha)->addDays($dias)->toDateString() : null);
            if (! $due) {
                RuleError::fail('RN-FAC-13', 'Un comprobante al crédito necesita fecha de vencimiento (días de crédito).');
            }
            if ($due < $fecha) {
                RuleError::fail('RN-FAC-13', 'El vencimiento no puede ser antes de la fecha de emisión.');
            }
        }
        $serie = self::serie($d['doc_type'], $d['brand_id'], $d['establishment_id'], ['series_id' => $d['series_id'] ?? null]);

        return self::registrar($extra + [
            'doc_type' => $d['doc_type'], 'series_id' => $serie->id, 'brand_id' => $d['brand_id'], 'establishment_id' => $d['establishment_id'],
            'customer' => $cli, 'order_id' => $d['order_id'] ?? null, 'seller_id' => $d['seller_id'] ?? $u->id,
            'payment_terms' => $credito ? 'CREDIT' : 'CASH', 'due_date' => $due, 'credit_days' => $credito ? ((int) ($d['credit_days'] ?? 0) ?: null) : null,
            'issue_date' => $fecha, 'reissue_of' => $d['reissue_of'] ?? null,
        ], $lineas, $u);
    }

    /* ------------------------------------------------------------------ FAC-02 Emitir desde el pedido */

    public const ESTADOS_FACTURABLES = ['READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED'];

    /** Comprobante vigente (no anulado ni rechazado) de un pedido. */
    public static function comprobanteDelPedido(string $orderId): ?object
    {
        return DB::table('sales_documents')->where('order_id', $orderId)->whereIn('doc_type', ['INVOICE', 'RECEIPT'])
            ->where('status', 'ISSUED')->where('sunat_status', '<>', 'REJECTED')->first(['id', 'full_number']);
    }

    /** Líneas del comprobante del pedido con el peso real y el delivery como servicio (RN-FAC-14). */
    public static function lineasDelPedido(object $o): array
    {
        $ls = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->join('products as p', 'p.id', '=', 'v.product_id')
            ->where('l.sales_order_id', $o->id)->orderBy('l.line_no')
            ->get(['l.*', 'v.name', 'v.sale_mode', 'v.std_cost', 'p.igv_affectation']);
        $pend = $ls->filter(fn ($l) => $l->price_basis === 'KG' && $l->weighed_kg === null)->count();
        if ($pend) {
            RuleError::fail('RN-FAC-14', "Faltan pesar {$pend} línea(s) por kg del pedido {$o->number}: el comprobante sale con el peso real.");
        }
        $lineas = [];
        foreach ($ls as $l) {
            $kg = $l->price_basis === 'KG';
            $qty = $kg ? (float) $l->weighed_kg : (float) $l->qty;
            $importe = round((float) ($kg ? ($l->final_amount ?? $l->est_amount) : ($l->final_amount ?? $l->est_amount)), 2);
            if ($qty <= 0 || $importe <= 0) {
                continue;
            }
            $desc = $l->name.($kg ? ' · '.number_format($qty, 3, ',', ' ').' kg'.($l->sale_mode === 'UNIT_VARIABLE_WEIGHT' ? ' ('.(int) $l->qty.' u)' : '') : '');
            $lineas[] = ['variant_id' => $l->variant_id, 'description' => $desc, 'qty' => round($qty, 3), 'units' => (float) $l->qty, 'uom_code' => $kg ? 'KGM' : 'NIU',
                'unit_price' => round($importe / $qty, 2), 'total' => $importe, 'igv_affectation' => $l->igv_affectation ?: '10', 'lot_id' => $l->lot_id,
                'unit_cost' => (float) $l->std_cost, 'cost' => round((float) $l->std_cost * ($kg ? $qty : (float) $l->qty), 2)];
        }
        if (! $lineas) {
            RuleError::fail('RN-FAC-01', "El pedido {$o->number} no tiene líneas con importe.");
        }
        // Descuento del pedido: se reparte entre los productos para que el comprobante sea el total final.
        $fee = round((float) $o->delivery_fee, 2);
        $final = round((float) ($o->final_total ?? $o->estimated_total), 2);
        $sub = round(array_sum(array_column($lineas, 'total')), 2);
        $desc = round($sub + $fee - $final, 2);
        if ($desc > self::EPS && $sub > 0) {
            $quedan = $desc;
            $mayor = 0;
            foreach ($lineas as $i => $l) {
                $parte = round($desc * $l['total'] / $sub, 2);
                $lineas[$i]['total'] = round($l['total'] - $parte, 2);
                $quedan = round($quedan - $parte, 2);
                if ($l['total'] > $lineas[$mayor]['total']) {
                    $mayor = $i;
                }
            }
            $lineas[$mayor]['total'] = round($lineas[$mayor]['total'] - $quedan, 2);
            foreach ($lineas as $i => $l) {
                $lineas[$i]['unit_price'] = round($l['total'] / $l['qty'], 2);
            }
        }
        if ($fee > 0) {
            $lineas[] = ['variant_id' => null, 'description' => 'Servicio de delivery', 'qty' => 1, 'uom_code' => 'ZZ', 'unit_price' => $fee, 'total' => $fee,
                'igv_affectation' => '10', 'cost' => 0];
        }

        return $lineas;
    }

    /** Tipo sugerido: factura si el cliente de facturación tiene RUC válido y la pidió, si no boleta. */
    public static function tipoSugerido(object $o, object $cli): string
    {
        if ($o->requested_doc_type === 'INVOICE' && $cli->doc_type === 'RUC' && Ruc::valido($cli->doc_number)) {
            return 'INVOICE';
        }

        return $o->requested_doc_type === 'INVOICE' && $cli->doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT';
    }

    /** Lo que verá FAC-02 antes de emitir: cliente, tipo, serie, líneas y montos. */
    public static function vistaPedido(string $orderId, User $u): array
    {
        $o = self::pedidoFacturable($orderId, $u);
        $cli = self::comprador($o->billing_customer_id ?? $o->customer_id);
        $tipo = self::tipoSugerido($o, $cli);
        $lineas = self::lineasDelPedido($o);
        $m = self::montos($lineas);
        $serie = fn ($t) => rescue(fn () => self::serie($t, $o->brand_id, $o->establishment_id)->series, null, false);
        $metodo = $o->payment_method_id ? DB::table('payment_methods')->where('id', $o->payment_method_id)->first(['code', 'name']) : null;
        $diasCredito = (int) (Params::get('fac_default_credit_days') ?? 15) ?: 15;

        return [
            'pedido' => ['id' => $o->id, 'number' => $o->number, 'status' => $o->status, 'channel' => $o->channel, 'delivery_date' => $o->delivery_date,
                'requested_doc_type' => $o->requested_doc_type, 'final_total' => (float) ($o->final_total ?? $o->estimated_total), 'delivery_fee' => (float) $o->delivery_fee,
                'brand' => DB::table('brands')->where('id', $o->brand_id)->value('name'), 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
                'paid_amount' => (float) $o->paid_amount, 'payment_method' => $metodo?->name, 'credit' => $metodo?->code === 'CREDIT'],
            'cliente' => $cli, 'tipo' => $tipo, 'series' => ['INVOICE' => $serie('INVOICE'), 'RECEIPT' => $serie('RECEIPT')],
            'lineas' => $m['lineas'], 'subtotal' => $m['subtotal'], 'igv' => $m['igv'], 'total' => $m['total'], 'credit_days' => $diasCredito,
            'factura_posible' => $cli->doc_type === 'RUC' && Ruc::valido($cli->doc_number),
            'tope_boleta' => (float) (Params::get('fac_receipt_id_required_above', ['brand' => $o->brand_id]) ?? 700),
        ];
    }

    public static function pedidoFacturable(string $orderId, User $u): object
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first() ?? RuleError::fail('RN-FAC-14', 'El pedido no existe.');
        self::alcance($u, $o->brand_id, $o->establishment_id);
        if (! in_array($o->status, self::ESTADOS_FACTURABLES, true)) {
            RuleError::fail('RN-FAC-14', "El pedido {$o->number} está «".self::estadoPedido($o->status).'»: se factura listo o entregado, con su peso real.');
        }
        if ($o->requested_doc_type === 'NONE') {
            RuleError::fail('RN-FAC-14', "El pedido {$o->number} no pidió comprobante.");
        }
        if ($prev = self::comprobanteDelPedido($o->id)) {
            RuleError::fail('RN-FAC-14', "El pedido {$o->number} ya tiene el comprobante {$prev->full_number}.");
        }

        return $o;
    }

    /** FAC-02: emite el comprobante del pedido. $opc: doc_type, buyer, credit_days, issue_date. */
    public static function desdePedido(string $orderId, array $opc, User $u): object
    {
        return DB::transaction(function () use ($orderId, $opc, $u) {
            DB::table('sales_orders')->where('id', $orderId)->lockForUpdate()->first();
            $o = self::pedidoFacturable($orderId, $u);
            $cli = self::comprador($o->billing_customer_id ?? $o->customer_id, $opc['buyer'] ?? []);
            $tipo = $opc['doc_type'] ?? self::tipoSugerido($o, $cli);
            $metodo = $o->payment_method_id ? DB::table('payment_methods')->where('id', $o->payment_method_id)->value('code') : null;
            $credito = ($opc['payment_terms'] ?? ($metodo === 'CREDIT' ? 'CREDIT' : 'CASH')) === 'CREDIT';
            $dias = (int) ($opc['credit_days'] ?? Params::get('fac_default_credit_days') ?? 15);
            $doc = self::emitir([
                'doc_type' => $tipo, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id, 'order_id' => $o->id,
                'seller_id' => $o->seller_id ?? $u->id, 'payment_terms' => $credito ? 'CREDIT' : 'CASH', 'credit_days' => $dias,
                'issue_date' => $opc['issue_date'] ?? null, 'series_id' => $opc['series_id'] ?? null,
            ], $cli, self::lineasDelPedido($o), $u, [
                'source' => 'ORDER', 'balance' => max(0, round((float) ($o->final_total ?? $o->estimated_total) - (float) $o->paid_amount, 2)),
            ]);
            // El cobro del pedido ya registrado se enlaza al comprobante (CAJ lo concilia).
            DB::table('payment_allocations')->where('order_id', $o->id)->whereNull('document_id')->update(['document_id' => $doc->id, 'updated_at' => now()]);

            return $doc;
        });
    }

    /* ------------------------------------------------------------------ alcance */

    /** El usuario trabaja con esa marca y ese local (alcance de SEG). */
    public static function alcance(User $u, ?string $marca, ?string $local): void
    {
        $a = Access::for($u);
        if ($marca && $a['brands'] && ! in_array($marca, $a['brands'], true)) {
            RuleError::fail('PERMISSION_DENIED', 'Esa marca no está en tu alcance.');
        }
        if ($local && $a['establishments'] && ! in_array($local, $a['establishments'], true)) {
            RuleError::fail('PERMISSION_DENIED', 'Ese local no está en tu alcance.');
        }
    }

    /** Filtra una consulta de comprobantes por el alcance del usuario. */
    public static function filtrar($q, User $u, string $alias = 'd')
    {
        $a = Access::for($u);

        return $q->when($a['brands'], fn ($w) => $w->whereIn("{$alias}.brand_id", $a['brands']))
            ->when($a['establishments'], fn ($w) => $w->whereIn("{$alias}.establishment_id", $a['establishments']));
    }

    public static function estadoPedido(string $s): string
    {
        return ['DRAFT' => 'borrador', 'CONFIRMED' => 'confirmado', 'IN_PREPARATION' => 'en preparación', 'WEIGHED' => 'pesado', 'READY' => 'listo',
            'IN_ROUTE' => 'en ruta', 'DELIVERED' => 'entregado', 'NOT_DELIVERED' => 'no entregado', 'CLOSED' => 'cerrado', 'CANCELLED' => 'cancelado'][$s] ?? strtolower($s);
    }
}
