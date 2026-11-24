<?php

namespace App\Modulos\Sus\Services;

use App\Modulos\Ops\Services\Consola;
use App\Modulos\Sus\Services\Pasarelas\Pasarela;
use App\Modulos\Sus\Services\Pasarelas\PasarelaFake;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * SUS-13 Cobros y conciliación.
 *  - Se cobra con el medio de pago guardado de la empresa (solo el token, RN-SUS-20) por el adaptador de la pasarela
 *    (sus_gateway; FAKE mientras no se elija una real, D-SUS-02).
 *  - El resultado llega por el aviso firmado de la pasarela. Cada aviso queda crudo en saas_gateway_events; uno con
 *    firma inválida no tiene efecto y uno repetido tampoco (RN-SUS-13: un cobro por referencia).
 *  - Aprobado: el comprobante se marca pagado si lo cubre (RN-SUS-14) y la suscripción vuelve a activa (RN-SUS-10).
 *    Rechazado: la suscripción pasa a «con deuda».
 *  - Conciliación: los cobros aprobados se juntan con el abono de la pasarela; la diferencia es la comisión.
 */
final class Pagos
{
    public const ESTADOS = ['PENDING' => 'Esperando a la pasarela', 'APPROVED' => 'Aprobado', 'DECLINED' => 'Rechazado'];

    public const ORIGENES = ['AUTO' => 'Corrida mensual', 'RETRY' => 'Reintento de mora', 'CONSOLE' => 'Desde la consola', 'CUSTOMER' => 'La empresa'];

    public static function pasarela(?string $codigo = null): Pasarela
    {
        return match ($codigo ?? self::codigo()) {
            'FAKE' => new PasarelaFake,
            default => RuleError::fail('RN-SUS-20', 'La pasarela configurada todavía no tiene adaptador.'),
        };
    }

    /** Cobro de un comprobante emitido con saldo, con el medio de pago activo de la empresa. */
    public static function cobrar(string $facturaId, string $origen, ?array $quien = null): array
    {
        $quien && Consola::exigir($quien, 'billing.manage');
        $f = Facturacion::ver($facturaId);
        if ($f['status'] !== 'ISSUED' || $f['doc_type'] === 'CREDIT_NOTE') {
            RuleError::fail('RN-SUS-14', 'Solo se cobra una factura o boleta emitida.');
        }
        if ($f['saldo'] <= 0) {
            RuleError::fail('RN-SUS-14', 'El comprobante no tiene saldo por cobrar.');
        }
        $medio = DB::table('saas_payment_methods')->where('tenant_id', $f['tenant_id'])->where('active', true)->first();
        if (! $medio) {
            RuleError::fail('RN-SUS-20', 'La empresa no tiene un medio de pago registrado.');
        }
        if (DB::table('saas_payments')->where('invoice_id', $facturaId)->where('status', 'PENDING')->exists()) {
            RuleError::fail('RN-SUS-13', 'Ya hay un cobro de este comprobante esperando a la pasarela.');
        }
        $pasarela = self::pasarela($medio->gateway);
        $r = $pasarela->cobrar($medio->token, $f['saldo'], "{$f['doc_type_name']} {$f['number']}");
        $id = DB::table('saas_payments')->insertGetId(['tenant_id' => $f['tenant_id'], 'invoice_id' => $facturaId, 'payment_method_id' => $medio->id,
            'gateway' => $medio->gateway, 'gateway_ref' => $r['ref'], 'amount' => $f['saldo'], 'status' => 'PENDING', 'origin' => $origen,
            'created_at' => now(), 'updated_at' => now()], 'id');
        if ($quien) {
            Consola::bitacora('PAYMENT_ATTEMPTED', $quien, ['tenant' => $f['tenant_id'], 'entity' => 'saas_payments', 'entity_id' => $id,
                'reason' => "Cobro de {$f['number']}", 'detail' => ['monto' => $f['saldo']]]);
        }
        // La pasarela de prueba entrega su aviso en el momento (la real lo manda después a /publico/pasarela).
        if (isset($r['evento'])) {
            self::recibirEvento($medio->gateway, $r['evento'], $r['firma'] ?? null);
        }

        return (array) DB::table('saas_payments')->where('id', $id)->first();
    }

