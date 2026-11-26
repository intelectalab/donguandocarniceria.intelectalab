<?php

use App\Modulos\Des\Http\Controllers\DespieceController;
use Illuminate\Support\Facades\Route;

// DES · Despiece y costeo conjunto. Reglas en app/Modulos/Des/Services/DespieceService.php.
// El despiece en curso (DES-04) usa las rutas de registro de PRO; el cierre es PRO-10 con el costeo de DES.
// Plantillas: des.template.manage. Precios de referencia: des.reference_price.manage. Cerrar fuera de balance: des.mass_balance.override.
Route::prefix('des')->group(function () {
    // DES-01 Plantillas y DES-02 Editor
    Route::get('/plantillas', [DespieceController::class, 'index'])->middleware('modulo:DES');
    Route::get('/plantillas/{id}', [DespieceController::class, 'show'])->middleware('modulo:DES')->whereUuid('id');
    Route::post('/plantillas', [DespieceController::class, 'store'])->middleware(['modulo:DES,C', 'permiso:des.template.manage']);
    Route::put('/plantillas/{id}', [DespieceController::class, 'update'])->middleware(['modulo:DES,E', 'permiso:des.template.manage'])->whereUuid('id');
    Route::post('/plantillas/{id}/activar', [DespieceController::class, 'activar'])->middleware(['modulo:DES,E', 'permiso:des.template.manage'])->whereUuid('id');
    Route::post('/plantillas/{id}/version', [DespieceController::class, 'version'])->middleware(['modulo:DES,C', 'permiso:des.template.manage'])->whereUuid('id');
    Route::post('/plantillas/{id}/retirar', [DespieceController::class, 'retirar'])->middleware(['modulo:DES,A', 'permiso:des.template.manage'])->whereUuid('id');

    // DES-03 Precios de referencia
    Route::get('/precios', [DespieceController::class, 'precios'])->middleware('modulo:DES');
    Route::post('/precios', [DespieceController::class, 'guardarPrecio'])->middleware(['modulo:DES,C', 'permiso:des.reference_price.manage']);

    // DES-04 Despiece en curso, DES-05 Balance y DES-06 Costeo (de una orden CUTTING)
    Route::get('/despieces', [DespieceController::class, 'despieces'])->middleware('modulo:DES');
    Route::get('/despieces/{id}', [DespieceController::class, 'despiece'])->middleware('modulo:DES')->whereUuid('id');

    // DES-07 Rendimiento por corte, DES-08 Proveedores y DES-09 Tablero
    Route::get('/cortes', [DespieceController::class, 'cortes'])->middleware('modulo:DES');
    Route::get('/proveedores', [DespieceController::class, 'proveedores'])->middleware('modulo:DES');
    Route::get('/tablero', [DespieceController::class, 'tablero'])->middleware('modulo:DES');
});
