<?php

namespace App\Console\Commands;

use App\Modulos\Sus\Services\Facturacion;
use App\Support\TenantContext;
use Illuminate\Console\Command;

/** SUS-12: corrida mensual de cobro del mes en curso (el día 1). Sin RUC emisor, deja los comprobantes en borrador. */
class SusCorrida extends Command
{
    protected $signature = 'sus:corrida {periodo? : AAAA-MM (por defecto, el mes en curso)}';

    protected $description = 'Arma, emite y cobra los comprobantes del SaaS del mes';

    public function handle(): int
    {
        TenantContext::platform();
        try {
            $r = Facturacion::corrida(['id' => null, 'full_name' => 'Sistema', 'role' => 'SYSTEM'], $this->argument('periodo') ?? now()->format('Y-m'), sistema: true);
            $this->info("Corrida {$r['run_no']} de {$r['period']}: {$r['issued']} emitidos, {$r['drafts']} en borrador, {$r['charged']} cobrados.");
            foreach ($r['notes'] as $n) {
                $this->line("· {$n}");
            }
        } finally {
            TenantContext::set(null);
        }

        return self::SUCCESS;
    }
}
