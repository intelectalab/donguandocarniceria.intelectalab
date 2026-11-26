<?php

namespace App\Modulos\Cnt\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * CNT · motor de asientos (cnt_build_entry). Dueño de journal_entries y journal_lines: los demás módulos piden el asiento
 * de su documento con alRegistrar() y lo reversan con alAnular(); nadie más escribe esas tablas.
 *  RN-CNT-01  se aprueba solo si cuadra (también en la base).
 *  RN-CNT-02  aprueba alguien con cnt.entry.approve distinto de quien lo preparó; la regla auto_approve lo deja aprobado.
 *  RN-CNT-03  aprobado no se modifica ni se borra: se corrige con un reverso (también en la base).
 *  RN-CNT-04  cada línea va al debe o al haber, no ambos, y no negativa (también en la base).
 *  RN-CNT-05  solo cuentas que reciben movimientos; con centro de costo o tercero si la cuenta lo exige.
 *  RN-CNT-06  sin asientos en un período cerrado (también en la base).
 *  RN-CNT-09  sin regla vigente, el documento va a la bandeja con NO_RULE.
 *  RN-CNT-14  número correlativo por empresa y período, al aprobar.
 *  RN-CNT-16  ingresos, costos y gastos llevan marca; sin marca va a la bandeja con MISSING_BRAND.
 *  RN-CNT-19  moneda extranjera en soles con el tipo de cambio de su fecha.
 *  RN-CNT-20  un documento tiene como máximo un asiento vigente por regla.
 */
final class AsientosService
{
    /** Orígenes que genera el motor (documento de origen => nombre). */
    public const ORIGENES = [
        'SALE' => 'Venta', 'COLLECTION' => 'Cobro', 'PURCHASE' => 'Compra', 'SUPPLIER_PAYMENT' => 'Pago a proveedor', 'EXPENSE' => 'Gasto', 'PAYROLL' => 'Planilla',
    ];

