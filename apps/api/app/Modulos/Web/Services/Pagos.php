<?php

namespace App\Modulos\Web\Services;

use App\Models\User;
use App\Modulos\Caj\Services\Cobros;
use App\Modulos\Caj\Services\ParaWeb as CajWeb;
use App\Modulos\Int\Services\Conectores;
use App\Modulos\Ped\Services\Mensajes;
use App\Modulos\Web\Services\Proveedores\MercadoPago;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * WEB-06 Pagos de la pasarela (Mercado Pago).
 * RN-WEB-06: el cobro se registra solo con una transacción aprobada, verificada con la API y por el mismo monto; un pago
 * pendiente no confirma el pedido y un rechazo lo deja en borrador y avisa. RN-WEB-09: reembolso o contracargo revierte
 * el cobro en CAJ, avisa a administración y deja preparada la nota de crédito para FAC.
 * La conciliación con la liquidación de Mercado Pago es de CAJ (CAJ-12): aquí solo se muestra su estado.
 */
final class Pagos
{
    public const PROVEEDOR = 'MERCADOPAGO';

    public const PENDIENTES = ['pending', 'in_process', 'authorized'];

    public const REVERSOS = ['refunded', 'charged_back'];

    public const CONCILIACION = ['NA' => 'No aplica', 'NO_PAYMENT' => 'Sin cobro', 'MATCHED' => 'Conciliado', 'DIFF' => 'Con diferencia',
        'TO_RELEASE' => 'Por liberar', 'IN_BATCH' => 'En liquidación abierta', 'RELEASED' => 'Liberado, por conciliar', 'REVERSED' => 'Cobro revertido'];

    /* ------------------------------------------------------------------ verificación con la API */

    private static function conector(object $s): ?object
    {
        return $s->payment_connector_id ? DB::table('integration_connectors')->where('id', $s->payment_connector_id)->first() : null;
    }

    /** El pago como lo tiene Mercado Pago (GET /v1/payments/{id}). Con el adaptador de prueba, si no lo tiene, vale el último verificado. */
    private static function consultar(object $s, string $paymentId, ?array $pista = null): ?array
    {
        $c = self::conector($s);
        if (! $c) {
            RuleError::fail('RN-WEB-10', "{$s->name} no tiene conector de Mercado Pago: créalo en Integraciones (INT) y elígelo en la tienda.");
        }
        try {
            $r = MercadoPago::pago($c, $paymentId, $pista);
            if (! MercadoPago::dePrueba($c)) {
                Conectores::reportar($c->id, true);
            }
        } catch (\Throwable $e) {
            if (! MercadoPago::dePrueba($c)) {
                Conectores::reportar($c->id, false, mb_substr($e->getMessage(), 0, 255));
            }
            RuleError::fail('RN-WEB-06', 'No se pudo verificar el pago con Mercado Pago: '.mb_substr($e->getMessage(), 0, 200).'. No se registra nada hasta verificarlo.');
        }
        if (! $r && MercadoPago::dePrueba($c)) {
            $raw = DB::table('gateway_transactions')->where('provider', self::PROVEEDOR)->where('external_payment_id', $paymentId)->value('raw');
            $r = $raw ? Base::json($raw, null) : null;
        }

        return $r;
    }

    /** Comisión e IGV de la comisión desde fee_details (Mercado Pago informa la comisión con IGV incluido). */
    private static function comision(array $r): array
    {
        $total = array_sum(array_map(fn ($f) => (float) ($f['amount'] ?? 0), $r['fee_details'] ?? []));
        $igv = $total ? Base::r($total - $total / 1.18) : 0.0;

        return [Base::r($total - $igv), $igv, $total ? Base::r((float) $r['transaction_amount'] - $total) : 0.0];
    }

    private static function fecha(?string $f): ?CarbonImmutable
    {
        if (! $f) {
            return null;
        }
        try {
            return CarbonImmutable::parse($f, 'America/Lima');
        } catch (\Throwable) {
            return null;
        }
    }

    private static function inboxDe(object $s, string $ref): ?object
    {
        return $ref !== '' ? DB::table('web_order_inbox')->where('store_id', $s->id)->where('external_order_id', $ref)->first() : null;
    }

