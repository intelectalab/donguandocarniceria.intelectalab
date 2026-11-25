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

// OPS · RN-OPS-09: vence cada minuto los accesos de soporte cumplidos (desactiva su usuario técnico).
// OPS · RN-OPS-15: cierra los tickets resueltos sin respuesta del cliente (ops_ticket_auto_close_days), cada mañana.
Schedule::command('ops:vencer-accesos')->everyMinute()->withoutOverlapping();

// INT-06: envía los mensajes salientes que tocan y reintenta los fallidos (RN-INT-08, RN-INT-09).
Schedule::command('int:despachar')->everyMinute()->withoutOverlapping();
// SUS · RN-SUS-10: mora diaria (deuda, reintentos, solo lectura, suspensión) y pruebas vencidas, en hora de Lima.
Schedule::command('sus:mora')->dailyAt('06:20')->timezone('America/Lima')->withoutOverlapping();
// SUS · SUS-12: corrida de cobro del mes, el día 1 (sin RUC emisor quedan en borrador).
Schedule::command('sus:corrida')->monthlyOn(1, '07:00')->timezone('America/Lima')->withoutOverlapping();
// OPS · OPS-10: congela las métricas del mes anterior (día 1) y guarda cada día la foto de uso de las empresas (SUS-04).
Schedule::command('ops:metricas cierre')->monthlyOn(1, '03:00')->timezone('America/Lima')->withoutOverlapping();
Schedule::command('ops:metricas uso')->dailyAt('05:10')->timezone('America/Lima')->withoutOverlapping();
// OPS · OPS-07: lectura de salud de los componentes con sonda propia (D-OPS-01).
Schedule::command('ops:leer-salud')->everyMinute()->withoutOverlapping();
// AUD: depuración mensual según las políticas de retención (RN-AUD-08) y la revisión de accesos de cada trimestre (RN-AUD-10).
Schedule::command('aud:depurar')->monthlyOn(1, '03:30')->timezone('America/Lima')->withoutOverlapping();
Schedule::command('aud:revision-trimestral')->dailyAt('07:10')->timezone('America/Lima')->withoutOverlapping();
Schedule::command('ops:cerrar-tickets')->dailyAt('05:30')->timezone('America/Lima')->withoutOverlapping();
