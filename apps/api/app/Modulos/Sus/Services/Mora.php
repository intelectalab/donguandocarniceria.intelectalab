<?php

namespace App\Modulos\Sus\Services;

use App\Modulos\Ops\Services\Consola;
use App\Modulos\Ops\Services\Empresas;
use App\Modulos\Ops\Services\Suscripciones;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * SUS-14 Mora (RN-SUS-10, RN-SUS-15).
 *  - Tarea diaria: un comprobante vencido pasa la suscripción a «con deuda»; se reintenta el cobro los días de mora de
 *    sus_payment_retry_days (1, 3 y 5); a los sus_grace_days (7) pasa a solo lectura y sus_read_only_days (15) después,
 *    a suspendida. Una prórroga (grace_until) pospone esos pasos. Una prueba vencida sin medio de pago pasa a solo
 *    lectura; con medio de pago, a activa.
 *  - El pago confirmado la devuelve a activa en el momento. Cada cambio queda en el historial con actor «Sistema».
 *  - La consola ve la cola con lo que debe cada empresa, los días, el próximo reintento y los próximos pasos, y puede
 *    mandar un recordatorio, dar una prórroga con motivo o cobrar ahora.
 */
final class Mora
{
    private const ADMINISTRADORES = ['GERENTE', 'ADMIN_SISTEMA', 'ADMINISTRACION'];

    /** Tarea diaria (contexto de plataforma). Devuelve un resumen de lo que hizo. */
    public static function diaria(): array
    {
        $r = ['pruebas' => 0, 'con_deuda' => 0, 'reintentos' => 0, 'solo_lectura' => 0, 'suspendidas' => 0];
        // RN-SUS-17: las cancelaciones pedidas por la empresa que llegaron a su fecha (antes de facturar el mes).
        $r['canceladas'] = Suscripcion::aplicarCancelaciones();
        // RN-SUS-18: las bajadas de plan que llegaron a su fecha (si el uso todavía cabe).
        $r['cambios_de_plan'] = CambioDePlan::aplicarPendientes();
        // RN-SUS-15: pruebas vencidas.
        foreach (DB::table('subscriptions')->where('status', 'TRIAL')->where('trial_ends_at', '<=', now())->get() as $s) {
            $conMedio = DB::table('saas_payment_methods')->where('tenant_id', $s->tenant_id)->where('active', true)->exists();
            self::pasar($s, $conMedio ? 'ACTIVE' : 'READ_ONLY', $conMedio ? 'Terminó la prueba: tiene medio de pago' : 'Terminó la prueba sin medio de pago');
            $r['pruebas']++;
        }
        $hoy = today();
        $reintentos = (array) Consola::param('sus_payment_retry_days', [1, 3, 5]);
        $gracia = (int) Consola::param('sus_grace_days', 7);
        $lectura = (int) Consola::param('sus_read_only_days', 15);
        foreach (self::deudas() as $d) {
            $s = DB::table('subscriptions')->where('id', $d->subscription_id)->first();
            if (! $s || in_array($s->status, ['CANCELLED', 'TRIAL'], true)) {
                continue;
            }
            $dias = (int) Carbon::parse($d->vence)->diffInDays($hoy);
            if ($s->status === 'ACTIVE') {
                $s = self::pasar($s, 'PAST_DUE', "Comprobante vencido hace {$dias} día(s)");
                $r['con_deuda']++;
            }
            if (in_array($dias, $reintentos, true) && ! DB::table('saas_payments')->where('invoice_id', $d->factura)->where('created_at', '>=', $hoy)->exists()) {
                try {
                    if (Pagos::cobrarSiCorresponde($d->factura, 'RETRY')) {
                        $r['reintentos']++;
                        $s = DB::table('subscriptions')->where('id', $s->id)->first();
                        if ($s->status === 'ACTIVE') {
                            continue;   // el reintento cobró y la reactivó
                        }
                    }
                } catch (Throwable) {
                    // Un reintento que no se puede hacer (sin medio de pago) no frena la mora.
                }
            }
            if ($s->grace_until && Carbon::parse($s->grace_until)->gte($hoy)) {
                continue;   // prórroga vigente
            }
            if ($s->status === 'PAST_DUE' && $dias >= $gracia) {
                $s = self::pasar($s, 'READ_ONLY', "{$dias} días de mora");
                $r['solo_lectura']++;
            }
            if ($s->status === 'READ_ONLY' && $dias >= $gracia + $lectura) {
                self::pasar($s, 'SUSPENDED', "{$dias} días de mora");
                $r['suspendidas']++;
            }
        }

        return $r;
    }

