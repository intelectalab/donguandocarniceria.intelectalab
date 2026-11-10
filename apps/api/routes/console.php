<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// ALM · RN-ALM-15: alertas diarias de vencimiento (3 y 7 días), en hora de Lima.
\Illuminate\Support\Facades\Schedule::command('alm:alertas-vencimiento')->dailyAt('06:00')->timezone('America/Lima')->withoutOverlapping();
