<?php

use App\Modulos\Fac\Http\Controllers\ColaController;
use App\Modulos\Fac\Http\Controllers\ComprobanteController;
use App\Modulos\Fac\Http\Controllers\ConfigController;
use App\Modulos\Fac\Http\Controllers\EmisionController;
use App\Modulos\Fac\Http\Controllers\GuiaController;
use Illuminate\Support\Facades\Route;

// FAC · Comprobantes electrónicos y guía de remisión (FAC-01 a FAC-12). Reglas en app/Modulos/Fac/Services.
Route::prefix('fac')->group(function () {
    // FAC-01 Comprobantes y FAC-04 Detalle
    Route::get('/comprobantes', [ComprobanteController::class, 'index'])->middleware('modulo:FAC');
    Route::get('/comprobantes/resumen', [ComprobanteController::class, 'resumen'])->middleware('modulo:FAC');
    Route::get('/comprobantes/exportar', [ComprobanteController::class, 'exportar'])->middleware(['modulo:FAC', 'throttle:10,1']);
    Route::get('/comprobantes/{id}', [ComprobanteController::class, 'show'])->middleware('modulo:FAC')->whereUuid('id');
    Route::get('/comprobantes/{id}/xml', [ComprobanteController::class, 'xml'])->middleware(['modulo:FAC', 'throttle:60,1'])->whereUuid('id');
    Route::get('/comprobantes/{id}/cdr', [ComprobanteController::class, 'cdr'])->middleware(['modulo:FAC', 'throttle:60,1'])->whereUuid('id');
    Route::post('/comprobantes/{id}/reenviar', [ComprobanteController::class, 'reenviar'])->middleware(['modulo:FAC', 'permiso:fac.document.resend', 'throttle:30,1'])->whereUuid('id');
    Route::post('/comprobantes/{id}/reemitir', [ComprobanteController::class, 'reemitir'])->middleware(['modulo:FAC,C', 'permiso:fac.document.issue'])->whereUuid('id');
    Route::post('/comprobantes/{id}/anular', [ComprobanteController::class, 'anular'])->middleware(['modulo:FAC', 'permiso:fac.document.void'])->whereUuid('id');
    Route::get('/marcas/{id}/logo', [ComprobanteController::class, 'logo'])->middleware('modulo:FAC')->whereUuid('id');

    // FAC-02 Emitir desde el pedido
    Route::get('/pedidos', [EmisionController::class, 'pedidos'])->middleware('modulo:FAC');
    Route::get('/pedidos/{id}', [EmisionController::class, 'pedido'])->middleware('modulo:FAC')->whereUuid('id');
    Route::post('/pedidos/{id}/emitir', [EmisionController::class, 'emitirPedido'])->middleware(['modulo:FAC,C', 'permiso:fac.document.issue'])->whereUuid('id');

    // FAC-03 Emisión directa
    Route::get('/emision/opciones', [EmisionController::class, 'opciones'])->middleware('modulo:FAC');
    Route::get('/emision/productos', [EmisionController::class, 'productos'])->middleware('modulo:FAC');
    Route::get('/emision/clientes', [EmisionController::class, 'clientes'])->middleware(['modulo:FAC', 'throttle:120,1']);
    Route::post('/comprobantes', [EmisionController::class, 'directa'])->middleware(['modulo:FAC,C', 'permiso:fac.document.issue']);

    // FAC-05 Nota de crédito y FAC-06 Nota de débito
    Route::get('/comprobantes/{id}/notas', [ComprobanteController::class, 'motivos'])->middleware('modulo:FAC')->whereUuid('id');
    Route::post('/comprobantes/{id}/nota-credito', [ComprobanteController::class, 'notaCredito'])->middleware(['modulo:FAC', 'permiso:fac.credit_note.issue'])->whereUuid('id');
    Route::post('/comprobantes/{id}/nota-peso', [ComprobanteController::class, 'notaPeso'])->middleware(['modulo:FAC', 'permiso:fac.credit_note.issue'])->whereUuid('id');
    Route::post('/comprobantes/{id}/nota-debito', [ComprobanteController::class, 'notaDebito'])->middleware(['modulo:FAC', 'permiso:fac.credit_note.issue'])->whereUuid('id');

    // FAC-07 Cola de envío
    Route::get('/cola', [ColaController::class, 'index'])->middleware('modulo:FAC');
    Route::post('/cola/procesar', [ColaController::class, 'procesar'])->middleware(['modulo:FAC', 'permiso:fac.document.resend', 'throttle:10,1']);
    Route::post('/guias/{id}/reenviar', [ColaController::class, 'reenviarGuia'])->middleware(['modulo:FAC', 'permiso:fac.document.resend', 'throttle:30,1'])->whereUuid('id');

    // FAC-08 Resumen diario y bajas
    Route::get('/resumenes', [ColaController::class, 'resumenes'])->middleware('modulo:FAC');
    Route::get('/resumenes/{id}', [ColaController::class, 'resumen'])->middleware('modulo:FAC')->whereUuid('id');
    Route::post('/resumenes', [ColaController::class, 'crearResumen'])->middleware(['modulo:FAC', 'permiso:fac.document.resend']);
    Route::post('/resumenes/{id}/enviar', [ColaController::class, 'enviarResumen'])->middleware(['modulo:FAC', 'permiso:fac.document.resend'])->whereUuid('id');
    Route::post('/resumenes/{id}/consultar', [ColaController::class, 'consultarResumen'])->middleware(['modulo:FAC', 'permiso:fac.document.resend'])->whereUuid('id');

    // FAC-09 Guía de remisión
    Route::get('/guias', [GuiaController::class, 'index'])->middleware('modulo:FAC');
    Route::get('/guias/opciones', [GuiaController::class, 'opciones'])->middleware('modulo:FAC');
    Route::get('/guias/pedido/{id}', [GuiaController::class, 'desdePedido'])->middleware('modulo:FAC')->whereUuid('id');
    Route::get('/guias/transferencia/{id}', [GuiaController::class, 'desdeTransferencia'])->middleware('modulo:FAC')->whereUuid('id');
    Route::get('/guias/{id}', [GuiaController::class, 'show'])->middleware('modulo:FAC')->whereUuid('id');
    Route::post('/guias', [GuiaController::class, 'store'])->middleware(['modulo:FAC', 'permiso:fac.guide.issue']);
    Route::post('/guias/{id}/anular', [GuiaController::class, 'anular'])->middleware(['modulo:FAC', 'permiso:fac.guide.issue'])->whereUuid('id');

    // FAC-10 Series
    Route::get('/series', [ConfigController::class, 'series'])->middleware('modulo:FAC');
    Route::post('/series', [ConfigController::class, 'crearSerie'])->middleware(['modulo:FAC', 'permiso:fac.series.manage']);
    Route::put('/series/{id}/estado', [ConfigController::class, 'estadoSerie'])->middleware(['modulo:FAC', 'permiso:fac.series.manage'])->whereUuid('id');

    // FAC-11 Plantillas impresas
    Route::get('/plantillas', [ConfigController::class, 'plantillas'])->middleware('modulo:FAC');
    Route::put('/plantillas/{id}', [ConfigController::class, 'guardarPlantilla'])->middleware('modulo:FAC,E')->whereUuid('id');

    // FAC-12 Comprobantes del período
    Route::get('/periodo', [ConfigController::class, 'periodo'])->middleware('modulo:FAC');
    Route::get('/periodo/exportar', [ConfigController::class, 'exportarPeriodo'])->middleware(['modulo:FAC', 'throttle:10,1']);
});
