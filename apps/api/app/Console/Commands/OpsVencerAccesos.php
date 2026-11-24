<?php

namespace App\Console\Commands;

use App\Modulos\Ops\Services\Accesos;
use Illuminate\Console\Command;

/** RN-OPS-09: vence los accesos de soporte cumplidos, desactiva su usuario técnico y cierra sus sesiones. */
class OpsVencerAccesos extends Command
{
    protected $signature = 'ops:vencer-accesos';

    protected $description = 'Vence los accesos de soporte cuyo plazo terminó';

    public function handle(): int
    {
        $n = Accesos::vencer();
        $this->info($n === 1 ? '1 acceso vencido.' : "{$n} accesos vencidos.");

        return self::SUCCESS;
    }
}
