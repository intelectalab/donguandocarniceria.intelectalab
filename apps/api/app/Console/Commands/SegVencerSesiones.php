<?php

namespace App\Console\Commands;

use App\Modulos\Seg\Services\Sesiones;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * SEG · RN-SEG-09: cierra las sesiones ya vencidas (por inactividad o duración) de cada empresa,
 * aunque nadie vuelva a usarlas. Cada una queda en la bitácora y en las sesiones anteriores con la
 * hora en que venció, según la política de su empresa (SEG-14). Programada cada hora en routes/console.php.
 */
class SegVencerSesiones extends Command
{
    protected $signature = 'seg:vencer-sesiones';

    protected $description = 'Cierra las sesiones vencidas de cada empresa y las deja en la bitácora (RN-SEG-09)';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            $this->info(sprintf('%s: %d sesión(es) vencida(s) cerradas', $tenant['name'], Sesiones::vencerLasVencidas()));
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
