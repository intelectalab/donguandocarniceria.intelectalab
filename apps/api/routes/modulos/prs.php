<?php

use App\Modulos\Prs\Http\Controllers\PresupuestoController as P;
use Illuminate\Support\Facades\Route;

// PRS · Presupuesto (PRS-01 a PRS-10). Reglas RN-PRS-01 a 13 en app/Modulos/Prs/Services. Cada acción pide su permiso de la spec;
// el servicio revisa además el alcance (RN-PRS-12) y que quien aprueba no sea quien envió (RN-PRS-05).
Route::prefix('prs')->group(function () {
    $leer = 'modulo:PRS';
    $editar = ['modulo:PRS', 'permiso:prs.budget.edit'];
    $conceptos = ['modulo:PRS', 'permiso:prs.concept.manage'];
    $todo = ['modulo:PRS', 'permiso:prs.report.view_all'];

    Route::get('/opciones', [P::class, 'opciones'])->middleware($leer);

    // PRS-01 Presupuestos
    Route::get('/presupuestos', [P::class, 'presupuestos'])->middleware($leer);
    Route::post('/presupuestos', [P::class, 'crearPresupuesto'])->middleware($editar);
    Route::post('/presupuestos/{id}/versiones', [P::class, 'nuevaVersion'])->middleware($editar)->whereUuid('id');

    // PRS-02 Conceptos presupuestales
    Route::get('/conceptos', [P::class, 'conceptos'])->middleware($leer);
    Route::post('/conceptos', [P::class, 'guardarConcepto'])->middleware($conceptos);
    Route::put('/conceptos/{id}', [P::class, 'guardarConcepto'])->middleware($conceptos)->whereUuid('id');
    Route::post('/conceptos/{id}/mapeos', [P::class, 'mapear'])->middleware($conceptos)->whereUuid('id');
    Route::delete('/mapeos/{id}', [P::class, 'quitarMapeo'])->middleware($conceptos)->whereUuid('id');

    // PRS-03 Edición de versión
    Route::get('/versiones/{id}', [P::class, 'matriz'])->middleware($leer)->whereUuid('id');
    Route::post('/versiones/{id}/lineas', [P::class, 'guardarLinea'])->middleware($editar)->whereUuid('id');
    Route::post('/versiones/{id}/filas', [P::class, 'guardarFila'])->middleware($editar)->whereUuid('id');
    Route::post('/versiones/{id}/filas/quitar', [P::class, 'quitarFila'])->middleware($editar)->whereUuid('id');
    Route::put('/lineas/{id}', [P::class, 'cambiarImporte'])->middleware($editar)->whereUuid('id');
    Route::delete('/lineas/{id}', [P::class, 'quitarLinea'])->middleware($editar)->whereUuid('id');

    // PRS-04 Carga y copia
    Route::get('/importar/plantilla', [P::class, 'plantilla'])->middleware([...$editar, 'throttle:20,1']);
    Route::post('/importar/archivo', [P::class, 'leerArchivo'])->middleware([...$editar, 'throttle:20,1']);
    Route::post('/versiones/{id}/importar/revisar', [P::class, 'revisarImportacion'])->middleware($editar)->whereUuid('id');
    Route::post('/versiones/{id}/importar', [P::class, 'importar'])->middleware($editar)->whereUuid('id');
    Route::post('/versiones/{id}/copiar-version', [P::class, 'copiarVersion'])->middleware($editar)->whereUuid('id');
    Route::post('/versiones/{id}/copiar-real', [P::class, 'copiarReal'])->middleware([...$editar, 'throttle:20,1'])->whereUuid('id');

    // PRS-05 Envío y aprobación
    Route::get('/versiones/{id}/diferencias', [P::class, 'diferencias'])->middleware($leer)->whereUuid('id');
    Route::post('/versiones/{id}/enviar', [P::class, 'enviar'])->middleware(['modulo:PRS', 'permiso:prs.budget.submit'])->whereUuid('id');
    Route::post('/versiones/{id}/aprobar', [P::class, 'aprobar'])->middleware($leer)->whereUuid('id');
    Route::post('/versiones/{id}/rechazar', [P::class, 'rechazar'])->middleware($leer)->whereUuid('id');

    // PRS-06 Real frente a presupuesto y PRS-07 Detalle del real
    Route::get('/ejecucion', [P::class, 'ejecucion'])->middleware($leer);
    Route::get('/ejecucion/exportar', [P::class, 'exportarEjecucion'])->middleware([$leer, 'throttle:10,1']);
    Route::get('/detalle', [P::class, 'detalle'])->middleware($leer);
    Route::post('/real/recalcular', [P::class, 'recalcular'])->middleware(['modulo:PRS', 'permiso:prs.concept.manage|prs.budget.approve', 'throttle:10,1']);

    // PRS-08 Proyección de cierre
    Route::get('/proyeccion', [P::class, 'proyeccion'])->middleware($leer);
    Route::post('/proyeccion/guardar', [P::class, 'guardarProyeccion'])->middleware([...$todo, 'throttle:20,1']);
    Route::post('/alertas/generar', [P::class, 'generarAlertas'])->middleware([...$todo, 'throttle:20,1']);

    // PRS-09 Comparativo de versiones
    Route::get('/comparativo', [P::class, 'comparativo'])->middleware($leer);

    // PRS-10 Alertas de desviación
    Route::get('/alertas', [P::class, 'alertas'])->middleware($leer);
    Route::get('/alertas/semaforo', [P::class, 'semaforoPorCentro'])->middleware($leer);
    Route::post('/alertas/{id}/comentar', [P::class, 'comentarAlerta'])->middleware($leer)->whereUuid('id');
});
