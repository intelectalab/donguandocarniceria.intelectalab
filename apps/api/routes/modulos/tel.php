<?php

use App\Modulos\Tel\Http\Controllers\AjustesController;
use App\Modulos\Tel\Http\Controllers\CentralController;
use App\Modulos\Tel\Http\Controllers\LlamadaController;
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

    // TEL-03 Números y desvíos.
    Route::get('/numeros', [CentralController::class, 'numeros'])->middleware(['modulo:TEL', $ver, 'throttle:60,1,telget-numeros']);
    Route::post('/numeros', [CentralController::class, 'guardarNumero'])->middleware(['modulo:TEL', $gestionar, 'throttle:30,1,telpost-numeros']);
    Route::put('/numeros/{id}', [CentralController::class, 'guardarNumero'])->middleware(['modulo:TEL', $gestionar, 'throttle:30,1,telput-numeros'])->whereUuid('id');

    // TEL-04 Menú de voz y horario.
    Route::get('/menu', [CentralController::class, 'menu'])->middleware(['modulo:TEL', $ver, 'throttle:60,1,telget-menu']);
    Route::put('/menu', [CentralController::class, 'guardarMenu'])->middleware(['modulo:TEL', $gestionar, 'throttle:20,1,telput-menu']);

    // TEL-05 Grupos de llamada (RN-TEL-06).
    Route::get('/grupos', [CentralController::class, 'grupos'])->middleware(['modulo:TEL', $ver, 'throttle:60,1,telget-grupos']);
    Route::post('/grupos', [CentralController::class, 'guardarGrupo'])->middleware(['modulo:TEL', $gestionar, 'throttle:20,1,telpost-grupos']);
    Route::put('/grupos/{id}', [CentralController::class, 'guardarGrupo'])->middleware(['modulo:TEL', $gestionar, 'throttle:30,1,telput-grupos'])->whereUuid('id');
    Route::get('/grupos/{id}/candidatos', [CentralController::class, 'candidatos'])->middleware(['modulo:TEL', $gestionar, 'throttle:60,1,telget-grupos-candidatos'])->whereUuid('id');
    Route::post('/grupos/{id}/miembros', [CentralController::class, 'agregarMiembro'])->middleware(['modulo:TEL', $gestionar, 'throttle:30,1,telpost-grupos-miembros'])->whereUuid('id');
    Route::put('/miembros/{id}', [CentralController::class, 'cambiarMiembro'])->middleware(['modulo:TEL', $gestionar, 'throttle:60,1,telput-miembros'])->whereUuid('id');

    // TEL-06 Teléfono en la app y TEL-07 Llamar desde la ficha o el pedido (RN-TEL-04 a 08). El simulador, solo fuera de producción.
    $llama = 'permiso:tel.call.make';
    $verLlamadas = 'permiso:tel.call.view_own|tel.call.view_all';
    Route::get('/telefono', [LlamadaController::class, 'telefono'])->middleware(['modulo:TEL', 'permiso:tel.call.make|tel.call.view_all', 'throttle:120,1,telget-telefono']);
    Route::post('/telefono/simular', [LlamadaController::class, 'simular'])->middleware(['modulo:TEL', $llama, 'throttle:30,1,telpost-telefono-simular']);
    Route::get('/llamar/destino', [LlamadaController::class, 'destino'])->middleware(['modulo:TEL', $llama, 'throttle:120,1,telget-llamar-destino']);
    Route::post('/llamadas', [LlamadaController::class, 'llamar'])->middleware(['modulo:TEL', $llama, 'throttle:20,1,telpost-llamadas']);
    Route::post('/llamadas/{id}/resultado', [LlamadaController::class, 'resultado'])->middleware(['modulo:TEL', 'permiso:tel.call.make|tel.call.view_all', 'throttle:30,1,telpost-llamadas-resultado'])->whereUuid('id');
    Route::get('/llamadas/{id}', [LlamadaController::class, 'ver'])->middleware(['modulo:TEL', $verLlamadas, 'throttle:120,1,telget-llamada'])->whereUuid('id');
    Route::get('/salientes', [LlamadaController::class, 'salientes'])->middleware(['modulo:TEL', $verLlamadas, 'throttle:60,1,telget-salientes']);
    Route::get('/pedidos', [LlamadaController::class, 'pedidos'])->middleware(['modulo:TEL', $llama, 'throttle:60,1,telget-pedidos']);
});
