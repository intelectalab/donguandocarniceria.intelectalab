<?php

namespace App\Modulos\Web\Services\Proveedores;

use App\Modulos\Int\Services\Credenciales;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Adaptador de Mercado Pago. La notificación del webhook solo trae el id del pago: el pago se verifica siempre con la
 * API (GET /v1/payments/{id}) antes de registrar nada (RN-WEB-06). El access_token sale cifrado de INT (RN-WEB-10).
 *
 * Con un conector de prueba (SANDBOX o FAKE) no sale a internet: el «lado de Mercado Pago» son los pagos que deja el
 * simulador de WEB-06 (o los datos que trae la notificación de prueba del simulador de INT).
 */
final class MercadoPago
{
    public const API = 'https://api.mercadopago.com';

    public static function dePrueba(object $c): bool
    {
        return $c->environment === 'SANDBOX' || $c->adapter === 'FAKE';
    }

    public function probar(object $c): array
    {
        if (self::dePrueba($c)) {
            return $c->simulate_down ? ['ok' => false, 'error' => 'HTTP 503 Service Unavailable: Mercado Pago no respondió'] : ['ok' => true];
        }
        try {
            $r = self::http($c)->get(self::API.'/users/me');

            return $r->successful() ? ['ok' => true] : ['ok' => false, 'error' => 'HTTP '.$r->status().': '.($r->json('message') ?? '')];
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => mb_substr($e->getMessage(), 0, 200)];
        }
    }

    /**
     * El pago tal como lo tiene Mercado Pago. $pista: lo que trajo la notificación (solo se usa con el adaptador falso,
     * cuando el simulador de INT manda el estado y el monto en el cuerpo).
     */
    public static function pago(object $c, string $id, ?array $pista = null): ?array
    {
        if (self::dePrueba($c)) {
            if ($c->simulate_down) {
                throw new \RuntimeException('HTTP 503: Mercado Pago no respondió a la verificación del pago');
            }
            $r = Cache::get(self::clave($id));
            if (! $r && $pista && isset($pista['status'], $pista['transaction_amount'])) {
                $r = self::remoto(['id' => $id, 'status' => $pista['status'], 'amount' => $pista['transaction_amount'], 'external_reference' => $pista['external_reference'] ?? '']);
            }

            return $r;
        }
        $r = self::http($c)->get(self::API.'/v1/payments/'.rawurlencode($id));
        if ($r->status() === 404) {
            return null;
        }
        if (! $r->successful()) {
            throw new \RuntimeException('HTTP '.$r->status().': Mercado Pago no devolvió el pago '.$id);
        }

        return $r->json();
    }

    /**
     * Arma (y guarda en el adaptador falso) un pago del lado de Mercado Pago con la forma de GET /v1/payments.
     * Comisión de prueba: 3,99 % + IGV; liberación a 14 días con tarjeta de crédito y 2 con débito o Yape.
     */
    public static function remoto(array $o): array
    {
        $id = (string) $o['id'];
        $metodo = $o['method'] ?? 'visa';
        $tipos = ['visa' => 'credit_card', 'master' => 'credit_card', 'amex' => 'credit_card', 'debvisa' => 'debit_card', 'yape' => 'digital_wallet', 'pagoefectivo_atm' => 'ticket'];
        $tipo = $tipos[$metodo] ?? 'credit_card';
        $estado = $o['status'] ?? 'approved';
        $detalle = $o['detail'] ?? ['approved' => 'accredited', 'pending' => $metodo === 'pagoefectivo_atm' ? 'pending_waiting_payment' : 'pending_contingency',
            'in_process' => 'pending_contingency', 'rejected' => 'cc_rejected_other_reason', 'refunded' => 'refunded_by_seller', 'charged_back' => 'cardholder_dispute'][$estado] ?? $estado;
        $monto = round((float) $o['amount'], 2);
        $ahora = now('America/Lima');
        $previo = Cache::get(self::clave($id));
        $cobra = in_array($estado, ['approved', 'refunded', 'charged_back'], true);
        $comision = $cobra ? round($monto * 0.0399 * 1.18, 2) : 0;
        $r = [
            'id' => $id, 'status' => $estado, 'status_detail' => $detalle, 'transaction_amount' => $monto, 'currency_id' => 'PEN',
            'external_reference' => (string) ($o['external_reference'] ?? ''), 'payment_method_id' => $metodo, 'payment_type_id' => $tipo, 'installments' => 1,
            'card' => str_contains($tipo, 'card') ? ['last_four_digits' => str_pad((string) (1000 + ((int) substr($id, -4)) % 8999), 4, '0', STR_PAD_LEFT)] : null,
            'payer' => ['email' => $o['payer_email'] ?? null],
            'date_created' => $previo['date_created'] ?? $ahora->toIso8601String(),
            'date_approved' => $previo['date_approved'] ?? ($estado === 'approved' ? $ahora->toIso8601String() : null),
            'money_release_date' => $previo['money_release_date'] ?? ($estado === 'approved' ? $ahora->addDays($tipo === 'credit_card' ? 14 : 2)->toDateString() : null),
            'fee_details' => $previo['fee_details'] ?? ($comision ? [['type' => 'mercadopago_fee', 'amount' => $comision]] : []),
            'live_mode' => false,
        ];
        Cache::put(self::clave($id), $r, now()->addDays(30));

        return $r;
    }

    private static function clave(string $id): string
    {
        return 'web:mp:'.(TenantContext::tenant()['id'] ?? 'x').':'.$id;
    }

    private static function http(object $c)
    {
        $token = Credenciales::secreto($c->id, 'access_token');
        if (! $token) {
            throw new \RuntimeException('Falta el access_token de Mercado Pago: cárgalo en Credenciales (INT-03).');
        }

        return Http::withToken($token)->acceptJson()->timeout(15)->connectTimeout(5);
    }
}
