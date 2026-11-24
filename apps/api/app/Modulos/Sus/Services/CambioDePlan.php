<?php

namespace App\Modulos\Sus\Services;

use App\Models\User;
use App\Modulos\Ops\Services\Planes;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * SUS-02 Cambiar de plan y SUS-03 Complementos (la empresa, permiso sus.subscription.change_plan).
 *  - RN-SUS-18: subir es inmediato, con prorrateo = (cuota nueva − anterior) × días restantes / días del período, en un
 *    comprobante aparte; bajar se aplica al fin del período y solo si el uso actual cabe en el plan nuevo (con sus
 *    complementos). En prueba, el cambio es inmediato y sin prorrateo.
 *  - RN-SUS-05: solo planes publicados.
 *  - Complementos: encienden un módulo (con sus dependencias en el plan, RN-SUS-01) o suben un límite. Se cobran en la
 *    corrida del mes; quitar uno no puede dejar el uso por encima del límite ni a un módulo sin lo que necesita.
 *  - RN-SUS-08: cada cambio vuelve a calcular los módulos encendidos.
 */
final class CambioDePlan
{
    /* ------------------------------------------------------------------ SUS-02 */

    /** Planes publicados para comparar, con lo que pasaría al elegir cada uno. */
    public static function comparador(): array
    {
        $s = self::viva();
        $actual = DB::table('saas_plan_versions')->where('id', $s->plan_version_id)->first();
        $catalogo = Planes::modulos();
        $versiones = DB::table('saas_plan_versions')->where('status', 'PUBLISHED')->orderBy('sort_order')->orderBy('price_pen')->get();

        return [
            'actual' => $actual?->id, 'pendiente' => $s->pending_plan_version_id, 'pendiente_desde' => $s->pending_from, 'en_prueba' => $s->status === 'TRIAL',
            'planes' => $versiones->map(function ($v) use ($s, $actual, $catalogo) {
                $precio = (float) $v->price_pen;
                $precioActual = (float) ($actual->price_pen ?? 0);
                $tipo = $v->id === $actual?->id ? 'ACTUAL' : ($precio >= $precioActual ? 'SUBE' : 'BAJA');
                $modulos = array_keys(ModulosDelPlan::deseados((object) ['id' => '00000000-0000-0000-0000-000000000000', 'plan_version_id' => $v->id], $v));

                return [
                    'id' => $v->id, 'plan_code' => $v->plan_code, 'name' => $v->name, 'description' => $v->description, 'price_pen' => $precio,
                    'users_max' => $v->users_max, 'brands_max' => $v->brands_max, 'sites_max' => $v->sites_max, 'highlights' => json_decode($v->highlights, true) ?: [],
                    'is_featured' => (bool) $v->is_featured, 'tipo' => $tipo,
                    'modulos' => array_values(array_map(fn ($c) => $catalogo[$c]['name'], array_filter($modulos, fn ($c) => ! $catalogo[$c]['is_core']))),
                    'prorrateo' => $tipo === 'SUBE' && $s->status !== 'TRIAL' ? self::prorrateo($s, $actual, $v) : null,
                    'excede' => $tipo === 'BAJA' ? self::excede($s, $v) : [],
                ];
            })->all(),
        ];
    }

