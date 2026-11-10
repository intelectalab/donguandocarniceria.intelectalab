<?php

use App\Modulos\Alm\Http\Controllers\AlertaController;
use App\Modulos\Alm\Http\Controllers\AlmacenController;
use App\Modulos\Alm\Http\Controllers\ConteoController;
use App\Modulos\Alm\Http\Controllers\LoteController;
use App\Modulos\Alm\Http\Controllers\MermaController;
use App\Modulos\Alm\Http\Controllers\PantallaController;
use App\Modulos\Alm\Http\Controllers\RecepcionController;
use App\Modulos\Alm\Http\Controllers\ReservaController;
use App\Modulos\Alm\Http\Controllers\StockController;
use App\Modulos\Alm\Http\Controllers\TransferenciaController;
use Illuminate\Support\Facades\Route;

// ALM · Almacenes, lotes, FEFO y movimientos de inventario. Reglas en app/Modulos/Alm/Services.
Route::prefix('alm')->group(function () {
    Route::get('/opciones', [AlmacenController::class, 'opciones'])->middleware('modulo:ALM');
    Route::get('/variantes', [AlmacenController::class, 'variantes'])->middleware('modulo:ALM');
    Route::get('/disponibles', [AlmacenController::class, 'disponibles'])->middleware('modulo:ALM');

    // Cifras de la cabecera de cada pantalla (01 a 13) y temperaturas de las cámaras (solo lectura, puntos de CAL)
    Route::get('/cifras/{pantalla}', [PantallaController::class, 'cifras'])->middleware('modulo:ALM')->where('pantalla', '\d{2}');
    Route::get('/temperaturas', [PantallaController::class, 'temperaturas'])->middleware('modulo:ALM');

    // ALM-01 Almacenes y ubicaciones
    Route::get('/almacenes/{id}', [PantallaController::class, 'almacen'])->middleware('modulo:ALM')->whereUuid('id');
    Route::get('/almacenes', [AlmacenController::class, 'index'])->middleware('modulo:ALM');
    Route::post('/almacenes', [AlmacenController::class, 'store'])->middleware(['modulo:ALM,C', 'permiso:alm.warehouse.manage']);
    Route::put('/almacenes/{id}', [AlmacenController::class, 'update'])->middleware(['modulo:ALM,E', 'permiso:alm.warehouse.manage'])->whereUuid('id');

    // ALM-02 Stock y ALM-03 Kardex
    Route::get('/stock', [StockController::class, 'index'])->middleware('modulo:ALM');
    Route::get('/stock/resumen', [StockController::class, 'resumen'])->middleware('modulo:ALM');
    Route::get('/stock/{id}', [PantallaController::class, 'saldo'])->middleware('modulo:ALM')->whereUuid('id');
    Route::get('/kardex', [StockController::class, 'kardex'])->middleware('modulo:ALM');
    Route::get('/kardex/{id}', [PantallaController::class, 'movimiento'])->middleware('modulo:ALM')->whereUuid('id');
    Route::post('/kardex/{id}/reversar', [StockController::class, 'reversar'])->middleware(['modulo:ALM,E', 'permiso:alm.count.approve'])->whereUuid('id');

    // ALM-04 Recepción
    Route::get('/recepciones', [RecepcionController::class, 'index'])->middleware('modulo:ALM');
    Route::get('/recepciones/{id}', [RecepcionController::class, 'show'])->middleware('modulo:ALM')->whereUuid('id');
    Route::post('/recepciones', [RecepcionController::class, 'store'])->middleware(['modulo:ALM,C', 'permiso:alm.receipt.create']);
    Route::put('/recepciones/{id}', [RecepcionController::class, 'update'])->middleware(['modulo:ALM,E', 'permiso:alm.receipt.create'])->whereUuid('id');
    Route::post('/recepciones/{id}/confirmar', [RecepcionController::class, 'confirmar'])->middleware(['modulo:ALM,E', 'permiso:alm.receipt.create'])->whereUuid('id');
    Route::post('/recepciones/{id}/anular', [RecepcionController::class, 'anular'])->middleware(['modulo:ALM,E', 'permiso:alm.receipt.create'])->whereUuid('id');

    // ALM-05 Lotes y ALM-06 Liberar o bloquear (el permiso depende del estado: lo valida LotesService)
    Route::get('/lotes', [LoteController::class, 'index'])->middleware('modulo:ALM');
    Route::get('/lotes/historial', [PantallaController::class, 'historialLotes'])->middleware('modulo:ALM');
    Route::get('/lotes/{id}', [LoteController::class, 'show'])->middleware('modulo:ALM')->whereUuid('id');
    Route::post('/lotes/{id}/estado', [LoteController::class, 'estado'])->middleware('modulo:ALM,E')->whereUuid('id');

    // ALM-07 Transferencias y ALM-12 Stock en tránsito
    Route::get('/transferencias', [TransferenciaController::class, 'index'])->middleware('modulo:ALM');
    Route::get('/transito', [PantallaController::class, 'transito'])->middleware('modulo:ALM');
    Route::get('/transferencias/{id}', [TransferenciaController::class, 'show'])->middleware('modulo:ALM')->whereUuid('id');
    Route::post('/transferencias', [TransferenciaController::class, 'store'])->middleware(['modulo:ALM,C', 'permiso:alm.transfer.create']);
    Route::post('/transferencias/{id}/guia', [TransferenciaController::class, 'guia'])->middleware(['modulo:ALM,E', 'permiso:alm.transfer.create'])->whereUuid('id');
    Route::post('/transferencias/{id}/despachar', [TransferenciaController::class, 'despachar'])->middleware(['modulo:ALM,E', 'permiso:alm.transfer.create'])->whereUuid('id');
    Route::post('/transferencias/{id}/recibir', [TransferenciaController::class, 'recibir'])->middleware(['modulo:ALM,E', 'permiso:alm.transfer.receive'])->whereUuid('id');
    Route::post('/transferencias/{id}/cancelar', [TransferenciaController::class, 'cancelar'])->middleware(['modulo:ALM,E', 'permiso:alm.transfer.create'])->whereUuid('id');

    // ALM-08 Conteos
    Route::get('/conteos', [ConteoController::class, 'index'])->middleware('modulo:ALM');
    Route::get('/conteos/{id}', [ConteoController::class, 'show'])->middleware('modulo:ALM')->whereUuid('id');
    Route::post('/conteos', [ConteoController::class, 'store'])->middleware('modulo:ALM,C');
    Route::put('/conteos/lineas/{lineId}', [ConteoController::class, 'contar'])->middleware('modulo:ALM,E')->whereUuid('lineId');
    Route::post('/conteos/{id}/cerrar', [ConteoController::class, 'cerrar'])->middleware('modulo:ALM,E')->whereUuid('id');
    Route::post('/conteos/{id}/aprobar', [ConteoController::class, 'aprobar'])->middleware(['modulo:ALM,E', 'permiso:alm.count.approve'])->whereUuid('id');
    Route::post('/conteos/{id}/cancelar', [ConteoController::class, 'cancelar'])->middleware('modulo:ALM,E')->whereUuid('id');

    // ALM-09 Mermas y ALM-13 Motivos
    Route::get('/mermas', [MermaController::class, 'index'])->middleware('modulo:ALM');
    Route::get('/mermas/{id}', [MermaController::class, 'show'])->middleware('modulo:ALM')->whereUuid('id');
    Route::get('/mermas/{id}/foto', [MermaController::class, 'foto'])->middleware('modulo:ALM')->whereUuid('id');
    Route::post('/mermas', [MermaController::class, 'store'])->middleware('modulo:ALM,C');
    Route::post('/mermas/{id}/aprobar', [MermaController::class, 'aprobar'])->middleware('modulo:ALM,E')->whereUuid('id');
    Route::post('/mermas/{id}/rechazar', [MermaController::class, 'rechazar'])->middleware('modulo:ALM,E')->whereUuid('id');
    Route::get('/motivos', [MermaController::class, 'motivos'])->middleware('modulo:ALM');
    Route::post('/motivos', [MermaController::class, 'guardarMotivo'])->middleware(['modulo:ALM,C', 'permiso:alm.waste.approve']);
    Route::put('/motivos/{id}', [MermaController::class, 'guardarMotivo'])->middleware(['modulo:ALM,E', 'permiso:alm.waste.approve'])->whereUuid('id');

    // ALM-10 Reservas
    Route::get('/reservas', [ReservaController::class, 'index'])->middleware('modulo:ALM');
    Route::get('/reservas/pedidos', [PantallaController::class, 'pedidos'])->middleware('modulo:ALM');
    Route::get('/reservas/pedidos/{orderId}', [PantallaController::class, 'pedido'])->middleware('modulo:ALM')->whereUuid('orderId');
    Route::get('/reservas/faltantes', [PantallaController::class, 'faltantes'])->middleware('modulo:ALM');
    Route::post('/reservas/pedidos/{orderId}/reintentar', [PantallaController::class, 'reintentar'])->middleware('modulo:ALM,E')->whereUuid('orderId');
    Route::post('/reservas/{id}/liberar', [ReservaController::class, 'liberar'])->middleware(['modulo:ALM', 'permiso:alm.reservation.release'])->whereUuid('id');

    // ALM-11 Alertas de vencimiento y KPI
    Route::get('/alertas', [AlertaController::class, 'index'])->middleware('modulo:ALM');
    Route::post('/alertas/generar', [AlertaController::class, 'generar'])->middleware('modulo:ALM,E');
    Route::post('/alertas/{lotId}/promocion', [PantallaController::class, 'promocion'])->middleware(['modulo:ALM,E', 'throttle:20,1'])->whereUuid('lotId');
    Route::get('/kpi', [AlertaController::class, 'kpi'])->middleware('modulo:ALM');
});
