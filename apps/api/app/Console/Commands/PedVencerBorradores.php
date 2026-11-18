<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Modulos\Ped\Services\Estados;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * PED · RN-PED-18: cancela con el motivo «Borrador vencido» los borradores sin actividad por
 * ped_draft_expiry_hours (48 h). Programada cada hora en routes/console.php.
 */
class PedVencerBorradores extends Command
{
    protected $signature = 'ped:vencer-borradores';

    protected $description = 'Cancela los borradores de pedido sin actividad (RN-PED-18)';

    public function handle(): int
    {
        $sistema = new User(['name' => 'Sistema']);
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            $this->info(sprintf('%s: %d borrador(es) vencido(s) cancelados', $tenant['name'], Estados::vencerBorradores($sistema)));
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
