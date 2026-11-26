<?php

use App\Modulos\Pro\Http\Controllers\LineaController;
use App\Modulos\Pro\Http\Controllers\OrdenController;
use Illuminate\Support\Facades\Route;

// PRO · Órdenes de producción. Reglas en app/Modulos/Pro/Services/ProduccionService.php.
// Crear y liberar: pro.order.create. Registrar en planta: pro.order.record. Cerrar: pro.order.close. Anular: pro.order.void.
// Costos y tarifas: pro.cost.view (se ocultan en la respuesta sin el permiso).
Route::prefix('pro')->group(function () {
    Route::get('/opciones', [LineaController::class, 'opciones'])->middleware('modulo:PRO');

    // PRO-01 Líneas
    Route::get('/lineas', [LineaController::class, 'index'])->middleware('modulo:PRO');
    Route::post('/lineas', [LineaController::class, 'store'])->middleware(['modulo:PRO,C', 'permiso:pro.order.create']);
    Route::put('/lineas/{id}', [LineaController::class, 'update'])->middleware(['modulo:PRO,E', 'permiso:pro.order.create'])->whereUuid('id');

    // PRO-02 Plan semanal, PRO-03 Requerimiento de insumos y PRO-12 Tablero
    Route::get('/plan', [LineaController::class, 'plan'])->middleware('modulo:PRO');
    Route::get('/requerimiento', [LineaController::class, 'requerimiento'])->middleware('modulo:PRO');
    Route::get('/tablero', [LineaController::class, 'tablero'])->middleware('modulo:PRO');

    // PRO-04 Órdenes, PRO-05 Nueva orden, PRO-11 Ficha y PRO-13 Anulación
    Route::get('/ordenes', [OrdenController::class, 'index'])->middleware('modulo:PRO');
    Route::post('/ordenes', [OrdenController::class, 'store'])->middleware(['modulo:PRO,C', 'permiso:pro.order.create']);
    Route::get('/ordenes/{id}', [OrdenController::class, 'show'])->middleware('modulo:PRO')->whereUuid('id');
    Route::post('/ordenes/{id}/liberar', [OrdenController::class, 'liberar'])->middleware(['modulo:PRO,E', 'permiso:pro.order.create'])->whereUuid('id');
    Route::post('/ordenes/{id}/anular', [OrdenController::class, 'anular'])->middleware(['modulo:PRO,A', 'permiso:pro.order.void'])->whereUuid('id');

    // PRO-06 a PRO-09 Registro en planta (la tableta del operario)
    Route::get('/ordenes/{id}/consumo-teorico', [OrdenController::class, 'consumoTeorico'])->middleware('modulo:PRO')->whereUuid('id');
    Route::post('/ordenes/{id}/consumos', [OrdenController::class, 'consumir'])->middleware(['modulo:PRO,C', 'permiso:pro.order.record', 'throttle:120,1'])->whereUuid('id');
    Route::post('/ordenes/{id}/lecturas', [OrdenController::class, 'lectura'])->middleware(['modulo:PRO,C', 'permiso:pro.order.record', 'throttle:120,1'])->whereUuid('id');
    Route::post('/ordenes/{id}/produccion', [OrdenController::class, 'producir'])->middleware(['modulo:PRO,C', 'permiso:pro.order.record', 'throttle:120,1'])->whereUuid('id');
    Route::post('/ordenes/{id}/personal', [OrdenController::class, 'personal'])->middleware(['modulo:PRO,C', 'permiso:pro.order.record'])->whereUuid('id');
    Route::post('/ordenes/{id}/equipos', [OrdenController::class, 'equipo'])->middleware(['modulo:PRO,C', 'permiso:pro.order.record'])->whereUuid('id');

    // PRO-10 Cierre
    Route::get('/ordenes/{id}/resumen', [OrdenController::class, 'resumen'])->middleware('modulo:PRO')->whereUuid('id');
    Route::post('/ordenes/{id}/cerrar', [OrdenController::class, 'cerrar'])->middleware(['modulo:PRO,E', 'permiso:pro.order.close'])->whereUuid('id');
});