    /** Cobro automático de la corrida: solo si la empresa tiene medio de pago con cobro automático. */
    public static function cobrarSiCorresponde(string $facturaId, string $origen): bool
    {
        $tenant = DB::table('saas_invoices')->where('id', $facturaId)->value('tenant_id');
        if (! DB::table('saas_payment_methods')->where('tenant_id', $tenant)->where('active', true)->where('auto_pay', true)->exists()) {
            return false;
        }
        self::cobrar($facturaId, $origen);

        return true;
    }

    /**
     * Aviso de la pasarela (webhook). Devuelve el resultado como texto (queda en el evento crudo).
     * Corre con la sesión de plataforma: el aviso no es de ninguna empresa hasta encontrar su cobro.
     */
    public static function recibirEvento(string $gateway, string $cuerpo, ?string $firma): string
    {
        $antes = TenantContext::id();
        $plataforma = DB::selectOne("SELECT current_setting('app.platform', true) = 'on' AS si")->si;
        TenantContext::platform();
        try {
            return DB::transaction(fn () => self::procesar($gateway, $cuerpo, $firma));
        } finally {
            $antes ? TenantContext::set(TenantContext::find($antes)) : ($plataforma ? TenantContext::platform() : TenantContext::set(null));
        }
    }

    /** Junta cobros aprobados con un abono de la pasarela; la diferencia es la comisión. */
    public static function conciliar(array $quien, array $d): array
    {
        Consola::exigir($quien, 'billing.manage');
        $cobros = DB::table('saas_payments')->whereIn('id', $d['payments'])->get();
        if ($cobros->count() !== count(array_unique($d['payments'])) || $cobros->contains(fn ($c) => $c->status !== 'APPROVED' || $c->settlement_id)) {
            RuleError::fail('RN-SUS-13', 'Solo se concilian cobros aprobados que no estén en otro abono.');
        }
        if ($cobros->pluck('gateway')->unique()->count() > 1) {
            RuleError::fail('RN-SUS-13', 'Un abono es de una sola pasarela.');
        }
        $bruto = round((float) $cobros->sum('amount'), 2);
        $abono = round((float) $d['amount'], 2);
        if ($abono <= 0 || $abono > $bruto) {
            RuleError::fail('RN-SUS-13', 'El abono debe ser mayor que cero y no pasar la suma de los cobros (S/ '.number_format($bruto, 2, ',', '.').').');
        }
        $gw = $cobros->first()->gateway;
        if (DB::table('saas_settlements')->where('gateway', $gw)->where('reference', trim($d['reference']))->exists()) {
            RuleError::fail('RN-SUS-13', 'Ese abono ya está registrado.');
        }
        $id = DB::table('saas_settlements')->insertGetId(['gateway' => $gw, 'reference' => trim($d['reference']), 'settled_on' => $d['settled_on'],
            'gross' => $bruto, 'amount' => $abono, 'fee' => round($bruto - $abono, 2), 'created_by_name' => $quien['full_name'], 'created_at' => now()], 'id');
        DB::table('saas_payments')->whereIn('id', $d['payments'])->update(['settlement_id' => $id, 'updated_at' => now()]);
        Consola::bitacora('PAYMENTS_RECONCILED', $quien, ['entity' => 'saas_settlements', 'entity_id' => $id, 'reason' => 'Abono '.trim($d['reference']),
            'detail' => ['cobros' => $cobros->count(), 'bruto' => $bruto, 'abono' => $abono]]);

        return (array) DB::table('saas_settlements')->where('id', $id)->first();
    }