    public static function cambiar(User $u, string $versionId): array
    {
        $s = self::viva();
        $v = DB::table('saas_plan_versions')->where('id', $versionId)->where('status', 'PUBLISHED')->first();
        if (! $v) {
            RuleError::fail('RN-SUS-05', 'Ese plan no está publicado.');
        }
        $actual = DB::table('saas_plan_versions')->where('id', $s->plan_version_id)->first();
        if ($v->id === $actual?->id) {
            RuleError::fail('RN-SUS-18', 'Ya estás en ese plan.');
        }
        $sube = (float) $v->price_pen >= (float) ($actual->price_pen ?? 0);
        if (! $sube && $s->status !== 'TRIAL') {
            if ($excede = self::excede($s, $v)) {
                RuleError::fail('RN-SUS-18', 'Con tu uso actual no entras en el plan '.$v->name.': '.implode('; ', array_map(fn ($e) => "{$e['nombre']} {$e['usado']} de {$e['limite']} (te sobran ".($e['usado'] - $e['limite']).')', $excede)).'.');
            }
            $desde = now()->startOfMonth()->addMonth()->toDateString();
            DB::table('subscriptions')->where('id', $s->id)->update(['pending_plan_version_id' => $v->id, 'pending_from' => $desde, 'updated_at' => now()]);
            self::evento($s, 'PLAN_SCHEDULED', "Pasa al plan {$v->name} el ".Carbon::parse($desde)->format('d/m/Y'), $u, ['a' => $v->plan_code, 'desde' => $desde]);

            return self::comparador();
        }
        $prorrateo = $s->status === 'TRIAL' ? null : self::prorrateo($s, $actual, $v);
        DB::table('subscriptions')->where('id', $s->id)->update(['plan_code' => $v->plan_code, 'plan_version_id' => $v->id, 'pending_plan_version_id' => null,
            'pending_from' => null, 'updated_at' => now()]);
        self::evento($s, 'PLAN_CHANGED', "Cambió al plan {$v->name}", $u, ['de' => $s->plan_code, 'a' => $v->plan_code, 'prorrateo' => $prorrateo]);
        ModulosDelPlan::sincronizar($s->tenant_id, $u->name);
        if ($prorrateo && $prorrateo['monto'] > 0) {
            Facturacion::cargoExtra(DB::table('subscriptions')->where('id', $s->id)->first(), 'PRORATION',
                "Cambio al plan {$v->name}: {$prorrateo['dias']} de {$prorrateo['dias_periodo']} días de ".mb_strtolower(now()->translatedFormat('F Y')), $prorrateo['monto']);
        }

        return self::comparador();
    }

    public static function deshacerPendiente(User $u): array
    {
        $s = self::viva();
        if (! $s->pending_plan_version_id) {
            RuleError::fail('RN-SUS-18', 'No hay un cambio de plan pendiente.');
        }
        DB::table('subscriptions')->where('id', $s->id)->update(['pending_plan_version_id' => null, 'pending_from' => null, 'updated_at' => now()]);
        self::evento($s, 'PLAN_CHANGE_UNDONE', 'Se queda en su plan', $u, []);

        return self::comparador();
    }

    /** Tarea diaria (contexto de plataforma): aplica las bajadas de plan que llegaron a su fecha, si el uso todavía cabe. */
    public static function aplicarPendientes(): int
    {
        $n = 0;
        foreach (DB::table('subscriptions')->whereNotNull('pending_plan_version_id')->where('pending_from', '<=', today())->where('status', '!=', 'CANCELLED')->get() as $s) {
            $v = DB::table('saas_plan_versions')->where('id', $s->pending_plan_version_id)->first();
            TenantContext::set(TenantContext::find($s->tenant_id));
            try {
                $excede = $v ? self::excede($s, $v) : [['nombre' => 'plan', 'usado' => 0, 'limite' => 0]];
            } finally {
                TenantContext::platform();
            }
            DB::table('subscriptions')->where('id', $s->id)->update(($excede ? [] : ['plan_code' => $v->plan_code, 'plan_version_id' => $v->id])
                + ['pending_plan_version_id' => null, 'pending_from' => null, 'updated_at' => now()]);
            DB::table('subscription_events')->insert(['subscription_id' => $s->id, 'tenant_id' => $s->tenant_id, 'event' => $excede ? 'PLAN_CHANGE_SKIPPED' : 'PLAN_CHANGED',
                'from_status' => $s->status, 'to_status' => $s->status, 'reason' => $excede ? 'No se aplicó la bajada de plan: el uso actual no cabe' : "Pasó al plan {$v->name}",
                'actor_type' => 'SYSTEM', 'actor_name' => 'Sistema', 'detail' => json_encode(['a' => $v?->plan_code]), 'occurred_at' => now()]);
            if (! $excede) {
                ModulosDelPlan::sincronizar($s->tenant_id, 'Sistema');
                $n++;
            }
        }

        return $n;
    }

    /* ------------------------------------------------------------------ SUS-03 */