    public const ESTADOS_VIVOS = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];

    /** Cuenta de existencias según el tipo de producto, y su compra (60) para el amarre. */
    private const COMPRA_DE_EXISTENCIA = ['2011' => '6011', '2111' => '6011', '2411' => '6021', '2521' => '6032', '2611' => '6041'];

    /** Destino por área del centro de costo (amarre de la clase 6 a la 9). */
    private const DESTINO_POR_AREA = ['PRODUCTION' => '921', 'QUALITY' => '921', 'WAREHOUSE' => '921', 'ADMIN' => '941', 'FINANCE' => '941', 'HR' => '941',
        'SALES' => '951', 'MARKETING' => '951', 'DELIVERY' => '952'];

    private static array $cuentas = [];

    /** CNT encendido para la empresa (si no, los módulos siguen sin asientos). */
    public static function activo(): bool
    {
        return DB::table('tenant_modules')->where('module_code', 'CNT')->where('enabled', true)->exists();
    }

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function mes(string $fecha): string
    {
        return substr($fecha, 0, 7).'-01';
    }

    public static function r(mixed $v): float
    {
        return round((float) $v, 2);
    }

    public static function cuenta(?string $codigo): ?object
    {
        if (! $codigo) {
            return null;
        }
        $t = DB::selectOne('SELECT app_tenant_id() AS t')->t;
        self::$cuentas[$t] ??= DB::table('gl_accounts')->get()->keyBy('code')->all();

        return self::$cuentas[$t][$codigo] ?? null;
    }

    public static function olvidarCuentas(): void
    {
        self::$cuentas = [];
    }

    /* ================================================================ hechos de cada documento */

    public static function cuentaDeCaja(?string $cashAccountId): ?string
    {
        if (! $cashAccountId) {
            return null;
        }
        $c = DB::table('cash_accounts')->where('id', $cashAccountId)->first();
        if (! $c) {
            return null;
        }
        $porCodigo = ['CAJA-L1' => '1011', 'CCH-L1' => '1012', 'CCH-L2' => '1012', 'BCP-CTE' => '104101', 'IBK-CTE' => '104102', 'YAPE' => '104103', 'PLIN' => '104103', 'MP' => '1031', 'POS-VISA' => '1032'];
        if (isset($porCodigo[$c->code])) {
            return $porCodigo[$c->code];
        }
        if (str_starts_with($c->code, 'DRV-')) {
            return '1013';
        }

        return ['CASH_REGISTER' => '1011', 'PETTY_CASH' => '1012', 'DRIVER_CASH' => '1013', 'BANK' => '104101', 'WALLET' => '104103', 'GATEWAY' => '1031', 'CARD_ACQUIRER' => '1032'][$c->account_type] ?? null;
    }

    private static function cuentaDeExistencia(?string $variantId): string
    {
        $p = $variantId ? DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $variantId)->first(['p.product_type', 'p.origin']) : null;

        return match (true) {
            ! $p => '2111',
            $p->product_type === 'PACKAGING' => '2611',
            $p->origin === 'RAW_MATERIAL' => '2411',
            $p->product_type === 'INPUT' => '2521',
            $p->origin === 'RESALE' => '2011',
            default => '2111',
        };
    }

    /** Centro de costo por id o por el código del prototipo («cc-PROD-L2»). */
    private static function centro(?string $cc): ?string
    {
        if (! $cc) {
            return null;
        }
        if (preg_match('/^[0-9a-f-]{36}$/', $cc)) {
            return $cc;
        }

        return DB::table('cost_centers')->where('code', preg_replace('/^cc-/', '', $cc))->value('id');
    }

    private static function marcaDeCentro(?string $cc): ?string
    {
        return $cc ? DB::table('cost_centers')->where('id', $cc)->value('brand_id') : null;
    }

    private static function tercero(string $tipo, ?string $id): ?array
    {
        if (! $id) {
            return null;
        }
        if ($tipo === 'SUPPLIER') {
            $s = DB::table('suppliers')->where('id', $id)->first();

            return $s ? ['type' => 'SUPPLIER', 'id' => $id, 'doc' => $s->doc_number, 'name' => $s->trade_name ?: $s->legal_name] : null;
        }
        $c = DB::table('customers')->where('id', $id)->first();

        return $c ? ['type' => 'CUSTOMER', 'id' => $id, 'doc' => $c->doc_number, 'name' => $c->trade_name ?: $c->full_name] : null;
    }

    private static function ajustar(array &$det, float $total): void
    {
        $dif = self::r($total - array_sum(array_column($det, 'amount')));
        if (abs($dif) >= 0.005 && $det) {
            $i = array_keys(array_column($det, 'amount'), max(array_column($det, 'amount')))[0];
            $det[$i]['amount'] = self::r($det[$i]['amount'] + $dif);
        }
    }

    /**
     * Lo que la regla necesita de un documento: origen, subtipo, fecha, importes, detalle, marca, local, tercero y cuentas de caja.
     * Devuelve ['skip' => motivo] si el documento no se asienta.
     */
    public static function hechos(string $tipo, string $id): ?array
    {
        switch ($tipo) {
            case 'SALE':
                $d = DB::table('sales_documents')->where('id', $id)->first();
                if (! $d) {
                    return null;
                }
                if ($d->status === 'VOIDED' || in_array($d->sunat_status, ['REJECTED', 'VOIDED'], true)) {
                    return ['skip' => 'Comprobante anulado o rechazado por la SUNAT', 'date' => $d->issue_date];
                }

                return ['source' => 'SALE', 'subtype' => $d->doc_type, 'date' => substr($d->issue_date, 0, 10), 'company_id' => $d->company_id,
                    'label' => ($d->doc_type === 'INVOICE' ? 'Factura' : ($d->doc_type === 'RECEIPT' ? 'Boleta' : 'Nota')).' '.$d->series.'-'.$d->number,
                    'brand' => $d->brand_id, 'site' => $d->establishment_id, 'third' => self::tercero('CUSTOMER', $d->customer_id) ?? ['type' => 'CUSTOMER', 'id' => $d->customer_id, 'doc' => $d->customer_doc_number, 'name' => $d->customer_name],
                    'amounts' => ['BASE' => (float) $d->subtotal, 'IGV' => (float) $d->igv, 'TOTAL' => (float) $d->total]];
            case 'COLLECTION':
                $p = DB::table('payments')->where('id', $id)->first();
                if (! $p) {
                    return null;
                }
                $fecha = CarbonImmutable::parse($p->paid_at)->setTimezone('America/Lima')->toDateString();
                if ($p->status !== 'CONFIRMED') {
                    return ['skip' => 'Cobro revertido', 'date' => $fecha];
                }
                $gl = self::cuentaDeCaja($p->cash_account_id);
                if (! $gl) {
                    return ['skip' => 'Aplicación de saldo a favor o venta al crédito: sin movimiento de caja', 'date' => $fecha];
                }

                return ['source' => 'COLLECTION', 'subtype' => 'PAYMENT', 'date' => $fecha, 'company_id' => DB::table('establishments')->where('id', $p->establishment_id)->value('company_id'),
                    'label' => "Cobro {$p->number}".($p->reference ? " · op. {$p->reference}" : ''), 'brand' => $p->brand_id, 'site' => $p->establishment_id,
                    'cash_gl' => $gl, 'third' => self::tercero('CUSTOMER', $p->customer_id), 'amounts' => ['TOTAL' => (float) $p->amount]];
            case 'PURCHASE':
                $d = DB::table('purchase_documents')->where('id', $id)->first();
                if (! $d) {
                    return null;
                }
                if ($d->status === 'VOIDED') {
                    return ['skip' => 'Comprobante anulado', 'date' => $d->accounting_date];
                }
                if ($d->match_status === 'OBSERVED') {
                    return ['skip' => 'Observado en el cruce de tres vías: espera la aprobación en la bandeja', 'date' => $d->accounting_date, 'held' => true];
                }
                $tc = (float) $d->exchange_rate ?: 1;
                $nti = $d->doc_type === 'INTERNAL_TRANSFER';
                $s = DB::table('suppliers')->where('id', $d->supplier_id)->first();
                $base = self::r(((float) $d->base_taxed + (float) $d->non_taxed + (float) $d->other_charges) * $tc);
                $igv = self::r((float) $d->igv * $tc);
                $credito = $d->igv_is_credit && $igv > 0;
                $detBase = $credito ? $base : self::r($base + $igv);
                $marca = $d->brand_id ?: self::marcaDeCentro($d->cost_center_id);
                $det = [];
                foreach (DB::table('purchase_document_lines')->where('document_id', $id)->get() as $l) {
                    $det[] = ['amount' => self::r(((float) $l->subtotal ?: ((float) $l->non_taxed ?: (float) $l->qty * (float) $l->unit_price)) * $tc), 'variant_id' => $l->variant_id,
                        'supplier_id' => $s->id, 'supplier_type' => $s->supplier_type, 'cc' => $l->cost_center_id ?: $d->cost_center_id, 'brand' => $marca ?: self::marcaDeCentro($l->cost_center_id),
                        'desc' => $l->description];
                }
                if (! $det) {
                    $det = [['amount' => $detBase, 'supplier_id' => $s->id, 'supplier_type' => $s->supplier_type, 'cc' => $d->cost_center_id, 'brand' => $marca, 'desc' => $d->description ?: 'Servicio']];
                }
                $suma = array_sum(array_column($det, 'amount')) ?: 1;
                foreach ($det as &$x) {
                    $x['amount'] = self::r($x['amount'] * $detBase / $suma);
                }
                unset($x);
                self::ajustar($det, $detBase);

                return ['source' => $nti ? 'NTI' : 'PURCHASE', 'subtype' => $nti ? '*' : $d->doc_type, 'date' => $d->accounting_date, 'company_id' => $d->company_id,
                    'label' => ($nti ? 'NTI' : (['INVOICE' => 'Factura', 'RECEIPT' => 'Boleta', 'FEE_RECEIPT' => 'Recibo por honorarios', 'CREDIT_NOTE' => 'Nota de crédito'][$d->doc_type] ?? 'Comprobante'))
                        ." {$d->series}-{$d->number} · ".($s->trade_name ?: $s->legal_name),
                    'brand' => $marca, 'site' => $d->establishment_id, 'cc' => $d->cost_center_id, 'third' => self::tercero('SUPPLIER', $s->id),
                    'payable_gl' => $nti ? null : ($d->doc_type === 'FEE_RECEIPT' ? '4241' : '4212'),
                    'amounts' => ['BASE' => $base, 'IGV' => $credito ? $igv : 0, 'TOTAL' => self::r((float) $d->total * $tc)], 'details' => $det,
                    'currency' => $d->currency, 'fx' => $tc, 'fx_total' => (float) $d->total];
            case 'SUPPLIER_PAYMENT':
                $p = DB::table('supplier_payments')->where('id', $id)->first();
                if (! $p) {
                    return null;
                }
                $fecha = CarbonImmutable::parse($p->paid_at)->setTimezone('America/Lima')->toDateString();
                if ($p->status !== 'CONFIRMED') {
                    return ['skip' => 'Pago revertido', 'date' => $fecha];
                }
                $gl = self::cuentaDeCaja($p->cash_account_id);
                if (! $gl) {
                    return ['skip' => 'Cuenta sin equivalente contable', 'date' => $fecha];
                }
                $det = [];
                foreach (DB::table('supplier_payment_allocations as a')->join('purchase_documents as d', 'd.id', '=', 'a.document_id')->where('a.payment_id', $id)->get(['a.amount', 'd.doc_type', 'd.series', 'd.number']) as $a) {
                    $det[] = ['account' => $a->doc_type === 'FEE_RECEIPT' ? '4241' : '4212', 'amount' => self::r($a->amount), 'desc' => "{$a->series}-{$a->number}", 'third' => true];
                }
                self::ajustar($det, (float) $p->amount);
                $s = DB::table('suppliers')->where('id', $p->supplier_id)->first();

                return ['source' => 'PAYMENT', 'subtype' => 'SUPPLIER', 'date' => $fecha, 'company_id' => $p->company_id,
                    'label' => "Pago {$p->number} · ".($s->trade_name ?: $s->legal_name).($p->is_detraction ? ' · detracción' : ''),
                    'cash_gl' => $gl, 'third' => self::tercero('SUPPLIER', $p->supplier_id), 'amounts' => ['TOTAL' => (float) $p->amount], 'details' => $det];
            case 'EXPENSE':
                $e = DB::table('expenses')->where('id', $id)->first();
                if (! $e) {
                    return null;
                }
                if (in_array($e->status, ['VOIDED', 'REJECTED'], true)) {
                    return ['skip' => 'Gasto anulado o rechazado', 'date' => $e->issue_date];
                }
                if (! in_array($e->status, ['APPROVED', 'PAID'], true)) {
                    return ['skip' => 'Gasto aún no aprobado en Gastos', 'date' => $e->issue_date, 'not_yet' => true];
                }
                $tc = (float) $e->exchange_rate ?: 1;
                $igv = self::r((float) $e->igv * $tc);
                $credito = $e->doc_type === 'INVOICE' && $e->accounting_flag === 'OK' && $igv > 0;
                $bruto = self::r((float) $e->amount_pen ?: (float) $e->total * $tc);
                $detBase = $credito ? self::r($bruto - $igv) : $bruto;
                $ret = self::r((float) $e->withholding_amount);
                $det = [];
                foreach (DB::table('expense_allocations')->where('expense_id', $id)->get() as $a) {
                    $det[] = ['amount' => self::r($detBase * (float) $a->pct / 100), 'category_id' => $e->category_id, 'cc' => $a->cost_center_id ?: $e->cost_center_id,
                        'brand' => $a->brand_id ?: ($e->brand_id ?: self::marcaDeCentro($a->cost_center_id))];
                }
                if (! $det) {
                    $det = [['amount' => $detBase, 'category_id' => $e->category_id, 'cc' => $e->cost_center_id, 'brand' => $e->brand_id ?: self::marcaDeCentro($e->cost_center_id)]];
                }
                foreach ($det as &$x) {
                    $x['desc'] = mb_substr("{$e->number} · {$e->description}", 0, 90).($e->accounting_flag === 'NO_VALID_RECEIPT' ? ' · no deducible' : '');
                }
                unset($x);
                self::ajustar($det, $detBase);
                $caja = $e->pay_source === 'PETTY';

                return ['source' => 'EXPENSE', 'subtype' => '*', 'date' => $e->issue_date, 'company_id' => $e->company_id, 'label' => "Gasto {$e->number} · ".mb_substr((string) $e->description, 0, 60),
                    'brand' => $e->brand_id, 'site' => $e->establishment_id, 'cc' => $e->cost_center_id, 'third' => self::tercero('SUPPLIER', $e->supplier_id),
                    'payable_gl' => $caja ? (self::cuentaDeCaja($e->paid_from_account_id) ?? '1012') : ($e->doc_type === 'FEES_RECEIPT' ? '4241' : ($e->supplier_id ? '4212' : '4691')),
                    'amounts' => ['IGV' => $credito ? $igv : 0, 'WITHHOLDING' => $ret, 'TOTAL_PAYABLE' => self::r($bruto - $ret), 'TOTAL' => $bruto],
                    'details' => $det, 'flag' => $e->accounting_flag];
            case 'PAYROLL':
                $p = DB::table('payroll_journal_imports')->where('id', $id)->first();
                if (! $p) {
                    return null;
                }
                $det = [];
                // Resumen por centro de costo: sueldos (6211), vacaciones (6215), EsSalud (6271) y CTS (6291).
                foreach (json_decode($p->lines ?? '[]', true) ?: [] as $l) {
                    $cc = self::centro($l['cost_center_id'] ?? null);
                    $nombre = $cc ? DB::table('cost_centers')->where('id', $cc)->value('name') : null;
                    foreach ([['6211', 'gross', 'Sueldos y salarios'], ['6215', 'vac', 'Vacaciones'], ['6271', 'essalud', 'EsSalud'], ['6291', 'cts', 'CTS']] as [$cta, $k, $txt]) {
                        if ((float) ($l[$k] ?? 0) > 0) {
                            $det[] = ['account' => $cta, 'amount' => self::r($l[$k]), 'cc' => $cc, 'brand' => self::marcaDeCentro($cc), 'desc' => $txt.($nombre ? ' · '.$nombre : '')];
                        }
                    }
                }
                $fin = CarbonImmutable::parse($p->period)->endOfMonth()->toDateString();

                return ['source' => 'PAYROLL', 'subtype' => '*', 'date' => $fin, 'company_id' => $p->company_id, 'label' => 'Planilla de '.Periodos::nombre($p->period),
                    'amounts' => ['ESSALUD' => (float) $p->essalud_total, 'PENSION' => (float) $p->pension_total, 'CTS' => (float) $p->cts_total, 'VAC' => (float) $p->vac_total, 'NET' => (float) $p->net_total],
                    'details' => $det];
        }
        RuleError::fail('RN-CNT-09', "Origen desconocido: {$tipo}.");
    }

    /* ================================================================ reglas y expansión */

    public static function regla(string $origen, string $subtipo, string $fecha, ?string $companyId = null): ?object
    {
        return DB::table('journal_rules')->where('status', 'ACTIVE')->where('source', $origen)
            ->where(fn ($q) => $q->where('subtype', $subtipo)->orWhere('subtype', '*'))
            ->when($companyId, fn ($q, $c) => $q->where('company_id', $c))
            ->where(fn ($q) => $q->whereNull('valid_from')->orWhere('valid_from', '<=', $fecha))
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))
            ->orderByRaw('CASE WHEN subtype = ? THEN 0 ELSE 1 END', [$subtipo])->orderByDesc('valid_from')->first();
    }

    private static function cuentaDeDetalle(?object $regla, array $it): ?string
    {
        $m = json_decode($regla->account_map ?? '{}', true) ?: [];
        if (! empty($it['supplier_id']) && isset($m['suppliers'][$it['supplier_id']])) {
            return $m['suppliers'][$it['supplier_id']];
        }
        if (! empty($it['variant_id'])) {
            return self::COMPRA_DE_EXISTENCIA[self::cuentaDeExistencia($it['variant_id'])] ?? null;
        }
        if (! empty($it['category_id'])) {
            $cod = DB::table('expense_categories')->where('id', $it['category_id'])->value('code');

            return $m['categories'][$cod] ?? null;
        }
        if (! empty($it['supplier_type'])) {
            return $m['supplier_types'][$it['supplier_type']] ?? null;
        }

        return null;
    }

    /**
     * Arma las líneas con la regla (o la clasificación de la bandeja en $ov: account, cc, brand) y dice qué falta.
     *
     * @return array{lines: array<int, array>, problems: string[]}
     */
    public static function expandir(?object $regla, array $f, array $ov = []): array
    {
        $lineasRegla = $regla ? DB::table('journal_rule_lines')->where('rule_id', $regla->id)->orderBy('seq')->get()
            : collect([(object) ['side' => 'D', 'account_from' => 'DETAIL', 'amount_key' => 'DETAIL', 'third' => null, 'account_code' => null, 'param_key' => null],
                (object) ['side' => 'C', 'account_from' => $f['cash_gl'] ?? null ? 'CASH' : 'PAYABLE', 'amount_key' => isset($f['amounts']['TOTAL_PAYABLE']) ? 'TOTAL_PAYABLE' : 'TOTAL', 'third' => 'DOC', 'account_code' => null, 'param_key' => null]]);
        $crudo = [];
        foreach ($lineasRegla as $rl) {
            $items = $rl->amount_key === 'DETAIL' ? ($f['details'] ?? []) : [['amount' => $f['amounts'][$rl->amount_key] ?? 0]];
            foreach ($items as $it) {
                $imp = self::r($it['amount'] ?? 0);
                if (abs($imp) < 0.005) {
                    continue;
                }
                $lado = $rl->side;
                if ($imp < 0) {
                    $imp = -$imp;
                    $lado = $lado === 'D' ? 'C' : 'D';
                }
                $codigo = match ($rl->account_from) {
                    'FIXED' => $rl->account_code,
                    'CASH' => $f['cash_gl'] ?? null,
                    'CASH_TO' => $f['cash_gl_to'] ?? null,
                    'PAYABLE' => $f['payable_gl'] ?? null,
                    'PARAM' => (string) Params::get((string) $rl->param_key),
                    default => $it['account'] ?? self::cuentaDeDetalle($regla, $it),
                };
                if (! $codigo && ! empty($ov['account'])) {
                    $codigo = $ov['account'];
                }
                $tercero = ($rl->third === 'DOC' || ! empty($it['third'])) ? ($f['third'] ?? null) : null;
                $crudo[] = ['account_code' => $codigo ?: null, 'side' => $lado, 'amount' => $imp, 'description' => $it['desc'] ?? $f['label'],
                    'cost_center_id' => $it['cc'] ?? ($f['cc'] ?? null), 'brand_id' => $it['brand'] ?? ($f['brand'] ?? null), 'establishment_id' => $it['site'] ?? ($f['site'] ?? null), 'third' => $tercero];
            }
        }
        $lineas = [];
        $problemas = [];
        foreach ($crudo as $l) {
            $a = self::cuenta($l['account_code']);
            if (! $a) {
                $problemas['MISSING_ACCOUNT'] = true;
                $lineas[] = $l;

                continue;
            }
            if ($a->requires_third_party && ! $l['third']) {
                $l['third'] = $f['third'] ?? null;
            }
            if ($a->requires_cost_center && ! $l['cost_center_id']) {
                if (! empty($ov['cc'])) {
                    $l['cost_center_id'] = $ov['cc'];
                } else {
                    $problemas['MISSING_COST_CENTER'] = true;
                }
            }
            if ($a->requires_brand && ! $l['brand_id']) {
                $l['brand_id'] = self::marcaDeCentro($l['cost_center_id']) ?? ($ov['brand'] ?? null);
                if (! $l['brand_id'] && $regla && $regla->allocate_common) {
                    foreach (self::prorratear($l['amount'], self::mes($f['date'])) as $p) {
                        $lineas[] = array_merge($l, ['amount' => $p['amount'], 'brand_id' => $p['brand'], 'description' => $l['description'].' (reparto por ventas)']);
                    }

                    continue;
                }
                if (! $l['brand_id']) {
                    $problemas['MISSING_BRAND'] = true;
                }
            }
            $lineas[] = $l;
        }

        return ['lines' => self::conDestino($lineas), 'problems' => array_keys($problemas)];
    }

    /** Amarre: la clase 6 con destino va a la 9 (por el área del centro de costo) contra la 79; las compras 60, a existencias y 61. */
    private static function conDestino(array $lineas): array
    {
        $agg = [];
        foreach ($lineas as $l) {
            $a = self::cuenta($l['account_code']);
            if (! $a || ! $a->dest_debit_code || ! $a->dest_credit_code) {
                continue;
            }
            $dd = $a->dest_debit_code === 'CC' ? (self::DESTINO_POR_AREA[DB::table('cost_centers')->where('id', $l['cost_center_id'])->value('area') ?? ''] ?? '941') : $a->dest_debit_code;
            foreach ([[$dd, $l['side']], [$a->dest_credit_code, $l['side'] === 'D' ? 'C' : 'D']] as [$codigo, $lado]) {
                $k = implode('|', [$codigo, $lado, $l['brand_id'], $l['cost_center_id'], $l['establishment_id']]);
                if (isset($agg[$k])) {
                    $agg[$k]['amount'] = self::r($agg[$k]['amount'] + $l['amount']);
                } else {
                    $agg[$k] = ['account_code' => $codigo, 'side' => $lado, 'amount' => $l['amount'], 'description' => 'Amarre (destino)', 'cost_center_id' => $l['cost_center_id'],
                        'brand_id' => $l['brand_id'], 'establishment_id' => $l['establishment_id'], 'third' => null, 'is_destination' => true];
                }
            }
        }

        return array_merge($lineas, array_values($agg));
    }

    /** Reparto de un gasto común entre marcas según sus ventas del mes. */
    public static function prorratear(float $monto, string $periodo): array
    {
        $fin = CarbonImmutable::parse($periodo)->endOfMonth()->toDateString();
        $ventas = DB::table('sales_documents')->whereBetween('issue_date', [$periodo, $fin])->where('status', '<>', 'VOIDED')->whereIn('doc_type', ['INVOICE', 'RECEIPT'])
            ->whereNotNull('brand_id')->groupBy('brand_id')->selectRaw('brand_id, sum(subtotal) AS v')->pluck('v', 'brand_id');
        if ($ventas->sum() <= 0) {
            $ventas = DB::table('brands')->where('status', 'ACTIVE')->pluck('id')->mapWithKeys(fn ($b) => [$b => 1]);
        }
        $tot = $ventas->sum();
        $out = [];
        $acum = 0.0;
        $keys = $ventas->sortDesc()->keys()->all();
        foreach ($keys as $i => $b) {
            $a = $i === count($keys) - 1 ? self::r($monto - $acum) : self::r($monto * $ventas[$b] / $tot);
            $acum = self::r($acum + $a);
            if (abs($a) >= 0.005) {
                $out[] = ['brand' => $b, 'amount' => $a];
            }
        }

        return $out;
    }

    /** RN-CNT-04, 05 y 16 sobre líneas guardadas o por guardar: [[regla, mensaje], …]. */
    public static function problemasDeLineas(iterable $lineas): array
    {
        $out = [];
        $i = 0;
        foreach ($lineas as $l) {
            $l = (array) $l;
            $n = 'Línea '.(++$i);
            $d = (float) ($l['debit'] ?? 0);
            $c = (float) ($l['credit'] ?? 0);
            if ($d < 0 || $c < 0) {
                $out[] = ['RN-CNT-04', "{$n}: el importe no puede ser negativo."];
            }
            if (($d > 0) === ($c > 0)) {
                $out[] = ['RN-CNT-04', "{$n}: lleva importe al debe o al haber, no ambos ni ninguno."];
            }
            $a = self::cuenta($l['account_code'] ?? null);
            if (! $a) {
                $out[] = ['RN-CNT-05', "{$n}: la cuenta ".(($l['account_code'] ?? '') ?: '(vacía)').' no existe en el plan.'];

                continue;
            }
            if (! $a->postable || $a->status !== 'ACTIVE') {
                $out[] = ['RN-CNT-05', "{$n}: la cuenta {$a->code} {$a->name} no recibe movimientos (es de título o está inactiva)."];
            }
            if ($a->requires_cost_center && empty($l['cost_center_id'])) {
                $out[] = ['RN-CNT-05', "{$n}: la cuenta {$a->code} exige centro de costo."];
            }
            if ($a->requires_third_party && empty($l['third_party_id']) && empty($l['third_party_doc'])) {
                $out[] = ['RN-CNT-05', "{$n}: la cuenta {$a->code} exige tercero (cliente, proveedor o trabajador)."];
            }
            if ($a->requires_brand && empty($l['brand_id'])) {
                $out[] = ['RN-CNT-16', "{$n}: la cuenta {$a->code} es de ingresos, costos o gastos y lleva marca."];
            }
        }

        return $out;
    }

    private static function fila(array $l): array
    {
        return ['account_code' => $l['account_code'], 'description' => mb_substr((string) ($l['description'] ?? ''), 0, 500),
            'debit' => $l['side'] === 'D' ? self::r($l['amount']) : 0, 'credit' => $l['side'] === 'C' ? self::r($l['amount']) : 0,
            'cost_center_id' => $l['cost_center_id'] ?? null, 'brand_id' => $l['brand_id'] ?? null, 'establishment_id' => $l['establishment_id'] ?? null,
            'third_party_type' => $l['third']['type'] ?? null, 'third_party_id' => $l['third']['id'] ?? null, 'third_party_doc' => $l['third']['doc'] ?? null,
            'third_party_name' => isset($l['third']['name']) ? mb_substr($l['third']['name'], 0, 255) : null, 'is_destination' => (bool) ($l['is_destination'] ?? false)];
    }

    /* ================================================================ crear, aprobar, reversar */

    /** Las fallas de la base (RN-CNT-0x: …) llegan como RuleError. */
    public static function base(\Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (QueryException $e) {
            if (preg_match('/(RN-CNT-\d{2}): ([^\n]+)/', $e->getMessage(), $m)) {
                RuleError::fail($m[1], ucfirst(trim(preg_replace('/\s*\(Connection:.*$/', '', $m[2]))));
            }
            throw $e;
        }
    }

    /** Inserta el asiento en borrador o por aprobar, con sus líneas. */
    public static function insertar(array $cab, array $filas, ?User $quien, string $accion): string
    {
        $td = self::r(array_sum(array_column($filas, 'debit')));
        $tc = self::r(array_sum(array_column($filas, 'credit')));
        $estado = $cab['status'] === 'APPROVED' ? 'PENDING_APPROVAL' : $cab['status'];

        return self::base(function () use ($cab, $filas, $quien, $accion, $td, $tc, $estado) {
            $id = DB::table('journal_entries')->insertGetId(array_merge([
                'number' => null, 'seq' => null, 'period' => self::mes($cab['entry_date']), 'currency' => 'PEN', 'total_debit' => $td, 'total_credit' => $tc,
                'prepared_at' => now(), 'auto_approved' => false, 'blocked' => false, 'source_subtype' => '*',
                'history' => json_encode([['at' => CarbonImmutable::now('America/Lima')->format('Y-m-d\TH:i'), 'user' => $quien?->name, 'action' => $accion]], JSON_UNESCAPED_UNICODE),
            ], $cab, ['status' => $estado]), 'id');
            foreach (array_values($filas) as $i => $f) {
                DB::table('journal_lines')->insert($f + ['entry_id' => $id, 'seq' => $i + 1]);
            }

            return $id;
        });
    }

    /** Siguiente número del período (RN-CNT-14), con candado por empresa y período. */
    private static function siguiente(string $companyId, string $periodo): int
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['cnt:seq:'.$companyId.':'.$periodo]);

        return (int) DB::table('journal_entries')->where('company_id', $companyId)->where('period', $periodo)->max('seq') + 1;
    }

    private static function historial(object $e, string $accion, ?User $quien): string
    {
        $h = json_decode($e->history ?? '[]', true) ?: [];
        $h[] = ['at' => CarbonImmutable::now('America/Lima')->format('Y-m-d\TH:i'), 'user' => $quien?->name, 'action' => $accion];

        return json_encode($h, JSON_UNESCAPED_UNICODE);
    }

    /** Marca el asiento como aprobado con su número (sin revisar permisos: lo llama aprobar() o la regla auto_approve). */
    private static function numerar(string $id, ?User $quien, bool $auto, string $accion): object
    {
        $e = DB::table('journal_entries')->where('id', $id)->lockForUpdate()->first();
        $n = self::siguiente($e->company_id, $e->period);
        $numero = substr($e->period, 0, 7).'-'.str_pad((string) $n, 5, '0', STR_PAD_LEFT);
        self::base(fn () => DB::table('journal_entries')->where('id', $id)->update([
            'status' => 'APPROVED', 'seq' => $n, 'number' => $numero, 'approved_by' => $auto ? null : $quien?->id, 'approved_at' => now(), 'auto_approved' => $auto,
            'history' => self::historial($e, $accion." · número {$numero}", $quien), 'updated_at' => now(),
        ]));

        return DB::table('journal_entries')->find($id);
    }

    /**
     * cnt_build_entry: genera el asiento de un documento con la regla vigente de su origen y subtipo.
     * Devuelve ['entry' => …], ['inbox' => …], ['skip' => motivo] o, con $opc['dry'], ['lines', 'problems'].
     *
     * @param  array{dry?: bool, override?: array, fallback?: bool, regenerate?: bool, replace?: string}  $opc
     */
    public static function generar(string $tipo, string $id, ?User $quien, array $opc = []): array
    {
        $f = self::hechos($tipo, $id) ?? RuleError::fail('RN-CNT-09', 'Documento no encontrado.');
        if (isset($f['skip'])) {
            return ['skip' => $f['skip']];
        }
        $empresa = $f['company_id'] ?? DB::table('companies')->orderBy('legal_name')->value('id');
        if (Periodos::cerrado($f['date'], $empresa)) {
            RuleError::fail('RN-CNT-06', 'El período de '.Periodos::nombre($f['date'])." está cerrado: no se genera el asiento de {$f['label']}.");
        }
        $regla = ! empty($opc['fallback']) ? null : self::regla($f['source'], $f['subtype'], $f['date'], $empresa);
        if (! $regla && empty($opc['fallback'])) {
            if (! empty($opc['dry'])) {
                return ['lines' => [], 'problems' => ['NO_RULE'], 'facts' => $f];
            }

            return ['inbox' => BandejaService::agregar(['source_type' => $tipo, 'source_id' => $id, 'reason' => 'NO_RULE', 'date' => $f['date'], 'company_id' => $empresa,
                'notes' => 'No hay regla vigente para '.$f['source'].' · '.$f['subtype'].'.', 'ref_label' => $f['label'],
                'amount' => $f['amounts']['TOTAL'] ?? ($f['amounts']['COST'] ?? null)])];
        }
        $vivos = DB::table('journal_entries')->where('source_kind', $tipo)->where('source_id', $id)->whereIn('status', self::ESTADOS_VIVOS)
            ->where(fn ($q) => $regla ? $q->where('rule_id', $regla->id) : $q->whereNull('rule_id'))->when($opc['replace'] ?? null, fn ($q, $r) => $q->where('id', '<>', $r))->first();
        if ($vivos) {
            if (! empty($opc['regenerate'])) {
                RuleError::fail('RN-CNT-20', "{$f['label']} ya tiene el asiento vigente ".($vivos->number ?? '(sin número)').': revérsalo antes de generar otro.');
            }

            return ['entry' => $vivos, 'existing' => true];
        }
        $x = self::expandir($regla, $f, $opc['override'] ?? []);
        if (! empty($opc['dry'])) {
            return $x + ['facts' => $f, 'rule' => $regla];
        }
        $filas = array_map(fn ($l) => self::fila($l), $x['lines']);
        $bloqueado = (bool) $x['problems'];
        $auto = ! $bloqueado && $regla && $regla->auto_approve;
        $eid = self::insertar([
            'company_id' => $empresa, 'entry_date' => $f['date'], 'source_kind' => $tipo, 'source_type' => $f['source'], 'source_subtype' => $f['subtype'], 'source_id' => $id,
            'source_label' => mb_substr($f['label'], 0, 255), 'rule_id' => $regla->id ?? null, 'rule_code' => $regla->code ?? 'Respaldo (bandeja)', 'description' => $f['label'],
            'status' => $bloqueado ? 'DRAFT' : 'PENDING_APPROVAL', 'blocked' => $bloqueado, 'blocked_reasons' => json_encode($x['problems']), 'prepared_by' => $opc['prepared_by'] ?? null,
            'brand_id' => $f['brand'] ?? null, 'establishment_id' => $f['site'] ?? null, 'exchange_rate' => $f['fx'] ?? 1,
            'fx_total' => ($f['currency'] ?? 'PEN') !== 'PEN' ? $f['fx_total'] : null,
        ], $filas, $quien, $regla ? "Generado por la regla {$regla->code}" : 'Generado con la clasificación de la bandeja');
        if ($auto) {
            self::numerar($eid, null, true, "Aprobado por la regla {$regla->code}");
        }
        if ($bloqueado) {
            BandejaService::agregar(['source_type' => $tipo, 'source_id' => $id, 'reason' => $x['problems'][0], 'missing' => $x['problems'], 'entry_id' => $eid, 'date' => $f['date'],
                'company_id' => $empresa, 'notes' => implode(' · ', array_map(fn ($p) => BandejaService::MOTIVOS[$p] ?? $p, $x['problems'])).'.', 'ref_label' => $f['label'],
                'amount' => self::r(array_sum(array_column($filas, 'debit')))]);
        }
        if ($tipo === 'EXPENSE' && ($f['flag'] ?? null) === 'NO_VALID_RECEIPT' && ! DB::table('expenses')->where('id', $id)->value('accounting_reviewed_at')) {
            BandejaService::agregar(['source_type' => 'EXPENSE', 'source_id' => $id, 'reason' => 'NO_VALID_RECEIPT', 'entry_id' => $eid, 'date' => $f['date'], 'company_id' => $empresa,
                'notes' => 'Sin comprobante válido: no da crédito fiscal ni es deducible salvo que la contadora lo valide.', 'ref_label' => $f['label'], 'amount' => $f['amounts']['TOTAL_PAYABLE'] ?? null]);
        }
        if (! empty($opc['replace'])) {
            $viejo = DB::table('journal_entries')->where('id', $opc['replace'])->first();
            if ($viejo && $viejo->status !== 'APPROVED') {
                DB::table('journal_entries')->where('id', $viejo->id)->update(['status' => 'VOIDED', 'void_reason' => 'Reemplazado por el asiento clasificado en la bandeja', 'updated_at' => now()]);
            }
        }
        Events::emit('journal_entry.created', 'journal_entries', $eid, ['source_kind' => $tipo, 'source_id' => $id, 'auto' => $auto, 'blocked' => $bloqueado]);

        return ['entry' => DB::table('journal_entries')->find($eid)];
    }

    /** Lo llaman COM, GRJ y los demás al registrar un documento: si CNT está encendido, genera su asiento (sin romper el registro). */
    public static function alRegistrar(string $tipo, string $id, ?User $quien): ?array
    {
        if (! self::activo()) {
            return null;
        }

        return self::generar($tipo, $id, $quien);
    }

    /** Al anular el documento: los asientos sin aprobar se anulan y el aprobado se reversa. */
    public static function alAnular(string $tipo, string $id, ?User $quien, string $motivo): void
    {
        if (! self::activo()) {
            return;
        }
        foreach (DB::table('journal_entries')->where('source_kind', $tipo)->where('source_id', $id)->whereIn('status', self::ESTADOS_VIVOS)->whereNull('reversed_by_id')->get() as $e) {
            if ($e->status === 'APPROVED') {
                self::reversar($e->id, $motivo, $quien, true);
            } else {
                DB::table('journal_entries')->where('id', $e->id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr($motivo, 0, 255), 'updated_at' => now()]);
            }
        }
        DB::table('accountant_inbox_items')->where('source_type', $tipo)->where('source_id', $id)->whereIn('status', BandejaService::ABIERTOS)
            ->update(['status' => 'APPROVED', 'approved_at' => now(), 'notes' => DB::raw("coalesce(notes, '') || ' · Documento anulado'"), 'updated_at' => now()]);
    }

    /** RN-CNT-01, 02, 05, 06 y 14. */
    public static function aprobar(string $id, User $quien): object
    {
        return DB::transaction(function () use ($id, $quien) {
            $e = DB::table('journal_entries')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            if ($e->status === 'APPROVED') {
                RuleError::fail('RN-CNT-02', "El asiento {$e->number} ya está aprobado.");
            }
            if ($e->status === 'VOIDED') {
                RuleError::fail('RN-CNT-02', 'El asiento está anulado.');
            }
            if (Periodos::cerrado($e->entry_date, $e->company_id)) {
                RuleError::fail('RN-CNT-06', 'El período de '.Periodos::nombre($e->entry_date).' está cerrado: no se aprueba un asiento con esa fecha.');
            }
            if (! Access::can($quien, 'cnt.entry.approve')) {
                RuleError::fail('RN-CNT-02', 'Aprobar asientos es de la contadora.');
            }
            if ($e->prepared_by && $e->prepared_by === $quien->id) {
                RuleError::fail('RN-CNT-02', 'Quien prepara el asiento no lo aprueba: debe aprobarlo otra persona.');
            }
            if ($e->blocked) {
                RuleError::fail('RN-CNT-05', 'El asiento está retenido en la bandeja: clasifícalo allí primero.');
            }
            $ls = DB::table('journal_lines')->where('entry_id', $id)->orderBy('seq')->get();
            if ($p = self::problemasDeLineas($ls)) {
                RuleError::fail($p[0][0], $p[0][1]);
            }
            $td = self::r($ls->sum('debit'));
            $tc = self::r($ls->sum('credit'));
            if (! ($td > 0) || abs($td - $tc) > 0.004) {
                RuleError::fail('RN-CNT-01', 'El asiento no cuadra: debe S/ '.number_format($td, 2, ',', ' ').' y haber S/ '.number_format($tc, 2, ',', ' ').'. Solo se aprueba si el debe y el haber son iguales y mayores que cero.');
            }

            return self::numerar($id, $quien, false, 'Aprobado');
        });
    }

    /** Asiento manual (CNT-04): queda por aprobar, o en borrador si $borrador. */
    public static function manual(array $d, User $quien, bool $borrador = false): object
    {
        return DB::transaction(function () use ($d, $quien, $borrador) {
            $empresa = $d['company_id'] ?? DB::table('companies')->orderBy('legal_name')->value('id');
            $fecha = substr($d['entry_date'], 0, 10);
            if (Periodos::cerrado($fecha, $empresa)) {
                RuleError::fail('RN-CNT-06', 'El período de '.Periodos::nombre($fecha).' está cerrado: no se registran asientos con esa fecha.');
            }
            $filas = [];
            foreach ($d['lines'] ?? [] as $l) {
                $deb = self::r($l['debit'] ?? 0);
                $cre = self::r($l['credit'] ?? 0);
                if ($deb == 0.0 && $cre == 0.0 && empty($l['account_code'])) {
                    continue;
                }
                $t = ! empty($l['third_party_id']) ? self::tercero($l['third_party_type'] ?? 'SUPPLIER', $l['third_party_id']) : null;
                $filas[] = ['account_code' => $l['account_code'] ?? null, 'description' => $l['description'] ?? ($d['description'] ?? null), 'debit' => $deb, 'credit' => $cre,
                    'cost_center_id' => $l['cost_center_id'] ?? null, 'brand_id' => $l['brand_id'] ?? null, 'establishment_id' => $l['establishment_id'] ?? null,
                    'third_party_type' => $t['type'] ?? ($l['third_party_type'] ?? null), 'third_party_id' => $t['id'] ?? null, 'third_party_doc' => $t['doc'] ?? ($l['third_party_doc'] ?? null),
                    'third_party_name' => $t['name'] ?? ($l['third_party_name'] ?? null), 'is_destination' => false];
            }
            if (count($filas) < 2) {
                RuleError::fail('RN-CNT-01', 'Un asiento lleva al menos dos líneas.');
            }
            if ($p = self::problemasDeLineas($filas)) {
                RuleError::fail($p[0][0], $p[0][1]);
            }
            $td = self::r(array_sum(array_column($filas, 'debit')));
            $tc = self::r(array_sum(array_column($filas, 'credit')));
            // Amarre a la clase 9 y a la 79 de las cuentas de gasto, como en los asientos de las reglas.
            if (($d['destination'] ?? true) && ! $borrador) {
                $con = self::conDestino(array_map(fn ($f) => ['account_code' => $f['account_code'], 'side' => $f['debit'] > 0 ? 'D' : 'C', 'amount' => $f['debit'] ?: $f['credit'],
                    'cost_center_id' => $f['cost_center_id'], 'brand_id' => $f['brand_id'], 'establishment_id' => $f['establishment_id']], $filas));
                foreach (array_slice($con, count($filas)) as $x) {
                    $filas[] = ['account_code' => $x['account_code'], 'description' => $x['description'], 'debit' => $x['side'] === 'D' ? $x['amount'] : 0,
                        'credit' => $x['side'] === 'C' ? $x['amount'] : 0, 'cost_center_id' => $x['cost_center_id'], 'brand_id' => $x['brand_id'],
                        'establishment_id' => $x['establishment_id'], 'third_party_type' => null, 'third_party_id' => null, 'third_party_doc' => null, 'third_party_name' => null, 'is_destination' => true];
                }
            }
            if (! $borrador && (! ($td > 0) || abs($td - $tc) > 0.004)) {
                RuleError::fail('RN-CNT-01', 'El asiento no cuadra: debe S/ '.number_format($td, 2, ',', ' ').' y haber S/ '.number_format($tc, 2, ',', ' ').' (diferencia S/ '.number_format($td - $tc, 2, ',', ' ').').');
            }
            $id = self::insertar([
                'company_id' => $empresa, 'entry_date' => $fecha, 'source_kind' => 'MANUAL', 'source_type' => 'MANUAL', 'source_subtype' => '*', 'description' => $d['description'],
                'status' => $borrador ? 'DRAFT' : 'PENDING_APPROVAL', 'prepared_by' => $quien->id, 'brand_id' => $d['brand_id'] ?? null, 'establishment_id' => $d['establishment_id'] ?? null,
                'source_label' => isset($d['reference']) ? mb_substr((string) $d['reference'], 0, 255) : null, 'bank_line_id' => $d['bank_line_id'] ?? null,
            ], $filas, $quien, $borrador ? 'Registrado como borrador' : 'Registrado');

            return self::ver($id);
        });
    }

    /** Un borrador manual pasa a por aprobar (cuadrado). */
    public static function enviar(string $id, User $quien): object
    {
        $e = DB::table('journal_entries')->where('id', $id)->first() ?? abort(404);
        if ($e->status !== 'DRAFT' || $e->blocked) {
            RuleError::fail('RN-CNT-02', 'Solo un borrador manual se envía a aprobación.');
        }
        $ls = DB::table('journal_lines')->where('entry_id', $id)->get();
        $td = self::r($ls->sum('debit'));
        if (! ($td > 0) || abs($td - self::r($ls->sum('credit'))) > 0.004) {
            RuleError::fail('RN-CNT-01', 'El asiento no cuadra: corrige sus líneas antes de enviarlo.');
        }
        DB::table('journal_entries')->where('id', $id)->update(['status' => 'PENDING_APPROVAL', 'history' => self::historial($e, 'Enviado a aprobación', $quien), 'updated_at' => now()]);

        return self::ver($id);
    }

    /** RN-CNT-03: un asiento sin aprobar se corrige; el aprobado, no (lo bloquea también la base). */
    public static function cambiarLinea(string $lineId, array $d, User $quien): object
    {
        $l = DB::table('journal_lines')->where('id', $lineId)->first() ?? abort(404);
        $e = DB::table('journal_entries')->where('id', $l->entry_id)->first();
        if ($e->status === 'APPROVED') {
            RuleError::fail('RN-CNT-03', "El asiento {$e->number} está aprobado: no se modifica; corrígelo con un asiento de reverso.");
        }
        self::base(fn () => DB::table('journal_lines')->where('id', $lineId)->update(array_intersect_key($d, array_flip(['account_code', 'debit', 'credit', 'cost_center_id', 'brand_id', 'description'])) + ['updated_at' => now()]));
        $ls = DB::table('journal_lines')->where('entry_id', $e->id)->get();
        DB::table('journal_entries')->where('id', $e->id)->update(['total_debit' => self::r($ls->sum('debit')), 'total_credit' => self::r($ls->sum('credit')),
            'history' => self::historial($e, 'Línea corregida', $quien), 'updated_at' => now()]);

        return self::ver($e->id);
    }

    public static function anular(string $id, string $motivo, User $quien): object
    {
        $e = DB::table('journal_entries')->where('id', $id)->first() ?? abort(404);
        if ($e->status === 'APPROVED') {
            RuleError::fail('RN-CNT-03', 'Un asiento aprobado no se anula: se corrige con un asiento de reverso.');
        }
        DB::table('journal_entries')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr($motivo, 0, 255), 'history' => self::historial($e, 'Anulado: '.$motivo, $quien), 'updated_at' => now()]);

        return self::ver($id);
    }

    /** Asiento de reverso con las líneas invertidas, en la fecha de hoy (o la del original si su período sigue abierto). */
    public static function reversar(string $id, string $motivo, ?User $quien, bool $sistema = false): object
    {
        return DB::transaction(function () use ($id, $motivo, $quien, $sistema) {
            $e = DB::table('journal_entries')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            if ($e->status !== 'APPROVED') {
                RuleError::fail('RN-CNT-03', 'Solo se reversa un asiento aprobado.');
            }
            if ($e->reversed_by_id) {
                RuleError::fail('RN-CNT-20', "El asiento {$e->number} ya tiene su reverso.");
            }
            if (! $sistema && (! $quien || ! Access::can($quien, 'cnt.entry.prepare'))) {
                RuleError::fail('RN-CNT-03', 'Reversar asientos es de la contadora o la practicante.');
            }
            $fecha = Periodos::cerrado($e->entry_date, $e->company_id) ? self::hoy() : $e->entry_date;
            $filas = DB::table('journal_lines')->where('entry_id', $id)->orderBy('seq')->get()->map(fn ($l) => [
                'account_code' => $l->account_code, 'description' => 'Reverso: '.$l->description, 'debit' => (float) $l->credit, 'credit' => (float) $l->debit,
                'cost_center_id' => $l->cost_center_id, 'brand_id' => $l->brand_id, 'establishment_id' => $l->establishment_id, 'third_party_type' => $l->third_party_type,
                'third_party_id' => $l->third_party_id, 'third_party_doc' => $l->third_party_doc, 'third_party_name' => $l->third_party_name, 'is_destination' => $l->is_destination,
            ])->all();
            $rid = self::insertar([
                'company_id' => $e->company_id, 'entry_date' => $fecha, 'source_kind' => $e->source_kind, 'source_type' => $e->source_type, 'source_subtype' => $e->source_subtype,
                'source_id' => $e->source_id, 'source_label' => $e->source_label, 'rule_id' => null, 'rule_code' => 'Reverso', 'description' => "Reverso de {$e->number}: {$motivo}",
                'status' => 'PENDING_APPROVAL', 'reversal_of' => $e->id, 'reverse_reason' => mb_substr($motivo, 0, 255), 'prepared_by' => $sistema ? null : $quien?->id,
                'brand_id' => $e->brand_id, 'establishment_id' => $e->establishment_id,
            ], $filas, $quien, "Reverso de {$e->number}");
            $r = self::numerar($rid, $quien, true, "Reverso de {$e->number}");
            DB::table('journal_entries')->where('id', $id)->update(['reversed_by_id' => $rid, 'history' => self::historial($e, "Reversado por {$r->number}: {$motivo}", $quien), 'updated_at' => now()]);

            return self::ver($rid);
        });
    }

    /** Genera los asientos que faltan de ventas, cobros, compras, pagos y gastos del período (CNT-03 «Generar pendientes»). */
    public static function generarPendientes(string $periodo, string $companyId, ?User $quien, int $tope = 500): array
    {
        $res = ['created' => 0, 'inbox' => 0, 'skipped' => 0, 'errors' => []];
        foreach (self::sinAsiento($periodo, $companyId)->take($tope) as $doc) {
            try {
                $r = DB::transaction(fn () => self::generar($doc->kind, $doc->id, $quien));
                $res[isset($r['entry']) && empty($r['existing']) ? 'created' : (isset($r['inbox']) ? 'inbox' : 'skipped')]++;
            } catch (RuleError $e) {
                $res['errors'][] = $doc->label.': '.$e->getMessage();
            }
        }

        return $res;
    }

    /** v_documents_without_entry: documentos del período sin asiento vivo ni ítem en la bandeja. */
    public static function sinAsiento(string $periodo, string $companyId): Collection
    {
        $fin = CarbonImmutable::parse($periodo)->endOfMonth()->toDateString();
        $con = fn (string $tipo) => DB::table('journal_entries')->select('source_id')->where('source_kind', $tipo)->whereIn('status', self::ESTADOS_VIVOS);
        $bandeja = fn (array $tipos) => DB::table('accountant_inbox_items')->select('source_id')->whereIn('source_type', $tipos)->whereIn('status', BandejaService::ABIERTOS);
        $ventas = DB::table('sales_documents')->where('company_id', $companyId)->whereBetween('issue_date', [$periodo, $fin])->where('status', '<>', 'VOIDED')
            ->whereNotIn('sunat_status', ['REJECTED', 'VOIDED'])->whereNotIn('id', $con('SALE'))->whereNotIn('id', $bandeja(['SALE']))
            ->get(['id', 'issue_date as date', 'total', DB::raw("doc_type || ' ' || series || '-' || number AS label")])->map(fn ($x) => (array) $x + ['kind' => 'SALE']);
        $compras = DB::table('purchase_documents')->where('company_id', $companyId)->whereBetween('accounting_date', [$periodo, $fin])->where('status', '<>', 'VOIDED')
            ->where('match_status', '<>', 'OBSERVED')->whereNotIn('id', $con('PURCHASE'))->whereNotIn('id', $bandeja(['PURCHASE', 'PURCHASE_DOCUMENT']))
            ->get(['id', 'accounting_date as date', 'total', DB::raw("doc_type || ' ' || series || '-' || number AS label")])->map(fn ($x) => (array) $x + ['kind' => 'PURCHASE']);
        $gastos = DB::table('expenses')->where('company_id', $companyId)->whereBetween('issue_date', [$periodo, $fin])->whereIn('status', ['APPROVED', 'PAID'])
            ->whereNotIn('id', $con('EXPENSE'))->whereNotIn('id', $bandeja(['EXPENSE']))
            ->get(['id', 'issue_date as date', 'amount_pen as total', DB::raw("'Gasto ' || number AS label")])->map(fn ($x) => (array) $x + ['kind' => 'EXPENSE']);
        $pagos = DB::table('supplier_payments')->where('company_id', $companyId)->where('status', 'CONFIRMED')
            ->whereRaw("(paid_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$periodo, $fin])->whereNotIn('id', $con('SUPPLIER_PAYMENT'))
            ->get(['id', DB::raw("(paid_at AT TIME ZONE 'America/Lima')::date AS date"), 'amount as total', DB::raw("'Pago ' || number AS label")])->map(fn ($x) => (array) $x + ['kind' => 'SUPPLIER_PAYMENT']);
        $locales = DB::table('establishments')->where('company_id', $companyId)->pluck('id');
        $cobros = DB::table('payments')->whereIn('establishment_id', $locales)->where('status', 'CONFIRMED')->whereNotNull('cash_account_id')
            ->whereRaw("(paid_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$periodo, $fin])->whereNotIn('id', $con('COLLECTION'))
            ->get(['id', DB::raw("(paid_at AT TIME ZONE 'America/Lima')::date AS date"), 'amount as total', DB::raw("'Cobro ' || number AS label")])->map(fn ($x) => (array) $x + ['kind' => 'COLLECTION']);

        return collect($ventas)->merge($compras)->merge($gastos)->merge($pagos)->merge($cobros)->map(fn ($x) => (object) $x)->sortBy('date')->values();
    }

    public static function ver(string $id): object
    {
        $e = DB::table('journal_entries as e')->leftJoin('users as up', 'up.id', '=', 'e.prepared_by')->leftJoin('users as ua', 'ua.id', '=', 'e.approved_by')
            ->leftJoin('brands as b', 'b.id', '=', 'e.brand_id')->leftJoin('establishments as s', 's.id', '=', 'e.establishment_id')
            ->leftJoin('journal_entries as rv', 'rv.id', '=', 'e.reversed_by_id')->leftJoin('journal_entries as ro', 'ro.id', '=', 'e.reversal_of')
            ->where('e.id', $id)->first(['e.*', 'up.name as prepared_by_name', 'ua.name as approved_by_name', 'b.name as brand_name', 's.name as establishment_name',
                'rv.number as reversed_by_number', 'ro.number as reversal_of_number']) ?? abort(404);
        $e->history = json_decode($e->history ?? '[]', true) ?: [];
        $e->blocked_reasons = json_decode($e->blocked_reasons ?? '[]', true) ?: [];
        $e->lines = DB::table('journal_lines as l')->leftJoin('gl_accounts as a', fn ($j) => $j->on('a.code', '=', 'l.account_code')->on('a.company_id', '=', DB::raw('?')))
            ->addBinding($e->company_id, 'join')
            ->leftJoin('cost_centers as cc', 'cc.id', '=', 'l.cost_center_id')->leftJoin('brands as b', 'b.id', '=', 'l.brand_id')
            ->where('l.entry_id', $id)->orderBy('l.seq')->get(['l.*', 'a.name as account_name', 'cc.code as cost_center_code', 'b.name as brand_name']);

        return $e;
    }
}
