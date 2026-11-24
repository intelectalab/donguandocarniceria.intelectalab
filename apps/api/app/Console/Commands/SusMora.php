<?php

namespace App\Console\Commands;

use App\Modulos\Sus\Services\Mora;
use App\Support\TenantContext;
use Illuminate\Console\Command;

/** RN-SUS-10 y RN-SUS-15: mora diaria (deuda, reintentos, solo lectura, suspensión) y pruebas vencidas. */
class SusMora extends Command
{
    protected $signature = 'sus:mora';

    protected $description = 'Revisa la mora de las suscripciones y las pruebas vencidas';

    public function handle(): int
    {
        TenantContext::platform();
        try {
            $r = Mora::diaria();
            $this->info("Pruebas: {$r['pruebas']} · con deuda: {$r['con_deuda']} · reintentos: {$r['reintentos']} · solo lectura: {$r['solo_lectura']} · suspendidas: {$r['suspendidas']} · canceladas: {$r['canceladas']}");
        } finally {
            TenantContext::set(null);
        }

        return self::SUCCESS;
    }
}