    /** El pago confirmado la devuelve a activa si ya no debe nada vencido (RN-SUS-10). */
    public static function alPagar(string $sub): void
    {
        $s = DB::table('subscriptions')->where('id', $sub)->first();
        if (! $s || ! in_array($s->status, ['PAST_DUE', 'READ_ONLY', 'SUSPENDED'], true)) {
            return;
        }
        $debe = DB::table('saas_invoices')->where('subscription_id', $sub)->where('status', 'ISSUED')->where('doc_type', '!=', 'CREDIT_NOTE')
            ->where('payment_status', 'UNPAID')->where('due_date', '<', today())->exists();
        if (! $debe) {
            self::pasar($s, 'ACTIVE', 'Pago confirmado');
            DB::table('subscriptions')->where('id', $sub)->update(['grace_until' => null]);
        }
    }

    /** Un cobro rechazado deja la suscripción con deuda. */
    public static function alFallar(string $sub): void
    {
        $s = DB::table('subscriptions')->where('id', $sub)->first();
        if ($s && $s->status === 'ACTIVE') {
            self::pasar($s, 'PAST_DUE', 'El cobro fue rechazado');
        }
    }

    /** Cola de mora: empresas que deben, cuánto, desde cuándo y qué les toca. */
    public static function cola(): array
    {
        $gracia = (int) Consola::param('sus_grace_days', 7);
        $lectura = (int) Consola::param('sus_read_only_days', 15);
        $reintentos = (array) Consola::param('sus_payment_retry_days', [1, 3, 5]);
        $hoy = today();
        $filas = [];
        foreach (self::deudas(incluirSinVencer: true) as $d) {
            $s = DB::table('subscriptions as s')->join('tenants as t', 't.id', '=', 's.tenant_id')->where('s.id', $d->subscription_id)
                ->select('s.*', 't.short as tenant_short')->first();
            if (! $s || $s->status === 'CANCELLED') {
                continue;
            }
            $vence = Carbon::parse($d->vence);
            $dias = $vence->lt($hoy) ? (int) $vence->diffInDays($hoy) : 0;
            $proximo = collect($reintentos)->map(fn ($n) => $vence->copy()->addDays($n))->first(fn ($f) => $f->gte($hoy));
            $prorroga = $s->grace_until ? Carbon::parse($s->grace_until) : null;
            $aLectura = $vence->copy()->addDays($gracia);
            $aSuspension = $vence->copy()->addDays($gracia + $lectura);
            if ($prorroga) {
                $aLectura = $aLectura->max($prorroga->copy()->addDay());
                $aSuspension = $aSuspension->max($prorroga->copy()->addDay());
            }
            $medio = DB::table('saas_payment_methods')->where('tenant_id', $s->tenant_id)->where('active', true)->first(['brand', 'last4', 'auto_pay']);
            $filas[] = [
                'subscription_id' => $s->id, 'tenant_id' => $s->tenant_id, 'tenant_short' => $s->tenant_short, 'plan_code' => $s->plan_code,
                'status' => $s->status, 'status_name' => Empresas::ESTADOS[$s->status], 'deuda' => round((float) $d->deuda, 2), 'comprobantes' => (int) $d->n,
                'factura' => $d->factura, 'vence' => $vence->toDateString(), 'dias' => $dias, 'proximo_reintento' => $proximo?->toDateString(),
                'pasa_a_solo_lectura' => in_array($s->status, ['ACTIVE', 'PAST_DUE'], true) ? $aLectura->toDateString() : null,
                'pasa_a_suspension' => in_array($s->status, ['ACTIVE', 'PAST_DUE', 'READ_ONLY'], true) ? $aSuspension->toDateString() : null,
                'grace_until' => $s->grace_until, 'medio_pago' => $medio ? "{$medio->brand} ···· {$medio->last4}".($medio->auto_pay ? '' : ' (sin cobro automático)') : null,
                'acciones' => DB::table('saas_dunning_actions')->where('subscription_id', $s->id)->orderByDesc('at')->limit(5)->get(['kind', 'until', 'reason', 'actor_name', 'at']),
            ];
        }
        usort($filas, fn ($a, $b) => $b['dias'] <=> $a['dias']);

        return $filas;
    }

