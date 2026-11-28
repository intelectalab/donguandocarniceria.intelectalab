<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Modulos\Int\Services\Archivos;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * CAJ-02 Registrar cobro, CAJ-03 Cobros y CAJ-04 Aplicar cobro.
 *
 * Reglas: RN-CAJ-01 (cuenta activa de la empresa y del tipo del medio), RN-CAJ-02 (número de operación),
 * RN-CAJ-03 (tarjeta con marca y 4 dígitos), RN-CAJ-04 (una operación no se usa dos veces), RN-CAJ-05 (lo
 * aplicado no supera el cobro y solo se aplica uno vigente), RN-CAJ-06 (reverso con motivo, sin reactivar),
 * RN-CAJ-07 (lo aplicado a un comprobante no supera su total menos sus notas), RN-CAJ-09 (lo pagado del pedido
 * sale de los cobros aplicados) y RN-CAJ-15 (el cobro contra entrega lo registra el repartidor en su app).
 */
final class Cobros
{
    public const MARCAS_TARJETA = ['VISA' => 'Visa', 'MASTERCARD' => 'Mastercard', 'AMEX' => 'American Express', 'DINERS' => 'Diners Club'];

    /** Medios con los que se registra un cobro en caja (sin crédito ni saldo a favor) y sus cuentas. */
    public static function medios(): Collection
    {
        $cuentas = DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', '<>', 'DRIVER_CASH')->orderBy('code')
            ->get(['id', 'code', 'name', 'account_type', 'establishment_id', 'brand_id', 'fee_pct']);

        return DB::table('payment_methods')->where('status', 'ACTIVE')->whereNotIn('kind', ['CREDIT', 'INTERNAL'])
            ->orderBy('sort_order')->orderBy('name')->get(['id', 'code', 'name', 'kind', 'requires_reference'])
            ->map(fn ($m) => [
                'id' => $m->id, 'code' => $m->code, 'name' => $m->name, 'kind' => $m->kind, 'requires_reference' => (bool) $m->requires_reference,
                'cuentas' => $cuentas->whereIn('account_type', Base::CUENTAS_DEL_MEDIO[$m->kind] ?? [])->values(),
            ])->values();
    }

    public static function medio(?string $codigo): object
    {
        $m = $codigo ? DB::table('payment_methods')->where('code', $codigo)->first() : null;
        if (! $m || $m->status !== 'ACTIVE' || in_array($m->kind, ['CREDIT', 'INTERNAL'], true)) {
            RuleError::fail('RN-CAJ-01', 'Elige un medio de pago de la empresa.');
        }

        return $m;
    }

    /** RN-CAJ-04: la operación no está en otro cobro vigente del mismo medio. */
    public static function operacionLibre(string $medioId, ?string $ref, string $nombre, ?string $salvo = null): void
    {
        if ($ref && DB::table('payments')->where('payment_method_id', $medioId)->where('status', 'CONFIRMED')
            ->whereRaw('upper(reference) = ?', [mb_strtoupper($ref)])->when($salvo, fn ($q) => $q->where('id', '<>', $salvo))->exists()) {
            RuleError::fail('RN-CAJ-04', "La operación {$ref} de {$nombre} ya está registrada en otro cobro.");
        }
    }

