<?php

namespace Database\Seeders;

use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * EQU · horas de uso de la demo (EQU-08), después de la base (corre con el dueño de las tablas).
 *
 * El prototipo registra el uso de equipos por orden de producción en production_order_equipment, una tabla
 * de PRO que la base no tiene, así que el extractor no la trajo. Aquí se repite su siembra en equipment_usage:
 * de lunes a sábado, del 11/09/2026 al 10/10/2026, una orden OP01-0381… por día y cada equipo con 75 % de
 * probabilidad, con horas de 70 % a 130 % de su uso típico. El horómetro sembrado ya incluye esas horas,
 * así que no se toca. La semilla es fija: cada corrida da las mismas filas.
 */
class EquDemoSeeder extends Seeder
{
    /** Equipo => horas típicas por orden (las del prototipo). */
    private const USO = ['EMB-L2-01' => 2.5, 'CUT-L2-01' => 1.5, 'AHU-L2-01' => 4, 'MAR-L2-01' => 3, 'SEL-L2-01' => 2, 'TOS-L2-01' => 1.5, 'SEL-L1-01' => 1.5, 'SIE-L1-01' => 2, 'REB-L2-01' => 1];

    public function run(): void
    {
        $tenant = DB::table('tenants')->where('name', 'like', '%DON GUANDO%')->value('id');
        if (! $tenant || DB::table('equipment_usage')->where('tenant_id', $tenant)->exists()) {
            return;
        }
        $equipos = DB::table('equipment')->where('tenant_id', $tenant)->whereIn('code', array_keys(self::USO))->get(['id', 'code', 'hourly_rate'])->keyBy('code');
        $jefe = DB::table('users')->where('tenant_id', $tenant)->where('email', 'olazo@donguando.pe')->value('id');
        mt_srand(44);
        $filas = [];
        $op = 380;
        for ($d = CarbonImmutable::parse('2026-09-11'); $d->lessThanOrEqualTo(CarbonImmutable::parse('2026-10-10')); $d = $d->addDay()) {
            if ($d->dayOfWeek === 0) {
                continue;
            }
            $op++;
            foreach (self::USO as $codigo => $horas) {
                if (! isset($equipos[$codigo]) || mt_rand() / mt_getrandmax() >= 0.75) {
                    continue;
                }
                $e = $equipos[$codigo];
                $h = round($horas * (0.7 + mt_rand() / mt_getrandmax() * 0.6), 1);
                $filas[] = [
                    'tenant_id' => $tenant, 'equipment_id' => $e->id, 'order_ref' => 'OP01-0'.$op, 'used_on' => $d->toDateString(), 'hours' => $h,
                    'hourly_rate' => $e->hourly_rate, 'cost' => round($h * (float) $e->hourly_rate, 2), 'source' => 'EQU', 'recorded_by' => $jefe,
                    'created_at' => $d->setTime(18, 0)->toDateTimeString(),
                ];
            }
        }
        foreach (array_chunk($filas, 200) as $lote) {
            DB::table('equipment_usage')->insert($lote);
        }
        $this->command?->info('EQU: '.count($filas).' registros de uso de equipos (EQU-08)');
    }
}
