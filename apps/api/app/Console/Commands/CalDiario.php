<?php

namespace App\Console\Commands;

use App\Modulos\Cal\Services\CalidadService;
use App\Modulos\Pro\Services\Comun;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * CAL · tarea de cada mañana, por empresa: crea las tareas del día desde la programación y marca incumplidas las
 * pendientes de días anteriores (RN-CAL-13), avisa los puntos de temperatura sin lectura (RN-CAL-14) y revisa los
 * registros sanitarios: vencidos a EXPIRED y segundo aviso a Calidad (RN-CAL-09). Con --desde rellena las tareas
 * de un rango (para la demo). Correrla dos veces el mismo día no duplica tareas ni avisos.
 */
class CalDiario extends Command
{
    protected $signature = 'cal:diario {--fecha= : Fecha (AAAA-MM-DD), por defecto hoy en Lima} {--desde= : Rellena las tareas desde esta fecha}';

    protected $description = 'Tareas de calidad del día, puntos sin lectura y vencimientos sanitarios';

    public function handle(): int
    {
        $fecha = $this->option('fecha') ?: Comun::hoy();
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            if (! CalidadService::activo()) {
                continue;
            }
            $n = 0;
            $desde = CarbonImmutable::parse($this->option('desde') ?: $fecha);
            for ($d = $desde; $d->toDateString() <= $fecha; $d = $d->addDay()) {
                $n += CalidadService::generarTareas($d->toDateString());
            }
            $miss = CalidadService::marcarIncumplidas($fecha);
            $avisos = 0;
            foreach (CalidadService::puntosAtrasados(CarbonImmutable::parse($fecha.' '.Comun::ahora()->format('H:i:s'), 'America/Lima')) as $p) {
                $avisos += Comun::avisar('CAL', ['CALIDAD', 'ALMACENERO'], "Falta la lectura de {$p->name}", 'No hay lectura dentro de su frecuencia. Regístrala en Registro de temperaturas.',
                    'CAL-05', $p->id, 'warn', 'sinlectura:'.$p->id.':'.$fecha, $p->establishment_id) > 0 ? 1 : 0;
            }
            $s = CalidadService::revisarSanitarios($fecha);
            $this->info(sprintf('%s: %d tarea(s) creada(s), %d incumplida(s), %d punto(s) sin lectura avisado(s), %d registro(s) vencido(s), %d aviso(s) de vencimiento',
                $tenant['name'], $n, $miss, $avisos, $s['expired'], $s['alerted']));
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