    /**
     * Registra un cobro (CAJ-02). $d: customer_id, method, cash_account_id, amount, paid_at, reference, card_brand,
     * card_last4, brand_id, establishment_id, notes, to_balance (bool: lo que no se aplica queda a favor del cliente)
     * y applications [{order_id?, document_id?, amount}].
     */
    public static function registrar(array $d, User $u, ?UploadedFile $voucher = null): object
    {
        return DB::transaction(function () use ($d, $u, $voucher) {
            $m = self::medio($d['method'] ?? null);
            $cuenta = Cuentas::activa($d['cash_account_id'] ?? null, $m->kind);
            $cliente = DB::table('customers')->where('id', $d['customer_id'] ?? null)->first(['id', 'full_name', 'status', 'merged_into_id']);
            if (! $cliente || $cliente->merged_into_id) {
                RuleError::fail('RN-CAJ-01', 'Elige el cliente que paga.');
            }
            $monto = Base::r($d['amount'] ?? 0);
            if ($monto <= 0) {
                RuleError::fail('RN-CAJ-05', 'El monto del cobro debe ser mayor que cero.');
            }
            $ref = trim((string) ($d['reference'] ?? '')) ?: null;
            if ($m->requires_reference && ! $ref) {
                RuleError::fail('RN-CAJ-02', "{$m->name} exige el número de operación.");
            }
            if ($ref && mb_strlen($ref) > 40) {
                RuleError::fail('RN-CAJ-02', 'El número de operación va hasta 40 caracteres.');
            }
            [$marcaTarjeta, $digitos] = [null, null];
            if ($m->kind === 'CARD') {
                $marcaTarjeta = strtoupper((string) ($d['card_brand'] ?? ''));
                $digitos = trim((string) ($d['card_last4'] ?? ''));
                if (! isset(self::MARCAS_TARJETA[$marcaTarjeta])) {
                    RuleError::fail('RN-CAJ-03', 'Elige la marca de la tarjeta.');
                }
                if (! preg_match('/^\d{4}$/', $digitos)) {
                    RuleError::fail('RN-CAJ-03', 'Escribe los 4 últimos dígitos de la tarjeta.');
                }
            }
            self::operacionLibre($m->id, $ref, $m->name);

            $aplicaciones = self::limpiarAplicaciones($d['applications'] ?? []);
            // Marca y local: los del primer pedido o comprobante; si no hay, los del formulario o de la cuenta.
            [$marca, $local] = self::marcaYLocal($aplicaciones, $d, $cuenta);
            if (! Base::enAlcance($u, $marca, $local)) {
                RuleError::fail('RN-CAJ-01', 'La marca o el local del cobro no son de tu alcance.');
            }
            if ($cuenta->brand_id && $cuenta->brand_id !== $marca) {
                RuleError::fail('RN-CAJ-01', "La cuenta {$cuenta->name} es de otra marca.");
            }
            if (in_array($cuenta->account_type, ['CASH_REGISTER', 'PETTY_CASH'], true) && $cuenta->establishment_id && $cuenta->establishment_id !== $local) {
                RuleError::fail('RN-CAJ-01', "La caja {$cuenta->name} es de otro local.");
            }
            $cuando = self::cuando($d['paid_at'] ?? null);
            $empresa = DB::table('establishments')->where('id', $local)->value('company_id');
            if ($empresa) {
                Periodos::abierto($cuando->toDateString(), $empresa);
            }
            foreach ($aplicaciones as $a) {
                self::noContraEntrega($a['order_id'] ?? DB::table('sales_documents')->where('id', $a['document_id'])->value('order_id'));
            }
            $aplicado = Base::r(array_sum(array_column($aplicaciones, 'amount')));
            if ($aplicado > $monto + Base::EPS) {
                RuleError::fail('RN-CAJ-05', 'Lo aplicado ('.Base::soles($aplicado).') pasa el monto del cobro ('.Base::soles($monto).').');
            }
            $aFavor = ! empty($d['to_balance']) ? Base::r($monto - $aplicado) : 0.0;

            $comision = $m->kind === 'CASH' ? 0.0 : Base::r($monto * (float) ($cuenta->fee_pct ?? 0) / 100 + (float) ($cuenta->fee_fixed ?? 0));
            $igv = Base::r($comision * Base::num('caj_mp_fee_igv_rate', 0.18));
            $id = DB::table('payments')->insertGetId([
                'number' => Base::numero('payments', 'CB-'), 'customer_id' => $cliente->id, 'payment_method_id' => $m->id, 'cash_account_id' => $cuenta->id,
                'amount' => $monto, 'paid_at' => $cuando, 'reference' => $ref, 'status' => 'CONFIRMED', 'brand_id' => $marca, 'establishment_id' => $local,
                'fee_amount' => $comision, 'fee_igv' => $igv, 'reconciliation_status' => $m->kind === 'CASH' ? 'NOT_APPLICABLE' : 'PENDING',
                'received_by' => $u->id, 'collected_by_user_id' => $u->id, 'card_brand' => $marcaTarjeta, 'card_last4' => $digitos,
                'to_balance' => $aFavor > Base::EPS ? $aFavor : null, 'notes' => ! empty($d['notes']) ? mb_substr(trim((string) $d['notes']), 0, 255) : null,
                'source' => 'CAJ', 'created_at' => now(),
            ], 'id');
            $cobro = DB::table('payments')->where('id', $id)->first();
            self::aplicarEn($cobro, $aplicaciones, $u);
            if ($aFavor > Base::EPS) {
                DB::table('customer_balance_movements')->insert([
                    'customer_id' => $cliente->id, 'movement_type' => 'OVERPAYMENT', 'amount' => $aFavor, 'payment_id' => $id,
                    'reason' => mb_substr("Cobro {$cobro->number}: lo que no se aplicó queda a favor", 0, 255), 'at' => now(), 'user' => mb_substr($u->name, 0, 40),
                ]);
            }
            if ($voucher) {
                $archivo = Archivos::subir($voucher, 'payments', $id, 'INTERNAL', $u);
                DB::table('payments')->where('id', $id)->update(['voucher_file_id' => $archivo['id']]);
            }
            Events::emit('payment.registered', 'payments', $id, ['number' => $cobro->number, 'method' => $m->code, 'amount' => $monto, 'source' => 'CAJ']);

            return self::detalle($id);
        });
    }

