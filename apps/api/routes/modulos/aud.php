<?php

use App\Modulos\Aud\Http\Controllers\AuditoriaController;
use Illuminate\Support\Facades\Route;

// AUD · Auditoría: consulta de cambios (AUD-01), historia del registro (AUD-02) y bitácora de accesos (AUD-03).
Route::prefix('aud')->group(function () {
    // AUD-01: la consulta completa es de administración del sistema, gerencia y auditoría (RN-AUD-09).
    Route::get('/cambios', [AuditoriaController::class, 'cambios'])->middleware(['modulo:AUD', 'permiso:aud.change_log.view', 'throttle:60,1']);
    Route::get('/cambios/{id}', [AuditoriaController::class, 'cambio'])->middleware(['modulo:AUD', 'permiso:aud.change_log.view'])->whereNumber('id');

    // AUD-02: la pestaña «Historia» de cualquier ficha; pide su permiso, no el módulo de Auditoría.
    Route::get('/historia', [AuditoriaController::class, 'historia'])->middleware(['permiso:aud.record_history.view', 'throttle:60,1']);
    Route::get('/historia/registros', [AuditoriaController::class, 'registros'])->middleware(['permiso:aud.record_history.view', 'throttle:60,1']);

    // AUD-03: bitácora de accesos.
    Route::get('/accesos', [AuditoriaController::class, 'accesos'])->middleware(['modulo:AUD', 'permiso:aud.access_log.view', 'throttle:60,1']);
});
