<?php

use App\Modulos\Api\Http\Controllers\ClaveController;
use Illuminate\Support\Facades\Route;

// API · API pública, claves y webhooks: lo que la empresa administra desde la app (la API pública misma vive en /api/v1,
// con autenticación por clave). Con el módulo apagado, «modulo:API» responde 403. Cada límite por minuto lleva su cuenta.
Route::prefix('api')->group(function () {
    $verClaves = 'permiso:api.key.view|api.key.manage';
    $gestionar = 'permiso:api.key.manage';

    // API-01 Claves de API, API-02 Crear clave y API-03 Detalle de clave (RN-API-01 a 04 y 10).
    Route::get('/claves', [ClaveController::class, 'lista'])->middleware(['modulo:API', $verClaves, 'throttle:120,1,apiget-claves']);
    Route::get('/claves/formulario', [ClaveController::class, 'formulario'])->middleware(['modulo:API', $gestionar, 'throttle:60,1,apiget-claves-formulario']);
    Route::get('/claves/clientes', [ClaveController::class, 'clientes'])->middleware(['modulo:API', $gestionar, 'throttle:60,1,apiget-claves-clientes']);
    Route::post('/claves', [ClaveController::class, 'crear'])->middleware(['modulo:API', $gestionar, 'throttle:20,1,apipost-claves']);
    Route::get('/claves/{id}', [ClaveController::class, 'ver'])->middleware(['modulo:API', $verClaves, 'throttle:120,1,apiget-clave'])->whereUuid('id');
    Route::put('/claves/{id}', [ClaveController::class, 'editar'])->middleware(['modulo:API', $gestionar, 'throttle:30,1,apiput-clave'])->whereUuid('id');
    Route::post('/claves/{id}/revocar', [ClaveController::class, 'revocar'])->middleware(['modulo:API', $gestionar, 'throttle:20,1,apipost-clave-revocar'])->whereUuid('id');

    // API-10 Uso de la API (RN-API-09): llamadas por día y por clave contra el límite, errores y rechazos.
    Route::get('/uso', [ClaveController::class, 'uso'])->middleware(['modulo:API', $verClaves, 'throttle:60,1,apiget-uso']);

    // API-11 Eventos y alcances (RN-API-17).
    Route::get('/catalogo', [ClaveController::class, 'catalogo'])->middleware(['modulo:API', 'permiso:api.docs.view|api.key.view|api.key.manage', 'throttle:120,1,apiget-catalogo']);
});