    /** RN-CAJ-15: un pedido que va en ruta con cobro contra entrega lo cobra el repartidor desde su app. */
    public static function noContraEntrega(?string $orderId): void
    {
        if (! $orderId) {
            return;
        }
        $parada = DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')
            ->where('s.order_id', $orderId)->whereIn('r.status', ['LOADING', 'IN_ROUTE'])->whereIn('s.status', ['PENDING', 'ARRIVED'])
            ->where('s.cod_amount', '>', 0)->first(['r.code']);
        if ($parada) {
            RuleError::fail('RN-CAJ-15', "El pedido va en la ruta {$parada->code} con cobro contra entrega: lo cobra el repartidor desde su app.");
        }
    }

    /** Fecha y hora del cobro: no futura ni de más de 60 días atrás. */
    private static function cuando(?string $f): CarbonImmutable
    {
        if (! $f) {
            return CarbonImmutable::now();
        }
        try {
            $t = CarbonImmutable::parse($f, 'America/Lima');
        } catch (\Throwable) {
            RuleError::fail('RN-CAJ-02', 'La fecha del cobro no es válida.');
        }
        if (strlen($f) === 10) {
            $t = $t->toDateString() === Base::hoy() ? CarbonImmutable::now() : $t->setTime(12, 0);
        }
        if ($t->greaterThan(CarbonImmutable::now()->addMinutes(5))) {
            RuleError::fail('RN-CAJ-02', 'La fecha del cobro no puede ser futura.');
        }
        if ($t->lessThan(CarbonImmutable::now()->subDays(60))) {
            RuleError::fail('RN-CAJ-02', 'La fecha del cobro es de hace más de 60 días: revisa el estado de cuenta.');
        }

        return $t;
    }

    /** @return list<array{order_id: ?string, document_id: ?string, amount: float}> */
    private static function limpiarAplicaciones(array $xs): array
    {
        $r = [];
        foreach ($xs as $a) {
            $monto = Base::r($a['amount'] ?? 0);
            if ($monto <= 0) {
                continue;
            }
            $o = ($a['order_id'] ?? null) ?: null;
            $doc = ($a['document_id'] ?? null) ?: null;
            if (! $o && ! $doc) {
                RuleError::fail('RN-CAJ-05', 'Cada aplicación va a un pedido o a un comprobante.');
            }
            $r[] = ['order_id' => $o, 'document_id' => $doc, 'amount' => $monto];
        }

        return $r;
    }

    private static function marcaYLocal(array $aplicaciones, array $d, object $cuenta): array
    {
        foreach ($aplicaciones as $a) {
            $x = $a['document_id'] ? DB::table('sales_documents')->where('id', $a['document_id'])->first(['brand_id', 'establishment_id'])
                : DB::table('sales_orders')->where('id', $a['order_id'])->first(['brand_id', 'establishment_id']);
            if ($x) {
                return [$x->brand_id, $x->establishment_id];
            }
        }
        $marca = ($d['brand_id'] ?? null) ?: $cuenta->brand_id;
        $local = ($d['establishment_id'] ?? null) ?: $cuenta->establishment_id;
        if (! $marca || ! DB::table('brands')->where('id', $marca)->exists()) {
            RuleError::fail('RN-CAJ-01', 'Elige la marca del cobro.');
        }
        if (! $local || ! DB::table('establishments')->where('id', $local)->exists()) {
            RuleError::fail('RN-CAJ-01', 'Elige el local del cobro.');
        }

        return [$marca, $local];
    }