    public static function lista(array $f): array
    {
        $q = DB::table('saas_payments as p')->join('tenants as t', 't.id', '=', 'p.tenant_id')->join('saas_invoices as f', 'f.id', '=', 'p.invoice_id')
            ->leftJoin('saas_payment_methods as m', 'm.id', '=', 'p.payment_method_id')->leftJoin('saas_settlements as s', 's.id', '=', 'p.settlement_id')
            ->select('p.*', 't.short as tenant_short', 'f.number as invoice_number', 'm.brand', 'm.last4', 's.reference as settlement_reference');
        if (! empty($f['status'])) {
            $q->where('p.status', $f['status']);
        }
        if (! empty($f['tenant'])) {
            $q->where('p.tenant_id', $f['tenant']);
        }
        if (($f['conciliado'] ?? '') !== '') {
            $f['conciliado'] ? $q->whereNotNull('p.settlement_id') : $q->whereNull('p.settlement_id')->where('p.status', 'APPROVED');
        }

        return $q->orderByDesc('p.created_at')->limit(500)->get()->map(fn ($p) => [
            'id' => $p->id, 'tenant_short' => $p->tenant_short, 'invoice_id' => $p->invoice_id, 'invoice_number' => $p->invoice_number, 'gateway' => $p->gateway,
            'gateway_ref' => $p->gateway_ref, 'amount' => (float) $p->amount, 'status' => $p->status, 'status_name' => self::ESTADOS[$p->status],
            'origin' => $p->origin, 'origin_name' => self::ORIGENES[$p->origin], 'error' => $p->error, 'tarjeta' => $p->brand ? "{$p->brand} ···· {$p->last4}" : null,
            'raw_event' => $p->raw_event ? json_decode($p->raw_event, true) : null, 'created_at' => $p->created_at, 'confirmed_at' => $p->confirmed_at,
            'settlement_reference' => $p->settlement_reference,
        ])->all();
    }

    public static function eventos(): array
    {
        return DB::table('saas_gateway_events')->orderByDesc('received_at')->limit(200)->get()
            ->map(fn ($e) => array_merge((array) $e, ['payload' => json_decode($e->payload, true)]))->all();
    }

    public static function abonos(): array
    {
        return DB::table('saas_settlements')->orderByDesc('settled_on')->limit(100)->get()->all();
    }

    /* ------------------------------------------------------------------ internos */

    private static function procesar(string $gateway, string $cuerpo, ?string $firma): string
    {
        $datos = json_decode($cuerpo, true);
        $eventoId = is_array($datos) ? mb_substr((string) ($datos['id'] ?? ''), 0, 80) : '';
        $tipo = is_array($datos) ? mb_substr((string) ($datos['type'] ?? ''), 0, 40) : '';
        $ok = in_array($gateway, ['FAKE'], true) && self::pasarela($gateway)->verificar($cuerpo, $firma);
        $guardar = function (string $resultado) use ($gateway, $eventoId, $tipo, $ok, $datos, $cuerpo): string {
            DB::table('saas_gateway_events')->insert(['gateway' => mb_substr($gateway, 0, 12), 'event_id' => $eventoId ?: 'sin-id', 'type' => $tipo ?: 'desconocido',
                'signature_ok' => $ok, 'payload' => is_array($datos) ? json_encode($datos) : json_encode(['crudo' => mb_substr($cuerpo, 0, 2000)]),
                'result' => $resultado, 'received_at' => now()]);

            return $resultado;
        };

        if (! $ok) {
            return $guardar('Firma inválida: sin efecto');
        }
        if (DB::table('saas_gateway_events')->where('gateway', $gateway)->where('event_id', $eventoId)->where('signature_ok', true)->exists()) {
            return $guardar('Aviso repetido: sin efecto');
        }
        $ref = (string) ($datos['data']['charge'] ?? '');
        $cobro = DB::table('saas_payments')->where('gateway', $gateway)->where('gateway_ref', $ref)->lockForUpdate()->first();
        if (! $cobro) {
            return $guardar('Cobro desconocido: sin efecto');
        }
        if ($cobro->status !== 'PENDING') {
            return $guardar('El cobro ya estaba confirmado: sin efecto');
        }
        $aprobado = $tipo === 'charge.succeeded';
        DB::table('saas_payments')->where('id', $cobro->id)->update(['status' => $aprobado ? 'APPROVED' : 'DECLINED', 'confirmed_at' => now(),
            'error' => $aprobado ? null : mb_substr((string) ($datos['data']['error'] ?? 'Rechazado'), 0, 200), 'raw_event' => json_encode($datos), 'updated_at' => now()]);
        $sub = DB::table('saas_invoices')->where('id', $cobro->invoice_id)->value('subscription_id');
        if ($aprobado) {
            $saldado = Facturacion::recalcular($cobro->invoice_id);
            $saldado && $sub && Mora::alPagar($sub);

            return $guardar($saldado ? 'Cobro aprobado: comprobante pagado' : 'Cobro aprobado: queda saldo');
        }
        $sub && Mora::alFallar($sub);

        return $guardar('Cobro rechazado');
    }

    private static function codigo(): string
    {
        return (string) Consola::param('sus_gateway', 'FAKE');
    }
}
