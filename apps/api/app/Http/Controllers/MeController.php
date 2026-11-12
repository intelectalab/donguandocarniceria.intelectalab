<?php

namespace App\Http\Controllers;

use App\Support\Access;
use App\Support\PasswordPolicy;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Lo que el frontend necesita al entrar: quién soy, mi empresa, mis marcas y locales (según mi
 * alcance), los módulos que puedo usar con sus acciones y mis permisos especiales.
 * El menú y los botones se arman con esto; la API vuelve a validar cada acción.
 */
class MeController extends Controller
{
    public function __invoke(Request $request)
    {
        $user = $request->user();
        $access = Access::for($user);

        $brands = DB::table('brands')->where('status', 'ACTIVE')
            ->when($access['brands'], fn ($q) => $q->whereIn('id', $access['brands']))
            ->orderBy('sort_order')->get(['id', 'code', 'name', 'primary_color', 'logo_url']);
        $establishments = DB::table('establishments')->where('status', 'ACTIVE')
            ->when($access['establishments'], fn ($q) => $q->whereIn('id', $access['establishments']))
            ->orderBy('code')->get(['id', 'code', 'name', 'short', 'has_counter']);

        $modules = DB::table('platform_modules')->orderBy('phase')->orderBy('sort_order')->get(['code', 'name', 'phase'])
            ->map(function ($m) use ($access) {
                $actions = $access['modules'][$m->code] ?? $access['modules']['*'] ?? '';

                return [
                    'code' => $m->code,
                    'name' => $m->name,
                    'phase' => $m->phase,
                    'enabled' => in_array($m->code, $access['enabled_modules'], true),
                    'actions' => $actions,
                ];
            })
            // El módulo se ve en el menú con la letra L (leer) o C (crear).
            ->filter(fn ($m) => (bool) preg_match('/[LC]/', $m['actions']))
            ->values();

        // Colores (PLT-06): el de la empresa y el propio de cada marca visible. La web pinta el sistema
        // con el de la marca elegida arriba, o con el de la empresa (RN-PLT-23).
        $temas = DB::table('ui_themes')->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->whereNull('brand_id')->orWhereIn('brand_id', $brands->pluck('id')))
            ->orderBy('created_at')->get(['brand_id', 'light', 'dark']);
        $tema = fn ($t) => ['light' => json_decode($t->light, true), 'dark' => json_decode($t->dark, true)];
        $empresa = $temas->whereNull('brand_id')->last();

        return response()->json([
            'themes' => [
                'empresa' => $empresa ? $tema($empresa) : null,
                'brands' => $temas->whereNotNull('brand_id')->keyBy('brand_id')->map($tema),
            ],
            // must_change_password: se le pidió cambiarla o venció (RN-SEG-02); la web lo lleva a Mi cuenta.
            'user' => $user->only(['id', 'name', 'email', 'role', 'default_brand_id', 'ui_theme_mode'])
                + ['must_change_password' => PasswordPolicy::debeCambiar($user), 'password_vencida' => PasswordPolicy::vencida($user)],
            'tenant' => TenantContext::tenant() + ['logo_url' => TenantController::urlLogo()],
            'roles' => $access['roles'],
            // Sin los permisos de los módulos apagados (RN-PLT-07): la web los oculta igual que la API.
            'permissions' => collect($access['all_permissions'] ? array_keys($access['permission_modules']) : $access['permissions'])
                ->filter(fn ($p) => ($m = $access['permission_modules'][$p] ?? null) === null || in_array($m, $access['enabled_modules'], true))
                ->values(),
            'modules' => $modules,
            'brands' => $brands,
            'establishments' => $establishments,
        ]);
    }
}