    public static function recordatorio(string $sub, array $quien): void
    {
        Consola::exigir($quien, 'billing.manage');
        $s = self::fila($sub);
        $d = collect(self::deudas(incluirSinVencer: true))->firstWhere('subscription_id', $sub);
        if (! $d) {
            RuleError::fail('RN-SUS-10', 'La empresa no tiene comprobantes por pagar.');
        }
        self::avisarEmpresa($s->tenant_id, 'Tienes un pago pendiente con GestionCarnica',
            'Debes S/ '.number_format((float) $d->deuda, 2, ',', '.').' (vence '.Carbon::parse($d->vence)->format('d/m/Y').'). Paga para seguir operando sin interrupciones.');
        DB::table('saas_dunning_actions')->insert(['subscription_id' => $sub, 'tenant_id' => $s->tenant_id, 'kind' => 'REMINDER', 'actor_name' => $quien['full_name'], 'at' => now()]);
        Consola::bitacora('DUNNING_REMINDER', $quien, ['tenant' => $s->tenant_id, 'entity' => 'subscriptions', 'entity_id' => $sub, 'reason' => 'Recordatorio de pago']);
    }

    /** Prórroga con motivo: pospone el paso a solo lectura o suspensión hasta esa fecha (no deshace el estado actual). */
    public static function prorroga(string $sub, array $quien, string $hasta, string $motivo): void
    {
        Consola::exigir($quien, 'billing.manage');
        $s = self::fila($sub);
        $max = (int) Consola::param('sus_max_extension_days', 15);
        $fecha = Carbon::parse($hasta)->startOfDay();
        if ($fecha->lt(today()) || $fecha->gt(today()->addDays($max))) {
            RuleError::fail('RN-SUS-10', "La prórroga va de hoy a {$max} días como máximo.");
        }
        DB::table('subscriptions')->where('id', $sub)->update(['grace_until' => $fecha->toDateString(), 'updated_at' => now()]);
        DB::table('saas_dunning_actions')->insert(['subscription_id' => $sub, 'tenant_id' => $s->tenant_id, 'kind' => 'EXTENSION', 'until' => $fecha->toDateString(),
            'reason' => mb_substr(trim($motivo), 0, 300), 'actor_name' => $quien['full_name'], 'at' => now()]);
        self::evento($s, 'GRACE_EXTENDED', trim($motivo), ['hasta' => $fecha->toDateString()], $quien);
        Consola::bitacora('DUNNING_EXTENSION', $quien, ['tenant' => $s->tenant_id, 'entity' => 'subscriptions', 'entity_id' => $sub, 'reason' => trim($motivo),
            'detail' => ['hasta' => $fecha->toDateString()]]);
    }

    /** Cobra ahora el comprobante vencido más antiguo. */
    public static function cobrarAhora(string $sub, array $quien): array
    {
        Consola::exigir($quien, 'billing.manage');
        $d = collect(self::deudas(incluirSinVencer: true))->firstWhere('subscription_id', $sub);
        if (! $d) {
            RuleError::fail('RN-SUS-10', 'La empresa no tiene comprobantes por pagar.');
        }

        return Pagos::cobrar($d->factura, 'CONSOLE', $quien);
    }

    /* ------------------------------------------------------------------ internos */

