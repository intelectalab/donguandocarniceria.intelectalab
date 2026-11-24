<?php

namespace App\Console\Commands;

use App\Modulos\Ops\Services\Salud;
use App\Support\TenantContext;
use Illuminate\Console\Command;

/** OPS-07 (D-OPS-01): lectura de salud de los componentes con sonda propia, cada minuto. */
class OpsLeerSalud extends Command
{
    protected $signature = 'ops:leer-salud';

    protected $description = 'Lee la salud de la aplicación, la base de datos, las colas y el almacenamiento';

    public function handle(): int
    {
        TenantContext::platform();
        try {
            $this->info(Salud::leer().' lecturas registradas.');
        } finally {
            TenantContext::set(null);
        }

        return self::SUCCESS;
    }
}
