<?php

namespace App\Http\Controllers;

use App\Support\Access;
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
            // Como G.canSee del prototipo: el módulo se ve con la letra L (leer) o C (crear).
            ->filter(fn ($m) => (bool) preg_match('/[LC]/', $m['actions']))
            ->values();

        return response()->json([
            'user' => $user->only(['id', 'name', 'email', 'role', 'default_brand_id', 'ui_theme_mode', 'must_change_password']),
            'tenant' => TenantContext::tenant(),
            'roles' => $access['roles'],
            'permissions' => $access['all_permissions'] ? ['*'] : $access['permissions'],
            'modules' => $modules,
            'brands' => $brands,
            'establishments' => $establishments,
        ]);
    }
}
