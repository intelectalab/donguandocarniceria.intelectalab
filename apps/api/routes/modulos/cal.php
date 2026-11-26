<?php

use App\Modulos\Cal\Http\Controllers\ChecklistController as Chk;
use App\Modulos\Cal\Http\Controllers\LoteController as Lote;
use App\Modulos\Cal\Http\Controllers\NoConformidadController as Nc;
use App\Modulos\Cal\Http\Controllers\TemperaturaController as Temp;
use Illuminate\Support\Facades\Route;

// CAL · Calidad e inocuidad. Reglas en app/Modulos/Cal/Services/CalidadService.php.
// Checklists, programación y puntos: cal.checklist.manage. Inspecciones, lecturas, NC y reclamos: cal.inspection.record.
// Decisión sobre el lote y aprobar cargas: cal.lot.release. Cerrar NC y excursiones: cal.nonconformity.close.
// Registros sanitarios: cal.sanitary.manage. Resolver reclamos: cal.claim.resolve.
Route::prefix('cal')->group(function () {
    Route::get('/opciones', [Nc::class, 'opciones'])->middleware('modulo:CAL');
    Route::get('/tablero', [Nc::class, 'tablero'])->middleware('modulo:CAL');                       // CAL-13

    // CAL-01 Checklists y CAL-02 Programación
    Route::get('/checklists', [Chk::class, 'index'])->middleware('modulo:CAL');
    Route::get('/checklists/{id}', [Chk::class, 'show'])->middleware('modulo:CAL')->whereUuid('id');
    Route::post('/checklists', [Chk::class, 'store'])->middleware(['modulo:CAL,C', 'permiso:cal.checklist.manage']);
    Route::put('/checklists/{id}', [Chk::class, 'update'])->middleware(['modulo:CAL,E', 'permiso:cal.checklist.manage'])->whereUuid('id');
    Route::post('/checklists/{id}/activar', [Chk::class, 'activar'])->middleware(['modulo:CAL,E', 'permiso:cal.checklist.manage'])->whereUuid('id');
    Route::post('/checklists/{id}/version', [Chk::class, 'version'])->middleware(['modulo:CAL,C', 'permiso:cal.checklist.manage'])->whereUuid('id');
    Route::get('/programacion', [Chk::class, 'programacion'])->middleware('modulo:CAL');
    Route::post('/programacion', [Chk::class, 'guardarProgramacion'])->middleware(['modulo:CAL,C', 'permiso:cal.checklist.manage']);
    Route::put('/programacion/{id}', [Chk::class, 'guardarProgramacion'])->middleware(['modulo:CAL,E', 'permiso:cal.checklist.manage'])->whereUuid('id');

    // CAL-03 Inspecciones y CAL-12 Limpieza y BPM
    Route::get('/inspecciones', [Chk::class, 'inspecciones'])->middleware('modulo:CAL');
    Route::get('/inspecciones/{id}', [Chk::class, 'inspeccion'])->middleware('modulo:CAL')->whereUuid('id');
    Route::post('/inspecciones', [Chk::class, 'inspeccionar'])->middleware(['modulo:CAL,C', 'permiso:cal.inspection.record', 'throttle:60,1']);
    Route::get('/limpieza', [Chk::class, 'limpieza'])->middleware('modulo:CAL');
    Route::post('/tareas/{id}/hecha', [Chk::class, 'completarTarea'])->middleware(['modulo:CAL,E', 'permiso:cal.inspection.record'])->whereUuid('id');

    // CAL-04 Puntos, CAL-05 Lecturas y CAL-06 Excursiones
    Route::get('/puntos', [Temp::class, 'puntos'])->middleware('modulo:CAL');
    Route::post('/puntos', [Temp::class, 'guardarPunto'])->middleware(['modulo:CAL,C', 'permiso:cal.checklist.manage']);
    Route::put('/puntos/{id}', [Temp::class, 'guardarPunto'])->middleware(['modulo:CAL,E', 'permiso:cal.checklist.manage'])->whereUuid('id');
    Route::get('/lecturas', [Temp::class, 'lecturas'])->middleware('modulo:CAL');
    Route::post('/lecturas', [Temp::class, 'leer'])->middleware(['modulo:CAL,C', 'permiso:cal.inspection.record', 'throttle:120,1']);
    Route::post('/lecturas/{id}/aprobar', [Temp::class, 'aprobar'])->middleware(['modulo:CAL,E', 'permiso:cal.lot.release'])->whereUuid('id');
    Route::get('/excursiones', [Temp::class, 'excursiones'])->middleware('modulo:CAL');
    Route::get('/excursiones/{id}', [Temp::class, 'excursion'])->middleware('modulo:CAL')->whereUuid('id');
    Route::post('/excursiones/{id}/cerrar', [Temp::class, 'cerrar'])->middleware(['modulo:CAL,E', 'permiso:cal.nonconformity.close'])->whereUuid('id');

    // CAL-07 Lotes por liberar
    Route::get('/lotes', [Lote::class, 'index'])->middleware('modulo:CAL');
    Route::get('/lotes/{id}', [Lote::class, 'show'])->middleware('modulo:CAL')->whereUuid('id');
    Route::post('/lotes/{id}/decision', [Lote::class, 'decidir'])->middleware(['modulo:CAL,E', 'permiso:cal.lot.release'])->whereUuid('id');

    // CAL-08 No conformidades y CAL-09 Acciones
    Route::get('/no-conformidades', [Nc::class, 'index'])->middleware('modulo:CAL');
    Route::get('/no-conformidades/{id}', [Nc::class, 'show'])->middleware('modulo:CAL')->whereUuid('id');
    Route::post('/no-conformidades', [Nc::class, 'store'])->middleware(['modulo:CAL,C', 'permiso:cal.inspection.record']);
    Route::put('/no-conformidades/{id}', [Nc::class, 'update'])->middleware(['modulo:CAL,E', 'permiso:cal.nonconformity.close'])->whereUuid('id');
    Route::post('/no-conformidades/{id}/cerrar', [Nc::class, 'cerrar'])->middleware(['modulo:CAL,E', 'permiso:cal.nonconformity.close'])->whereUuid('id');
    Route::post('/no-conformidades/{id}/acciones', [Nc::class, 'agregarAccion'])->middleware(['modulo:CAL,C', 'permiso:cal.inspection.record'])->whereUuid('id');
    Route::get('/acciones', [Nc::class, 'acciones'])->middleware('modulo:CAL');
    Route::post('/acciones/{id}/estado', [Nc::class, 'avanzarAccion'])->middleware(['modulo:CAL,E', 'permiso:cal.inspection.record|cal.nonconformity.close'])->whereUuid('id');

    // CAL-10 Registros sanitarios (amplía CAT-10)
    Route::get('/sanitarios', [Nc::class, 'sanitarios'])->middleware('modulo:CAL');
    Route::post('/sanitarios', [Nc::class, 'registrarSanitario'])->middleware(['modulo:CAL,C', 'permiso:cal.sanitary.manage']);

    // CAL-11 Reclamos de calidad
    Route::get('/reclamos', [Nc::class, 'reclamos'])->middleware('modulo:CAL');
    Route::get('/reclamos/{id}', [Nc::class, 'reclamo'])->middleware('modulo:CAL')->whereUuid('id');
    Route::post('/reclamos', [Nc::class, 'registrarReclamo'])->middleware(['modulo:CAL,C', 'permiso:cal.inspection.record|cal.claim.resolve']);
    Route::post('/reclamos/{id}/resolver', [Nc::class, 'resolverReclamo'])->middleware(['modulo:CAL,E', 'permiso:cal.claim.resolve'])->whereUuid('id');
});
