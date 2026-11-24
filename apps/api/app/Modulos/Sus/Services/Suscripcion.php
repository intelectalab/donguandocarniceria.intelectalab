<?php

namespace App\Modulos\Sus\Services;

use App\Models\User;
use App\Modulos\Ops\Services\Consola;
use App\Modulos\Ops\Services\Empresas;
use App\Modulos\Ops\Services\Suscripciones;
use App\Support\Access;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * La suscripción de la empresa en contexto (SUS-01, SUS-04 a SUS-08) y el contrato de SUS para los demás módulos
 * (docs/contratos.md). La tabla subscriptions no tiene RLS: aquí siempre se filtra por la empresa del contexto.
 *  - RN-SUS-21: una empresa sin suscripción (piloto, interna) no tiene límites ni bloqueos.
 *  - RN-SUS-06: límites del plan contratado (usuarios del personal, marcas y locales activos).
 *  - RN-SUS-17: cancelar al fin del período; los datos se conservan sus_data_retention_days.
 *  - RN-SUS-20: la tarjeta nunca llega al sistema: la pasarela la convierte en un token en el navegador.
 */
final class Suscripcion
{
    /** Límites que mide SUS: clave => [columna del plan, nombre]. */
    public const LIMITES = ['users' => ['users_max', 'Usuarios del personal'], 'brands' => ['brands_max', 'Marcas'], 'sites' => ['sites_max', 'Locales']];

    public const ENCUESTA = ['PRICE' => 'Es caro para mi negocio', 'MISSING' => 'Le faltan funciones que necesito', 'HARD' => 'Es difícil de usar',
        'OTHER_SYSTEM' => 'Me cambio a otro sistema', 'CLOSING' => 'Cierro o pauso el negocio', 'OTHER' => 'Otro motivo'];

    /* ------------------------------------------------------------------ contrato para otros módulos */

    /** La suscripción viva de la empresa en contexto, o null si opera sin suscripción (RN-SUS-21). */
    public static function vigente(): ?object
    {
        $tenant = TenantContext::id();
        if (! $tenant) {
            return null;
        }

        return DB::table('subscriptions')->where('tenant_id', $tenant)->orderByRaw("status = 'CANCELLED'")->orderByDesc('started_at')->first();
    }

    /** RN-SUS-07: ¿puede registrar? (no en solo lectura, suspendida ni cancelada). Sin suscripción, siempre. */
    public static function operativa(): bool
    {
        $s = self::vigente();

        return ! $s || ! in_array($s->status, ['READ_ONLY', 'SUSPENDED', 'CANCELLED'], true);
    }

    /** RN-SUS-06: límite efectivo de una clave de LIMITES; null = sin límite. */
    public static function limite(string $clave): ?int
    {
        $s = self::vigente();
        if (! $s || $s->status === 'CANCELLED' || ! isset(self::LIMITES[$clave])) {
            return null;
        }
        $v = DB::table('saas_plan_versions')->where('id', $s->plan_version_id)->value(self::LIMITES[$clave][0]);

        return $v === null ? null : (int) $v;
    }

    /** Uso actual de una clave de LIMITES en la empresa en contexto. */
    public static function usado(string $clave): int
    {
        return match ($clave) {
            // Los usuarios técnicos del soporte y los del portal B2B no cuentan (RN-SUS-06).
            'users' => DB::table('users')->where('status', 'ACTIVE')->where(fn ($q) => $q->whereNull('user_type')->orWhereNotIn('user_type', ['PLATFORM_SUPPORT', 'B2B_CUSTOMER']))->count(),
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->count(),
            'sites' => DB::table('establishments')->where('status', 'ACTIVE')->count(),
            default => 0,
        };
    }

    /** RN-SUS-06: rechaza una alta que pasaría el límite, con el límite y el uso en el mensaje. */
    public static function exigirLimite(string $clave, int $agrega = 1): void
    {
        $limite = self::limite($clave);
        if ($limite === null) {
            return;
        }
        $uso = self::usado($clave);
        if ($uso + $agrega > $limite) {
            RuleError::fail('RN-SUS-06', 'Tu plan permite '.$limite.' '.mb_strtolower(self::LIMITES[$clave][1])." y ya tienes {$uso}. Cambia de plan o contrata más para agregar otro.");
        }
    }

    /* ------------------------------------------------------------------ SUS-01 y SUS-04 */

