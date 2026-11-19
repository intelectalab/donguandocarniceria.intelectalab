<?php

namespace App\Console\Commands;

use App\Modulos\Equ\Services\EquiposService;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * EQU · tarea de cada mañana, por empresa: crea las órdenes preventivas que tocan (RN-EQU-07), avisa los
 * preventivos con atraso y las calibraciones por vencer o vencidas (RN-EQU-08). Programada en routes/console.php.
 * Correrla dos veces el mismo día no duplica órdenes ni avisos.
 */
class EquDiario extends Command
{
    protected $signature = 'equ:diario {--fecha= : Fecha (AAAA-MM-DD), por defecto hoy en Lima}';

    protected $description = 'Crea las órdenes preventivas que tocan y avisa calibraciones por vencer';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            if (! DB::table('tenant_modules')->where('module_code', 'EQU')->where('enabled', true)->exists()) {
                continue;
            }
            $p = EquiposService::generarPreventivas($this->option('fecha'));
            $c = EquiposService::avisarCalibraciones($this->option('fecha'));
            $this->info(sprintf('%s: %d orden(es) preventiva(s) creada(s)%s, %d preventivo(s) con atraso, %d calibración(es) por vencer avisada(s), %d vencida(s)',
                $tenant['name'], count($p['created']), $p['created'] ? ' ('.implode(', ', $p['created']).')' : '', count($p['overdue']), $c['expiring'], $c['blocked']));
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