    public static function complementos(): array
    {
        $s = self::viva();
        $deseados = ModulosDelPlan::deseados($s);
        $catalogo = Planes::modulos();
        $activos = DB::table('subscription_addons')->where('subscription_id', $s->id)->where('status', 'ACTIVE')->get()->keyBy('addon_code');

        return DB::table('saas_addons')->whereIn('status', ['PUBLISHED'])->orWhereIn('code', $activos->keys())->orderBy('sort_order')->get()
            ->map(function ($a) use ($activos, $deseados, $catalogo) {
                $c = $activos[$a->code] ?? null;
                $enPlan = $a->kind === 'MODULE' && in_array($deseados[$a->module_code] ?? null, ['CORE', 'PLAN'], true);
                $faltan = $a->kind === 'MODULE' ? array_values(array_filter($catalogo[$a->module_code]['depends_on'] ?? [], fn ($d) => ! isset($deseados[$d]))) : [];

                return [
                    'code' => $a->code, 'name' => $a->name, 'description' => $a->description, 'kind' => $a->kind, 'module_code' => $a->module_code,
                    'limit_key' => $a->limit_key, 'unit_qty' => $a->unit_qty, 'price_pen' => $a->price_pen !== null ? (float) $a->price_pen : null,
                    'publicado' => $a->status === 'PUBLISHED', 'contratado' => $c ? ['quantity' => $c->quantity, 'unit_price' => (float) $c->unit_price, 'desde' => $c->started_at] : null,
                    'incluido_en_plan' => $enPlan, 'faltan' => array_map(fn ($d) => $catalogo[$d]['name'] ?? $d, $faltan),
                ];
            })->all();
    }

    public static function contratar(User $u, string $code, int $cantidad): array
    {
        $s = self::viva();
        $a = DB::table('saas_addons')->where('code', $code)->where('status', 'PUBLISHED')->first();
        if (! $a) {
            RuleError::fail('RN-SUS-01', 'Ese complemento no está disponible.');
        }
        $activo = DB::table('subscription_addons')->where('subscription_id', $s->id)->where('addon_code', $code)->where('status', 'ACTIVE')->first();
        if ($a->kind === 'MODULE') {
            $deseados = ModulosDelPlan::deseados($s);
            if (isset($deseados[$a->module_code])) {
                RuleError::fail('RN-SUS-01', 'Ese módulo ya está incluido en tu plan o contratado.');
            }
            $catalogo = Planes::modulos();
            $faltan = array_values(array_filter($catalogo[$a->module_code]['depends_on'] ?? [], fn ($d) => ! isset($deseados[$d])));
            if ($faltan) {
                RuleError::fail('RN-SUS-01', "{$a->name} necesita ".implode(', ', array_map(fn ($d) => $catalogo[$d]['name'] ?? $d, $faltan)).': cámbiate a un plan que lo incluya.');
            }
            $cantidad = 1;
        }
        if ($activo) {
            DB::table('subscription_addons')->where('id', $activo->id)->update(['quantity' => $activo->quantity + $cantidad, 'updated_at' => now()]);
        } else {
            DB::table('subscription_addons')->insert(['subscription_id' => $s->id, 'tenant_id' => $s->tenant_id, 'addon_code' => $code, 'quantity' => $cantidad,
                'unit_price' => $a->price_pen, 'started_at' => now(), 'created_by_name' => mb_substr($u->name, 0, 120), 'created_at' => now(), 'updated_at' => now()]);
        }
        self::evento($s, 'ADDON_ADDED', "Contrató {$a->name}".($cantidad > 1 ? " × {$cantidad}" : ''), $u, ['complemento' => $code, 'cantidad' => $cantidad]);
        ModulosDelPlan::sincronizar($s->tenant_id, $u->name);

        return self::complementos();
    }

