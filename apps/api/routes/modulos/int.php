<?php

use App\Modulos\Int\Http\Controllers\ConectorController;
use App\Modulos\Int\Http\Controllers\SalienteController;
use Illuminate\Support\Facades\Route;

// INT · Integraciones: conectores y credenciales (INT-01 a INT-03), mensajes salientes y cola muerta (INT-06, INT-07).
Route::prefix('int')->group(function () {
    $conector = 'permiso:int.connector.manage';
    $credencial = 'permiso:int.credential.rotate';

    // INT-01 Conectores e INT-02 Ficha del conector
    Route::get('/conectores', [ConectorController::class, 'index'])->middleware('modulo:INT');
    Route::get('/conectores/{id}', [ConectorController::class, 'show'])->middleware('modulo:INT')->whereUuid('id');
    Route::post('/conectores/{id}/probar', [ConectorController::class, 'probar'])->middleware(['modulo:INT,E', $conector, 'throttle:20,1'])->whereUuid('id');
    Route::post('/conectores/{id}/estado', [ConectorController::class, 'estado'])->middleware(['modulo:INT,E', $conector])->whereUuid('id');
    Route::post('/conectores/{id}/simular-caida', [ConectorController::class, 'simularCaida'])->middleware(['modulo:INT,E', $conector])->whereUuid('id');

    // INT-03 Credenciales (el secreto nunca vuelve: solo sus últimos 4 caracteres)
    Route::get('/credenciales', [ConectorController::class, 'credenciales'])->middleware('modulo:INT');
    Route::post('/credenciales', [ConectorController::class, 'cargarCredencial'])->middleware(['modulo:INT,C', $credencial, 'throttle:20,1']);
    Route::post('/credenciales/{id}/rotar', [ConectorController::class, 'rotarCredencial'])->middleware(['modulo:INT,E', $credencial, 'throttle:20,1'])->whereUuid('id');
    Route::post('/credenciales/{id}/revocar', [ConectorController::class, 'revocarCredencial'])->middleware(['modulo:INT,E', $credencial])->whereUuid('id');

    // INT-06 Mensajes salientes e INT-07 Cola muerta (reintentar o cancelar: int.outbox.retry y motivo)
    $cola = 'permiso:int.outbox.retry';
    Route::get('/salientes', [SalienteController::class, 'index'])->middleware('modulo:INT');
    Route::get('/salientes/eventos', [SalienteController::class, 'eventos'])->middleware('modulo:INT');
    Route::get('/salientes/{id}', [SalienteController::class, 'show'])->middleware('modulo:INT')->whereUuid('id');
    Route::post('/salientes/procesar', [SalienteController::class, 'procesar'])->middleware(['modulo:INT,E', $cola, 'throttle:10,1']);
    Route::post('/salientes/{id}/reintentar', [SalienteController::class, 'reintentar'])->middleware(['modulo:INT,E', $cola, 'throttle:20,1'])->whereUuid('id');
    Route::post('/salientes/{id}/cancelar', [SalienteController::class, 'cancelar'])->middleware(['modulo:INT,E', $cola])->whereUuid('id');
});
