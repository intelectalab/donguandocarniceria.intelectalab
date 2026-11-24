<?php

namespace App\Console\Commands;

use App\Modulos\Int\Services\Salientes;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** INT-06: despacha los mensajes salientes que tocan, empresa por empresa (RN-INT-08, RN-INT-09). Corre cada minuto. */
class IntDespachar extends Command
{
    protected $signature = 'int:despachar {--limite=200 : Mensajes por empresa en cada corrida}';

    protected $description = 'Envía los mensajes salientes pendientes y reintenta los fallidos con espera exponencial';

    public function handle(): int
    {
        $total = 0;
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            TenantContext::set(TenantContext::find($t->id));
            try {
                $n = Salientes::procesar(false, (int) $this->option('limite'));
                if ($n) {
                    $this->info("{$t->id}: {$n} mensajes despachados.");
                }
                $total += $n;
            } catch (\Throwable $e) {
                // Una empresa con problemas no frena el despacho de las demás.
                $this->error("{$t->id}: {$e->getMessage()}");
            }
        }
        TenantContext::set(null);
        $this->info("Listo: {$total} mensajes despachados.");

        return self::SUCCESS;
    }
}
