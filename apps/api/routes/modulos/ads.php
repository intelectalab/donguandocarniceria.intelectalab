<?php

use App\Modulos\Ads\Http\Controllers\PublicidadController;
use Illuminate\Support\Facades\Route;

// ADS · Publicidad y atribución (ADS-01 a ADS-09; RN-ADS-01 a 12).
Route::prefix('ads')->group(function () {
    // ADS-01 Cuentas publicitarias
    Route::get('/cuentas', [PublicidadController::class, 'cuentas'])->middleware(['modulo:ADS', 'throttle:120,1,adsget-cuentas']);
    Route::post('/cuentas', [PublicidadController::class, 'conectarCuenta'])->middleware(['modulo:ADS', 'permiso:ads.account.manage', 'throttle:20,1,adspost-cuentas']);
    Route::get('/cuentas/{id}', [PublicidadController::class, 'verCuenta'])->middleware(['modulo:ADS', 'throttle:120,1,adsget-cuenta'])->whereUuid('id');
    Route::post('/cuentas/{id}/estado', [PublicidadController::class, 'estadoCuenta'])->middleware(['modulo:ADS', 'permiso:ads.account.manage', 'throttle:30,1,adspost-cuenta-estado'])->whereUuid('id');

    // ADS-02 Campañas y anuncios y ADS-03 Enlaces de rastreo
    Route::get('/anuncios', [PublicidadController::class, 'anuncios'])->middleware(['modulo:ADS', 'throttle:120,1,adsget-anuncios']);
    Route::put('/anuncios/{id}/rastreo', [PublicidadController::class, 'guardarRastreo'])->middleware(['modulo:ADS', 'permiso:ads.account.manage', 'throttle:60,1,adsput-rastreo'])->whereUuid('id');

    // ADS-04 Importaciones
    Route::get('/importaciones', [PublicidadController::class, 'importaciones'])->middleware(['modulo:ADS', 'throttle:120,1,adsget-importaciones']);
    Route::post('/importaciones/reimportar', [PublicidadController::class, 'reimportar'])->middleware(['modulo:ADS', 'permiso:ads.account.manage', 'throttle:20,1,adspost-reimportar']);
    Route::post('/importaciones/diaria', [PublicidadController::class, 'correrImportacionDiaria'])->middleware(['modulo:ADS', 'permiso:ads.account.manage', 'throttle:10,1,adspost-diaria']);

    // ADS-05 Resultados por anuncio
    Route::get('/resultados', [PublicidadController::class, 'resultados'])->middleware(['modulo:ADS', 'permiso:ads.result.view|ads.account.manage', 'throttle:120,1,adsget-resultados']);
    Route::get('/resultados/pedidos', [PublicidadController::class, 'pedidosDeResultado'])->middleware(['modulo:ADS', 'permiso:ads.result.view|ads.account.manage', 'throttle:120,1,adsget-res-pedidos']);

    // ADS-06 Embudo de atribución
    Route::get('/embudo', [PublicidadController::class, 'embudo'])->middleware(['modulo:ADS', 'throttle:120,1,adsget-embudo']);
    Route::post('/embudo/pedidos/{orderId}/corregir', [PublicidadController::class, 'corregirAtribucion'])->middleware(['modulo:ADS', 'permiso:ads.attribution.correct', 'throttle:30,1,adspost-corregir'])->whereUuid('orderId');

    // ADS-07 Facturas de plataformas (la contadora concilia con ads.invoice.reconcile sin el resto de ADS)
    Route::get('/facturas', [PublicidadController::class, 'facturas'])->middleware(['permiso:ads.invoice.reconcile|ads.account.manage|ads.result.view', 'throttle:120,1,adsget-facturas']);
    Route::post('/facturas', [PublicidadController::class, 'registrarFactura'])->middleware(['permiso:ads.invoice.reconcile', 'throttle:20,1,adspost-facturas']);
    Route::post('/facturas/{id}/conciliar', [PublicidadController::class, 'conciliarFactura'])->middleware(['permiso:ads.invoice.reconcile', 'throttle:30,1,adspost-conciliar'])->whereUuid('id');
    Route::post('/facturas/{id}/enviar-gas', [PublicidadController::class, 'enviarFacturaAGas'])->middleware(['permiso:ads.invoice.reconcile', 'throttle:20,1,adspost-enviar-gas'])->whereUuid('id');

    // ADS-08 Creadores de contenido
    Route::get('/creadores', [PublicidadController::class, 'creadores'])->middleware(['modulo:ADS', 'throttle:120,1,adsget-creadores']);
    Route::post('/creadores', [PublicidadController::class, 'registrarGastoCreador'])->middleware(['modulo:ADS', 'throttle:20,1,adspost-creadores']);

    // ADS-09 Comparativo de plataformas
    Route::get('/comparativo', [PublicidadController::class, 'comparativo'])->middleware(['modulo:ADS', 'permiso:ads.result.view|ads.account.manage', 'throttle:120,1,adsget-comparativo']);
});
