<?php

namespace App\Console\Commands;

use App\Modulos\Ops\Services\Metricas;
use App\Support\TenantContext;
use Illuminate\Console\Command;

/** OPS-10 y SUS-04: «cierre» congela las métricas del mes anterior (RN-OPS-17); «uso» deja la foto de uso del mes. */
class OpsMetricas extends Command
{
    protected $signature = 'ops:metricas {accion : cierre o uso} {periodo? : AAAA-MM para el cierre (por defecto, el mes anterior)}';

    protected $description = 'Congela las métricas del mes cerrado o guarda la foto de uso de las empresas';

    public function handle(): int
    {
        TenantContext::platform();
        try {
            if ($this->argument('accion') === 'uso') {
                $this->info(Metricas::fotoDeUso().' empresas con su uso del mes.');
            } else {
                $r = Metricas::congelar(null, $this->argument('periodo') ?? now()->subMonthNoOverflow()->format('Y-m'));
                $this->info("Métricas de {$r['period']} congeladas (corrida {$r['run_no']}).");
            }
        } finally {
            TenantContext::set(null);
        }

        return self::SUCCESS;
    }
}
