<?php

use App\Modulos\Pre\Http\Controllers\CargaController;
use App\Modulos\Pre\Http\Controllers\ErrorController;
use App\Modulos\Pre\Http\Controllers\FefoController;
use App\Modulos\Pre\Http\Controllers\OlaController;
use App\Modulos\Pre\Http\Controllers\TableroController;
use App\Modulos\Pre\Http\Controllers\TareaController;
use Illuminate\Support\Facades\Route;

// PRE · Preparación con escaneo, bolsas numeradas y carga verificada (PRE-01 a PRE-12). Reglas en app/Modulos/Pre/Services.
// Las acciones con permiso especial de la spec piden el módulo para leer y el permiso (así el coordinador de delivery, que
// solo lee PRE, puede crear olas y cargar, como dice la spec).
Route::prefix('pre')->group(function () {
    $olas = ['modulo:PRE', 'permiso:pre.wave.manage'];
    $armar = ['modulo:PRE', 'permiso:pre.task.pick'];

    // PRE-01 Planificador de olas
    Route::get('/planificador', [OlaController::class, 'planificador'])->middleware('modulo:PRE');
    Route::get('/olas', [OlaController::class, 'lista'])->middleware('modulo:PRE');
    Route::get('/olas/{id}', [OlaController::class, 'show'])->middleware('modulo:PRE')->whereUuid('id');
    Route::post('/olas', [OlaController::class, 'store'])->middleware($olas);
    Route::post('/olas/{id}/liberar', [OlaController::class, 'liberar'])->middleware($olas)->whereUuid('id');
    Route::post('/olas/{id}/cancelar', [OlaController::class, 'cancelar'])->middleware($olas)->whereUuid('id');
    Route::post('/olas/{id}/cerrar', [OlaController::class, 'cerrar'])->middleware($olas)->whereUuid('id');
    Route::delete('/olas/{id}/tareas/{taskId}', [OlaController::class, 'quitar'])->middleware($olas)->whereUuid(['id', 'taskId']);

    // PRE-02 Lista consolidada
    Route::get('/olas/{id}/consolidada', [OlaController::class, 'consolidada'])->middleware('modulo:PRE')->whereUuid('id');

    // PRE-03 Lista por pedido y PRE-04 Armado con escaneo
    Route::get('/tareas', [TareaController::class, 'index'])->middleware('modulo:PRE');
    Route::get('/tareas/{id}', [TareaController::class, 'show'])->middleware('modulo:PRE')->whereUuid('id');
    Route::post('/tareas/{id}/escanear', [TareaController::class, 'escanear'])->middleware($armar)->whereUuid('id');
    Route::post('/tareas/{id}/anular', [TareaController::class, 'anular'])->middleware(['modulo:PRE,E', 'permiso:pre.wave.manage|pre.short.approve'])->whereUuid('id');
    Route::post('/tareas/{id}/stock', [TareaController::class, 'stock'])->middleware(['modulo:PRE,E', 'permiso:pre.short.approve|pre.wave.manage'])->whereUuid('id');

    // PRE-05 Pesado
    Route::get('/pesado', [TareaController::class, 'pesado'])->middleware('modulo:PRE');

    // PRE-06 Bolsas y etiquetas
    Route::post('/tareas/{id}/bolsas', [TareaController::class, 'embolsar'])->middleware($armar)->whereUuid('id');

    // PRE-07 Verificación
    Route::post('/tareas/{id}/verificar', [TareaController::class, 'verificar'])->middleware(['modulo:PRE', 'permiso:pre.task.verify', 'throttle:30,1'])->whereUuid('id');
    Route::get('/tareas/{id}/foto', [TareaController::class, 'foto'])->middleware('modulo:PRE')->whereUuid('id');

    // PRE-08 Carga del vehículo
    Route::get('/rutas', [CargaController::class, 'rutas'])->middleware('modulo:PRE');
    Route::get('/carga', [CargaController::class, 'carga'])->middleware('modulo:PRE');
    Route::post('/carga/escanear', [CargaController::class, 'escanear'])->middleware(['modulo:PRE', 'permiso:pre.load.scan']);

    // PRE-09 Faltantes
    Route::get('/faltantes', [TareaController::class, 'faltantes'])->middleware('modulo:PRE');
    Route::post('/lineas/{id}/faltante', [TareaController::class, 'pedirFaltante'])->middleware($armar)->whereUuid('id');
    Route::post('/lineas/{id}/faltante/aprobar', [TareaController::class, 'aprobarFaltante'])->middleware(['modulo:PRE', 'permiso:pre.short.approve'])->whereUuid('id');
    Route::post('/lineas/{id}/faltante/rechazar', [TareaController::class, 'rechazarFaltante'])->middleware(['modulo:PRE', 'permiso:pre.short.approve'])->whereUuid('id');

    // PRE-10 Errores de armado
    Route::get('/errores', [ErrorController::class, 'index'])->middleware('modulo:PRE');
    Route::get('/errores/resumen', [ErrorController::class, 'resumen'])->middleware('modulo:PRE');
    Route::get('/errores/opciones', [ErrorController::class, 'opciones'])->middleware('modulo:PRE');
    Route::get('/errores/pedidos', [ErrorController::class, 'pedidos'])->middleware('modulo:PRE');
    Route::post('/errores', [ErrorController::class, 'store'])->middleware(['modulo:PRE', 'permiso:pre.error.manage|pre.task.verify']);
    Route::post('/errores/{id}/cerrar', [ErrorController::class, 'cerrar'])->middleware(['modulo:PRE', 'permiso:pre.error.manage'])->whereUuid('id');

    // PRE-11 Tablero de preparación
    Route::get('/tablero', [TableroController::class, 'dia'])->middleware('modulo:PRE');
    Route::get('/kpis', [TableroController::class, 'kpis'])->middleware('modulo:PRE');

    // PRE-12 Autorizaciones FEFO
    Route::get('/fefo', [FefoController::class, 'index'])->middleware('modulo:PRE');
    Route::post('/fefo/{id}/autorizar', [FefoController::class, 'autorizar'])->middleware(['modulo:PRE', 'permiso:pre.fefo.override'])->whereUuid('id');
    Route::post('/fefo/{id}/negar', [FefoController::class, 'negar'])->middleware(['modulo:PRE', 'permiso:pre.fefo.override'])->whereUuid('id');
});
