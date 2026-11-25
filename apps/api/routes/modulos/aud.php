<?php

use App\Modulos\Aud\Http\Controllers\AuditoriaController;
use Illuminate\Support\Facades\Route;

// AUD · Auditoría: cambios (AUD-01, 02), accesos (AUD-03, 04), exportaciones (AUD-05), retención y depuración (AUD-06, 07) y revisión de accesos (AUD-08).
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
    // AUD-06 y AUD-07: la auditoría consulta; solo quien gestiona la retención cambia políticas y depura (RN-AUD-08).
    Route::get('/retencion', [AuditoriaController::class, 'retencion'])->middleware(['modulo:AUD', 'permiso:aud.retention.manage|aud.change_log.view', 'throttle:60,1']);
    Route::put('/retencion/{categoria}', [AuditoriaController::class, 'actualizarRetencion'])->middleware(['modulo:AUD', 'permiso:aud.retention.manage', 'throttle:20,1'])->where('categoria', '[A-Z_]+');
    Route::post('/retencion/{categoria}/depurar', [AuditoriaController::class, 'depurarCategoria'])->middleware(['modulo:AUD', 'permiso:aud.retention.manage', 'throttle:10,1'])->where('categoria', '[A-Z_]+');
    Route::get('/depuraciones', [AuditoriaController::class, 'depuraciones'])->middleware(['modulo:AUD', 'permiso:aud.retention.manage|aud.change_log.view', 'throttle:60,1']);
    Route::post('/depuraciones', [AuditoriaController::class, 'depurarVencidas'])->middleware(['modulo:AUD', 'permiso:aud.retention.manage', 'throttle:5,1']);

    // AUD-08: la gerencia y administración del sistema revisan; la auditoría consulta las cerradas (RN-AUD-10).
    Route::get('/revision', [AuditoriaController::class, 'revision'])->middleware(['modulo:AUD', 'permiso:aud.access_review.run|aud.change_log.view', 'throttle:60,1']);
    Route::post('/revision', [AuditoriaController::class, 'iniciarRevision'])->middleware(['modulo:AUD', 'permiso:aud.access_review.run', 'throttle:10,1']);
    Route::get('/revision/{id}', [AuditoriaController::class, 'verRevision'])->middleware(['modulo:AUD', 'permiso:aud.access_review.run|aud.change_log.view'])->whereUuid('id');
    Route::put('/revision/{id}/decisiones', [AuditoriaController::class, 'decidirRevision'])->middleware(['modulo:AUD', 'permiso:aud.access_review.run', 'throttle:120,1'])->whereUuid('id');
    Route::post('/revision/{id}/cerrar', [AuditoriaController::class, 'cerrarRevision'])->middleware(['modulo:AUD', 'permiso:aud.access_review.run', 'throttle:10,1'])->whereUuid('id');

    Route::post('/exportaciones/{id}/enlace', [AuditoriaController::class, 'enlaceExportacion'])->middleware(['permiso:aud.export.request|aud.export.approve', 'throttle:30,1'])->whereUuid('id');
});