    public static function resumen(User $u): array
    {
        $s = self::vigente();
        if (! $s) {
            return ['sin_suscripcion' => true];
        }
        $v = DB::table('saas_plan_versions')->where('id', $s->plan_version_id)->first();
        $mes = now()->startOfMonth();

        return [
            'sin_suscripcion' => false,
            'id' => $s->id, 'status' => $s->status, 'status_name' => Empresas::ESTADOS[$s->status], 'efecto' => Suscripciones::EFECTO[$s->status],
            'plan_code' => $s->plan_code, 'plan_name' => $v->name ?? $s->plan_code, 'plan_version' => $v->version ?? null, 'plan_description' => $v->description ?? null,
            'price_pen' => $v && $v->price_pen !== null ? (float) $v->price_pen : null, 'discount_pct' => (float) ($s->discount_pct ?? 0),
            'cuota' => $v && $v->price_pen !== null ? round((float) $v->price_pen * (1 - (float) ($s->discount_pct ?? 0) / 100), 2) : null,
            'igv_rate' => (float) Consola::param('sus_igv_rate', 0.18),
            'started_at' => $s->started_at, 'trial_ends_at' => $s->trial_ends_at, 'proximo_cobro' => $s->status === 'TRIAL' ? null : now()->startOfMonth()->addMonth()->toDateString(),
            'cancel_at_period_end' => (bool) $s->cancel_at_period_end, 'cancel_effective_on' => $s->cancel_effective_on,
            'conservacion_hasta' => $s->status === 'CANCELLED' && $s->cancelled_at ? Carbon::parse($s->cancelled_at)->addDays((int) Consola::param('sus_data_retention_days', 90))->toDateString() : null,
            'uso' => collect(self::LIMITES)->map(fn ($l, $k) => ['clave' => $k, 'nombre' => $l[1], 'usado' => self::usado($k), 'limite' => self::limite($k), 'tipo' => 'HARD'])->values(),
            'pedidos_mes' => DB::table('sales_orders')->where('status', '!=', 'DRAFT')->where('created_at', '>=', $mes)->count(),
            'deuda' => self::deuda(),
            'medio_pago' => self::medio(),
            'puede' => ['facturas' => self::puede($u, 'sus.invoice.view'), 'pagar' => self::puede($u, 'sus.payment_method.manage'), 'cancelar' => self::puede($u, 'sus.subscription.cancel')],
        ];
    }

    /* ------------------------------------------------------------------ SUS-05 */

    /** Comprobantes emitidos de la empresa (los borradores no se ven: aún no existen para ella). */
    public static function comprobantes(): array
    {
        $ids = DB::table('saas_invoices')->where('status', 'ISSUED')->orderByDesc('issue_date')->orderByDesc('created_at')->limit(120)->pluck('id');

        return $ids->map(fn ($id) => self::sinInternos(Facturacion::ver($id)))->all();
    }

    public static function comprobante(string $id): array
    {
        $f = DB::table('saas_invoices')->where('id', $id)->where('status', 'ISSUED')->first();
        if (! $f) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }

