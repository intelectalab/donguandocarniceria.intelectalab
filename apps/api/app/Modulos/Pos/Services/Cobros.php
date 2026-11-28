<?php

namespace App\Modulos\Pos\Services;

use App\Models\User;
use App\Modulos\Cli\Services\Clientes;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Cobros del mostrador (POS-04, POS-12): medios mezclados, vuelto solo del efectivo y saldo a favor.
 * CAJ aún no existe: este es el registro de respaldo de la Fase 1 y escribe payments,
 * payment_allocations y customer_balance_movements. Cuando CAJ exista, POS llamará a su servicio.
 *
 * Reglas: RN-POS-05 (en un turno abierto, lo valida quien llama), RN-POS-11 (la suma iguala el total;
 * el vuelto solo sale del efectivo), RN-CAJ-02 (número de operación), RN-CAJ-03 (tarjeta con marca y
 * 4 dígitos), RN-CAJ-04 (una operación no se registra dos veces) y RN-CAJ-08 (saldo a favor nunca
 * negativo).
 */
final class Cobros
{
    public const MARCAS_TARJETA = ['VISA' => 'Visa', 'MASTERCARD' => 'Mastercard', 'AMEX' => 'American Express', 'DINERS' => 'Diners Club'];

    public const EPS = 0.005;

    /**
     * Valida los pagos contra el total. $pagos: [{method, amount, reference?, card_brand?, card_last4?}].
     *
     * @return array{pagos: list<array>, suma: float, efectivo: float, vuelto: float}
     */
    public static function validar(array $pagos, float $total, string $clienteId): array
    {
        $medios = Cajas::medios()->keyBy('code');
        $limpios = [];
        $vistos = [];
        foreach ($pagos as $p) {
            $monto = round((float) ($p['amount'] ?? 0), 2);
            if ($monto <= 0) {
                continue;
            }
            $m = $medios[$p['method'] ?? ''] ?? null;
            if (! $m) {
                RuleError::fail('RN-CAJ-01', 'Ese medio de pago no se acepta en el mostrador.');
            }
            $ref = trim((string) ($p['reference'] ?? '')) ?: null;
            if ($m['requires_reference'] && ! $ref) {
                RuleError::fail('RN-CAJ-02', "{$m['name']} exige el número de operación.");
            }
            if ($ref && mb_strlen($ref) > 40) {
                RuleError::fail('RN-CAJ-02', 'El número de operación va hasta 40 caracteres.');
            }
            $marca = null;
            $digitos = null;
            if ($m['kind'] === 'CARD') {
                $marca = strtoupper((string) ($p['card_brand'] ?? 'VISA'));
                $digitos = trim((string) ($p['card_last4'] ?? ''));
                if (! isset(self::MARCAS_TARJETA[$marca])) {
                    RuleError::fail('RN-CAJ-03', 'Elige la marca de la tarjeta.');
                }
                if (! preg_match('/^\d{4}$/', $digitos)) {
                    RuleError::fail('RN-CAJ-03', 'Escribe los 4 últimos dígitos de la tarjeta.');
                }
            }
            if ($ref) {
                $clave = $m['code'].'|'.mb_strtoupper($ref);
                if (isset($vistos[$clave]) || DB::table('payments')->where('payment_method_id', $m['id'])->where('status', 'CONFIRMED')->whereRaw('upper(reference) = ?', [mb_strtoupper($ref)])->exists()) {
                    RuleError::fail('RN-CAJ-04', "La operación {$ref} de {$m['name']} ya está registrada en otro cobro.");
                }
                $vistos[$clave] = true;
            }
            if ($m['code'] === 'BALANCE') {
                if ($clienteId === Cajas::clienteVarios()) {
                    RuleError::fail('RN-CAJ-08', 'El saldo a favor se usa con el cliente identificado (no «Clientes varios»).');
                }
                $saldo = Clientes::saldo($clienteId);
                if ($monto > $saldo + self::EPS) {
                    RuleError::fail('RN-CAJ-08', 'El cliente tiene S/ '.number_format(max(0, $saldo), 2).' de saldo a favor.');
                }
            }
            $limpios[] = ['medio' => $m, 'amount' => $monto, 'reference' => $ref, 'card_brand' => $marca, 'card_last4' => $digitos];
        }
        $suma = round(array_sum(array_column($limpios, 'amount')), 2);
        $efectivo = round(array_sum(array_map(fn ($p) => $p['medio']['kind'] === 'CASH' ? $p['amount'] : 0, $limpios)), 2);
        $otros = round($suma - $efectivo, 2);
        if (! $limpios && $total > self::EPS) {
            RuleError::fail('RN-POS-11', 'Registra el pago: la suma de pagos debe igualar el total (S/ '.number_format($total, 2).').');
        }
        if ($otros > $total + self::EPS) {
            RuleError::fail('RN-POS-11', 'Los pagos que no son efectivo (S/ '.number_format($otros, 2).') pasan el total (S/ '.number_format($total, 2).'): el vuelto solo sale del efectivo.');
        }
        if ($suma < $total - self::EPS) {
            RuleError::fail('RN-POS-11', 'La suma de pagos (S/ '.number_format($suma, 2).') no alcanza el total (S/ '.number_format($total, 2).'): faltan S/ '.number_format($total - $suma, 2).'.');
        }
        $vuelto = round(max(0, $suma - $total), 2);
        if ($vuelto > $efectivo + self::EPS) {
            RuleError::fail('RN-POS-11', 'El vuelto solo sale del efectivo.');
        }

        return ['pagos' => $limpios, 'suma' => $suma, 'efectivo' => $efectivo, 'vuelto' => $vuelto];
    }

