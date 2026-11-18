<?php

namespace App\Modulos\Seg\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Seg\Services\Bitacora;
use App\Modulos\Seg\Services\Sesiones;
use App\Support\Access;
use App\Support\Params;
use App\Support\PasswordPolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * SEG-06 Mi cuenta: cada persona, lo suyo (sin permiso especial ni acceso al módulo SEG). Datos,
 * preferencias (marca por defecto, modo de color y avisos), estado del segundo factor y prueba de la
 * política al cambiar la contraseña (el cambio en sí es POST /me/password). Queda en la bitácora.
 */
class MiCuentaController extends Controller
{
    public const MODOS = ['LIGHT', 'DARK', 'SYSTEM'];

    public function show(Request $request)
    {
        $u = $request->user();
        $a = Access::for($u);
        $roles = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->where('ur.user_id', $u->id)->orderBy('r.name')
            ->get(['r.name', 'r.requires_mfa', 'r.scope_mode']);
        $marcas = DB::table('brands')->where('status', 'ACTIVE')->when($a['brands'], fn ($q) => $q->whereIn('id', $a['brands']))->orderBy('sort_order')->get(['id', 'name']);
        $locales = DB::table('establishments')->where('status', 'ACTIVE')->when($a['establishments'], fn ($q) => $q->whereIn('id', $a['establishments']))->orderBy('code')->pluck('short');
        $empleado = $u->employee_id ? DB::table('employees')->where('id', $u->employee_id)->first(['full_name', 'position']) : null;
        $prefs = $u->notify_prefs ?? [];

        return response()->json([
            'datos' => [
                'name' => $u->name, 'email' => $u->email, 'roles' => $roles->pluck('name')->join(', ') ?: '—',
                // Solo lo que de verdad limita: marcas asignadas y locales asignados (sin asignar = todos).
                'alcance' => ($a['brands'] || $a['establishments'])
                    ? collect([$a['brands'] ? $marcas->pluck('name')->join(', ') : null, $a['establishments'] ? $locales->join(', ') : null])->filter()->join(' · ')
                    : 'Todo',
                'trabajador' => $empleado ? "{$empleado->full_name} · {$empleado->position}" : null,
                'ultimo_ingreso' => $u->last_login, 'idioma' => $u->locale ?: 'es-PE',
                'empresa' => DB::table('tenants')->where('id', $u->tenant_id)->value('name'),
            ],
            'preferencias' => [
                'default_brand_id' => $u->default_brand_id, 'ui_theme_mode' => $u->ui_theme_mode ?: 'SYSTEM',
                'avisos_correo' => ($prefs['email'] ?? true) !== false, 'avisos_push' => (bool) ($prefs['push'] ?? false), 'resumen_diario' => (bool) ($prefs['daily_summary'] ?? false),
            ],
            'marcas' => $marcas,
            'seguridad' => [
                'exige_2fa' => $roles->contains('requires_mfa', true), 'twofa_enabled' => (bool) $u->twofa_enabled, 'mfa_enrolled_at' => $u->mfa_enrolled_at,
                'codigos_disponibles' => DB::table('mfa_recovery_codes')->where('user_id', $u->id)->whereNull('used_at')->whereNull('voided_at')->count(),
                'password_changed_at' => $u->password_changed_at, 'password_vence_dias' => (int) (Params::get('seg_password_max_age_days') ?? 0),
                'sesiones_abiertas' => Sesiones::vigentes(DB::table('personal_access_tokens'))->where('tokenable_id', $u->id)->count(),
                'max_sesiones' => Sesiones::politica()['max_sesiones'],
                'regla' => PasswordPolicy::rule(),
            ],
        ]);
    }

    public function preferencias(Request $request)
    {
        $u = $request->user();
        $marcas = Access::for($u)['brands'];
        $d = $request->validate([
            'default_brand_id' => ['nullable', 'uuid', Rule::exists('brands', 'id')->where('status', 'ACTIVE')->when($marcas, fn ($r) => $r->whereIn('id', $marcas))],
            'ui_theme_mode' => ['sometimes', Rule::in(self::MODOS)],
            'avisos_correo' => ['sometimes', 'boolean'], 'avisos_push' => ['sometimes', 'boolean'], 'resumen_diario' => ['sometimes', 'boolean'],
        ], ['default_brand_id.exists' => 'Elige una de tus marcas.']);

        $prefs = $u->notify_prefs ?? [];
        foreach (['avisos_correo' => 'email', 'avisos_push' => 'push', 'resumen_diario' => 'daily_summary'] as $campo => $clave) {
            if (array_key_exists($campo, $d)) {
                $prefs[$clave] = (bool) $d[$campo];
            }
        }
        $u->forceFill(array_filter([
            'ui_theme_mode' => $d['ui_theme_mode'] ?? null,
        ]) + (array_key_exists('default_brand_id', $d) ? ['default_brand_id' => $d['default_brand_id']] : []) + ['notify_prefs' => $prefs])->save();
        Bitacora::registrar('PROFILE_UPDATED', ['user' => $u, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => 'Cambió sus preferencias',
            'details' => array_intersect_key($d, array_flip(['default_brand_id', 'ui_theme_mode', 'avisos_correo', 'avisos_push', 'resumen_diario']))]);

        return $this->show($request);
    }

    /**
     * La barra lateral de cada persona: las pantallas fijadas con la estrella en «Lo de todos los días»
     * (la lista completa: solo códigos de pantalla y sin repetir) y si ve el menú corto o el completo.
     * Qué se muestra lo decide el menú: una pantalla que el rol no ve no sale.
     */
    public function menu(Request $request)
    {
        // Llega una de las dos cosas o ambas; una lista vacía de estrellas vale (quita todas).
        if (! $request->exists('favs') && ! $request->exists('corto')) {
            throw ValidationException::withMessages(['favs' => ['Envía las pantallas fijadas o el menú elegido.']]);
        }
        $d = $request->validate([
            'favs' => ['sometimes', 'present', 'array', 'max:40'],
            'favs.*' => ['string', 'distinct', 'regex:/^[A-Z]{3}-\d{2}$/'],
            'corto' => ['sometimes', 'boolean'],
        ], ['favs.max' => 'Puedes fijar hasta 40 pantallas.']);
        $u = $request->user();
        $u->forceFill(array_filter([
            'menu_favs' => array_key_exists('favs', $d) ? array_values($d['favs']) : null,
            'menu_corto' => array_key_exists('corto', $d) ? (bool) $d['corto'] : null,
        ], fn ($v) => $v !== null))->save();

        return response()->json(['menu_favs' => $u->menu_favs, 'menu_corto' => $u->menu_corto]);
    }

    /** Prueba la contraseña nueva contra la política, sin guardarla (para el cambio de contraseña). */
    public function probarClave(Request $request)
    {
        $d = $request->validate(['password' => ['present', 'nullable', 'string', 'max:200']]);

        return response()->json(['checks' => array_map(fn ($c) => ['etiqueta' => $c['etiqueta'], 'ok' => $c['ok']],
            PasswordPolicy::checks($request->user(), (string) ($d['password'] ?? '')))]);
    }
}
