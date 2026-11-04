<?php

namespace App\Http\Controllers;

use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Pública: la pantalla de ingreso. En modo por dominio sale con el nombre, el color y las marcas
 * de la empresa; en el ingreso general (sin empresa todavía), con la marca de Aycha.
 */
class TenantController extends Controller
{
    public function __invoke()
    {
        $tenant = TenantContext::tenant();
        if (! $tenant) {
            return response()->json([
                'general' => true, 'name' => 'Aycha Comercial', 'short' => 'Aycha', 'trade_name' => null,
                'logo_url' => null, 'primary_color' => null, 'brands' => [],
            ]);
        }

        $company = DB::table('companies')->where('status', 'ACTIVE')->orderBy('created_at')
            ->first(['legal_name', 'trade_name', 'logo_url', 'primary_color']);
        $brands = DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')
            ->get(['code', 'name', 'primary_color', 'logo_url']);

        return response()->json([
            'general' => false,
            'name' => $tenant['name'],
            'short' => $tenant['short'],
            'trade_name' => $company?->trade_name,
            'logo_url' => $company?->logo_url,
            // El de la empresa; si no lo definió, el de su primera marca.
            'primary_color' => $company?->primary_color ?: $brands->first()?->primary_color,
            'brands' => $brands,
        ]);
    }
}