        return self::sinInternos(Facturacion::ver($id)) + ['emisor' => ['ruc' => $f->issuer_ruc, 'nombre' => Consola::param('sus_issuer_name', '') ?: 'Intelectalab']];
    }

    /** Pagar un comprobante con la tarjeta registrada (el resultado llega por el aviso de la pasarela). */
    public static function pagar(User $u, string $id): array
    {
        self::comprobante($id);
        $p = Pagos::cobrar($id, 'CUSTOMER');

        return ['status' => $p['status'], 'error' => $p['error'] ?? null, 'comprobante' => self::comprobante($id)];
    }

    /* ------------------------------------------------------------------ SUS-06 */

    /** Guarda el medio de pago: solo el token, la marca, los 4 últimos dígitos y el vencimiento (RN-SUS-20). */
    public static function guardarMedio(User $u, array $d): array
    {
        $s = self::vigente();
        if (! $s || $s->status === 'CANCELLED') {
            RuleError::fail('RN-SUS-20', 'Tu empresa no tiene una suscripción activa.');
        }
        $venceFin = Carbon::create((int) $d['exp_year'], (int) $d['exp_month'], 1)->endOfMonth();
        if ($venceFin->isPast()) {
            RuleError::fail('RN-SUS-20', 'La tarjeta está vencida.');
        }
        DB::transaction(function () use ($d, $s) {
            DB::table('saas_payment_methods')->where('active', true)->update(['active' => false, 'updated_at' => now()]);
            DB::table('saas_payment_methods')->insert(['tenant_id' => $s->tenant_id, 'gateway' => $d['gateway'], 'token' => $d['token'], 'brand' => $d['brand'],
                'last4' => $d['last4'], 'exp_month' => $d['exp_month'], 'exp_year' => $d['exp_year'], 'auto_pay' => (bool) $d['auto_pay'],
                'billing_email' => $d['billing_email'] ?? null, 'created_at' => now(), 'updated_at' => now()]);
        });
        self::evento($s, 'PAYMENT_METHOD', 'Medio de pago registrado', $u, ['tarjeta' => "{$d['brand']} {$d['last4']}"]);

        return self::medio();
    }

    /** Cobro automático sí o no y correo de facturación, sin cambiar la tarjeta. */
    public static function preferencias(User $u, array $d): array
    {
        $m = DB::table('saas_payment_methods')->where('active', true)->first();
        if (! $m) {
            RuleError::fail('RN-SUS-20', 'Primero registra una tarjeta.');
        }
        DB::table('saas_payment_methods')->where('id', $m->id)->update(['auto_pay' => (bool) $d['auto_pay'], 'billing_email' => $d['billing_email'] ?? null, 'updated_at' => now()]);

        return self::medio();
    }

    /* ------------------------------------------------------------------ SUS-07 */

    /** RN-SUS-17: se cancela al fin del período pagado (en prueba, al terminar la prueba). */
    public static function cancelar(User $u, array $d): array
    {
        $s = self::vigente();
        if (! $s || $s->status === 'CANCELLED') {
            RuleError::fail('RN-SUS-17', 'Tu empresa no tiene una suscripción activa.');
        }
        if ($s->cancel_at_period_end) {
            RuleError::fail('RN-SUS-17', 'La cancelación ya está pedida para el '.Carbon::parse($s->cancel_effective_on)->format('d/m/Y').'.');
        }
        $fecha = $s->status === 'TRIAL' && $s->trial_ends_at ? Carbon::parse($s->trial_ends_at)->startOfDay() : now()->startOfMonth()->addMonth();
        DB::table('subscriptions')->where('id', $s->id)->update(['cancel_at_period_end' => true, 'cancel_effective_on' => $fecha->toDateString(),
            'cancel_reason' => mb_substr(trim($d['reason']), 0, 300), 'cancel_survey' => $d['survey'], 'cancel_requested_by' => $u->id, 'updated_at' => now()]);
        self::evento($s, 'CANCEL_REQUESTED', trim($d['reason']), $u, ['desde' => $fecha->toDateString(), 'encuesta' => $d['survey']]);

        return self::resumen($u);
    }

    public static function deshacerCancelacion(User $u): array
    {
        $s = self::vigente();
        if (! $s || ! $s->cancel_at_period_end || $s->status === 'CANCELLED') {
            RuleError::fail('RN-SUS-17', 'No hay una cancelación pendiente.');
        }
        DB::table('subscriptions')->where('id', $s->id)->update(['cancel_at_period_end' => false, 'cancel_effective_on' => null, 'cancel_reason' => null,
            'cancel_survey' => null, 'cancel_requested_by' => null, 'updated_at' => now()]);
        self::evento($s, 'CANCEL_UNDONE', 'La empresa decidió seguir', $u, []);

        return self::resumen($u);
    }

    /* ------------------------------------------------------------------ SUS-08 y /me */

    /** Para la franja de toda la aplicación: estado, días de mora y deuda (null si no hay nada que avisar). */
    public static function paraMe(): ?array
    {
        $s = self::vigente();
        if (! $s) {
            return null;
        }
        $deuda = in_array($s->status, ['PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED', 'ACTIVE'], true) ? self::deuda() : null;
        $pruebaPorVencer = $s->status === 'TRIAL' && $s->trial_ends_at && Carbon::parse($s->trial_ends_at)->lte(now()->addDays(5)) && ! self::medio();
        if (! in_array($s->status, ['PAST_DUE', 'READ_ONLY', 'CANCELLED'], true) && ! $pruebaPorVencer && ! $s->cancel_at_period_end) {
            return null;
        }
        $gracia = (int) Consola::param('sus_grace_days', 7);

        return [
            'status' => $s->status, 'deuda' => $deuda['total'] ?? 0, 'dias' => $deuda['dias'] ?? 0,
            'solo_lectura_desde' => $s->status === 'PAST_DUE' && isset($deuda['vence']) ? Carbon::parse($deuda['vence'])->addDays($gracia)->toDateString() : null,
            'trial_ends_at' => $pruebaPorVencer ? $s->trial_ends_at : null, 'cancel_effective_on' => $s->cancel_at_period_end ? $s->cancel_effective_on : null,
            'conservacion_hasta' => $s->status === 'CANCELLED' && $s->cancelled_at ? Carbon::parse($s->cancelled_at)->addDays((int) Consola::param('sus_data_retention_days', 90))->toDateString() : null,
        ];
    }

    /** RN-SUS-17: aplica las cancelaciones que llegaron a su fecha (lo llama la tarea diaria, en contexto de plataforma). */
    public static function aplicarCancelaciones(): int
    {
        $n = 0;
        foreach (DB::table('subscriptions')->where('cancel_at_period_end', true)->where('status', '!=', 'CANCELLED')->where('cancel_effective_on', '<=', today())->get() as $s) {
            DB::table('subscriptions')->where('id', $s->id)->update(['status' => 'CANCELLED', 'status_changed_at' => now(), 'cancelled_at' => now(), 'updated_at' => now()]);
            DB::select('SELECT platform_dunning_tenant_status(?)', [$s->tenant_id]);
            DB::table('subscription_events')->insert(['subscription_id' => $s->id, 'tenant_id' => $s->tenant_id, 'event' => 'STATUS_CHANGED', 'from_status' => $s->status,
                'to_status' => 'CANCELLED', 'reason' => 'Cancelada por la empresa: '.mb_substr((string) $s->cancel_reason, 0, 250), 'actor_type' => 'SYSTEM',
                'actor_name' => 'Sistema', 'detail' => json_encode(['encuesta' => $s->cancel_survey]), 'occurred_at' => now()]);
            $n++;
        }

        return $n;
    }

    /* ------------------------------------------------------------------ internos */

    private static function deuda(): array
    {
        $f = collect(self::comprobantesPorPagar());

        return ['total' => round($f->sum('saldo'), 2), 'comprobantes' => $f->count(), 'vence' => $f->min('due_date'),
            'dias' => $f->min('due_date') && Carbon::parse($f->min('due_date'))->lt(today()) ? (int) Carbon::parse($f->min('due_date'))->diffInDays(today()) : 0];
    }

    private static function comprobantesPorPagar(): array
    {
        $ids = DB::table('saas_invoices')->where('status', 'ISSUED')->where('doc_type', '!=', 'CREDIT_NOTE')->where('payment_status', 'UNPAID')->pluck('id');

        return $ids->map(fn ($id) => Facturacion::ver($id))->filter(fn ($f) => $f['saldo'] > 0)->values()->all();
    }

    private static function medio(): ?array
    {
        $m = DB::table('saas_payment_methods')->where('active', true)->first();

        return $m ? ['brand' => $m->brand, 'last4' => $m->last4, 'exp_month' => $m->exp_month, 'exp_year' => $m->exp_year, 'auto_pay' => (bool) $m->auto_pay,
            'billing_email' => $m->billing_email, 'gateway' => $m->gateway] : null;
    }

    /** Lo que la empresa no necesita ver de un comprobante (datos internos de la consola). */
    private static function sinInternos(array $f): array
    {
        unset($f['tenant_id'], $f['tenant_short'], $f['subscription_id']);
        $f['cobros'] = collect($f['cobros'] ?? [])->map(fn ($c) => ['amount' => $c->amount, 'status' => $c->status, 'error' => $c->error, 'created_at' => $c->created_at])->all();

        return $f;
    }

    private static function puede(User $u, string $p): bool
    {
        return Access::can($u, $p);
    }

    private static function evento(object $s, string $evento, string $motivo, User $u, array $detalle): void
    {
        DB::table('subscription_events')->insert(['subscription_id' => $s->id, 'tenant_id' => $s->tenant_id, 'event' => $evento, 'from_status' => $s->status,
            'to_status' => $s->status, 'reason' => mb_substr($motivo, 0, 300), 'actor_type' => 'TENANT_USER', 'actor_id' => $u->id, 'actor_name' => $u->name,
            'detail' => json_encode($detalle), 'occurred_at' => now()]);
    }
}
