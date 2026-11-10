<?php

namespace App\Console\Commands;

use App\Modulos\Alm\Services\AlertasService;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * ALM · RN-ALM-15: alerta diaria de lotes por vencer (3 y 7 días) y vencidos, por empresa.
 * Programada en routes/console.php. Correrla dos veces el mismo día no duplica alertas.
 */
class AlmAlertasVencimiento extends Command
{
    protected $signature = 'alm:alertas-vencimiento {--fecha= : Fecha de la foto (AAAA-MM-DD), por defecto hoy en Lima}';

    protected $description = 'Genera las alertas diarias de vencimiento de lotes de cada empresa (RN-ALM-15)';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            $r = AlertasService::generarDiarias($this->option('fecha'));
            $this->info(sprintf('%s · %s: %d vencidos, %d a 3 días, %d a 7 días (S/ %s)', $tenant['name'], $r['date'], $r['new']['EXPIRED'], $r['new']['D3'], $r['new']['D7'], $r['value_pen']));
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
