<?php

use App\Modulos\Tel\Http\Controllers\AjustesController;
use Illuminate\Support\Facades\Route;

// TEL · Telefonía con grabación (incluida y apagada). Con el módulo apagado, «modulo:TEL» responde 403 con RN-PLT-07
// en todas las rutas, y la base rechaza escribir en las tablas tel_* (guardia tel_guard). Cada límite por minuto lleva
// su propia cuenta (tercer parámetro).
Route::prefix('tel')->group(function () {
    $ver = 'permiso:tel.settings.manage|tel.call.view_all';
    $gestionar = 'permiso:tel.settings.manage';

    // TEL-01 Lista de activación (RN-TEL-02): la lista se llena en Módulos activables; aquí se pasa a en vivo.
    Route::get('/activacion', [AjustesController::class, 'activacion'])->middleware(['modulo:TEL', $ver, 'throttle:60,1,telget-activacion']);
    Route::post('/activacion/pasos/{codigo}', [AjustesController::class, 'marcarPaso'])->middleware(['modulo:TEL', $gestionar, 'throttle:30,1,telpost-activacion-pasos'])->where('codigo', '[A-Z_]{3,30}');
    Route::post('/activacion/en-vivo', [AjustesController::class, 'enVivo'])->middleware(['modulo:TEL', $gestionar, 'throttle:10,1,telpost-activacion-en-vivo']);
    Route::post('/activacion/configuracion', [AjustesController::class, 'aConfiguracion'])->middleware(['modulo:TEL', $gestionar, 'throttle:10,1,telpost-activacion-configuracion']);

    // TEL-02 Ajustes (RN-TEL-03, 04, 06, 07, 10).
    Route::get('/ajustes', [AjustesController::class, 'ver'])->middleware(['modulo:TEL', $ver, 'throttle:60,1,telget-ajustes']);
    Route::put('/ajustes', [AjustesController::class, 'guardar'])->middleware(['modulo:TEL', $gestionar, 'throttle:20,1,telput-ajustes']);
    Route::post('/ajustes/audio', [AjustesController::class, 'subirAudio'])->middleware(['modulo:TEL', $gestionar, 'throttle:10,1,telpost-ajustes-audio']);
    Route::get('/ajustes/audio', [AjustesController::class, 'enlaceAudio'])->middleware(['modulo:TEL', $ver, 'throttle:30,1,telget-ajustes-audio']);
});
