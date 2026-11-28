<?php

use App\Modulos\Pos\Http\Controllers\CajaController;
use App\Modulos\Pos\Http\Controllers\DevolucionController;
use App\Modulos\Pos\Http\Controllers\RecojoController;
use App\Modulos\Pos\Http\Controllers\TurnoController;
use App\Modulos\Pos\Http\Controllers\VentaController;
use Illuminate\Support\Facades\Route;

// POS · Mostrador (POS-01 a POS-12). Reglas en app/Modulos/Pos/Services.
Route::prefix('pos')->group(function () {
    Route::get('/contexto', [TurnoController::class, 'contexto'])->middleware('modulo:POS');

    // POS-01 Abrir turno, POS-07 Cerrar turno y POS-08 Aprobación de cierre
    Route::get('/turnos', [TurnoController::class, 'index'])->middleware('modulo:POS');
    Route::get('/turnos/{id}', [TurnoController::class, 'show'])->middleware('modulo:POS')->whereUuid('id');
    Route::post('/turnos', [TurnoController::class, 'abrir'])->middleware(['modulo:POS,C', 'permiso:pos.shift.open']);
    Route::post('/turnos/{id}/cerrar', [TurnoController::class, 'cerrar'])->middleware('modulo:POS,E')->whereUuid('id');
    Route::post('/turnos/{id}/aprobar', [TurnoController::class, 'aprobar'])->middleware(['modulo:POS', 'permiso:pos.shift.approve'])->whereUuid('id');

    // POS-06 Ingresos y retiros
    Route::get('/turnos/{id}/movimientos', [TurnoController::class, 'movimientos'])->middleware('modulo:POS')->whereUuid('id');
    Route::post('/turnos/{id}/movimientos', [TurnoController::class, 'movimiento'])->middleware(['modulo:POS,C', 'throttle:30,1'])->whereUuid('id');

    // POS-02 Venta, POS-03 Ingreso de peso y POS-04 Cobro
    Route::get('/productos', [VentaController::class, 'productos'])->middleware('modulo:POS');
    Route::post('/codigo', [VentaController::class, 'codigo'])->middleware('modulo:POS');
    Route::post('/peso', [VentaController::class, 'peso'])->middleware('modulo:POS');
    Route::post('/cotizar', [VentaController::class, 'cotizar'])->middleware('modulo:POS');
    Route::get('/clientes', [VentaController::class, 'clientes'])->middleware('modulo:POS');
    Route::post('/ventas', [VentaController::class, 'vender'])->middleware(['modulo:POS,C', 'permiso:pos.sale.create']);

    // POS-05 Comprobante y POS-10 Ventas del turno
    Route::get('/ventas', [VentaController::class, 'ventasDelTurno'])->middleware('modulo:POS');
    Route::get('/tickets/{ticket}', [VentaController::class, 'ticket'])->middleware('modulo:POS')->where('ticket', 'TK-[0-9]+');
    Route::get('/comprobantes/{id}', [VentaController::class, 'comprobante'])->middleware('modulo:POS')->whereUuid('id');
    Route::post('/comprobantes/{id}/reenviar', [VentaController::class, 'reenviar'])->middleware(['modulo:POS', 'throttle:20,1'])->whereUuid('id');
    Route::post('/comprobantes/{id}/correo', [VentaController::class, 'correo'])->middleware(['modulo:POS', 'throttle:10,1'])->whereUuid('id');
    Route::get('/marcas/{id}/logo', [VentaController::class, 'logo'])->middleware('modulo:POS')->whereUuid('id');

    // POS-09 Devolución
    Route::get('/devoluciones', [DevolucionController::class, 'index'])->middleware('modulo:POS');
    Route::post('/comprobantes/{id}/devolucion', [DevolucionController::class, 'store'])->middleware(['modulo:POS,E', 'permiso:pos.sale.refund'])->whereUuid('id');

    // POS-11 Cajas registradoras
    Route::get('/cajas', [CajaController::class, 'index'])->middleware('modulo:POS');
    Route::get('/cajas/opciones', [CajaController::class, 'opciones'])->middleware(['modulo:POS', 'permiso:pos.terminal.manage']);
    Route::post('/cajas', [CajaController::class, 'store'])->middleware(['modulo:POS', 'permiso:pos.terminal.manage']);
    Route::put('/cajas/{id}', [CajaController::class, 'update'])->middleware(['modulo:POS', 'permiso:pos.terminal.manage'])->whereUuid('id');

    // POS-12 Pedidos por recoger
    Route::get('/recojos', [RecojoController::class, 'index'])->middleware('modulo:POS');
    Route::get('/recojos/{id}', [RecojoController::class, 'show'])->middleware('modulo:POS')->whereUuid('id');
    Route::post('/recojos/{id}/entregar', [RecojoController::class, 'entregar'])->middleware('modulo:POS,E')->whereUuid('id');
});
