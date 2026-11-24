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

    // AUD-04: accesos a datos sensibles.
    Route::get('/sensibles', [AuditoriaController::class, 'sensibles'])->middleware(['modulo:AUD', 'permiso:aud.access_log.view', 'throttle:60,1']);

    // AUD-05: exportaciones (solicitar con motivo; aprobar o rechazar otra persona; descargar con enlace temporal).
    Route::get('/exportaciones', [AuditoriaController::class, 'exportaciones'])->middleware(['permiso:aud.export.request|aud.export.approve', 'throttle:60,1']);
    Route::get('/exportaciones/{id}', [AuditoriaController::class, 'exportacion'])->middleware('permiso:aud.export.request|aud.export.approve')->whereUuid('id');
    Route::post('/exportaciones', [AuditoriaController::class, 'solicitarExportacion'])->middleware(['permiso:aud.export.request', 'throttle:10,1']);
    Route::post('/exportaciones/{id}/aprobar', [AuditoriaController::class, 'aprobarExportacion'])->middleware(['permiso:aud.export.approve', 'throttle:20,1'])->whereUuid('id');
    Route::post('/exportaciones/{id}/rechazar', [AuditoriaController::class, 'rechazarExportacion'])->middleware('permiso:aud.export.approve')->whereUuid('id');
    Route::post('/exportaciones/{id}/enlace', [AuditoriaController::class, 'enlaceExportacion'])->middleware(['permiso:aud.export.request|aud.export.approve', 'throttle:30,1'])->whereUuid('id');
});
