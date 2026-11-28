<?php

use App\Modulos\Web\Http\Controllers\BandejaController;
use App\Modulos\Web\Http\Controllers\EventoController;
use App\Modulos\Web\Http\Controllers\MapeoController;
use App\Modulos\Web\Http\Controllers\PagoController;
use App\Modulos\Web\Http\Controllers\SincronizacionController;
use App\Modulos\Web\Http\Controllers\TiendaController;
use Illuminate\Support\Facades\Route;

// WEB · Tienda WooCommerce y pasarela Mercado Pago (WEB-01 a WEB-08). Reglas en app/Modulos/Web/Services.
// Los webhooks entran por el receptor público de INT (/api/hooks/{token}); WEB instala sus procesadores.
Route::prefix('web')->group(function () {
    // WEB-01 Tiendas
    Route::get('/tiendas', [TiendaController::class, 'index'])->middleware('modulo:WEB');
    Route::get('/tiendas/opciones', [TiendaController::class, 'opciones'])->middleware(['modulo:WEB', 'permiso:web.store.manage']);
    Route::get('/tiendas/{id}', [TiendaController::class, 'show'])->middleware('modulo:WEB')->whereUuid('id');
    Route::post('/tiendas', [TiendaController::class, 'store'])->middleware(['modulo:WEB', 'permiso:web.store.manage']);
    Route::put('/tiendas/{id}', [TiendaController::class, 'update'])->middleware(['modulo:WEB', 'permiso:web.store.manage'])->whereUuid('id');
    Route::post('/tiendas/{id}/probar', [TiendaController::class, 'probar'])->middleware(['modulo:WEB', 'permiso:web.store.manage', 'throttle:20,1'])->whereUuid('id');
    Route::post('/tiendas/{id}/estado', [TiendaController::class, 'estado'])->middleware(['modulo:WEB', 'permiso:web.store.manage'])->whereUuid('id');

    // WEB-02 Mapeo de productos
    Route::get('/mapeos', [MapeoController::class, 'index'])->middleware('modulo:WEB');
    Route::get('/mapeos/variantes', [MapeoController::class, 'variantes'])->middleware(['modulo:WEB', 'permiso:web.mapping.manage']);
    Route::get('/mapeos/{id}', [MapeoController::class, 'show'])->middleware('modulo:WEB')->whereUuid('id');
    Route::post('/mapeos', [MapeoController::class, 'vincular'])->middleware(['modulo:WEB', 'permiso:web.mapping.manage']);
    Route::post('/mapeos/crear', [MapeoController::class, 'crear'])->middleware(['modulo:WEB', 'permiso:web.mapping.manage', 'throttle:30,1']);
    Route::post('/mapeos/{id}/desvincular', [MapeoController::class, 'desvincular'])->middleware(['modulo:WEB', 'permiso:web.mapping.manage'])->whereUuid('id');
    Route::post('/mapeos/{id}/publicar', [MapeoController::class, 'publicar'])->middleware(['modulo:WEB', 'permiso:web.mapping.manage'])->whereUuid('id');

    // WEB-03 Sincronización
    Route::get('/sincronizacion', [SincronizacionController::class, 'index'])->middleware('modulo:WEB');
    Route::get('/sincronizacion/{id}', [SincronizacionController::class, 'show'])->middleware('modulo:WEB')->whereUuid('id');
    Route::post('/sincronizacion', [SincronizacionController::class, 'correr'])->middleware(['modulo:WEB', 'permiso:web.sync.run', 'throttle:20,1']);

    // WEB-04 Bandeja de pedidos web y WEB-05 Resolver error
    Route::get('/bandeja', [BandejaController::class, 'index'])->middleware('modulo:WEB');
    Route::get('/bandeja/ejemplo', [BandejaController::class, 'ejemplo'])->middleware(['modulo:WEB', 'permiso:web.sync.run']);
    Route::post('/bandeja/simular', [BandejaController::class, 'simular'])->middleware(['modulo:WEB', 'permiso:web.sync.run', 'throttle:30,1']);
    Route::get('/bandeja/{id}', [BandejaController::class, 'show'])->middleware('modulo:WEB')->whereUuid('id');
    Route::post('/bandeja/{id}/reprocesar', [BandejaController::class, 'reprocesar'])->middleware(['modulo:WEB', 'permiso:web.inbox.resolve', 'throttle:30,1'])->whereUuid('id');
    Route::post('/bandeja/{id}/ignorar', [BandejaController::class, 'ignorar'])->middleware(['modulo:WEB', 'permiso:web.inbox.resolve'])->whereUuid('id');
    Route::post('/bandeja/{id}/celular', [BandejaController::class, 'celular'])->middleware(['modulo:WEB', 'permiso:web.inbox.resolve'])->whereUuid('id');
    Route::post('/bandeja/{id}/pin', [BandejaController::class, 'pin'])->middleware(['modulo:WEB', 'throttle:30,1'])->whereUuid('id');
    Route::post('/bandeja/{id}/ubicacion', [BandejaController::class, 'ubicacion'])->middleware(['modulo:WEB', 'throttle:30,1'])->whereUuid('id');
    Route::post('/bandeja/{id}/enlace', [BandejaController::class, 'enlace'])->middleware(['modulo:WEB', 'throttle:20,1'])->whereUuid('id');

    // WEB-06 Pagos de la pasarela
    Route::get('/pagos', [PagoController::class, 'index'])->middleware('modulo:WEB');
    Route::post('/pagos/simular', [PagoController::class, 'simular'])->middleware(['modulo:WEB', 'permiso:web.sync.run', 'throttle:30,1']);
    Route::get('/pagos/{id}', [PagoController::class, 'show'])->middleware('modulo:WEB')->whereUuid('id');
    Route::post('/pagos/{id}/cobro', [PagoController::class, 'cobrar'])->middleware(['modulo:WEB', 'throttle:30,1'])->whereUuid('id');
    Route::post('/pagos/{id}/avisar', [PagoController::class, 'avisar'])->middleware(['modulo:WEB', 'throttle:30,1'])->whereUuid('id');

    // WEB-07 Eventos webhook
    Route::get('/eventos', [EventoController::class, 'index'])->middleware('modulo:WEB');
    Route::get('/eventos/{id}', [EventoController::class, 'show'])->middleware('modulo:WEB')->whereUuid('id');
    Route::post('/eventos/{id}/reprocesar', [EventoController::class, 'reprocesar'])->middleware(['modulo:WEB', 'permiso:int.webhook.reprocess', 'throttle:20,1'])->whereUuid('id');

    // WEB-08 Stock publicado
    Route::get('/stock', [MapeoController::class, 'stock'])->middleware('modulo:WEB');
    Route::get('/stock/{id}', [MapeoController::class, 'stockDe'])->middleware('modulo:WEB')->whereUuid('id');
});
