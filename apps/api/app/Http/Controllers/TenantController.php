<?php

namespace App\Http\Controllers;

use App\Support\Logos;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Pública: la pantalla de ingreso. En modo por dominio sale con el nombre, el color y las marcas
 * de la empresa; en el ingreso general (sin empresa todavía), con la marca de GestionCarnica.
 */
class TenantController extends Controller
{
    /**
     * Pública: el logo de la empresa del cliente resuelto por el dominio (pantalla de ingreso).
     * Sin cliente (ingreso general) no hay logo.
     */
    public function logo()
    {
        abort_unless(TenantContext::tenant(), 404);

        // tenant_branding tiene RLS: solo la fila del cliente de esta petición.
        return Logos::servir('cliente', DB::table('tenant_branding')->value('logo_url'), 'private, max-age=300');
    }

    /** Dirección del logo del cliente, o null; ?v= cambia cuando cambia el archivo. */
    public static function urlLogo(): ?string
    {
        $b = DB::table('tenant_branding')->whereNotNull('logo_url')->first(['logo_url', 'updated_at']);

        return $b ? '/api/v1/tenant/logo?v='.substr(md5($b->logo_url.$b->updated_at), 0, 8) : null;
    }

    public function __invoke()
    {
        $tenant = TenantContext::tenant();
        if (! $tenant) {
            return response()->json([
                'general' => true, 'name' => 'GestionCarnica Comercial', 'short' => 'GestionCarnica', 'trade_name' => null,
                'logo_url' => null, 'primary_color' => null, 'brands' => [],
            ]);
        }

        $company = DB::table('companies')->where('status', 'ACTIVE')->orderBy('created_at')
            ->first(['legal_name', 'trade_name', 'primary_color']);
        $brands = DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')
            ->get(['code', 'name', 'primary_color', 'logo_url']);

        return response()->json([
            'general' => false,
            'name' => $tenant['name'],
            'short' => $tenant['short'],
            'trade_name' => $company?->trade_name,
            'logo_url' => self::urlLogo(),
            // El de la empresa; si no lo definió, el de su primera marca.
            'primary_color' => $company?->primary_color ?: $brands->first()?->primary_color,
            'brands' => $brands,
        ]);
    }
}
