<?php

namespace App\Console\Commands;

use App\Modulos\Mae\Services\TiposDeCambio;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * MAE · RN-MAE-14: carga el tipo de cambio del día de cada empresa desde la fuente (conector FX de INT).
 * Intenta tres veces; si no lo logra, avisa a administración (una vez por día) para cargarlo a mano en MAE-05.
 * Programado a las 09:00 de Lima (mae_fx_load_time) en routes/console.php. Fines de semana y feriados no hay publicación.
 */
class MaeCargarTipoCambio extends Command
{
    protected $signature = 'mae:cargar-tipo-cambio {--fecha= : Fecha (AAAA-MM-DD), por defecto hoy en Lima} {--pausa=20 : Segundos entre intentos}';

    protected $description = 'Carga el tipo de cambio del día de cada empresa y avisa si falla tres veces (RN-MAE-14)';

    public function handle(): int
    {
        $fecha = $this->option('fecha') ?: TiposDeCambio::hoy();
        if (! TiposDeCambio::esHabil($fecha)) {
            $this->info("{$fecha}: no es día hábil, no hay publicación.");

            return self::SUCCESS;
        }
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            $error = null;
            for ($intento = 1; $intento <= 3; $intento++) {
                try {
                    $r = TiposDeCambio::cargarDeFuente($fecha);
                    $this->info("{$tenant['name']} · {$fecha}: {$r['mensaje']}");
                    $error = null;
                    break;
                } catch (\Throwable $e) {
                    $error = $e->getMessage();
                    if ($intento < 3 && (int) $this->option('pausa') > 0) {
                        sleep((int) $this->option('pausa'));
                    }
                }
            }
            if ($error) {
                $this->warn("{$tenant['name']} · {$fecha}: no se cargó ({$error}).");
                $titulo = 'Falta el tipo de cambio del '.date('d/m/Y', strtotime($fecha));
                if (! DB::table('notifications')->where(['module' => 'MAE', 'title' => $titulo])->exists()) {
                    DB::table('notifications')->insert([
                        'role' => 'ADMINISTRACION', 'module' => 'MAE', 'tone' => 'warn', 'at' => now(), 'title' => $titulo,
                        'body' => 'La carga automática falló tres veces: regístralo a mano en Tipo de cambio.', 'ref' => json_encode(['href' => '/m/mae/mae-05']),
                    ]);
                }
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
