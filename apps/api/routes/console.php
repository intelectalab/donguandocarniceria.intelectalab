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

// MAE · RN-MAE-14: tipo de cambio del día desde el conector FX (09:00 Lima, mae_fx_load_time); si falla tres veces avisa.
Schedule::command('mae:cargar-tipo-cambio')->dailyAt('09:00')->timezone('America/Lima')->weekdays()->withoutOverlapping();

// EQU · RN-EQU-07 y RN-EQU-08: órdenes preventivas que tocan y avisos de calibración, cada mañana en hora de Lima.
Schedule::command('equ:diario')->dailyAt('06:10')->timezone('America/Lima')->withoutOverlapping();

// PED · RN-PED-18: cancela los borradores sin actividad (ped_draft_expiry_hours, 48 h por defecto), cada hora.
Schedule::command('ped:vencer-borradores')->hourly()->withoutOverlapping();
