<?php

use App\Modulos\Grj\Http\Controllers\GranjaController;
use Illuminate\Support\Facades\Route;

// GRJ · Integración con la granja relacionada. Reglas en app/Modulos/Grj/Services/GranjaService.php.
// Vínculos y cambio a factura: grj.link.manage (la contadora entra a GRJ solo en lectura). Mapeo: grj.mapping.manage.
// Envíos: grj.dispatch.receive. Cierre de la conciliación: grj.reconciliation.close (el acuerdo también con GRJ editar).
Route::prefix('grj')->group(function () {
    Route::get('/opciones', [GranjaController::class, 'opciones'])->middleware('modulo:GRJ');
    Route::get('/cifras/{pantalla}', [GranjaController::class, 'cifras'])->middleware('modulo:GRJ')->where('pantalla', '\d{2}');

    // GRJ-01 Vínculo con la granja
    Route::get('/vinculos', [GranjaController::class, 'vinculos'])->middleware('modulo:GRJ');
    Route::get('/vinculos/esperado', [GranjaController::class, 'esperado'])->middleware('modulo:GRJ');
    Route::post('/vinculos', [GranjaController::class, 'crearVinculo'])->middleware(['modulo:GRJ', 'permiso:grj.link.manage']);
    Route::post('/vinculos/{id}/terminar', [GranjaController::class, 'cerrarVinculo'])->middleware(['modulo:GRJ', 'permiso:grj.link.manage'])->whereUuid('id');

    // GRJ-02 Mapeo de productos
    Route::get('/mapeos', [GranjaController::class, 'mapeos'])->middleware('modulo:GRJ');
    Route::post('/mapeos', [GranjaController::class, 'mapear'])->middleware(['modulo:GRJ', 'permiso:grj.mapping.manage']);

    // GRJ-03 Envíos y GRJ-04 Recepción de un envío
    Route::get('/envios', [GranjaController::class, 'envios'])->middleware('modulo:GRJ');
    Route::get('/envios/{id}', [GranjaController::class, 'envio'])->middleware('modulo:GRJ')->whereUuid('id');
    Route::post('/envios', [GranjaController::class, 'ingresar'])->middleware(['modulo:GRJ', 'permiso:grj.dispatch.receive', 'throttle:60,1']);
    Route::post('/envios/{id}/reprocesar', [GranjaController::class, 'reprocesar'])->middleware(['modulo:GRJ', 'permiso:grj.dispatch.receive|grj.mapping.manage'])->whereUuid('id');
    Route::post('/envios/{id}/recibir', [GranjaController::class, 'recibir'])->middleware(['modulo:GRJ', 'permiso:grj.dispatch.receive'])->whereUuid('id');
    Route::post('/envios/{id}/acuerdo', [GranjaController::class, 'disputa'])->middleware('modulo:GRJ')->whereUuid('id');

    // GRJ-05 Conciliación mensual
    Route::get('/conciliacion', [GranjaController::class, 'conciliacion'])->middleware('modulo:GRJ');
    Route::post('/conciliacion/acordar', [GranjaController::class, 'acordar'])->middleware('modulo:GRJ');
    Route::post('/conciliacion/cerrar', [GranjaController::class, 'cerrarConciliacion'])->middleware(['modulo:GRJ', 'permiso:grj.reconciliation.close']);

    // GRJ-06 Cambio a factura y GRJ-07 Tablero
    Route::post('/cambio-a-factura', [GranjaController::class, 'cambioAFactura'])->middleware(['modulo:GRJ', 'permiso:grj.link.manage']);
    Route::post('/cambio-a-factura/deshacer', [GranjaController::class, 'deshacerCambio'])->middleware(['modulo:GRJ', 'permiso:grj.link.manage']);
    Route::get('/tablero', [GranjaController::class, 'tablero'])->middleware('modulo:GRJ');
});