    /** CAJ-04: aplica un cobro vigente a pedidos y comprobantes del cliente. */
    public static function aplicar(string $id, array $aplicaciones, User $u): object
    {
        return DB::transaction(function () use ($id, $aplicaciones, $u) {
            $p = DB::table('payments')->where('id', $id)->lockForUpdate()->first() ?? abort(404, 'No se encontró el cobro.');
            if (! Base::enAlcance($u, $p->brand_id, $p->establishment_id)) {
                abort(404, 'No se encontró el cobro.');
            }
            $limpias = self::limpiarAplicaciones($aplicaciones);
            if (! $limpias) {
                RuleError::fail('RN-CAJ-05', 'Escribe cuánto aplicas a cada pedido o comprobante.');
            }
            self::aplicarEn($p, $limpias, $u);
            Events::emit('payment.applied', 'payments', $p->id, ['number' => $p->number, 'amount' => array_sum(array_column($limpias, 'amount'))]);

            return self::detalle($p->id);
        });
    }

    /** Lo que queda sin aplicar de un cobro: monto − aplicado − lo que pasó a saldo a favor. */
    public static function sinAplicar(object $p): float
    {
        $aplicado = (float) DB::table('payment_allocations')->where('payment_id', $p->id)->sum('amount');

        return Base::r((float) $p->amount - $aplicado - (float) ($p->to_balance ?? 0));
    }

    /** Valida y guarda las aplicaciones de un cobro (RN-CAJ-05, 07 y 09). Lo llama quien ya tiene la transacción. */
    public static function aplicarEn(object $p, array $aplicaciones, User $u): void
    {
        if (! $aplicaciones) {
            return;
        }
        if ($p->status !== 'CONFIRMED') {
            RuleError::fail('RN-CAJ-05', "El cobro {$p->number} está revertido: solo se aplica un cobro vigente.");
        }
        $libre = self::sinAplicar($p);
        $total = Base::r(array_sum(array_column($aplicaciones, 'amount')));
        if ($total > $libre + Base::EPS) {
            RuleError::fail('RN-CAJ-05', 'Al cobro '.$p->number.' le quedan '.Base::soles(max(0, $libre)).' sin aplicar: no alcanza para '.Base::soles($total).'.');
        }
        $linea = (int) DB::table('payment_allocations')->where('payment_id', $p->id)->max('line_no');
        foreach ($aplicaciones as $a) {
            [$o, $doc] = self::destino($a, $p);
            if ($o) {
                $pendiente = self::pendientePedido($o);
                if ($a['amount'] > $pendiente + Base::EPS) {
                    RuleError::fail('RN-CAJ-05', "Al pedido {$o->number} le faltan ".Base::soles(max(0, $pendiente)).': no se le aplica '.Base::soles($a['amount']).'.');
                }
            }
            if ($doc) {
                $saldo = self::saldoComprobante($doc->id);
                if ($a['amount'] > $saldo + Base::EPS) {
                    RuleError::fail('RN-CAJ-07', "A {$doc->full_number} le quedan ".Base::soles(max(0, $saldo)).' por cobrar (total menos notas de crédito y cobros): no se le aplica '.Base::soles($a['amount']).'.');
                }
            }
            DB::table('payment_allocations')->insert([
                'payment_id' => $p->id, 'line_no' => ++$linea, 'order_id' => $o?->id, 'document_id' => $doc?->id, 'amount' => $a['amount'], 'created_at' => now(),
            ]);
            if ($o) {
                self::sumarPagado($o->id, $a['amount']);
            }
            if ($doc) {
                self::recalcularComprobante($doc->id);
            }
        }
    }

