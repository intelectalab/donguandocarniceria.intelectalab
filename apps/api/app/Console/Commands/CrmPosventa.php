<?php

namespace App\Console\Commands;

use App\Modulos\Crm\Services\Encuestas;
use App\Modulos\Crm\Services\Recompra;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * CRM · posventa, en las empresas con CRM encendido (programadas en routes/console.php):
 *  - crm:posventa encuestas → RN-CRM-20: envía las encuestas de los pedidos entregados hace más de 2 h (cada 10 min);
 *  - crm:posventa recompra  → RN-CRM-19: recalcula la recompra y crea las tareas que tocan (cada mañana).
 */
class CrmPosventa extends Command
{
    protected $signature = 'crm:posventa {que : encuestas o recompra}';

    protected $description = 'Encuestas posentrega y recompra de CRM (RN-CRM-19, RN-CRM-20)';

    public function handle(): int
    {
        $que = $this->argument('que');
        if (! in_array($que, ['encuestas', 'recompra'], true)) {
            $this->error('Usa «encuestas» o «recompra».');

            return self::INVALID;
        }
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            if (! DB::table('tenant_modules')->where('module_code', 'CRM')->where('enabled', true)->exists()) {
                continue;
            }
            if ($que === 'encuestas') {
                $n = Encuestas::enviarPendientes();
                if (array_sum($n)) {
                    $this->info(sprintf('%s: %d en la ventana, %d como plantilla, %d no enviadas', $tenant['name'], $n['SESSION'], $n['TEMPLATE'], $n['NOT_SENT']));
                }
            } else {
                $r = Recompra::recalcular();
                $this->info(sprintf('%s: %d perfiles de recompra, %d tareas nuevas', $tenant['name'], $r['perfiles'], $r['tareas']));
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
