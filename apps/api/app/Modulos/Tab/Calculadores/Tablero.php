<?php

namespace App\Modulos\Tab\Calculadores;

use App\Modulos\Tab\Services\Base;
use App\Modulos\Tab\Services\Catalogo;
use App\Modulos\Tab\Services\Metas;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Los indicadores del propio TAB. */
final class Tablero
{
    public static function todos(): array
    {
        return [
            // KPI-TAB-01: indicadores activos con meta vigente / indicadores activos × 100 (de módulos encendidos)
            'KPI-TAB-01' => function (Periodo $p) {
                $activos = array_filter(Catalogo::defs(), fn ($d) => Catalogo::calculable($d));
                $con = array_filter($activos, fn ($d) => Metas::vigente($d->code, $p->marca, $p->local, $p->hasta) !== null);

                return Periodo::pct(count($con), count($activos), 1);
            },
            // KPI-TAB-02: fecha de la primera corrida OK del mes − último día del mes (la corrida que está congelando cuenta)
            'KPI-TAB-02' => function (Periodo $p) {
                $primera = DB::table('kpi_snapshot_runs')->where('period', $p->mes())->whereIn('status', ['OK', 'RUNNING'])
                    ->min(DB::raw("coalesce(finished_at, started_at)"));
                if (! $primera) {
                    return Periodo::valor(null);
                }
                $dias = (int) CarbonImmutable::parse($p->finDeMes())->diffInDays(CarbonImmutable::parse($primera)->setTimezone('America/Lima')->startOfDay(), false);

                return Periodo::total($dias, 0);
            },
        ];
    }

    /** Para Base::… sin importar el namespace en las closures. */
    public static function hoy(): string
    {
        return Base::hoy();
    }
}
