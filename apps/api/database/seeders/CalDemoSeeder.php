<?php

namespace Database\Seeders;

use App\Modulos\Cal\Services\CalidadService;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * CAL · tareas de la programación de la demo (CAL-12 y KPI-CAL-05/06), del 01/10/2026 al 10/10/2026: las mismas
 * que crearía cal:diario cada mañana. Una inspección hecha ese día y turno marca la tarea como hecha; las pendientes
 * de días anteriores al 10/10 quedan incumplidas. Corre después de la base (con el dueño de las tablas).
 */
class CalDemoSeeder extends Seeder
{
    public function run(): void
    {
        $tenant = DB::table('tenants')->where('name', 'like', '%DON GUANDO%')->value('id');
        if (! $tenant || DB::table('qc_schedule_tasks')->where('tenant_id', $tenant)->exists()) {
            return;
        }
        TenantContext::set(TenantContext::find($tenant));
        for ($d = CarbonImmutable::parse('2026-10-01'); $d->lessThanOrEqualTo(CarbonImmutable::parse('2026-10-10')); $d = $d->addDay()) {
            CalidadService::generarTareas($d->toDateString());
        }
        CalidadService::marcarIncumplidas('2026-10-10');
        TenantContext::set(null);
    }
}