    public static function quitar(User $u, string $code, ?int $cantidad): array
    {
        $s = self::viva();
        $c = DB::table('subscription_addons as x')->join('saas_addons as a', 'a.code', '=', 'x.addon_code')->where('x.subscription_id', $s->id)
            ->where('x.addon_code', $code)->where('x.status', 'ACTIVE')->select('x.*', 'a.kind', 'a.limit_key', 'a.unit_qty', 'a.module_code', 'a.name')->first();
        if (! $c) {
            RuleError::fail('RN-SUS-06', 'No tienes ese complemento.');
        }
        $quita = $c->kind === 'MODULE' ? $c->quantity : min($c->quantity, $cantidad ?? $c->quantity);
        if ($c->kind === 'LIMIT') {
            $limite = Suscripcion::limite($c->limit_key) - $quita * $c->unit_qty;
            $usado = Suscripcion::usado($c->limit_key);
            if ($usado > $limite) {
                RuleError::fail('RN-SUS-06', 'No se puede quitar: '.mb_strtolower(Suscripcion::LIMITES[$c->limit_key][1])." quedarían en {$limite} y usas {$usado}.");
            }
        } else {
            $catalogo = Planes::modulos();
            $sin = ModulosDelPlan::deseados($s);
            unset($sin[$c->module_code]);
            $dependen = array_keys(array_filter($sin, fn ($o, $m) => in_array($c->module_code, $catalogo[$m]['depends_on'] ?? [], true), ARRAY_FILTER_USE_BOTH));
            if ($dependen) {
                RuleError::fail('RN-SUS-01', "No se puede quitar {$c->name}: lo necesita ".implode(', ', array_map(fn ($m) => $catalogo[$m]['name'], $dependen)).'.');
            }
        }
        $quita >= $c->quantity
            ? DB::table('subscription_addons')->where('id', $c->id)->update(['status' => 'ENDED', 'ended_at' => now(), 'updated_at' => now()])
            : DB::table('subscription_addons')->where('id', $c->id)->update(['quantity' => $c->quantity - $quita, 'updated_at' => now()]);
        self::evento($s, 'ADDON_REMOVED', "Quitó {$c->name}".($quita > 1 ? " × {$quita}" : ''), $u, ['complemento' => $code, 'cantidad' => $quita]);
        ModulosDelPlan::sincronizar($s->tenant_id, $u->name);

        return self::complementos();
    }

    /* ------------------------------------------------------------------ internos */

    private static function viva(): object
    {
        $s = Suscripcion::vigente();
        if (! $s || $s->status === 'CANCELLED') {
            RuleError::fail('RN-SUS-05', 'Tu empresa no tiene una suscripción activa.');
        }

        return $s;
    }

    /** RN-SUS-18 y CA-SUS-06: (cuota nueva − anterior) × días restantes del mes / días del mes, con el descuento pactado. */
    private static function prorrateo(object $s, ?object $actual, object $v): array
    {
        $dias = now()->daysInMonth;
        $restan = $dias - now()->day + 1;
        $dif = ((float) $v->price_pen - (float) ($actual->price_pen ?? 0)) * (1 - (float) ($s->discount_pct ?? 0) / 100);

        return ['monto' => round(max(0, $dif) * $restan / $dias, 2), 'dias' => $restan, 'dias_periodo' => $dias];
    }

    /** Límites que el uso actual pasaría con ese plan (más los complementos de límite contratados). */
    private static function excede(object $s, object $v): array
    {
        $extra = DB::table('subscription_addons as x')->join('saas_addons as a', 'a.code', '=', 'x.addon_code')->where('x.subscription_id', $s->id)
            ->where('x.status', 'ACTIVE')->where('a.kind', 'LIMIT')->selectRaw('a.limit_key, sum(x.quantity * a.unit_qty) AS n')->groupBy('a.limit_key')->pluck('n', 'limit_key');
        $r = [];
        foreach (Suscripcion::LIMITES as $k => [$col, $nombre]) {
            if ($v->{$col} === null) {
                continue;
            }
            $limite = (int) $v->{$col} + (int) ($extra[$k] ?? 0);
            $usado = Suscripcion::usado($k);
            if ($usado > $limite) {
                $r[] = ['clave' => $k, 'nombre' => $nombre, 'usado' => $usado, 'limite' => $limite];
            }
        }

        return $r;
    }

    private static function evento(object $s, string $evento, string $motivo, User $u, array $detalle): void
    {
        DB::table('subscription_events')->insert(['subscription_id' => $s->id, 'tenant_id' => $s->tenant_id, 'event' => $evento, 'from_status' => $s->status,
            'to_status' => $s->status, 'reason' => mb_substr($motivo, 0, 300), 'actor_type' => 'TENANT_USER', 'actor_id' => $u->id, 'actor_name' => $u->name,
            'detail' => json_encode($detalle), 'occurred_at' => now()]);
    }
}
