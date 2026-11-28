<?php

use App\Modulos\Api\Http\Controllers\PublicaController;
use Illuminate\Support\Facades\Route;

// API · la API pública v1 que usan los sistemas de los clientes (/api/publica/v1). Sin sesión de la app: cada llamada
// trae su clave (Authorization: Bearer ak_live_…) y el middleware «clave:<alcance>» la revisa, aplica los límites y
// registra el uso. El límite de abajo es solo una red contra abusos por IP; el de verdad es el de cada clave.
Route::prefix('publica/v1')->middleware('throttle:600,1,apipublica-ip')->group(function () {
    Route::get('/orders', [PublicaController::class, 'pedidos'])->middleware('clave:orders:read');
    Route::get('/orders/{number}', [PublicaController::class, 'pedido'])->middleware('clave:orders:read')->where('number', '[A-Za-z0-9\-]{1,30}');
    Route::post('/orders', [PublicaController::class, 'crearPedido'])->middleware('clave:orders:write');
    Route::post('/orders/{number}/documents', [PublicaController::class, 'comprobantePedido'])->middleware('clave:orders:write')->where('number', '[A-Za-z0-9\-]{1,30}');
    Route::get('/customers', [PublicaController::class, 'clientes'])->middleware('clave:customers:read');
    Route::post('/customers', [PublicaController::class, 'crearCliente'])->middleware('clave:customers:write');
    Route::get('/products', [PublicaController::class, 'productos'])->middleware('clave:products:read');
    Route::get('/prices', [PublicaController::class, 'precios'])->middleware('clave:prices:read');
    Route::get('/stock', [PublicaController::class, 'stock'])->middleware('clave:stock:read');
    Route::get('/documents', [PublicaController::class, 'comprobantes'])->middleware('clave:documents:read');
    Route::get('/payments', [PublicaController::class, 'cobros'])->middleware('clave:payments:read');
    Route::get('/deliveries', [PublicaController::class, 'entregas'])->middleware('clave:deliveries:read');
    Route::get('/webhook-endpoints', [PublicaController::class, 'destinosWebhook'])->middleware('clave:webhooks:write');
    Route::post('/webhook-endpoints', [PublicaController::class, 'crearDestinoWebhook'])->middleware('clave:webhooks:write');

    // Una ruta que no existe en la v1 responde con el código de la API, no con la página de error de la app.
    Route::any('/{resto?}', [PublicaController::class, 'noExiste'])->where('resto', '.*');
});
Route::any('/publica/{version}/{resto?}', [PublicaController::class, 'version'])->where(['version' => 'v(?!1$)[0-9]+', 'resto' => '.*'])->middleware('throttle:60,1,apipublica-version');
