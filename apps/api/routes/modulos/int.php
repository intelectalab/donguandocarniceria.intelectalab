<?php

use App\Modulos\Int\Http\Controllers\ConectorController;
use Illuminate\Support\Facades\Route;

// INT · Integraciones. Tanda 1: conectores y credenciales (INT-01 a INT-03).
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
});