    /** El pedido y el comprobante de una aplicación, del mismo cliente del cobro. */
    private static function destino(array $a, object $p): array
    {
        $doc = null;
        $o = null;
        if ($a['document_id']) {
            $doc = DB::table('sales_documents')->where('id', $a['document_id'])->lockForUpdate()->first();
            if (! $doc) {
                RuleError::fail('RN-CAJ-07', 'El comprobante no existe.');
            }
            if (! in_array($doc->doc_type, ['INVOICE', 'RECEIPT'], true) || $doc->status !== 'ISSUED') {
                RuleError::fail('RN-CAJ-07', "{$doc->full_number} no es una boleta o factura vigente.");
            }
            if ($doc->sunat_status === 'REJECTED') {
                RuleError::fail('RN-CAJ-14', "{$doc->full_number} fue rechazado por SUNAT: no tiene cuenta por cobrar hasta corregirse.");
            }
            if ($doc->customer_id !== $p->customer_id) {
                RuleError::fail('RN-CAJ-05', "{$doc->full_number} es de otro cliente.");
            }
            if ($a['order_id'] && $doc->order_id && $doc->order_id !== $a['order_id']) {
                RuleError::fail('RN-CAJ-05', "{$doc->full_number} es de otro pedido.");
            }
            $a['order_id'] = $a['order_id'] ?: $doc->order_id;
        }
        if ($a['order_id']) {
            $o = DB::table('sales_orders')->where('id', $a['order_id'])->lockForUpdate()->first();
            if (! $o) {
                RuleError::fail('RN-CAJ-05', 'El pedido no existe.');
            }
            if ($o->status === 'CANCELLED') {
                RuleError::fail('RN-CAJ-05', "El pedido {$o->number} está anulado.");
            }
            if ($o->customer_id !== $p->customer_id && $o->billing_customer_id !== $p->customer_id) {
                RuleError::fail('RN-CAJ-05', "El pedido {$o->number} es de otro cliente.");
            }
            if (! $doc) {
                $docId = DB::table('sales_documents')->where('order_id', $o->id)->where('status', 'ISSUED')->whereIn('doc_type', ['INVOICE', 'RECEIPT'])
                    ->where('sunat_status', '<>', 'REJECTED')->orderByDesc('created_at')->value('id');
                $doc = $docId ? DB::table('sales_documents')->where('id', $docId)->lockForUpdate()->first() : null;
            }
        }

        return [$o, $doc];
    }

    /** Lo que falta pagar del pedido: total (final o estimado) − pagado. */
    public static function pendientePedido(object $o): float
    {
        return Base::r((float) ($o->final_total ?? $o->estimated_total) - (float) $o->paid_amount);
    }

    /** RN-CAJ-09: lo pagado del pedido sube o baja con los cobros que se le aplican o revierten. */
    public static function sumarPagado(string $orderId, float $monto): void
    {
        DB::table('sales_orders')->where('id', $orderId)
            ->update(['paid_amount' => DB::raw('greatest(0, round(coalesce(paid_amount, 0) + ('.Base::r($monto).'), 2))'), 'updated_at' => now()]);
    }

    /** Notas de crédito vigentes de un comprobante. */
    public static function notasDe(string $docId): float
    {
        return Base::r(DB::table('sales_documents')->where('related_document_id', $docId)->where('doc_type', 'CREDIT_NOTE')
            ->where('status', 'ISSUED')->where('sunat_status', '<>', 'REJECTED')->sum('total'));
    }

    /** Cobros vigentes aplicados al comprobante, más el saldo a favor usado en él. */
    public static function cobradoDe(string $docId): float
    {
        $cobros = (float) DB::table('payment_allocations as a')->join('payments as p', 'p.id', '=', 'a.payment_id')
            ->where('a.document_id', $docId)->where('p.status', 'CONFIRMED')->sum('a.amount');
        $saldo = (float) DB::table('customer_balance_movements')->where('document_id', $docId)->where('movement_type', 'APPLIED')->sum(DB::raw('-amount'));

        return Base::r($cobros + $saldo);
    }

    /** RN-CAJ-14: cuenta por cobrar = total − notas de crédito − cobros vigentes aplicados. */
    public static function saldoComprobante(string $docId): float
    {
        $d = DB::table('sales_documents')->where('id', $docId)->first(['total', 'sunat_status']);
        if (! $d || $d->sunat_status === 'REJECTED') {
            return 0.0;
        }

        return Base::r((float) $d->total - self::notasDe($docId) - self::cobradoDe($docId));
    }