    /**
     * Registra los cobros y los aplica a los pedidos y comprobantes, en orden: primero los medios que
     * no son efectivo y al final el efectivo sin el vuelto. $destinos: [{order_id, document_id, amount}].
     *
     * @return array{cobros: list<object>, aplicado: array<string, float>}
     */
    public static function registrar(array $v, array $destinos, object $caja, object $turno, string $clienteId, ?string $ticket, User $u): array
    {
        $pendiente = [];
        foreach ($destinos as $d) {
            $pendiente[$d['order_id']] = round((float) $d['amount'], 2);
        }
        $docDe = array_column($destinos, 'document_id', 'order_id');
        $pagos = $v['pagos'];
        usort($pagos, fn ($a, $b) => (int) ($a['medio']['kind'] === 'CASH') <=> (int) ($b['medio']['kind'] === 'CASH'));
        $cobros = [];
        $aplicado = array_fill_keys(array_keys($pendiente), 0.0);
        $marca = DB::table('sales_orders')->where('id', array_key_first($pendiente))->value('brand_id');
        foreach ($pagos as $p) {
            $monto = $p['medio']['kind'] === 'CASH' ? round($p['amount'] - $v['vuelto'], 2) : $p['amount'];
            if ($monto <= 0.004) {
                continue;
            }
            $asig = [];
            foreach ($pendiente as $oid => $falta) {
                if ($falta <= 0.004 || $monto <= 0.004) {
                    continue;
                }
                $a = round(min($falta, $monto), 2);
                $asig[] = ['order_id' => $oid, 'document_id' => $docDe[$oid], 'amount' => $a];
                $pendiente[$oid] = round($falta - $a, 2);
                $monto = round($monto - $a, 2);
                $aplicado[$oid] = round($aplicado[$oid] + $a, 2);
            }
            if (! $asig) {
                continue;
            }
            $tot = round(array_sum(array_column($asig, 'amount')), 2);
            if ($p['medio']['code'] === 'BALANCE') {
                foreach ($asig as $a) {
                    DB::table('customer_balance_movements')->insert([
                        'customer_id' => $clienteId, 'movement_type' => 'APPLIED', 'amount' => -1 * $a['amount'], 'order_id' => $a['order_id'],
                        'reason' => mb_substr('Saldo a favor usado en el mostrador'.($ticket ? " ({$ticket})" : ''), 0, 255), 'at' => now(), 'user' => mb_substr($u->name, 0, 40),
                    ]);
                }
                if (Clientes::saldo($clienteId) < -self::EPS) {
                    RuleError::fail('RN-CAJ-08', 'El saldo a favor del cliente no alcanza.');
                }

                continue;
            }
            $cuenta = Cajas::cuentaDelCobro($caja, $p['medio']);
            $c = DB::table('cash_accounts')->where('id', $cuenta)->first(['fee_pct', 'fee_fixed']);
            $comision = $p['medio']['kind'] === 'CASH' ? 0.0 : round($tot * (float) ($c->fee_pct ?? 0) / 100 + (float) ($c->fee_fixed ?? 0), 2);
            $id = DB::table('payments')->insertGetId([
                'number' => self::numero(), 'customer_id' => $clienteId, 'payment_method_id' => $p['medio']['id'], 'cash_account_id' => $cuenta,
                'amount' => $tot, 'paid_at' => now(), 'reference' => $p['reference'], 'status' => 'CONFIRMED',
                'brand_id' => $marca, 'establishment_id' => $caja->establishment_id, 'fee_amount' => $comision,
                'reconciliation_status' => $p['medio']['kind'] === 'CASH' ? 'NOT_APPLICABLE' : 'PENDING',
                'received_by' => $u->id, 'collected_by_user_id' => $u->id,
                'card_brand' => $p['card_brand'], 'card_last4' => $p['card_last4'],
                'pos_shift_id' => $turno->id, 'pos_ticket' => $ticket,
                'cash_given' => $p['medio']['kind'] === 'CASH' ? $p['amount'] : null,
                'change_given' => $p['medio']['kind'] === 'CASH' ? $v['vuelto'] : null, 'created_at' => now(),
            ], 'id');
            $n = 0;
            foreach ($asig as $a) {
                DB::table('payment_allocations')->insert(['payment_id' => $id, 'line_no' => ++$n] + $a + ['created_at' => now()]);
            }
            $cobro = DB::table('payments')->where('id', $id)->first();
            Events::emit('payment.registered', 'payments', $id, ['number' => $cobro->number, 'method' => $p['medio']['code'], 'amount' => $tot, 'source' => 'POS']);
            $cobros[] = $cobro;
        }

        return ['cobros' => $cobros, 'aplicado' => $aplicado];
    }

    /** CB-000001 por empresa, con candado. */
    public static function numero(): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['caj:cobro:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table('payments')->where('number', 'like', 'CB-%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, 4), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return 'CB-'.str_pad((string) (((int) $max) + 1), 6, '0', STR_PAD_LEFT);
    }
}
