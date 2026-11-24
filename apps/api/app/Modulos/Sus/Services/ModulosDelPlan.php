<?php

namespace App\Modulos\Sus\Services;

use App\Modulos\Ops\Services\Planes;
use App\Support\Access;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * RN-SUS-08 y RN-SUS-09: qué módulos corresponden a una suscripción (núcleo + plan + complementos) y su sincronía con
 * tenant_modules. Un módulo que la empresa apagó a mano (sus_source MANUAL) sigue apagado; la empresa no enciende uno
 * que no esté contratado (lo revisa PLT al encender).
 */
final class ModulosDelPlan
{
    /** code => origen ('CORE', 'PLAN' o 'ADDON') de los módulos que corresponden a la suscripción. */
    public static function deseados(object $s, ?object $version = null): array
    {
        $catalogo = Planes::modulos();
        $v = $version ?? DB::table('saas_plan_versions')->where('id', $s->plan_version_id)->first();
        $origen = [];
        foreach ($catalogo as $code => $m) {
            if ($m['is_core']) {
                $origen[$code] = 'CORE';
            }
        }
        $delPlan = ! $v ? [] : ($v->all_modules ? array_keys($catalogo) : (json_decode($v->modules, true) ?: []));
        if ($v && ! $v->all_modules && ! $delPlan) {
            $delPlan = DB::table('saas_plan_modules')->where('plan_code', $v->plan_code)->pluck('module_code')->all();
        }
        foreach ($delPlan as $code) {
            $origen[$code] ??= 'PLAN';
        }
        $addons = DB::table('subscription_addons as x')->join('saas_addons as a', 'a.code', '=', 'x.addon_code')
            ->where('x.subscription_id', $s->id)->where('x.status', 'ACTIVE')->where('a.kind', 'MODULE')->pluck('a.module_code');
        foreach ($addons as $code) {
            $origen[$code] ??= 'ADDON';
        }

        return array_intersect_key($origen, $catalogo);
    }

    /**
     * Deja tenant_modules de la empresa como corresponde a su suscripción. Corre con el contexto de la empresa y vuelve
     * al que había. Devuelve [encendidos, apagados].
     */
    public static function sincronizar(string $tenant, string $actor): array
    {
        $s = DB::table('subscriptions')->where('tenant_id', $tenant)->where('status', '!=', 'CANCELLED')->orderByDesc('started_at')->first();
        if (! $s) {
            return [[], []];
        }
        $deseados = self::deseados($s);
        $plan = DB::table('saas_plan_versions')->where('id', $s->plan_version_id)->value('name') ?? $s->plan_code;
        $catalogo = Planes::modulos();
        $antes = TenantContext::id();
        $plataforma = DB::selectOne("SELECT current_setting('app.platform', true) = 'on' AS si")->si;
        if ($antes !== $tenant) {
            TenantContext::set(TenantContext::find($tenant));
        }
        $on = [];
        $off = [];
        try {
            $filas = DB::table('tenant_modules')->get()->keyBy('module_code');
            $ahora = now();
            foreach ($catalogo as $code => $m) {
                $f = $filas[$code] ?? null;
                $quiere = isset($deseados[$code]);
                $origen = $deseados[$code] ?? null;
                if (! $f) {
                    DB::table('tenant_modules')->insert(['module_code' => $code, 'phase' => $m['phase'], 'enabled' => $quiere, 'sus_source' => $origen,
                        'changed_at' => $ahora, 'changed_by' => mb_substr($actor, 0, 80), 'reason' => $quiere ? "Incluido en el plan {$plan}" : "No incluido en el plan {$plan}",
                        'enabled_at' => $quiere ? $ahora : null, 'created_at' => $ahora]);
                    $quiere && $on[] = $code;

                    continue;
                }
                if ($quiere && ! $f->enabled && $f->sus_source !== 'MANUAL') {
                    DB::table('tenant_modules')->where('id', $f->id)->update(['enabled' => true, 'sus_source' => $origen, 'enabled_at' => $ahora, 'changed_at' => $ahora,
                        'changed_by' => mb_substr($actor, 0, 80), 'reason' => $origen === 'ADDON' ? 'Complemento contratado' : "Incluido en el plan {$plan}", 'updated_at' => $ahora]);
                    $on[] = $code;
                } elseif ($quiere && $f->enabled && $f->sus_source !== $origen) {
                    DB::table('tenant_modules')->where('id', $f->id)->update(['sus_source' => $origen, 'updated_at' => $ahora]);
                } elseif (! $quiere && $f->enabled && ! $m['is_core']) {
                    DB::table('tenant_modules')->where('id', $f->id)->update(['enabled' => false, 'sus_source' => null, 'disabled_at' => $ahora, 'changed_at' => $ahora,
                        'changed_by' => mb_substr($actor, 0, 80), 'reason' => "No incluido en el plan {$plan}", 'updated_at' => $ahora]);
                    $off[] = $code;
                }
            }
            Access::forget();
        } finally {
            if ($antes !== $tenant) {
                $antes ? TenantContext::set(TenantContext::find($antes)) : ($plataforma ? TenantContext::platform() : TenantContext::set(null));
            }
        }

        return [$on, $off];
    }

    /** RN-SUS-09: ¿el módulo está contratado (núcleo, plan o complemento)? Sin suscripción, todos. */
    public static function contratado(string $code): bool
    {
        $s = Suscripcion::vigente();

        return ! $s || $s->status === 'CANCELLED' || isset(self::deseados($s)[$code]);
    }

    /** Origen del módulo en la suscripción (para PLT al encender a mano), o null. */
    public static function origen(string $code): ?string
    {
        $s = Suscripcion::vigente();

        return $s ? (self::deseados($s)[$code] ?? null) : null;
    }
}
