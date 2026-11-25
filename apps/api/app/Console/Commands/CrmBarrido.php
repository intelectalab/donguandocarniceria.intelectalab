<?php

namespace App\Console\Commands;

use App\Modulos\Crm\Services\Tareas;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * CRM · RN-CRM-02 y RN-CRM-14: cada minuto crea la tarea «chat sin responder» de los chats que pasaron el tiempo en
 * horario sin respuesta y avisa a la supervisión de esos chats y de los que esperan en la cola. Programada en
 * routes/console.php. Solo las empresas con CRM encendido.
 */
class CrmBarrido extends Command
{
    protected $signature = 'crm:barrido';

    protected $description = 'Tareas y avisos de chats sin responder y en cola (RN-CRM-02, RN-CRM-14)';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            if (! DB::table('tenant_modules')->where('module_code', 'CRM')->where('enabled', true)->exists()) {
                continue;
            }
            [$tareas, $cola] = Tareas::barrer();
            if ($tareas || $cola) {
                $this->info(sprintf('%s: %d tarea(s) de chat sin responder, %d chat(s) en cola avisados', $tenant['name'], $tareas, $cola));
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
