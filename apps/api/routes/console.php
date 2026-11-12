<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// ALM · RN-ALM-15: alertas diarias de vencimiento (3 y 7 días), en hora de Lima.
Schedule::command('alm:alertas-vencimiento')->dailyAt('06:00')->timezone('America/Lima')->withoutOverlapping();

// SEG · RN-SEG-09: cierra cada hora las sesiones vencidas que nadie volvió a usar (quedan en la bitácora).
Schedule::command('seg:vencer-sesiones')->hourly()->withoutOverlapping();
