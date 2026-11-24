<?php

namespace App\Modulos\Ops\Services;

use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * SUS-11 Suscripciones de clientes y OPS-04 Suspender o reactivar.
 *  - RN-SUS-04: solo las transiciones válidas; CANCELLED es final. Todo cambio deja su evento con quién y motivo.
 *  - Efecto (RN-SUS-07): SUSPENDED corta el acceso de la empresa (tenants.status, lo revisa cada petición);
 *    READ_ONLY y CANCELLED la dejan en solo lectura (middleware «suscripcion»); TRIAL, ACTIVE y PAST_DUE operan normal.
 *  - RN-SUS-15: la prueba se extiende sin pasar sus_trial_max_days en total.
 */
final class Suscripciones
{
    /** RN-SUS-04 */
    public const TRANSICIONES = [
        'TRIAL' => ['ACTIVE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED'],
        'ACTIVE' => ['PAST_DUE', 'SUSPENDED', 'CANCELLED'],
        'PAST_DUE' => ['ACTIVE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED'],
        'READ_ONLY' => ['ACTIVE', 'SUSPENDED', 'CANCELLED'],
        'SUSPENDED' => ['ACTIVE', 'READ_ONLY', 'CANCELLED'],
        'CANCELLED' => [],
    ];

    /** Qué ve la empresa en cada estado (para la confirmación de la consola). */
    public const EFECTO = [
        'TRIAL' => 'Opera normal mientras dura la prueba.',
        'ACTIVE' => 'Opera normal.',
        'PAST_DUE' => 'Opera normal, con el aviso de deuda.',
        'READ_ONLY' => 'Solo lectura: puede consultar, exportar y pagar, pero no registrar pedidos, comprobantes, cobros ni movimientos.',
        'SUSPENDED' => 'Suspensión total: nadie de la empresa puede ingresar hasta que se reactive.',
        'CANCELLED' => 'Cancelada: queda en solo lectura con sus datos guardados; no vuelve atrás.',
    ];

    public static function lista(): array
    {
        $empresas = collect(Empresas::lista())->keyBy('id');

        return DB::table('subscriptions as s')->join('tenants as t', 't.id', '=', 's.tenant_id')
            ->leftJoin('saas_plan_versions as v', 'v.id', '=', 's.plan_version_id')
            ->orderByRaw("s.status = 'CANCELLED'")->orderByDesc('s.status_changed_at')
            ->get(['s.*', 't.short', 't.name as tenant_name', 't.ruc', 'v.version', 'v.name as plan_name', 'v.price_pen'])
            ->map(fn ($s) => [
                'id' => $s->id, 'tenant_id' => $s->tenant_id, 'short' => $s->short, 'tenant_name' => $s->tenant_name, 'ruc' => $s->ruc,
                'plan_code' => $s->plan_code, 'plan_name' => $s->plan_name ?? $s->plan_code, 'version' => $s->version,
                'status' => $s->status, 'status_name' => Empresas::ESTADOS[$s->status],
                'days_in_status' => (int) now()->startOfDay()->diffInDays(Carbon::parse($s->status_changed_at)->startOfDay(), true),
                'trial_ends_at' => $s->trial_ends_at, 'trial_days_granted' => $s->trial_days_granted,
                'discount_pct' => (float) $s->discount_pct, 'discount_reason' => $s->discount_reason,
                'mrr' => self::mrr($s), 'uso' => $empresas[$s->tenant_id]['uso'] ?? [], 'started_at' => $s->started_at,
                'transiciones' => self::TRANSICIONES[$s->status],
            ])->all();
    }

    public static function detalle(string $id): array
    {
        $fila = collect(self::lista())->firstWhere('id', $id);
        if (! $fila) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }

