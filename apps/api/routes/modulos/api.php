<?php

use App\Modulos\Api\Http\Controllers\ClaveController;
use Illuminate\Support\Facades\Route;

// API · API pública, claves y webhooks: lo que la empresa administra desde la app (la API pública misma vive en /api/v1,
// con autenticación por clave). Con el módulo apagado, «modulo:API» responde 403. Cada límite por minuto lleva su cuenta.
Route::prefix('api')->group(function () {
    $verClaves = 'permiso:api.key.view|api.key.manage';
    $gestionar = 'permiso:api.key.manage';
    $verWebhooks = 'permiso:api.webhook.view_deliveries|api.webhook.manage|api.key.view|api.key.manage';
    $gestionarWebhooks = 'permiso:api.webhook.manage';
    $reenviarWebhooks = 'permiso:api.webhook.resend|api.webhook.manage';
    $verDocs = 'permiso:api.docs.view|api.key.view|api.key.manage';
    $reiniciarSandbox = 'permiso:api.sandbox.reset|api.key.manage';

    // API-01 Claves de API, API-02 Crear clave y API-03 Detalle de clave (RN-API-01 a 04 y 10).
    Route::get('/claves', [ClaveController::class, 'lista'])->middleware(['modulo:API', $verClaves, 'throttle:120,1,apiget-claves']);
    Route::get('/claves/formulario', [ClaveController::class, 'formulario'])->middleware(['modulo:API', $verClaves, 'throttle:60,1,apiget-claves-formulario']);
    Route::get('/claves/clientes', [ClaveController::class, 'clientes'])->middleware(['modulo:API', $verClaves, 'throttle:60,1,apiget-claves-clientes']);
    Route::post('/claves', [ClaveController::class, 'crear'])->middleware(['modulo:API', $gestionar, 'throttle:20,1,apipost-claves']);
    Route::get('/claves/{id}', [ClaveController::class, 'ver'])->middleware(['modulo:API', $verClaves, 'throttle:120,1,apiget-clave'])->whereUuid('id');
    Route::put('/claves/{id}', [ClaveController::class, 'editar'])->middleware(['modulo:API', $gestionar, 'throttle:30,1,apiput-clave'])->whereUuid('id');
    Route::post('/claves/{id}/revocar', [ClaveController::class, 'revocar'])->middleware(['modulo:API', $gestionar, 'throttle:20,1,apipost-clave-revocar'])->whereUuid('id');

    // API-04 Destinos de webhooks y API-05 Crear o editar destino (RN-API-05 a 07 y 12).
    Route::get('/destinos', [ClaveController::class, 'destinos'])->middleware(['modulo:API', $verWebhooks, 'throttle:120,1,apiget-destinos']);
    Route::get('/destinos/formulario', [ClaveController::class, 'formularioDestino'])->middleware(['modulo:API', $verWebhooks, 'throttle:60,1,apiget-destinos-form']);
    Route::post('/destinos/revisar-url', [ClaveController::class, 'revisarUrl'])->middleware(['modulo:API', $verWebhooks, 'throttle:60,1,apipost-destinos-url']);
    Route::post('/destinos', [ClaveController::class, 'crearDestino'])->middleware(['modulo:API', $gestionarWebhooks, 'throttle:30,1,apipost-destinos']);
    Route::get('/destinos/{id}', [ClaveController::class, 'verDestino'])->middleware(['modulo:API', $verWebhooks, 'throttle:120,1,apiget-destino'])->whereUuid('id');
    Route::put('/destinos/{id}', [ClaveController::class, 'editarDestino'])->middleware(['modulo:API', $gestionarWebhooks, 'throttle:30,1,apiput-destino'])->whereUuid('id');
    Route::post('/destinos/{id}/estado', [ClaveController::class, 'estadoDestino'])->middleware(['modulo:API', $gestionarWebhooks, 'throttle:30,1,apipost-destino-estado'])->whereUuid('id');
    Route::post('/destinos/{id}/rotar-secreto', [ClaveController::class, 'rotarSecretoDestino'])->middleware(['modulo:API', $gestionarWebhooks, 'throttle:20,1,apipost-destino-rotar'])->whereUuid('id');
    Route::post('/destinos/{id}/probar', [ClaveController::class, 'probarDestino'])->middleware(['modulo:API', $gestionarWebhooks, 'throttle:30,1,apipost-destino-probar'])->whereUuid('id');

    // API-06 Entregas y API-07 Detalle de entrega (RN-API-07 y 08).
    Route::get('/entregas', [ClaveController::class, 'entregas'])->middleware(['modulo:API', $verWebhooks, 'throttle:120,1,apiget-entregas']);
    Route::post('/entregas/procesar', [ClaveController::class, 'procesarEntregas'])->middleware(['modulo:API', $verWebhooks, 'throttle:30,1,apipost-entregas-procesar']);
    Route::get('/entregas/{id}', [ClaveController::class, 'verEntrega'])->middleware(['modulo:API', $verWebhooks, 'throttle:120,1,apiget-entrega']);
    Route::post('/entregas/{id}/intentar', [ClaveController::class, 'intentarEntrega'])->middleware(['modulo:API', $gestionarWebhooks, 'throttle:30,1,apipost-entrega-intentar'])->whereUuid('id');
    Route::post('/entregas/{id}/reenviar', [ClaveController::class, 'reenviarEntrega'])->middleware(['modulo:API', $reenviarWebhooks, 'throttle:30,1,apipost-entrega-reenviar'])->whereUuid('id');

    // API-08 Documentación y consola de prueba (RN-API-07, 13, 15, 17 y 18).
    Route::get('/documentacion', [ClaveController::class, 'documentacion'])->middleware(['modulo:API', $verDocs, 'throttle:120,1,apiget-docs']);
    Route::get('/openapi.json', [ClaveController::class, 'openapi'])->middleware(['modulo:API', $verDocs, 'throttle:60,1,apiget-openapi']);
    Route::post('/documentacion/firma', [ClaveController::class, 'calcularFirma'])->middleware(['modulo:API', $verDocs, 'throttle:120,1,apipost-firma']);
    Route::post('/consola/probar', [ClaveController::class, 'probarConsola'])->middleware(['modulo:API', $verDocs, 'throttle:120,1,apipost-consola']);

    // API-09 Sandbox (RN-API-16).
    Route::get('/sandbox', [ClaveController::class, 'sandbox'])->middleware(['modulo:API', $verDocs, 'throttle:120,1,apiget-sandbox']);
    Route::post('/sandbox/reiniciar', [ClaveController::class, 'reiniciarSandbox'])->middleware(['modulo:API', $reiniciarSandbox, 'throttle:20,1,apipost-sandbox-reset']);

    // API-10 Uso de la API (RN-API-09): llamadas por día y por clave contra el límite, errores y rechazos.
    Route::get('/uso', [ClaveController::class, 'uso'])->middleware(['modulo:API', $verClaves, 'throttle:60,1,apiget-uso']);

    // API-11 Eventos y alcances (RN-API-17).
    Route::get('/catalogo', [ClaveController::class, 'catalogo'])->middleware(['modulo:API', $verDocs, 'throttle:120,1,apiget-catalogo']);
});
