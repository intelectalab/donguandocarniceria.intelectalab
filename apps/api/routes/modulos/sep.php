<?php

use App\Modulos\Sep\Http\Controllers\SeparacionController;
use Illuminate\Support\Facades\Route;

// SEP · Separación de marcas (SEP-01 a SEP-12; RN-SEP-01 a 20).
Route::prefix('sep')->middleware('modulo:SEP')->group(function () {
    Route::get('/proyectos', [SeparacionController::class, 'index']);
    Route::post('/preview', [SeparacionController::class, 'preview'])->middleware('permiso:sep.separation.prepare');
    Route::get('/proyectos/actual', [SeparacionController::class, 'show']);
    Route::get('/proyectos/{id}', [SeparacionController::class, 'show']);
    Route::post('/proyectos', [SeparacionController::class, 'store'])->middleware('permiso:sep.separation.prepare');
    Route::put('/proyectos/{id}', [SeparacionController::class, 'update'])->middleware('permiso:sep.separation.prepare')->whereUuid('id');
    Route::post('/proyectos/{id}/cancelar', [SeparacionController::class, 'cancelar'])->middleware('permiso:sep.separation.prepare|sep.separation.approve')->whereUuid('id');
    Route::post('/proyectos/{id}/items/reconstruir', [SeparacionController::class, 'reconstruirItems'])->middleware('permiso:sep.separation.prepare')->whereUuid('id');
    Route::put('/items/{itemId}', [SeparacionController::class, 'actualizarItem'])->middleware('permiso:sep.separation.prepare')->whereUuid('itemId');
    Route::put('/proyectos/{id}/politica-cxc', [SeparacionController::class, 'politicaCuentasPorCobrar'])->middleware('permiso:sep.separation.prepare')->whereUuid('id');

    // SEP-02 Validaciones previas
    Route::post('/proyectos/{id}/chequeos', [SeparacionController::class, 'correrValidaciones'])->middleware('permiso:sep.separation.prepare')->whereUuid('id');
    Route::post('/proyectos/{id}/validar', [SeparacionController::class, 'validar'])->middleware('permiso:sep.separation.prepare')->whereUuid('id');

    // SEP-08 Aprobación (4 ojos)
    Route::post('/proyectos/{id}/aprobar', [SeparacionController::class, 'aprobar'])->middleware('permiso:sep.separation.approve')->whereUuid('id');

    // SEP-09 Ejecución y monitoreo
    Route::post('/proyectos/{id}/ejecutar', [SeparacionController::class, 'ejecutar'])->middleware('permiso:sep.separation.execute')->whereUuid('id');

    // SEP-10 Paquete de exportación
    Route::post('/proyectos/{id}/paquete', [SeparacionController::class, 'generarPaquete'])->middleware('permiso:sep.export.download|sep.separation.prepare|sep.separation.execute')->whereUuid('id');
    Route::post('/proyectos/{id}/paquete/enlace', [SeparacionController::class, 'enlacePaquete'])->middleware('permiso:sep.export.download')->whereUuid('id');
    Route::post('/proyectos/{id}/paquete/aprobar', [SeparacionController::class, 'aprobarPaquete'])->middleware('permiso:aud.export.approve|sep.separation.approve')->whereUuid('id');

    // SEP-11 Acta de separación
    Route::post('/proyectos/{id}/acta', [SeparacionController::class, 'generarActa'])->middleware('permiso:sep.separation.prepare|sep.separation.execute|sep.separation.approve')->whereUuid('id');
    Route::post('/proyectos/{id}/acta/enlace', [SeparacionController::class, 'enlaceActa'])->middleware('permiso:sep.export.download')->whereUuid('id');

    // SEP-12 Marcas separadas e historial de razones sociales
    Route::get('/historial', [SeparacionController::class, 'historial']);
    Route::post('/historial', [SeparacionController::class, 'agregarVigencia'])->middleware('permiso:sep.separation.prepare');
});
