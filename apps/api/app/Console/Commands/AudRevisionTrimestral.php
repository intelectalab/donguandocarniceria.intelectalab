<?php

namespace App\Console\Commands;

use App\Modulos\Aud\Services\Revision;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** AUD · el primer día de cada trimestre (o el siguiente en que corra) abre la revisión de accesos de cada empresa y avisa a la gerencia (RN-AUD-10). Correrla de nuevo no duplica. Programada en routes/console.php. */
class AudRevisionTrimestral extends Command
{
    protected $signature = 'aud:revision-trimestral';

    protected $description = 'Abre la revisión de accesos del trimestre y avisa a quienes la hacen';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            try {
                if (! DB::table('tenant_modules')->where('module_code', 'AUD')->where('enabled', true)->exists()) {
                    continue;
                }
                $this->info($tenant['name'].': '.(Revision::abrirDelTrimestre() ? 'revisión '.Revision::trimestre().' abierta y avisada' : 'ya estaba abierta'));
            } catch (\Throwable $e) {
                report($e);
                $this->error($tenant['name'].': '.$e->getMessage());
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
