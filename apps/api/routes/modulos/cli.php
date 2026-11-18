<?php

use App\Modulos\Cli\Http\Controllers\ClienteController;
use App\Modulos\Cli\Http\Controllers\DireccionController;
use App\Modulos\Cli\Http\Controllers\DocumentoController;
use App\Modulos\Cli\Http\Controllers\DuplicadoController;
use App\Modulos\Cli\Http\Controllers\EnlaceController;
use App\Modulos\Cli\Http\Controllers\ImportacionController;
use App\Modulos\Cli\Http\Controllers\ZonaController;
use Illuminate\Support\Facades\Route;

// CLI · Clientes, direcciones con pin y zonas de reparto. El enlace que abre el cliente sin sesión
// está en routes/api.php (v1/publico/ubicacion).
Route::prefix('cli')->group(function () {
    $manage = 'permiso:cli.customer.manage';

    // CLI-01 Clientes
    Route::get('/clientes', [ClienteController::class, 'index'])->middleware('modulo:CLI');
    Route::get('/clientes/resumen', [ClienteController::class, 'resumen'])->middleware('modulo:CLI');
    Route::get('/clientes/exportar', [ClienteController::class, 'exportar'])->middleware(['modulo:CLI', 'permiso:cli.customer.export', 'throttle:10,1']);

    // CLI-03 Alta rápida
    Route::get('/clientes/celular', [ClienteController::class, 'celular'])->middleware('modulo:CLI');
    Route::get('/clientes/recientes', [ClienteController::class, 'recientes'])->middleware('modulo:CLI');
    Route::post('/clientes/rapida', [ClienteController::class, 'rapida'])->middleware(['modulo:CLI,C', $manage]);

    // CLI-02 Ficha del cliente
    Route::get('/clientes/{id}', [ClienteController::class, 'show'])->middleware('modulo:CLI')->whereUuid('id');
    Route::get('/clientes/{id}/pedidos', [ClienteController::class, 'pedidos'])->middleware('modulo:CLI')->whereUuid('id');
    Route::get('/clientes/{id}/comprobantes', [ClienteController::class, 'comprobantes'])->middleware('modulo:CLI')->whereUuid('id');
    Route::post('/clientes', [ClienteController::class, 'store'])->middleware(['modulo:CLI,C', $manage]);
    Route::put('/clientes/{id}', [ClienteController::class, 'update'])->middleware(['modulo:CLI,E', $manage])->whereUuid('id');
    Route::post('/clientes/{id}/consentimiento', [ClienteController::class, 'consentimiento'])->middleware(['modulo:CLI,E', $manage])->whereUuid('id');
    Route::post('/clientes/{id}/bloquear', [ClienteController::class, 'bloquear'])->middleware(['modulo:CLI,E', 'permiso:cli.customer.block'])->whereUuid('id');
    Route::post('/clientes/{id}/desbloquear', [ClienteController::class, 'desbloquear'])->middleware(['modulo:CLI,E', 'permiso:cli.customer.block'])->whereUuid('id');

    // CLI-04 Validar documento (el permiso depende de si es manual: lo revisa el controlador)
    Route::post('/documentos/consultar', [DocumentoController::class, 'consultar'])->middleware(['modulo:CLI', 'throttle:30,1']);
    Route::get('/documentos/pendientes', [DocumentoController::class, 'pendientes'])->middleware('modulo:CLI');
    Route::post('/clientes/{id}/documento', [DocumentoController::class, 'validar'])->middleware('modulo:CLI,E')->whereUuid('id');

    // CLI-05 Direcciones y CLI-06 Mapa de la dirección
    Route::get('/clientes/{id}/direcciones', [DireccionController::class, 'index'])->middleware('modulo:CLI')->whereUuid('id');
    Route::post('/clientes/{id}/direcciones', [DireccionController::class, 'store'])->middleware(['modulo:CLI,C', $manage])->whereUuid('id');
    Route::get('/direcciones/revisar', [DireccionController::class, 'revisar'])->middleware('modulo:CLI');
    Route::get('/direcciones/{id}', [DireccionController::class, 'show'])->middleware('modulo:CLI')->whereUuid('id');
    Route::put('/direcciones/{id}', [DireccionController::class, 'update'])->middleware(['modulo:CLI,E', $manage])->whereUuid('id');
    Route::post('/direcciones/{id}/predeterminar', [DireccionController::class, 'predeterminar'])->middleware(['modulo:CLI,E', $manage])->whereUuid('id');
    Route::post('/direcciones/{id}/desactivar', [DireccionController::class, 'desactivar'])->middleware(['modulo:CLI,E', $manage])->whereUuid('id');
    Route::get('/geocodificar', [DireccionController::class, 'geocodificar'])->middleware(['modulo:CLI', 'throttle:60,1']);
    Route::get('/zona-del-pin', [DireccionController::class, 'zona'])->middleware('modulo:CLI');
    Route::get('/distritos', [DireccionController::class, 'distritos'])->middleware('modulo:CLI');

    // CLI-07 Enlace de ubicación
    Route::get('/enlaces', [EnlaceController::class, 'index'])->middleware('modulo:CLI');
    Route::post('/clientes/{id}/enlace', [EnlaceController::class, 'store'])->middleware(['modulo:CLI,C', $manage])->whereUuid('id');
    Route::post('/enlaces/{id}/anular', [EnlaceController::class, 'anular'])->middleware(['modulo:CLI,E', $manage])->whereUuid('id');

    // CLI-08 Zonas de reparto y CLI-09 Simulador
    Route::get('/zonas', [ZonaController::class, 'index'])->middleware('modulo:CLI');
    Route::post('/zonas', [ZonaController::class, 'store'])->middleware(['modulo:CLI,E', 'permiso:cli.zone.manage']);
    Route::put('/zonas/{id}', [ZonaController::class, 'update'])->middleware(['modulo:CLI,E', 'permiso:cli.zone.manage'])->whereUuid('id');
    Route::post('/simulador', [ZonaController::class, 'simular'])->middleware('modulo:CLI');
    Route::get('/simulador/variantes', [ZonaController::class, 'variantes'])->middleware('modulo:CLI');

    // CLI-10 Duplicados y CLI-11 Fusión
    Route::get('/duplicados', [DuplicadoController::class, 'index'])->middleware('modulo:CLI');
    Route::get('/duplicados/resumen', [DuplicadoController::class, 'resumen'])->middleware('modulo:CLI');
    Route::post('/duplicados/buscar', [DuplicadoController::class, 'buscar'])->middleware(['modulo:CLI,E', 'permiso:cli.customer.merge']);
    Route::post('/duplicados/{id}/descartar', [DuplicadoController::class, 'descartar'])->middleware(['modulo:CLI,E', 'permiso:cli.customer.merge'])->whereUuid('id');
    Route::get('/fusion', [DuplicadoController::class, 'vista'])->middleware('modulo:CLI');
    Route::post('/fusion', [DuplicadoController::class, 'fusionar'])->middleware(['modulo:CLI,E', 'permiso:cli.customer.merge']);
    Route::get('/fusiones', [DuplicadoController::class, 'fusiones'])->middleware('modulo:CLI');

    // CLI-12 Importar clientes
    Route::get('/importar/plantilla', [ImportacionController::class, 'plantilla'])->middleware(['modulo:CLI,C', $manage, 'throttle:20,1']);
    Route::post('/importar/archivo', [ImportacionController::class, 'leerArchivo'])->middleware(['modulo:CLI,C', $manage, 'throttle:20,1']);
    Route::post('/importar/revisar', [ImportacionController::class, 'revisar'])->middleware(['modulo:CLI,C', $manage, 'throttle:20,1']);
    Route::post('/importar', [ImportacionController::class, 'importar'])->middleware(['modulo:CLI,C', $manage, 'throttle:10,1']);
});
