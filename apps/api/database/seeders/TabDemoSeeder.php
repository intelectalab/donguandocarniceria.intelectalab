<?php

namespace Database\Seeders;

use App\Modulos\Tab\Services\Base;
use App\Modulos\Tab\Services\Cierre;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * TAB · demo: deja octubre de 2026 congelado en cada empresa con TAB encendido, como lo habría hecho la tarea automática
 * del día 3 de noviembre a las 02:00 (RN-TAB-10). Los meses de mayo a setiembre ya vienen congelados del prototipo
 * (PrototipoSeeder), con la corrida fallida de julio y el recálculo de agosto. El mes en curso se calcula al vuelo.
 * Va al final del DatabaseSeeder: lee los datos de todos los módulos. Correrlo dos veces no crea otra corrida.
 */
class TabDemoSeeder extends Seeder
{
    public const MES = '2026-10-01';

    public function run(): void
    {
        $empresas = DB::table('tenant_modules')->where('module_code', 'TAB')->where('enabled', true)->pluck('tenant_id');
        foreach ($empresas as $t) {
            Base::enEmpresa($t, function () {
                DB::select('SELECT tab_seed_dashboards()');
                if (! Base::terminado(self::MES) || DB::table('kpi_snapshot_runs')->where('period', self::MES)->where('status', 'OK')->exists()) {
                    return;
                }
                // Una empresa sin pedidos en el mes (la segunda de la demo) no se congela: no hay nada que fotografiar.
                if (! DB::table('sales_orders')->where('created_at', '>=', self::MES.' 00:00:00-05')->where('created_at', '<', '2026-11-01 00:00:00-05')->exists()) {
                    return;
                }
                // La hora de la tarea programada: día 3 del mes siguiente, 02:00 de Lima.
                Carbon::setTestNow(CarbonImmutable::parse('2026-11-03 02:00:00', 'America/Lima'));
                try {
                    $run = Cierre::congelar(self::MES, null, null, true);
                } finally {
                    Carbon::setTestNow();
                }
                DB::table('kpi_snapshot_runs')->where('id', $run->id)->update(['finished_at' => '2026-11-03 02:04:00-05']);
                $this->command?->info(sprintf('TAB: octubre de 2026 congelado (corrida %d, %d indicadores)', $run->run_no, $run->kpis_count));
            });
        }
    }
}