    public static function recalcularComprobante(string $docId): void
    {
        DB::table('sales_documents')->where('id', $docId)->update(['balance' => max(0, self::saldoComprobante($docId)), 'updated_at' => now()]);
    }

    /** CAJ-03: revierte un cobro con motivo (RN-CAJ-06). Deshace sus aplicaciones y el saldo a favor que generó. */
    public static function revertir(string $id, ?string $motivo, User $u): object
    {
        return DB::transaction(function () use ($id, $motivo, $u) {
            $p = DB::table('payments')->where('id', $id)->lockForUpdate()->first() ?? abort(404, 'No se encontró el cobro.');
            if (! Base::enAlcance($u, $p->brand_id, $p->establishment_id)) {
                abort(404, 'No se encontró el cobro.');
            }
            $motivo = Base::motivo($motivo, 'RN-CAJ-06', 'Revertir un cobro exige el motivo (al menos 5 letras).');
            if ($p->status === 'REVERSED') {
                RuleError::fail('RN-CAJ-06', "El cobro {$p->number} ya está revertido: un cobro revertido no se reactiva.");
            }
            if ($p->settlement_batch_id || DB::table('settlement_batch_items')->where('payment_id', $p->id)->exists()) {
                RuleError::fail('RN-CAJ-12', "El cobro {$p->number} está en un abono: quítalo del abono antes de revertirlo (un cobro conciliado no cambia).");
            }
            if ($p->driver_settlement_id) {
                RuleError::fail('RN-CAJ-06', "El cobro {$p->number} ya se liquidó con el repartidor: corrígelo con un traslado o una nota de crédito.");
            }
            if ($p->pos_shift_id) {
                RuleError::fail('RN-CAJ-06', "El cobro {$p->number} es del mostrador: se corrige con una devolución en el Mostrador (POS-09), que cuadra el turno.");
            }
            $aFavor = Base::r($p->to_balance ?? 0);
            if ($aFavor > Base::EPS) {
                Base::candadoCliente($p->customer_id);
                if (Saldos::saldo($p->customer_id) < $aFavor - Base::EPS) {
                    RuleError::fail('RN-CAJ-08', "El cobro {$p->number} dejó ".Base::soles($aFavor).' a favor del cliente y ya lo usó: el saldo a favor no puede quedar negativo.');
                }
                DB::table('customer_balance_movements')->insert([
                    'customer_id' => $p->customer_id, 'movement_type' => 'REVERSAL', 'amount' => -$aFavor, 'payment_id' => $p->id,
                    'reason' => mb_substr("Reverso del cobro {$p->number}: {$motivo}", 0, 255), 'at' => now(), 'user' => mb_substr($u->name, 0, 40),
                ]);
            }
            DB::table('payments')->where('id', $p->id)->update([
                'status' => 'REVERSED', 'reversal_reason' => $motivo, 'reversed_at' => now(), 'reversed_by' => mb_substr($u->name, 0, 40),
                'reconciliation_status' => 'NOT_APPLICABLE', 'updated_at' => now(),
            ]);
            foreach (DB::table('payment_allocations')->where('payment_id', $p->id)->get() as $a) {
                if ($a->order_id) {
                    self::sumarPagado($a->order_id, -1 * (float) $a->amount);
                }
                if ($a->document_id) {
                    self::recalcularComprobante($a->document_id);
                }
            }
            // Cobro contra entrega aún sin liquidar: la parada vuelve a quedar por cobrar.
            foreach (DB::table('delivery_events')->where('payment_id', $p->id)->whereNotNull('stop_id')->get(['stop_id']) as $e) {
                DB::table('delivery_stops')->where('id', $e->stop_id)
                    ->update(['collected_amount' => DB::raw('greatest(0, round(collected_amount - '.Base::r($p->amount).', 2))'), 'updated_at' => now()]);
            }
            Events::emit('payment.reversed', 'payments', $p->id, ['number' => $p->number, 'reason' => $motivo, 'by' => $u->id]);

            return self::detalle($p->id);
        });
    }

