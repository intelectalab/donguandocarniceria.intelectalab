<?php

namespace App\Console\Commands;

use App\Modulos\Fac\Services\Envios;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** FAC-07 · RN-FAC-06: envía al OSE los comprobantes y guías pendientes y reintenta los vencidos, empresa por empresa. Corre cada minuto. */
class FacProcesarCola extends Command
{
    protected $signature = 'fac:procesar-cola {--limite=200 : Comprobantes por empresa en cada corrida}';

    protected $description = 'Envía al OSE los comprobantes pendientes y reintenta a los 1, 5, 15, 60 y 240 minutos';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            TenantContext::set(TenantContext::find($t->id));
            try {
                $r = Envios::procesar((int) $this->option('limite'));
                if ($r['procesados']) {
                    $this->info("{$t->id}: {$r['procesados']} enviados ({$r['aceptados']} aceptados, {$r['pendientes']} pendientes, {$r['rechazados']} rechazados).");
                }
            } catch (\Throwable $e) {
                // Una empresa con problemas no frena a las demás.
                $this->error("{$t->id}: {$e->getMessage()}");
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
