<?php

namespace App\Console\Commands;

use App\Modulos\Aud\Services\Retencion;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** AUD · corrida mensual de depuración por empresa (RN-AUD-08): cada categoría con filas vencidas se archiva (si su política lo pide) y se depura; queda en AUD-07. Programada en routes/console.php. */
class AudDepurar extends Command
{
    protected $signature = 'aud:depurar';

    protected $description = 'Archiva y depura lo vencido según las políticas de retención de cada empresa';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            try {
                if (! DB::table('tenant_modules')->where('module_code', 'AUD')->where('enabled', true)->exists()) {
                    continue;
                }
                $hechas = Retencion::depurarVencidas('Mantenimiento programado');
                $this->info($tenant['name'].': '.(count($hechas) ? implode(', ', array_map(fn ($c) => "{$c['number']} {$c['category_name']} ({$c['purged_rows']} filas, {$c['status_name']})", $hechas)) : 'nada vencido'));
            } catch (\Throwable $e) {
                report($e);
                $this->error($tenant['name'].': '.$e->getMessage());
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