    /** Consulta base de CAJ-03 con los nombres para mostrar. */
    public static function consulta(User $u, array $f)
    {
        $dias = ($f['sin_aplicar'] ?? null) === '1' ? 365 : 30;
        [$desde, $hasta] = [Base::fecha($f['desde'] ?? null, CarbonImmutable::parse(Base::hoy())->subDays($dias)->toDateString()), Base::fecha($f['hasta'] ?? null)];
        $q = DB::table('payments as p')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->join('cash_accounts as c', 'c.id', '=', 'p.cash_account_id')
            ->leftJoin('customers as cu', 'cu.id', '=', 'p.customer_id')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')
            ->leftJoin('users as us', 'us.id', '=', 'p.collected_by_user_id')->leftJoin('establishments as e', 'e.id', '=', 'p.establishment_id')
            ->whereRaw("(p.paid_at at time zone 'America/Lima')::date between ? and ?", [$desde, $hasta])
            ->when($f['medio'] ?? null, fn ($w, $v) => $w->where('m.code', $v))
            ->when($f['cuenta'] ?? null, fn ($w, $v) => $w->where('p.cash_account_id', $v))
            ->when($f['marca'] ?? null, fn ($w, $v) => $w->where('p.brand_id', $v))
            ->when($f['cobrado_por'] ?? null, fn ($w, $v) => $w->where('p.collected_by_user_id', $v))
            ->when($f['estado'] ?? null, fn ($w, $v) => $w->where('p.status', $v))
            ->when($f['conciliacion'] ?? null, fn ($w, $v) => $w->where('p.reconciliation_status', $v))
            ->when($f['cliente'] ?? null, fn ($w, $v) => $w->where('p.customer_id', $v))
            ->when(($f['sin_aplicar'] ?? null) === '1', fn ($w) => $w->where('p.status', 'CONFIRMED')
                ->whereRaw('p.amount - coalesce(p.to_balance, 0) - (select coalesce(sum(a.amount), 0) from payment_allocations a where a.payment_id = p.id) > 0.005'))
            ->when($f['origen'] ?? null, fn ($w, $v) => match ($v) {
                'POS' => $w->whereNotNull('p.pos_shift_id'),
                'DEL' => $w->whereExists(fn ($x) => $x->from('delivery_events as de')->whereColumn('de.payment_id', 'p.id')),
                'CAJ' => $w->where('p.source', 'CAJ'),
                default => $w,
            });

        return Base::alcance($q, $u)->select([
            'p.id', 'p.number', 'p.paid_at', 'p.amount', 'p.reference', 'p.status', 'p.reconciliation_status', 'p.fee_amount', 'p.fee_igv', 'p.card_brand', 'p.card_last4',
            'p.to_balance', 'p.pos_ticket', 'p.pos_shift_id', 'p.source', 'p.reversal_reason', 'p.voucher_file_id', 'm.code as medio', 'm.name as medio_nombre', 'm.kind as medio_tipo',
            'c.name as cuenta', 'c.code as cuenta_code', 'cu.full_name as cliente', 'b.name as marca', 'us.name as cobrado_por', 'e.name as local',
            DB::raw('(select coalesce(sum(a.amount), 0) from payment_allocations a where a.payment_id = p.id) as aplicado'),
        ]);
    }

