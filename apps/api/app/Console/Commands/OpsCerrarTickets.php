<?php

namespace App\Console\Commands;

use App\Modulos\Ops\Services\Tickets;
use Illuminate\Console\Command;

/** RN-OPS-15: cierra los tickets resueltos en los que el cliente no respondió en ops_ticket_auto_close_days días. */
class OpsCerrarTickets extends Command
{
    protected $signature = 'ops:cerrar-tickets';

    protected $description = 'Cierra los tickets de soporte resueltos sin respuesta del cliente';

    public function handle(): int
    {
        $n = Tickets::cerrarResueltos();
        $this->info($n === 1 ? '1 ticket cerrado.' : "{$n} tickets cerrados.");

        return self::SUCCESS;
    }
}
