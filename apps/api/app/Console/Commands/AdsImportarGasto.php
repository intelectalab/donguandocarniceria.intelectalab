<?php

namespace App\Console\Commands;

use App\Modulos\Ads\Services\Publicidad;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** ADS-04 · RN-ADS-01: importación diaria a las 06:00 (Lima) con los últimos ads_import_lookback_days (3) días de cada cuenta activa. */
class AdsImportarGasto extends Command
{
    protected $signature = 'ads:importar-gasto';

    protected $description = 'Importa el gasto publicitario de los últimos días para las cuentas activas de cada empresa';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            TenantContext::set(TenantContext::find($t->id));
            try {
                if (! DB::table('tenant_modules')->where('module_code', 'ADS')->where('enabled', true)->exists()) {
                    continue;
                }
                $r = Publicidad::correrImportacionDiaria();
                if ($r['ok']) {
                    $this->info("{$t->id}: {$r['ok']} cuentas importadas ({$r['desde']} al {$r['hasta']}).");
                }
            } catch (\Throwable $e) {
                $this->error("{$t->id}: {$e->getMessage()}");
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
