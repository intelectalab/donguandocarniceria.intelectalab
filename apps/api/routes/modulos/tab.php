<?php

use App\Modulos\Tab\Http\Controllers\TableroController as T;
use Illuminate\Support\Facades\Route;

// TAB · Tablero e indicadores (TAB-01 a TAB-10). Reglas RN-TAB-01 a 10 en app/Modulos/Tab/Services.
// Todos ven su tablero (tab.dashboard.view); el servicio revisa el rol del tablero y el alcance de marca y local (RN-TAB-06).
Route::prefix('tab')->group(function () {
    $leer = ['modulo:TAB', 'permiso:tab.dashboard.view'];
    $exportar = ['modulo:TAB', 'permiso:tab.export.run', 'throttle:10,1'];

    Route::get('/tableros', [T::class, 'tableros'])->middleware($leer);
    Route::post('/actualizar', [T::class, 'actualizar'])->middleware([...$leer, 'throttle:20,1']);

    // TAB-01 a TAB-06 Tableros por rol
    Route::get('/tableros/{codigo}', [T::class, 'tablero'])->middleware($leer)->where('codigo', '[A-Za-z_]+');
    Route::get('/tableros/{codigo}/exportar', [T::class, 'exportarTablero'])->middleware($exportar)->where('codigo', '[A-Za-z_]+');

    // TAB-07 Catálogo de indicadores
    Route::get('/indicadores', [T::class, 'catalogo'])->middleware($leer);
    Route::get('/indicadores/exportar', [T::class, 'exportarCatalogo'])->middleware($exportar);
    Route::put('/indicadores/{codigo}', [T::class, 'editarIndicador'])->middleware(['modulo:TAB', 'permiso:tab.kpi.manage'])->where('codigo', '[A-Za-z0-9-]+');

    // TAB-08 Metas
    Route::get('/metas', [T::class, 'metas'])->middleware($leer);
    Route::get('/metas/propuestas', [T::class, 'propuestas'])->middleware(['modulo:TAB', 'permiso:tab.target.manage']);
    Route::post('/metas/simular', [T::class, 'simular'])->middleware($leer);
    Route::post('/metas', [T::class, 'guardarMeta'])->middleware(['modulo:TAB', 'permiso:tab.target.manage']);
    Route::post('/metas/{id}/cerrar', [T::class, 'cerrarMeta'])->middleware(['modulo:TAB', 'permiso:tab.target.manage'])->whereUuid('id');

    // TAB-09 Cierre mensual de indicadores
    Route::get('/cierre', [T::class, 'cierre'])->middleware($leer);
    Route::post('/cierre/congelar', [T::class, 'congelar'])->middleware(['modulo:TAB', 'permiso:tab.snapshot.run', 'throttle:10,1']);

    // TAB-10 Detalle de un indicador
    Route::get('/indicadores/{codigo}/detalle', [T::class, 'detalle'])->middleware($leer)->where('codigo', '[A-Za-z0-9-]+');
    Route::get('/indicadores/{codigo}/exportar', [T::class, 'exportarDetalle'])->middleware($exportar)->where('codigo', '[A-Za-z0-9-]+');
});
