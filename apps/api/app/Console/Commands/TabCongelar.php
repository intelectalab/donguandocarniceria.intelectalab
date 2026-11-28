<?php

namespace App\Console\Commands;

use App\Modulos\Tab\Services\Base;
use App\Modulos\Tab\Services\Cierre;
use App\Support\RuleError;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * TAB · RN-TAB-10: congela los indicadores del mes anterior el día tab_snapshot_day (3) de cada mes, por empresa.
 * Programada cada día a las 02:00 de Lima en routes/console.php: solo actúa el día que toca y si el mes aún no está congelado.
 * Con --forzar congela el mes anterior hoy mismo (si no lo estaba). Una corrida fallida queda en TAB-09 y avisa a gerencia.
 */
class TabCongelar extends Command
{
    protected $signature = 'tab:congelar {--forzar : Congela el mes anterior aunque hoy no sea el día programado}';

    protected $description = 'Congela los indicadores del mes anterior de cada empresa con el módulo TAB encendido (RN-TAB-10)';

    public function handle(): int
    {
        $error = false;
        foreach (DB::select("SELECT id, name FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            try {
                $run = Base::enEmpresa($t->id, fn () => in_array('TAB', Base::modulosEncendidos(), true)
                    ? Cierre::automatico(null, (bool) $this->option('forzar')) : null);
                $this->info($run ? sprintf('%s · %s: corrida %d con %d valores', $t->name, substr($run->period, 0, 7), $run->run_no, $run->kpis_count)
                    : "{$t->name}: no toca congelar hoy (o el mes ya está congelado)");
            } catch (RuleError $e) {
                $error = true;
                $this->error("{$t->name}: {$e->getMessage()}");
            }
        }

        return $error ? self::FAILURE : self::SUCCESS;
    }
}
