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
// CAL · RN-CAL-09, RN-CAL-13 y RN-CAL-14: tareas diarias de calidad, puntos sin lectura y registros sanitarios.
Schedule::command('cal:diario')->dailyAt('06:15')->timezone('America/Lima')->withoutOverlapping();
// B2B y CMP: crédito, cobranza, segmentos, puntos y corrida de recurrentes de las 18:00 (RN-B2B-09).
Schedule::command('canales:diario b2b')->dailyAt('06:30')->timezone('America/Lima')->withoutOverlapping();
Schedule::command('canales:diario cmp')->dailyAt('06:40')->timezone('America/Lima')->withoutOverlapping();
Schedule::command('canales:diario corrida')->dailyAt('18:00')->timezone('America/Lima')->withoutOverlapping();
// CRM · RN-CRM-02 y RN-CRM-14: tarea y aviso por chat sin responder (15 min en horario) y aviso por chat en cola (5 min).
Schedule::command('crm:barrido')->everyMinute()->withoutOverlapping();
// CRM · RN-CRM-20: encuestas de los pedidos entregados hace más de 2 h; RN-CRM-19: recompra recalculada cada mañana.
Schedule::command('crm:posventa encuestas')->everyTenMinutes()->withoutOverlapping();
Schedule::command('crm:posventa recompra')->dailyAt('06:00')->timezone('America/Lima')->withoutOverlapping();

// TEL · purga nocturna de grabaciones vencidas (RN-TEL-10), en las empresas con Telefonía encendida.
Schedule::command('tel:purga')->dailyAt('03:00')->timezone('America/Lima')->withoutOverlapping();
// FAC-07 · RN-FAC-06: procesa la cola de envío de comprobantes y guías al OSE y sus reintentos.
Schedule::command('fac:procesar-cola')->everyMinute()->withoutOverlapping();
// WEB · RN-WEB-05: sincroniza stock, precios y consulta de respaldo de pedidos de las tiendas WooCommerce.
Schedule::command('web:sincronizar')->everyMinute()->withoutOverlapping();
// TAB · RN-TAB-10: congela los indicadores del mes anterior el día tab_snapshot_day (3) a las 02:00 de Lima.
Schedule::command('tab:congelar')->dailyAt('02:00')->timezone('America/Lima')->withoutOverlapping();
// API · RN-API-08: procesa cada minuto los reintentos vencidos de entregas de webhooks salientes.
Schedule::command('api:procesar-webhooks')->everyMinute()->withoutOverlapping();
