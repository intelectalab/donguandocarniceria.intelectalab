<?php

namespace App\Console\Commands;

use App\Modulos\Api\Services\Webhooks;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** API-06 · RN-API-08: procesa cada minuto los reintentos vencidos de entregas de webhooks salientes. */
class ApiProcesarWebhooks extends Command
{
    protected $signature = 'api:procesar-webhooks';

    protected $description = 'Envía y reintenta las entregas pendientes de webhooks salientes con espera exponencial';

    public function handle(): int
    {
        $total = 0;
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            TenantContext::set(TenantContext::find($t->id));
            try {
                if (! DB::table('tenant_modules')->where('module_code', 'API')->where('enabled', true)->exists()) {
                    continue;
                }
                $n = Webhooks::procesarCola();
                if ($n) {
                    $this->info("{$t->id}: {$n} entregas procesadas.");
                }
                $total += $n;
            } catch (\Throwable $e) {
                $this->error("{$t->id}: {$e->getMessage()}");
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