        return $fila + [
            'historial' => DB::table('subscription_events')->where('subscription_id', $id)->orderByDesc('occurred_at')
                ->get(['event', 'from_status', 'to_status', 'reason', 'actor_name', 'actor_type', 'occurred_at', 'detail']),
            'efectos' => self::EFECTO,
        ];
    }

    /** Cambio de estado con motivo (SUS-11 y OPS-04). */
    public static function cambiarEstado(string $id, string $nuevo, string $motivo, array $quien): array
    {
        Consola::exigir($quien, 'tenant.status');

        return DB::transaction(function () use ($id, $nuevo, $motivo, $quien) {
            $s = DB::table('subscriptions')->where('id', $id)->lockForUpdate()->first();
            if (! $s) {
                abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
            }
            if (! in_array($nuevo, self::TRANSICIONES[$s->status], true)) {
                RuleError::fail('RN-SUS-04', 'No se puede pasar de «'.Empresas::ESTADOS[$s->status].'» a «'.Empresas::ESTADOS[$nuevo].'».'
                    .($s->status === 'CANCELLED' ? ' Una suscripción cancelada es final.' : ''));
            }
            DB::table('subscriptions')->where('id', $id)->update([
                'status' => $nuevo, 'status_changed_at' => now(), 'cancelled_at' => $nuevo === 'CANCELLED' ? now() : $s->cancelled_at, 'updated_at' => now(),
            ]);
            // El acceso de la empresa: solo la suspensión lo corta del todo.
            DB::select('SELECT platform_set_tenant_status(?, ?, ?)', [$s->tenant_id, $nuevo === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE', $quien['id']]);
            self::evento($s, 'STATUS_CHANGED', $motivo, $quien, ['from' => $s->status, 'to' => $nuevo]);
            Consola::bitacora($nuevo === 'SUSPENDED' ? 'TENANT_SUSPENDED' : ($s->status === 'SUSPENDED' ? 'TENANT_REACTIVATED' : 'SUBSCRIPTION_STATUS'), $quien,
                ['tenant' => $s->tenant_id, 'entity' => 'subscriptions', 'entity_id' => $id, 'reason' => $motivo, 'detail' => ['from' => $s->status, 'to' => $nuevo]]);

            return self::detalle($id);
        });
    }

    /** RN-SUS-15: más días de prueba, sin pasar el tope en total. */
    public static function extenderPrueba(string $id, int $dias, string $motivo, array $quien): array
    {
        Consola::exigir($quien, 'plans.manage');
        $s = self::buscar($id);
        if ($s->status !== 'TRIAL') {
            RuleError::fail('RN-SUS-15', 'Solo se extiende una suscripción en prueba.');
        }
        $tope = (int) Consola::param('sus_trial_max_days', 30);
        if ($s->trial_days_granted + $dias > $tope) {
            RuleError::fail('RN-SUS-15', "La prueba no puede pasar de {$tope} días en total: ya tiene {$s->trial_days_granted} y quedan ".max(0, $tope - $s->trial_days_granted).'.');
        }
        $fin = Carbon::parse($s->trial_ends_at)->addDays($dias);
        DB::table('subscriptions')->where('id', $id)->update(['trial_ends_at' => $fin, 'trial_days_granted' => $s->trial_days_granted + $dias, 'updated_at' => now()]);
        self::evento($s, 'TRIAL_EXTENDED', $motivo, $quien, ['dias' => $dias, 'hasta' => $fin->toIso8601String()]);
        Consola::bitacora('TRIAL_EXTENDED', $quien, ['tenant' => $s->tenant_id, 'entity' => 'subscriptions', 'entity_id' => $id, 'reason' => $motivo, 'detail' => ['dias' => $dias]]);

        return self::detalle($id);
    }

    /** Descuento pactado sobre la cuota (entra al MRR). */
    public static function descuento(string $id, float $pct, string $motivo, array $quien): array
    {
        Consola::exigir($quien, 'plans.manage');
        $s = self::buscar($id);
        if ($s->status === 'CANCELLED') {
            RuleError::fail('RN-SUS-04', 'Una suscripción cancelada no cambia.');
        }
        DB::table('subscriptions')->where('id', $id)->update(['discount_pct' => $pct, 'discount_reason' => $pct > 0 ? $motivo : null, 'updated_at' => now()]);
        self::evento($s, 'DISCOUNT', $motivo, $quien, ['antes' => (float) $s->discount_pct, 'despues' => $pct]);
        Consola::bitacora('SUBSCRIPTION_DISCOUNT', $quien, ['tenant' => $s->tenant_id, 'entity' => 'subscriptions', 'entity_id' => $id, 'reason' => $motivo, 'detail' => ['pct' => $pct]]);

        return self::detalle($id);
    }

    /** MRR de la suscripción: cuota mensual después del descuento, sin IGV, solo si está activa o con deuda (KPI-OPS-01). */
    public static function mrr(object $s): float
    {
        if (! in_array($s->status, ['ACTIVE', 'PAST_DUE'], true)) {
            return 0.0;
        }
        $precio = $s->price_pen ?? DB::table('saas_plan_versions')->where('id', $s->plan_version_id)->value('price_pen')
            ?? DB::table('saas_plans')->where('code', $s->plan_code)->value('price_pen');

        return round((float) $precio * (1 - ((float) ($s->discount_pct ?? 0)) / 100), 2);
    }

    private static function buscar(string $id): object
    {
        $s = DB::table('subscriptions')->where('id', $id)->first();
        if (! $s) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }

        return $s;
    }

    private static function evento(object $s, string $evento, string $motivo, array $quien, array $detalle): void
    {
        DB::table('subscription_events')->insert([
            'subscription_id' => $s->id, 'tenant_id' => $s->tenant_id, 'event' => $evento,
            'from_status' => $detalle['from'] ?? $s->status, 'to_status' => $detalle['to'] ?? $s->status, 'reason' => mb_substr($motivo, 0, 300),
            'actor_type' => 'PLATFORM_USER', 'actor_id' => $quien['id'], 'actor_name' => $quien['full_name'], 'detail' => json_encode($detalle), 'occurred_at' => now(),
        ]);
    }
}
