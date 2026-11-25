<?php

use App\Modulos\Int\Http\Controllers\AvisoArchivoController;
use App\Modulos\Int\Http\Controllers\ConectorController;
use App\Modulos\Int\Http\Controllers\OperacionIntController;
use App\Modulos\Int\Http\Controllers\SalienteController;
use App\Modulos\Int\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

// INT · Integraciones: conectores y credenciales (INT-01 a INT-03), webhooks (INT-04, INT-05), mensajes salientes y cola muerta (INT-06, INT-07),
// corridas (INT-08), notificaciones, preferencias y archivos (INT-09 a INT-11), salud (INT-12) y simulador (INT-13).
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

    // INT-04 Webhooks de entrada e INT-05 Bitácora (el receptor público está en routes/api.php: /api/hooks/{token})
    Route::get('/webhooks', [WebhookController::class, 'endpoints'])->middleware('modulo:INT');
    Route::post('/webhooks/{id}/regenerar', [WebhookController::class, 'regenerar'])->middleware(['modulo:INT,E', $conector, 'throttle:10,1'])->whereUuid('id');
    Route::post('/webhooks/{id}/secreto', [WebhookController::class, 'secreto'])->middleware(['modulo:INT,E', $credencial, 'throttle:20,1'])->whereUuid('id');
    Route::get('/webhooks/eventos', [WebhookController::class, 'eventos'])->middleware('modulo:INT');
    Route::get('/webhooks/eventos/{id}', [WebhookController::class, 'evento'])->middleware('modulo:INT')->whereUuid('id');
    Route::post('/webhooks/eventos/{id}/reprocesar', [WebhookController::class, 'reprocesar'])->middleware(['modulo:INT,E', 'permiso:int.webhook.reprocess', 'throttle:20,1'])->whereUuid('id');

    // INT-08 Corridas programadas, INT-12 Salud de integraciones e INT-13 Simulador (solo contra conectores de prueba)
    Route::get('/corridas', [OperacionIntController::class, 'corridas'])->middleware('modulo:INT');
    Route::post('/corridas', [OperacionIntController::class, 'ejecutar'])->middleware(['modulo:INT,E', $conector, 'throttle:10,1']);
    Route::get('/salud', [OperacionIntController::class, 'salud'])->middleware('modulo:INT');
    Route::get('/simulador', [OperacionIntController::class, 'simulador'])->middleware('modulo:INT');
    Route::post('/simulador', [OperacionIntController::class, 'simular'])->middleware(['modulo:INT,E', 'permiso:int.simulator.use', 'throttle:20,1']);

    // INT-09 Centro de notificaciones e INT-10 Preferencias: cada persona las suyas (el servicio revisa quién ve todas)
    Route::get('/notificaciones', [AvisoArchivoController::class, 'notificaciones'])->middleware('modulo:INT');
    Route::post('/notificaciones/leer-todas', [AvisoArchivoController::class, 'marcarTodas'])->middleware('modulo:INT');
    Route::post('/notificaciones/{id}/leida', [AvisoArchivoController::class, 'marcar'])->middleware('modulo:INT')->whereUuid('id');
    Route::get('/preferencias', [AvisoArchivoController::class, 'preferencias'])->middleware('modulo:INT');
    Route::put('/preferencias', [AvisoArchivoController::class, 'guardarPreferencia'])->middleware(['modulo:INT', 'throttle:60,1']);

    // INT-11 Archivos adjuntos (la descarga va por un enlace firmado y temporal: routes/api.php)
    Route::get('/archivos', [AvisoArchivoController::class, 'archivos'])->middleware('modulo:INT');
    Route::get('/archivos/registros', [AvisoArchivoController::class, 'registros'])->middleware('modulo:INT');
    Route::post('/archivos', [AvisoArchivoController::class, 'subir'])->middleware(['modulo:INT,C', 'permiso:int.file.upload', 'throttle:30,1']);
    Route::post('/archivos/{id}/enlace', [AvisoArchivoController::class, 'enlace'])->middleware(['modulo:INT', 'throttle:60,1'])->whereUuid('id');
    Route::post('/archivos/{id}/eliminar', [AvisoArchivoController::class, 'eliminar'])->middleware(['modulo:INT,E', 'permiso:int.file.delete'])->whereUuid('id');
});