    public static function totales(User $u, array $f): array
    {
        $base = self::consulta($u, $f);
        $t = DB::query()->fromSub($base, 'x')->selectRaw("count(*) as n, coalesce(sum(amount) filter (where status = 'CONFIRMED'), 0) as vigente,
            coalesce(sum(amount) filter (where status = 'CONFIRMED' and reconciliation_status = 'PENDING'), 0) as por_conciliar,
            count(*) filter (where status = 'REVERSED') as revertidos")->first();

        return ['n' => (int) $t->n, 'vigente' => Base::r($t->vigente), 'por_conciliar' => Base::r($t->por_conciliar), 'revertidos' => (int) $t->revertidos];
    }

    /** Detalle de un cobro con sus aplicaciones, abono y liquidación. */
    public static function detalle(string $id): object
    {
        $p = DB::table('payments as p')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->join('cash_accounts as c', 'c.id', '=', 'p.cash_account_id')
            ->leftJoin('customers as cu', 'cu.id', '=', 'p.customer_id')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')->leftJoin('establishments as e', 'e.id', '=', 'p.establishment_id')
            ->leftJoin('users as us', 'us.id', '=', 'p.collected_by_user_id')->leftJoin('settlement_batches as sb', 'sb.id', '=', 'p.settlement_batch_id')
            ->leftJoin('driver_settlements as ds', 'ds.id', '=', 'p.driver_settlement_id')
            ->where('p.id', $id)->first(['p.*', 'm.code as medio', 'm.name as medio_nombre', 'm.kind as medio_tipo', 'c.name as cuenta', 'c.account_type as cuenta_tipo',
                'cu.full_name as cliente', 'cu.doc_type as cliente_doc_type', 'cu.doc_number as cliente_doc', 'b.name as marca', 'e.name as local', 'us.name as cobrado_por',
                'sb.reference as abono', 'sb.status as abono_estado', 'ds.number as liquidacion']);
        if (! $p) {
            abort(404, 'No se encontró el cobro.');
        }
        $p->aplicaciones = DB::table('payment_allocations as a')->leftJoin('sales_orders as o', 'o.id', '=', 'a.order_id')->leftJoin('sales_documents as d', 'd.id', '=', 'a.document_id')
            ->where('a.payment_id', $id)->orderBy('a.line_no')
            ->get(['a.id', 'a.line_no', 'a.amount', 'a.order_id', 'a.document_id', 'o.number as pedido', 'd.full_number as comprobante', 'd.doc_type']);
        $p->aplicado = Base::r($p->aplicaciones->sum('amount'));
        $p->sin_aplicar = $p->status === 'CONFIRMED' ? self::sinAplicar($p) : 0.0;
        $p->origen = $p->pos_shift_id ? 'POS' : (DB::table('delivery_events')->where('payment_id', $id)->exists() ? 'DEL' : ($p->source ?: 'CAJ'));

        return $p;
    }

    /** Pedidos y comprobantes del cliente con algo por pagar (CAJ-02 y CAJ-04). */
    public static function pendientesDe(string $clienteId, User $u): array
    {
        $pedidos = Base::alcance(DB::table('sales_orders as p'), $u)->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')
            ->where(fn ($w) => $w->where('p.customer_id', $clienteId)->orWhere('p.billing_customer_id', $clienteId))
            ->where('p.status', '<>', 'CANCELLED')->whereNotIn('p.status', ['DRAFT'])
            ->whereRaw('coalesce(p.final_total, p.estimated_total) - p.paid_amount > 0.005')
            ->orderByDesc('p.created_at')->limit(50)
            ->get(['p.id', 'p.number', 'p.status', 'p.delivery_date', 'p.estimated_total', 'p.final_total', 'p.paid_amount', 'p.brand_id', 'b.name as marca',
                DB::raw('round(coalesce(p.final_total, p.estimated_total) - p.paid_amount, 2) as pendiente'),
                DB::raw("(select d.full_number from sales_documents d where d.order_id = p.id and d.status = 'ISSUED' and d.doc_type in ('INVOICE','RECEIPT') order by d.created_at desc limit 1) as comprobante")]);
        $docs = Base::alcance(DB::table('sales_documents as p'), $u)->where('p.customer_id', $clienteId)->whereIn('p.doc_type', ['INVOICE', 'RECEIPT'])
            ->where('p.status', 'ISSUED')->where('p.sunat_status', '<>', 'REJECTED')->where('p.balance', '>', 0.005)
            ->orderBy('p.issue_date')->limit(50)->get(['p.id', 'p.full_number', 'p.doc_type', 'p.issue_date', 'p.due_date', 'p.total', 'p.order_id', 'p.balance']);

        return [
            'pedidos' => $pedidos->filter(fn ($o) => ! $o->comprobante || ! $docs->contains('order_id', $o->id))->values(),
            'comprobantes' => $docs->map(function ($d) {
                $d->saldo = max(0, self::saldoComprobante($d->id));

                return $d;
            })->filter(fn ($d) => $d->saldo > Base::EPS)->values(),
            'saldo_a_favor' => Saldos::saldo($clienteId),
        ];
    }
}
