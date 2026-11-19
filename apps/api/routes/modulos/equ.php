<?php

use App\Modulos\Equ\Http\Controllers\CalibracionController;
use App\Modulos\Equ\Http\Controllers\EquipoController;
use App\Modulos\Equ\Http\Controllers\OrdenController;
use App\Modulos\Equ\Http\Controllers\PlanController;
use App\Modulos\Equ\Http\Controllers\UsoController;
use Illuminate\Support\Facades\Route;

// EQU · Equipos, calibración y mantenimiento. Reglas en app/Modulos/Equ/Services/EquiposService.php.
// Equipos y carga por hora: equ.equipment.manage. Calibraciones: equ.calibration.record. Órdenes: equ.maintenance.manage.
// Reportar fallas: equ.failure.report o equ.maintenance.manage (el jefe también abre correctivas).
// Horas de uso y lecturas de horómetro: equ.usage.record.
Route::prefix('equ')->group(function () {
    Route::get('/opciones', [EquipoController::class, 'opciones'])->middleware('modulo:EQU');
    Route::get('/cifras/{pantalla}', [EquipoController::class, 'cifras'])->middleware('modulo:EQU')->where('pantalla', '\d{2}');

    // EQU-01 Equipos y EQU-02 Ficha
    Route::get('/equipos', [EquipoController::class, 'index'])->middleware('modulo:EQU');
    Route::get('/equipos/codigo', [EquipoController::class, 'porCodigo'])->middleware('modulo:EQU');
    Route::get('/equipos/{id}', [EquipoController::class, 'show'])->middleware('modulo:EQU')->whereUuid('id');
    Route::get('/equipos/{id}/apto', [EquipoController::class, 'apto'])->middleware('modulo:EQU')->whereUuid('id');
    Route::post('/equipos', [EquipoController::class, 'store'])->middleware(['modulo:EQU,C', 'permiso:equ.equipment.manage']);
    Route::put('/equipos/{id}', [EquipoController::class, 'update'])->middleware(['modulo:EQU,E', 'permiso:equ.equipment.manage'])->whereUuid('id');
    Route::put('/equipos/{id}/carga', [EquipoController::class, 'carga'])->middleware(['modulo:EQU,E', 'permiso:equ.equipment.manage'])->whereUuid('id');

    // EQU-03 Calibraciones (solo inserción) y EQU-04 Calendario
    Route::get('/calibraciones', [CalibracionController::class, 'index'])->middleware('modulo:EQU');
    Route::post('/calibraciones', [CalibracionController::class, 'store'])->middleware(['modulo:EQU,C', 'permiso:equ.calibration.record']);
    Route::get('/calendario', [CalibracionController::class, 'calendario'])->middleware('modulo:EQU');

    // EQU-05 Planes preventivos
    Route::get('/planes', [PlanController::class, 'index'])->middleware('modulo:EQU');
    Route::post('/planes', [PlanController::class, 'store'])->middleware(['modulo:EQU,C', 'permiso:equ.maintenance.manage']);
    Route::put('/planes/{id}', [PlanController::class, 'update'])->middleware(['modulo:EQU,E', 'permiso:equ.maintenance.manage'])->whereUuid('id');
    Route::post('/planes/generar', [PlanController::class, 'generar'])->middleware(['modulo:EQU,C', 'permiso:equ.maintenance.manage', 'throttle:10,1']);

    // EQU-06 Órdenes de mantenimiento y EQU-07 Reporte de falla
    Route::get('/ordenes', [OrdenController::class, 'index'])->middleware('modulo:EQU');
    Route::get('/ordenes/{id}', [OrdenController::class, 'show'])->middleware('modulo:EQU')->whereUuid('id');
    Route::post('/ordenes', [OrdenController::class, 'store'])->middleware(['modulo:EQU,C', 'permiso:equ.maintenance.manage|equ.failure.report']);
    Route::post('/ordenes/{id}/iniciar', [OrdenController::class, 'iniciar'])->middleware(['modulo:EQU,E', 'permiso:equ.maintenance.manage'])->whereUuid('id');
    Route::post('/ordenes/{id}/terminar', [OrdenController::class, 'terminar'])->middleware(['modulo:EQU,E', 'permiso:equ.maintenance.manage'])->whereUuid('id');
    Route::post('/ordenes/{id}/anular', [OrdenController::class, 'anular'])->middleware(['modulo:EQU,A', 'permiso:equ.maintenance.manage'])->whereUuid('id');
    Route::post('/fallas', [OrdenController::class, 'falla'])->middleware(['modulo:EQU,C', 'permiso:equ.failure.report|equ.maintenance.manage', 'throttle:30,1']);

    // EQU-08 Uso del equipo (PRO registrará sus horas con EquiposService::registrarUso)
    Route::get('/uso', [UsoController::class, 'index'])->middleware('modulo:EQU');
    Route::get('/uso/por-equipo', [UsoController::class, 'porEquipo'])->middleware('modulo:EQU');
    Route::post('/uso', [UsoController::class, 'store'])->middleware(['modulo:EQU,C', 'permiso:equ.usage.record']);
    Route::post('/equipos/{id}/horometro', [UsoController::class, 'lectura'])->middleware(['modulo:EQU,C', 'permiso:equ.usage.record'])->whereUuid('id');

    // EQU-09 Tablero de equipos
    Route::get('/tablero', [UsoController::class, 'tablero'])->middleware('modulo:EQU');
});
