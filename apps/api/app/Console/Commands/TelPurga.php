<?php

namespace App\Console\Commands;

use App\Modulos\Tel\Services\Grabaciones;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * TEL · purga nocturna de grabaciones (RN-TEL-10, Ley 29733), en las empresas con Telefonía encendida: el audio vencido
 * y sin retención legal se elimina y la grabación queda purgada; los datos de la llamada se conservan.
 */
class TelPurga extends Command
{
    protected $signature = 'tel:purga';

    protected $description = 'Purga las grabaciones de llamadas vencidas (RN-TEL-10)';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            if (! DB::table('tenant_modules')->where('module_code', 'TEL')->where('enabled', true)->exists()) {
                continue;
            }
            $r = Grabaciones::purgar('Purga nocturna', siempre: false);
            if ($r) {
                $this->info(sprintf('%s: %d grabaciones purgadas', $tenant['name'], $r['purgadas']));
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