    /** Por suscripción: deuda de comprobantes emitidos sin pagar, el más antiguo y su vencimiento. */
    private static function deudas(bool $incluirSinVencer = false): array
    {
        $filtro = $incluirSinVencer ? '' : 'AND f.due_date < ?';

        return DB::select(<<<SQL
            SELECT f.subscription_id, sum(f.total - coalesce(p.pagado, 0) - coalesce(n.acreditado, 0)) AS deuda, count(*) AS n, min(f.due_date) AS vence,
                   (array_agg(f.id ORDER BY f.due_date))[1] AS factura
            FROM saas_invoices f
            LEFT JOIN (SELECT invoice_id, sum(amount) AS pagado FROM saas_payments WHERE status = 'APPROVED' GROUP BY invoice_id) p ON p.invoice_id = f.id
            LEFT JOIN (SELECT credit_note_for, sum(total) AS acreditado FROM saas_invoices WHERE status = 'ISSUED' AND doc_type = 'CREDIT_NOTE' GROUP BY credit_note_for) n ON n.credit_note_for = f.id
            WHERE f.status = 'ISSUED' AND f.doc_type <> 'CREDIT_NOTE' AND f.payment_status = 'UNPAID' AND f.subscription_id IS NOT NULL
              {$filtro}
            GROUP BY f.subscription_id
            SQL, $incluirSinVencer ? [] : [today()->toDateString()]);
    }

    /** Cambia el estado con actor «Sistema», respetando las transiciones (RN-SUS-04) y el acceso de la empresa. */
    private static function pasar(object $s, string $a, string $motivo): object
    {
        if ($s->status === $a || ! in_array($a, Suscripciones::TRANSICIONES[$s->status], true)) {
            return $s;
        }
        DB::table('subscriptions')->where('id', $s->id)->update(['status' => $a, 'status_changed_at' => now(), 'updated_at' => now()]);
        DB::select('SELECT platform_dunning_tenant_status(?)', [$s->tenant_id]);
        self::evento($s, 'STATUS_CHANGED', $motivo, ['from' => $s->status, 'to' => $a]);
        if (in_array($a, ['READ_ONLY', 'SUSPENDED'], true)) {
            self::avisarEmpresa($s->tenant_id, $a === 'READ_ONLY' ? 'Tu empresa quedó en solo lectura' : 'Tu empresa fue suspendida',
                $a === 'READ_ONLY' ? 'Por un pago pendiente puedes consultar y exportar, pero no registrar nada nuevo. Paga para volver a operar.'
                    : 'Por un pago pendiente, nadie de la empresa puede ingresar hasta que se pague.');
        }

        return DB::table('subscriptions')->where('id', $s->id)->first();
    }

    private static function evento(object $s, string $evento, string $motivo, array $detalle, ?array $quien = null): void
    {
        DB::table('subscription_events')->insert([
            'subscription_id' => $s->id, 'tenant_id' => $s->tenant_id, 'event' => $evento, 'from_status' => $detalle['from'] ?? $s->status,
            'to_status' => $detalle['to'] ?? $s->status, 'reason' => mb_substr($motivo, 0, 300), 'actor_type' => $quien ? 'PLATFORM_USER' : 'SYSTEM',
            'actor_id' => $quien['id'] ?? null, 'actor_name' => $quien['full_name'] ?? 'Sistema', 'detail' => json_encode($detalle), 'occurred_at' => now(),
        ]);
    }

    private static function avisarEmpresa(string $tenant, string $titulo, string $texto): void
    {
        $plataforma = DB::selectOne("SELECT current_setting('app.platform', true) = 'on' AS si")->si;
        TenantContext::set(TenantContext::find($tenant));
        try {
            $ids = DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')->join('users', 'users.id', '=', 'user_roles.user_id')
                ->where('users.status', 'ACTIVE')->whereIn('roles.code', self::ADMINISTRADORES)->distinct()->pluck('users.id');
            $filas = $ids->map(fn ($id) => ['user_id' => $id, 'module' => 'SUS', 'tone' => 'warn', 'at' => now(), 'title' => $titulo, 'body' => mb_substr($texto, 0, 240),
                'ref' => json_encode(['href' => '/inicio'])])->all();
            if ($filas) {
                DB::table('notifications')->insert($filas);
            }
        } finally {
            $plataforma ? TenantContext::platform() : TenantContext::set(null);
        }
    }

    private static function fila(string $sub): object
    {
        return DB::table('subscriptions')->where('id', $sub)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }
}
