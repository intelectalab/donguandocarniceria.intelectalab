<?php

use App\Modulos\Rec\Http\Controllers\AditivoController;
use App\Modulos\Rec\Http\Controllers\CostoController;
use App\Modulos\Rec\Http\Controllers\DetalleController;
use App\Modulos\Rec\Http\Controllers\RecetaController;
use App\Modulos\Rec\Http\Controllers\VersionController;
use Illuminate\Support\Facades\Route;

// REC · Recetas y formulación. Reglas en app/Modulos/Rec/Services/RecetasService.php.
// Editar pide rec.version.edit; aprobar, rec.version.approve (y no ser el autor); ver costos, rec.cost.view.
Route::prefix('rec')->group(function () {
    Route::get('/opciones', [RecetaController::class, 'opciones'])->middleware('modulo:REC');
    Route::get('/cifras/{pantalla}', [RecetaController::class, 'cifras'])->middleware('modulo:REC')->where('pantalla', '\d{2}');

    // REC-01 Recetas
    Route::get('/recetas', [RecetaController::class, 'index'])->middleware('modulo:REC');
    Route::get('/recetas/{id}', [RecetaController::class, 'show'])->middleware('modulo:REC')->whereUuid('id');
    Route::post('/recetas', [RecetaController::class, 'store'])->middleware(['modulo:REC,C', 'permiso:rec.version.edit']);
    Route::put('/recetas/{id}', [RecetaController::class, 'update'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid('id');
    Route::post('/recetas/{id}/versiones', [VersionController::class, 'store'])->middleware(['modulo:REC,C', 'permiso:rec.version.edit'])->whereUuid('id');

    // REC-02 Editor de versión y REC-07 Revisión y aprobación
    Route::get('/versiones', [VersionController::class, 'index'])->middleware('modulo:REC');
    Route::get('/versiones/{id}', [VersionController::class, 'show'])->middleware('modulo:REC')->whereUuid('id');
    Route::put('/versiones/{id}', [VersionController::class, 'update'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid('id');
    Route::delete('/versiones/{id}', [VersionController::class, 'destroy'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid('id');
    Route::post('/versiones/{id}/enviar', [VersionController::class, 'enviar'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid('id');
    Route::post('/versiones/{id}/devolver', [VersionController::class, 'devolver'])->middleware('modulo:REC,E')->whereUuid('id');
    Route::post('/versiones/{id}/aprobar', [VersionController::class, 'aprobar'])->middleware(['modulo:REC,E', 'permiso:rec.version.approve'])->whereUuid('id');
    Route::get('/versiones/{id}/revision', [VersionController::class, 'revision'])->middleware('modulo:REC')->whereUuid('id');

    // REC-03 Ingredientes
    Route::get('/versiones/{id}/ingredientes', [DetalleController::class, 'ingredientes'])->middleware('modulo:REC')->whereUuid('id');
    Route::post('/versiones/{id}/ingredientes', [DetalleController::class, 'guardarIngrediente'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid('id');
    Route::put('/versiones/{id}/ingredientes/{ingId}', [DetalleController::class, 'guardarIngrediente'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid(['id', 'ingId']);

    // REC-05 Pasos
    Route::get('/versiones/{id}/pasos', [DetalleController::class, 'pasos'])->middleware('modulo:REC')->whereUuid('id');
    Route::post('/versiones/{id}/pasos', [DetalleController::class, 'guardarPaso'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid('id');
    Route::put('/versiones/{id}/pasos/{pasoId}', [DetalleController::class, 'guardarPaso'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid(['id', 'pasoId']);
    Route::post('/pasos/{id}/mover', [DetalleController::class, 'moverPaso'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid('id');

    // REC-06 Puntos de control
    Route::get('/versiones/{id}/puntos', [DetalleController::class, 'puntos'])->middleware('modulo:REC')->whereUuid('id');
    Route::post('/versiones/{id}/puntos', [DetalleController::class, 'guardarPunto'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid('id');
    Route::put('/versiones/{id}/puntos/{puntoId}', [DetalleController::class, 'guardarPunto'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])->whereUuid(['id', 'puntoId']);

    Route::delete('/{tipo}/{id}', [DetalleController::class, 'quitar'])->middleware(['modulo:REC,E', 'permiso:rec.version.edit'])
        ->where('tipo', 'ingredientes|pasos|puntos')->whereUuid('id');

    // REC-04 Catálogo de aditivos (lo editan Calidad y el jefe de producción: lo valida el servicio)
    Route::get('/aditivos', [AditivoController::class, 'index'])->middleware('modulo:REC');
    Route::get('/aditivos/{id}', [AditivoController::class, 'show'])->middleware('modulo:REC')->whereUuid('id');
    Route::post('/aditivos', [AditivoController::class, 'guardar'])->middleware('modulo:REC,E');
    Route::put('/aditivos/{id}', [AditivoController::class, 'guardar'])->middleware('modulo:REC,E')->whereUuid('id');

    // REC-08 Escalado (también para PRO-05; los operarios ven solo los kg, D-REC-02)
    Route::get('/versiones/{id}/escalado', [VersionController::class, 'escalar'])->middleware('modulo:REC')->whereUuid('id');

    // REC-09 Costo de la receta
    Route::get('/costos', [CostoController::class, 'index'])->middleware(['modulo:REC', 'permiso:rec.cost.view']);
    Route::post('/costos/recalcular', [CostoController::class, 'recalcular'])->middleware(['modulo:REC', 'permiso:rec.cost.view', 'throttle:10,1']);
    Route::get('/versiones/{id}/costo', [VersionController::class, 'costo'])->middleware(['modulo:REC', 'permiso:rec.cost.view'])->whereUuid('id');

    // REC-10 Ficha técnica
    Route::get('/versiones/{id}/ficha', [VersionController::class, 'ficha'])->middleware('modulo:REC')->whereUuid('id');
});