    private static function anotarTx(string $id, string $estado, string $detalle): void
    {
        DB::table('gateway_transactions')->where('id', $id)->update([
            'history' => DB::raw("coalesce(history, '[]'::jsonb) || ".DB::getPdo()->quote(Base::enc([['at' => now()->toIso8601String(), 'status' => $estado, 'detail' => $detalle]])).'::jsonb'),
            'updated_at' => now(),
        ]);
    }

    /* ------------------------------------------------------------------ notificación */

    /**
     * Llega la notificación de Mercado Pago (webhook o simulador): solo trae el id, el pago se verifica con la API y se
     * guarda la transacción, única por proveedor y pago. Devuelve la transacción y el resultado para el evento de INT.
     */
    public static function notificacion(object $s, string $paymentId, ?string $eventoId = null, ?array $pista = null): array
    {
        $paymentId = trim($paymentId);
        if ($paymentId === '' || mb_strlen($paymentId) > 40) {
            RuleError::fail('RN-WEB-06', 'La notificación de Mercado Pago no trae un id de pago válido.');
        }
        $r = self::consultar($s, $paymentId, $pista);
        if (! $r || ! isset($r['status'], $r['transaction_amount'])) {
            RuleError::fail('RN-WEB-06', "Mercado Pago no devolvió el pago {$paymentId}: no se registra nada.");
        }
        if (! array_key_exists($r['status'], Base::ESTADOS_PAGO)) {
            RuleError::fail('RN-WEB-06', "Mercado Pago devolvió el estado «{$r['status']}» para el pago {$paymentId}: no se reconoce.");
        }

        [$tx, $previo] = DB::transaction(function () use ($s, $r, $paymentId, $eventoId) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['web:mp:'.$paymentId]);
            [$comision, $igv, $neto] = self::comision($r);
            $ref = (string) ($r['external_reference'] ?? '');
            $ib = self::inboxDe($s, $ref);
            $base = [
                'status' => $r['status'], 'status_detail' => (string) ($r['status_detail'] ?? ''), 'amount' => Base::r($r['transaction_amount']),
                'fee_amount' => $comision, 'fee_igv' => $igv, 'net_amount' => $neto,
                'date_approved' => self::fecha($r['date_approved'] ?? null), 'money_release_date' => isset($r['money_release_date']) ? substr((string) $r['money_release_date'], 0, 10) : null,
                'raw' => Base::enc($r), 'verified_at' => now(), 'updated_at' => now(),
            ];
            $tx = DB::table('gateway_transactions')->where('provider', self::PROVEEDOR)->where('external_payment_id', $paymentId)->lockForUpdate()->first();
            $previo = $tx?->status;
            if (! $tx) {
                $id = DB::table('gateway_transactions')->insertGetId($base + [
                    'provider' => self::PROVEEDOR, 'external_payment_id' => $paymentId, 'store_id' => $s->id, 'external_reference' => mb_substr($ref, 0, 255),
                    'inbox_id' => $ib?->id, 'order_ids' => $ib ? $ib->order_ids : '[]',
                    'payment_method' => (string) ($r['payment_method_id'] ?? '—'), 'payment_type' => (string) ($r['payment_type_id'] ?? '—'),
                    'installments' => (int) ($r['installments'] ?? 1), 'card_last4' => $r['card']['last_four_digits'] ?? null, 'payer_email' => $r['payer']['email'] ?? null,
                    'date_created' => self::fecha($r['date_created'] ?? null) ?? now(), 'webhook_event_ids' => '[]', 'history' => '[]', 'created_at' => now(),
                ], 'id');
            } else {
                $id = $tx->id;
                DB::table('gateway_transactions')->where('id', $id)->update($base + ($ib && ! $tx->inbox_id ? ['inbox_id' => $ib->id, 'order_ids' => $ib->order_ids] : []));
            }
            if ($eventoId) {
                DB::table('gateway_transactions')->where('id', $id)->whereRaw('not (webhook_event_ids @> ?::jsonb)', [Base::enc([$eventoId])])
                    ->update(['webhook_event_ids' => DB::raw('webhook_event_ids || '.DB::getPdo()->quote(Base::enc([$eventoId])).'::jsonb')]);
            }
            $det = Base::MP_DETALLE[$r['status_detail'] ?? ''] ?? ($r['status_detail'] ?? '');
            self::anotarTx($id, $r['status'], ($previo && $previo !== $r['status'] ? Base::ESTADOS_PAGO[$previo].' → ' : '').Base::ESTADOS_PAGO[$r['status']]
                .($det ? " · {$det}" : '').' · verificado con la API de Mercado Pago');

            return [DB::table('gateway_transactions')->where('id', $id)->first(), $previo];
        });

        $estado = $tx->status;
        $detalle = "Pago {$paymentId} ".mb_strtolower(Base::ESTADOS_PAGO[$estado]);
        if ($estado === 'approved' && ! $tx->payment_id) {
            try {
                $p = self::confirmar($tx->id, (float) $tx->amount, null);
                $detalle = "Aprobado y verificado · cobro {$p['cobro']} de ".Base::soles((float) $tx->amount);
            } catch (RuleError $e) {
                $detalle = 'Aprobado · '.$e->getMessage();
                self::anotarTx($tx->id, 'WAITING', $e->getMessage());
            }
        } elseif ($estado === 'rejected' && $previo !== 'rejected') {
            $detalle = 'Rechazado ('.(Base::MP_DETALLE[$tx->status_detail] ?? $tx->status_detail).'): el pedido sigue en borrador y se avisó para escribir al cliente';
            self::avisarRechazo($tx);
        } elseif (in_array($estado, self::PENDIENTES, true)) {
            $detalle = 'Pendiente ('.(Base::MP_DETALLE[$tx->status_detail] ?? $tx->status_detail).'): no confirma el pedido para preparar (RN-WEB-06)';
        } elseif (in_array($estado, self::REVERSOS, true) && $previo !== $estado) {
            $detalle = Base::ESTADOS_PAGO[$estado].': '.self::revertir($tx->id);
        }
        Events::emit('web_payment.verified', 'gateway_transactions', $tx->id, ['status' => $estado, 'payment' => $paymentId, 'amount' => (float) $tx->amount]);

        return ['tx' => DB::table('gateway_transactions')->where('id', $tx->id)->first(), 'detalle' => $detalle];
    }

    /** Un rechazo deja el pedido en borrador: avisa a la vendedora con el mensaje listo para el cliente. */
    private static function avisarRechazo(object $tx): void
    {
        $s = Base::tienda($tx->store_id);
        $ib = $tx->inbox_id ? DB::table('web_order_inbox')->where('id', $tx->inbox_id)->first() : null;
        $motivo = Base::MP_DETALLE[$tx->status_detail] ?? 'rechazado';
        $para = $s->default_seller_id ? ['user_id' => $s->default_seller_id] : ['role' => 'SUPERVISORA_VENTAS'];
        Base::avisar($para, "Pago web rechazado · #{$tx->external_reference}",
            'RN-WEB-06: '.Base::soles((float) $tx->amount)." rechazado ({$motivo}). El pedido queda en borrador"
            .($ib && $ib->customer_id ? ': avisa al cliente por WhatsApp desde Pagos de la pasarela.' : '.'), 'WEB-06', $tx->id, 'warn', 'PAYMENTS');
    }

    /** Texto y enlace de WhatsApp para avisar el rechazo al cliente; queda anotado que se le avisó. */
    public static function avisoCliente(string $txId, User $u): array
    {
        $tx = self::visible($txId, $u);
        if ($tx->status !== 'rejected') {
            RuleError::fail('RN-WEB-06', 'Solo se avisa al cliente de un pago rechazado.');
        }
        $ib = $tx->inbox_id ? DB::table('web_order_inbox')->where('id', $tx->inbox_id)->first() : null;
        $c = $ib && $ib->customer_id ? DB::table('customers')->where('id', $ib->customer_id)->first(['id', 'full_name', 'phone']) : null;
        if (! $c) {
            RuleError::fail('RN-WEB-06', 'El pago no tiene un pedido web con cliente: no hay a quién avisar.');
        }
        $nombre = explode(' ', trim((string) $c->full_name))[0];
        $texto = "Hola {$nombre}, Mercado Pago rechazó el pago de tu pedido web #{$tx->external_reference} (".(Base::MP_DETALLE[$tx->status_detail] ?? 'rechazado')
            .'). Puedes pagar de nuevo desde «Mis pedidos» en la tienda o escribirnos por aquí y te ayudamos.';
        $enlace = Mensajes::enlaceWhatsapp((object) ['contact_phone' => null, 'customer_id' => $c->id], $texto);
        DB::table('gateway_transactions')->where('id', $tx->id)->update(['customer_notified_at' => now(), 'updated_at' => now()]);
        self::anotarTx($tx->id, 'NOTIFIED', "{$u->name} avisó el rechazo al cliente por WhatsApp");

        return ['texto' => $texto, 'enlace' => $enlace];
    }

    /* ------------------------------------------------------------------ cobro */

    /** Los pedidos de la transacción (los de su pedido web), sin los anulados. */
    private static function pedidosDe(object $tx): array
    {
        $ib = $tx->inbox_id ? DB::table('web_order_inbox')->where('id', $tx->inbox_id)->first() : self::inboxDe(Base::tienda($tx->store_id), (string) $tx->external_reference);
        $ids = $ib ? Base::json($ib->order_ids) : Base::json($tx->order_ids);

        return $ids ? DB::table('sales_orders')->whereIn('id', $ids)->where('status', '<>', 'CANCELLED')->orderBy('number')->get()->all() : [];
    }

    /**
     * RN-WEB-06 / CA-WEB-04: registra en CAJ el cobro de una transacción aprobada, verificada otra vez con la API y por el
     * mismo monto. Con $u null es el registro automático (al llegar el pago aprobado o al crearse el pedido).
     */
    public static function confirmar(string $txId, float $monto, ?User $u): array
    {
        $tx = DB::table('gateway_transactions')->where('id', $txId)->first() ?? abort(404, 'Transacción de Mercado Pago no encontrada.');
        if ($u) {
            $tx = self::visible($txId, $u);
            if (! (Access::module($u, 'CAJ', 'C') || Access::module($u, 'WEB', 'E'))) {
                RuleError::fail('RN-WEB-06', 'Tu rol no registra cobros: pásalo a caja o administración.');
            }
        }
        if ($tx->status !== 'approved') {
            RuleError::fail('RN-WEB-06', "La transacción {$tx->external_payment_id} de Mercado Pago está «".(Base::ESTADOS_PAGO[$tx->status] ?? $tx->status).'»: solo un pago aprobado confirma el cobro y el pedido.');
        }
        $s = Base::tienda($tx->store_id);
        $r = self::consultar($s, $tx->external_payment_id);
        if (! $r || ($r['status'] ?? null) !== 'approved' || abs(Base::r($r['transaction_amount'] ?? 0) - (float) $tx->amount) > Base::EPS) {
            RuleError::fail('RN-WEB-06', "La verificación con la API de Mercado Pago no coincide para {$tx->external_payment_id} (estado "
                .($r['status'] ?? '—').', monto '.Base::soles((float) ($r['transaction_amount'] ?? 0)).').');
        }
        $monto = Base::r($monto);
        if (abs($monto - (float) $tx->amount) > Base::EPS) {
            RuleError::fail('RN-WEB-06', 'El cobro de '.Base::soles($monto).' no coincide con el pago aprobado de '.Base::soles((float) $tx->amount)
                ." en Mercado Pago ({$tx->external_payment_id}): registra el mismo monto.");
        }

        $res = DB::transaction(function () use ($tx, $monto, $u, $s) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['web:mp:'.$tx->external_payment_id]);
            $tx = DB::table('gateway_transactions')->where('id', $tx->id)->lockForUpdate()->first();
            $previo = $tx->payment_id ? DB::table('payments')->where('id', $tx->payment_id)->first(['number', 'status']) : null;
            if ($previo && $previo->status === 'CONFIRMED') {
                RuleError::fail('RN-WEB-02', "La transacción {$tx->external_payment_id} ya tiene el cobro {$previo->number}: no se registra dos veces.");
            }
            $pedidos = self::pedidosDe($tx);
            if (! $pedidos) {
                $ib = self::inboxDe($s, (string) $tx->external_reference);
                RuleError::fail('RN-WEB-06', "El pedido web #{$tx->external_reference} aún no está creado"
                    .($ib ? ' (bandeja: '.mb_strtolower(Base::ESTADOS_BANDEJA[$ib->status] ?? $ib->status).($ib->error_code ? ", {$ib->error_code}" : '').')' : ' (no llegó a la bandeja)')
                    .': el cobro se registra apenas se cree.');
            }
            $cuenta = CajWeb::cuentaPasarela($pedidos[0]->brand_id);
            if (! $cuenta) {
                RuleError::fail('RN-WEB-06', 'No hay una cuenta activa de pasarela (Mercado Pago) en Caja: créala en CAJ antes de registrar cobros web.');
            }
            // Se aplica a cada pedido lo que le falta; si el pago trae más (envío o redondeo), queda a favor del cliente.
            $resta = $monto;
            $aplicaciones = [];
            foreach ($pedidos as $o) {
                $a = Base::r(min($resta, max(0, Cobros::pendientePedido($o))));
                if ($a > Base::EPS) {
                    $aplicaciones[] = ['order_id' => $o->id, 'document_id' => null, 'amount' => $a];
                    $resta = Base::r($resta - $a);
                }
            }
            $aprobado = self::fecha($tx->date_approved ? (string) $tx->date_approved : null);
            $cuando = $aprobado && $aprobado->greaterThan(CarbonImmutable::now()->subDays(59)) && $aprobado->lessThan(CarbonImmutable::now()) ? $aprobado->toIso8601String() : null;
            $actor = $u ?? Base::sistema('Mercado Pago');
            $cobro = Cobros::registrar([
                'customer_id' => $pedidos[0]->customer_id, 'method' => 'MP', 'cash_account_id' => $cuenta->id, 'amount' => $monto, 'paid_at' => $cuando,
                'reference' => 'MP-'.$tx->external_payment_id, 'brand_id' => $pedidos[0]->brand_id, 'establishment_id' => $pedidos[0]->establishment_id,
                'applications' => $aplicaciones, 'to_balance' => true, 'notes' => "Pedido web #{$tx->external_reference} · {$s->name}",
            ], $actor);
            CajWeb::marcarPasarela($cobro->id, $tx->id, (float) $tx->fee_amount, (float) $tx->fee_igv, $u === null);
            DB::table('gateway_transactions')->where('id', $tx->id)->update(['payment_id' => $cobro->id, 'order_ids' => Base::enc(array_map(fn ($o) => $o->id, $pedidos)),
                'registered_at' => now(), 'updated_at' => now()]);
            self::anotarTx($tx->id, 'PAYMENT', "Cobro {$cobro->number} de ".Base::soles($monto).' en Mercado Pago (comisión '.Base::soles((float) $tx->fee_amount)
                .' + IGV '.Base::soles((float) $tx->fee_igv).') aplicado a '.implode(', ', array_map(fn ($o) => $o->number, $pedidos)).($u ? " · {$u->name}" : ''));

            return ['cobro' => $cobro->number, 'payment_id' => $cobro->id, 'pedidos' => array_map(fn ($o) => $o->id, $pedidos), 'inbox' => $tx->inbox_id];
        });

        // Con el pago aprobado se confirma cada pedido que ya tiene lo que necesita (si falta el pin, queda en borrador).
        $notas = [];
        foreach ($res['pedidos'] as $oid) {
            $c = Bandeja::confirmar($oid, 'Pago web aprobado por Mercado Pago');
            $num = DB::table('sales_orders')->where('id', $oid)->value('number');
            $notas[] = "{$num}: ".($c['ok'] ? 'confirmado' : ($c['motivo'] ?? 'queda en borrador'));
        }
        if ($res['inbox']) {
            $faltan = [];
            foreach ($res['pedidos'] as $oid) {
                $o = DB::table('sales_orders')->where('id', $oid)->first();
                if ($o && $o->status === 'DRAFT') {
                    foreach (\App\Modulos\Ped\Services\Pedidos::faltantes($o) as $f) {
                        $faltan[$f['codigo']] = true;
                    }
                }
            }
            DB::table('web_order_inbox')->where('id', $res['inbox'])->update(['missing' => $faltan ? Base::enc(array_keys($faltan)) : null, 'updated_at' => now()]);
            Base::anotar('web_order_inbox', $res['inbox'], ['action' => 'PAYMENT', 'user' => 'Mercado Pago',
                'detail' => "Pago aprobado {$tx->external_payment_id} · {$res['cobro']} · ".implode('; ', $notas)]);
        }

        return $res + ['notas' => $notas];
    }

    /** Al crearse los pedidos de un pedido web: enlaza sus transacciones y registra el cobro de las aprobadas que esperaban. */
    public static function alCrearPedidos(string $inboxId): void
    {
        $ib = DB::table('web_order_inbox')->where('id', $inboxId)->first();
        if (! $ib || $ib->status !== 'PROCESSED') {
            return;
        }
        $txs = DB::table('gateway_transactions')->where('store_id', $ib->store_id)
            ->where(fn ($q) => $q->where('inbox_id', $ib->id)->orWhere('external_reference', $ib->external_order_id))->get();
        foreach ($txs as $tx) {
            DB::table('gateway_transactions')->where('id', $tx->id)->update(['inbox_id' => $ib->id, 'order_ids' => $ib->order_ids, 'updated_at' => now()]);
            if ($tx->status === 'approved' && ! $tx->payment_id) {
                try {
                    self::confirmar($tx->id, (float) $tx->amount, null);
                } catch (RuleError $e) {
                    self::anotarTx($tx->id, 'WAITING', $e->getMessage());
                }
            }
        }
    }

    /** ¿El pedido tiene su pago web aprobado y cobrado? (o se paga de otra forma: contra entrega, Yape o transferencia los cobra CAJ). */
    public static function pagadoDe(object $o): bool
    {
        if ((float) $o->paid_amount > 0 && Cobros::pendientePedido($o) <= Base::EPS) {
            return true;
        }

        return DB::table('gateway_transactions as t')->join('payments as p', 'p.id', '=', 't.payment_id')
            ->where('t.status', 'approved')->where('p.status', 'CONFIRMED')->whereRaw('t.order_ids @> ?::jsonb', [Base::enc([$o->id])])->exists();
    }

    /* ------------------------------------------------------------------ reverso */

    /** RN-WEB-09: reembolso o contracargo. Revierte el cobro en CAJ, prepara la nota de crédito y avisa a administración. */
    public static function revertir(string $txId, ?string $motivo = null): string
    {
        $tx = DB::table('gateway_transactions')->where('id', $txId)->first();
        $tipo = $tx->status === 'charged_back' ? 'Contracargo' : 'Reembolso';
        $por = $motivo ?: "{$tipo} de Mercado Pago {$tx->external_payment_id} (".(Base::MP_DETALLE[$tx->status_detail] ?? ($tx->status_detail ?: $tx->status)).')';
        $res = 'no había cobro registrado que revertir';
        $error = null;
        $p = $tx->payment_id ? DB::table('payments')->where('id', $tx->payment_id)->first(['id', 'number', 'status']) : null;
        if ($p && $p->status === 'CONFIRMED') {
            try {
                Cobros::revertir($p->id, mb_substr($por, 0, 250), Base::sistema('Mercado Pago'));
                $res = "cobro {$p->number} revertido";
            } catch (\Throwable $e) {
                $error = mb_substr($e->getMessage(), 0, 255);
                $res = "el cobro {$p->number} no se pudo revertir ({$error}); regístralo en Caja";
            }
        } elseif ($p) {
            $res = "cobro {$p->number} ya revertido";
        }
        $ids = $tx->payment_id ? DB::table('payment_allocations')->where('payment_id', $tx->payment_id)->whereNotNull('order_id')->pluck('order_id')->all() : [];
        $ids = array_values(array_unique(array_merge($ids, Base::json($tx->order_ids))));
        $docs = $ids ? DB::table('sales_documents')->whereIn('order_id', $ids)->whereIn('doc_type', ['INVOICE', 'RECEIPT'])->where('status', '<>', 'VOIDED')
            ->where('sunat_status', '<>', 'REJECTED')->orderBy('full_number')->get(['id', 'full_number', 'total']) : collect();
        $notas = $docs->map(fn ($d) => ['document_id' => $d->id, 'full_number' => $d->full_number, 'amount' => Base::r(min((float) $d->total, (float) $tx->amount)),
            'status' => 'PREPARED', 'reason' => mb_substr($por, 0, 250)])->all();
        DB::table('gateway_transactions')->where('id', $txId)->update(['reversed_at' => now(), 'reverse_result' => mb_substr($res, 0, 255), 'reverse_error' => $error,
            'credit_notes' => $notas ? Base::enc($notas) : null, 'updated_at' => now()]);
        $nc = $notas ? '; nota de crédito preparada sobre '.implode(', ', array_column($notas, 'full_number')).' (se emite en Facturación, FAC-05)' : '';
        self::anotarTx($txId, 'REVERSED', "RN-WEB-09: {$res}{$nc}");
        Base::avisar(['role' => 'ADMINISTRACION'], "{$tipo} de Mercado Pago · ".Base::soles((float) $tx->amount),
            "RN-WEB-09: {$res}{$nc}. Pedido web #{$tx->external_reference}.", 'WEB-06', $txId, 'bad', 'PAYMENTS');

        return $res.$nc;
    }

    /** Pagos pendientes que pasaron web_mp_pending_expire_hours sin aprobarse: vencen y el pedido no se prepara. Devuelve los vencidos. */
    public static function vencerPendientes(?string $storeId = null): array
    {
        $horas = Base::param('web_mp_pending_expire_hours', 48);
        $out = [];
        $q = DB::table('gateway_transactions')->whereIn('status', self::PENDIENTES)->where('date_created', '<=', now()->subHours($horas))
            ->when($storeId, fn ($w) => $w->where('store_id', $storeId));
        foreach ($q->get(['id', 'external_payment_id', 'external_reference']) as $t) {
            $n = DB::table('gateway_transactions')->where('id', $t->id)->whereIn('status', self::PENDIENTES)
                ->update(['status' => 'expired', 'status_detail' => 'expired_by_aycha', 'expired_at' => now(), 'updated_at' => now()]);
            if ($n) {
                self::anotarTx($t->id, 'expired', "Vencido: {$horas} h sin aprobación (web_mp_pending_expire_hours); el pedido no se prepara");
                $out[] = $t;
            }
        }

        return $out;
    }

    /* ------------------------------------------------------------------ lectura */

    public static function visible(string $id, User $u): object
    {
        $tx = DB::table('gateway_transactions')->where('id', $id)->first();
        if (! $tx || ! in_array($tx->store_id, Base::idsTiendasDe($u), true)) {
            abort(404, 'Transacción de Mercado Pago no encontrada.');
        }

        return $tx;
    }

    /** Situación de conciliación de la transacción (el abono de Mercado Pago se concilia en CAJ-12). */
    public static function conciliacion(object $tx, ?object $p): string
    {
        if ($tx->status !== 'approved') {
            return 'NA';
        }
        if (! $p) {
            return 'NO_PAYMENT';
        }
        if ($p->status === 'REVERSED') {
            return 'REVERSED';
        }
        if ($p->reconciliation_status === 'MATCHED') {
            return 'MATCHED';
        }
        if ($p->reconciliation_status === 'DIFFERENCE') {
            return 'DIFF';
        }
        if ($tx->money_release_date && (string) $tx->money_release_date > Base::hoy()) {
            return 'TO_RELEASE';
        }

        return $p->settlement_batch_id ? 'IN_BATCH' : 'RELEASED';
    }

    public static function lista(User $u, array $f): array
    {
        $tiendas = Base::idsTiendasDe($u);
        $q = DB::table('gateway_transactions as t')->join('web_stores as s', 's.id', '=', 't.store_id')->leftJoin('payments as p', 'p.id', '=', 't.payment_id')
            ->whereIn('t.store_id', $tiendas)
            ->select('t.id', 't.external_payment_id', 't.external_reference', 't.store_id', 's.name as tienda', 't.status', 't.status_detail', 't.amount', 't.fee_amount',
                't.fee_igv', 't.net_amount', 't.payment_method', 't.payment_type', 't.date_created', 't.date_approved', 't.money_release_date', 't.payment_id', 't.order_ids',
                't.credit_notes', 't.customer_notified_at', 't.inbox_id', 'p.number as cobro', 'p.status as cobro_status', 'p.reconciliation_status', 'p.settlement_batch_id');
        if (! empty($f['tienda'])) {
            $q->where('t.store_id', $f['tienda']);
        }
        if (! empty($f['estado'])) {
            $f['estado'] === 'PENDIENTES' ? $q->whereIn('t.status', self::PENDIENTES) : $q->where('t.status', $f['estado']);
        }
        if (! empty($f['desde'])) {
            $q->where('t.date_created', '>=', $f['desde'].' 00:00:00-05');
        }
        if (! empty($f['hasta'])) {
            $q->where('t.date_created', '<=', $f['hasta'].' 23:59:59-05');
        }
        if ($b = trim((string) ($f['q'] ?? ''))) {
            $q->where(fn ($w) => $w->where('t.external_payment_id', 'ilike', "%{$b}%")->orWhere('t.external_reference', 'ilike', "%{$b}%")
                ->orWhere('p.number', 'ilike', "%{$b}%")->orWhere('t.payer_email', 'ilike', "%{$b}%"));
        }
        $filas = $q->orderByDesc('t.date_created')->limit(2000)->get()->map(function ($t) {
            $p = $t->payment_id ? (object) ['status' => $t->cobro_status, 'reconciliation_status' => $t->reconciliation_status, 'settlement_batch_id' => $t->settlement_batch_id] : null;
            $t->conciliacion = self::conciliacion($t, $p);
            $t->order_ids = Base::json($t->order_ids);
            $t->credit_notes = Base::json($t->credit_notes, null);
            $t->pedidos = $t->order_ids ? DB::table('sales_orders')->whereIn('id', $t->order_ids)->orderBy('number')->pluck('number')->all() : [];

            return $t;
        })->all();
        if (! empty($f['conciliacion'])) {
            $filas = array_values(array_filter($filas, fn ($t) => $t->conciliacion === $f['conciliacion']));
        }
        $aprob = array_filter($filas, fn ($t) => $t->status === 'approved');

        return Paginas::deLista($filas, $f) + ['cifras' => [
            'aprobado' => Base::r(array_sum(array_map(fn ($t) => (float) $t->amount, $aprob))),
            'comision' => Base::r(array_sum(array_map(fn ($t) => (float) $t->fee_amount + (float) $t->fee_igv, $aprob))),
            'pendientes' => count(array_filter($filas, fn ($t) => in_array($t->status, self::PENDIENTES, true))),
            'sin_cobro' => count(array_filter($filas, fn ($t) => $t->conciliacion === 'NO_PAYMENT')),
            'por_conciliar' => count(array_filter($filas, fn ($t) => $t->conciliacion === 'RELEASED')),
            'reversos' => count(array_filter($filas, fn ($t) => in_array($t->status, self::REVERSOS, true))),
        ]];
    }

    public static function ver(string $id, User $u): array
    {
        $tx = self::visible($id, $u);
        $s = Base::tienda($tx->store_id);
        $p = CajWeb::cobro($tx->payment_id);
        $ids = Base::json($tx->order_ids);
        $notas = array_map(function ($n) {
            $emitida = DB::table('sales_documents')->where('related_document_id', $n['document_id'])->where('doc_type', 'CREDIT_NOTE')->where('status', 'ISSUED')
                ->orderByDesc('created_at')->first(['id', 'full_number', 'total']);

            return $n + ['emitida' => $emitida ? ['id' => $emitida->id, 'full_number' => $emitida->full_number, 'total' => (float) $emitida->total] : null];
        }, Base::json($tx->credit_notes, []) ?? []);
        $ib = $tx->inbox_id ? DB::table('web_order_inbox')->where('id', $tx->inbox_id)->first(['id', 'external_order_id', 'status', 'customer_name', 'customer_id']) : null;

        return [
            'tx' => (object) array_merge((array) $tx, [
                'raw' => Base::json($tx->raw), 'history' => Base::json($tx->history), 'webhook_event_ids' => Base::json($tx->webhook_event_ids), 'order_ids' => $ids,
                'credit_notes' => $notas ?: null,
            ]),
            'tienda' => ['id' => $s->id, 'name' => $s->name],
            'cobro' => $p, 'conciliacion' => self::conciliacion($tx, $p),
            'pedidos' => $ids ? DB::table('sales_orders')->whereIn('id', $ids)->orderBy('number')
                ->get(['id', 'number', 'status', 'estimated_total', 'final_total', 'paid_amount'])->all() : [],
            'bandeja' => $ib,
            'puede_cobrar' => $tx->status === 'approved' && (! $p || $p->status !== 'CONFIRMED') && (Access::module($u, 'CAJ', 'C') || Access::module($u, 'WEB', 'E')),
            'puede_simular' => ($c = self::conector($s)) && MercadoPago::dePrueba($c),
            'eventos' => DB::table('webhook_events')->whereIn('id', array_filter(Base::json($tx->webhook_event_ids), fn ($x) => preg_match('/^[0-9a-f-]{36}$/', (string) $x)))
                ->orderBy('received_at')->get(['id', 'status', 'received_at', 'event_type'])->all(),
        ];
    }
}
