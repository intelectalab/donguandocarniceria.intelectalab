<?php

use App\Modulos\Caj\Http\Controllers\AbonoController;
use App\Modulos\Caj\Http\Controllers\CobroController;
use App\Modulos\Caj\Http\Controllers\CuentaController;
use App\Modulos\Caj\Http\Controllers\LiquidacionController;
use App\Modulos\Caj\Http\Controllers\ReporteController;
use App\Modulos\Caj\Http\Controllers\SaldoController;
use Illuminate\Support\Facades\Route;

// CAJ · Cajas, cobros y conciliación (CAJ-01 a CAJ-13). Reglas en app/Modulos/Caj/Services.
Route::prefix('caj')->group(function () {
    // CAJ-01 Cuentas
    Route::get('/cuentas', [CuentaController::class, 'index'])->middleware('modulo:CAJ');
    Route::get('/cuentas/opciones', [CuentaController::class, 'opciones'])->middleware(['modulo:CAJ', 'permiso:caj.account.manage']);
    Route::get('/cuentas/{id}/movimientos', [CuentaController::class, 'movimientos'])->middleware('modulo:CAJ')->whereUuid('id');
    Route::post('/cuentas', [CuentaController::class, 'store'])->middleware(['modulo:CAJ', 'permiso:caj.account.manage']);
    Route::put('/cuentas/{id}', [CuentaController::class, 'update'])->middleware(['modulo:CAJ', 'permiso:caj.account.manage'])->whereUuid('id');

    // CAJ-02 Registrar cobro, CAJ-03 Cobros y CAJ-04 Aplicar cobro
    Route::get('/cobros/opciones', [CobroController::class, 'opciones'])->middleware('modulo:CAJ');
    Route::get('/clientes', [CobroController::class, 'clientes'])->middleware(['modulo:CAJ', 'throttle:120,1']);
    Route::get('/clientes/{id}/pendientes', [CobroController::class, 'pendientes'])->middleware('modulo:CAJ')->whereUuid('id');
    Route::get('/cobros', [CobroController::class, 'index'])->middleware('modulo:CAJ');
    Route::get('/cobros/exportar', [CobroController::class, 'exportar'])->middleware(['modulo:CAJ', 'throttle:10,1']);
    Route::get('/cobros/{id}', [CobroController::class, 'show'])->middleware('modulo:CAJ')->whereUuid('id');
    Route::get('/cobros/{id}/voucher', [CobroController::class, 'voucher'])->middleware('modulo:CAJ')->whereUuid('id');
    Route::post('/cobros', [CobroController::class, 'store'])->middleware(['modulo:CAJ,C', 'permiso:caj.payment.register', 'throttle:60,1']);
    Route::post('/cobros/{id}/aplicar', [CobroController::class, 'aplicar'])->middleware(['modulo:CAJ,C', 'permiso:caj.payment.register'])->whereUuid('id');
    Route::post('/cobros/{id}/revertir', [CobroController::class, 'revertir'])->middleware(['modulo:CAJ', 'permiso:caj.payment.reverse'])->whereUuid('id');

    // CAJ-05 Mensaje de pago
    Route::get('/mensaje/opciones', [ReporteController::class, 'mensajeOpciones'])->middleware('modulo:CAJ');
    Route::get('/mensaje/pedidos', [ReporteController::class, 'pedidos'])->middleware('modulo:CAJ');
    Route::post('/mensaje', [ReporteController::class, 'mensaje'])->middleware(['modulo:CAJ', 'throttle:60,1']);

    // CAJ-06 Caja del repartidor y CAJ-07 Liquidación del repartidor
    Route::get('/repartidores', [LiquidacionController::class, 'caja'])->middleware('modulo:CAJ');
    Route::get('/liquidaciones', [LiquidacionController::class, 'index'])->middleware('modulo:CAJ');
    Route::get('/rutas/{id}/liquidacion', [LiquidacionController::class, 'ruta'])->middleware('modulo:CAJ')->whereUuid('id');
    Route::post('/rutas/{id}/liquidar', [LiquidacionController::class, 'liquidar'])->middleware(['modulo:CAJ', 'permiso:caj.driver.settle'])->whereUuid('id');
    Route::post('/liquidaciones/{id}/aprobar', [LiquidacionController::class, 'aprobar'])->middleware(['modulo:CAJ,A', 'permiso:caj.driver.settle'])->whereUuid('id');

    // CAJ-08 Abonos de pasarela y adquirente y CAJ-09 Conciliación pendiente
    Route::get('/abonos', [AbonoController::class, 'index'])->middleware('modulo:CAJ');
    Route::get('/abonos/candidatos', [AbonoController::class, 'candidatos'])->middleware(['modulo:CAJ', 'permiso:caj.reconciliation.manage']);
    Route::get('/abonos/{id}', [AbonoController::class, 'show'])->middleware('modulo:CAJ')->whereUuid('id');
    Route::post('/abonos', [AbonoController::class, 'store'])->middleware(['modulo:CAJ', 'permiso:caj.reconciliation.manage']);
    Route::post('/abonos/{id}/cobros', [AbonoController::class, 'agregar'])->middleware(['modulo:CAJ', 'permiso:caj.reconciliation.manage'])->whereUuid('id');
    Route::delete('/abonos/{id}/cobros/{paymentId}', [AbonoController::class, 'quitar'])->middleware(['modulo:CAJ', 'permiso:caj.reconciliation.manage'])
        ->whereUuid('id')->whereUuid('paymentId');
    Route::post('/abonos/{id}/cerrar', [AbonoController::class, 'cerrar'])->middleware(['modulo:CAJ', 'permiso:caj.reconciliation.manage'])->whereUuid('id');
    Route::get('/conciliacion', [AbonoController::class, 'pendientes'])->middleware('modulo:CAJ');

    // CAJ-10 Saldos a favor
    Route::get('/saldos', [SaldoController::class, 'index'])->middleware('modulo:CAJ');
    Route::get('/saldos/{id}', [SaldoController::class, 'show'])->middleware('modulo:CAJ')->whereUuid('id');
    Route::post('/saldos/{id}/usar', [SaldoController::class, 'usar'])->middleware(['modulo:CAJ,C', 'permiso:caj.payment.register'])->whereUuid('id');
    Route::post('/saldos/{id}/devolver', [SaldoController::class, 'devolver'])->middleware(['modulo:CAJ', 'permiso:caj.balance.refund'])->whereUuid('id');

    // CAJ-11 Cuentas por cobrar
    Route::get('/por-cobrar', [ReporteController::class, 'cxc'])->middleware('modulo:CAJ');
    Route::get('/por-cobrar/exportar', [ReporteController::class, 'cxcExportar'])->middleware(['modulo:CAJ', 'throttle:10,1']);

    // CAJ-12 Traslados entre cuentas
    Route::get('/traslados', [ReporteController::class, 'traslados'])->middleware('modulo:CAJ');
    Route::post('/traslados', [ReporteController::class, 'trasladar'])->middleware(['modulo:CAJ,E', 'throttle:30,1']);

    // CAJ-13 Cierre diario de caja
    Route::get('/cierre', [ReporteController::class, 'cierre'])->middleware('modulo:CAJ');
});
