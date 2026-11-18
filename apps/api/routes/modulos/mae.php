<?php

use App\Modulos\Mae\Http\Controllers\CatalogoController;
use App\Modulos\Mae\Http\Controllers\MedioPagoController;
use App\Modulos\Mae\Http\Controllers\TipoCambioController;
use App\Modulos\Mae\Http\Controllers\TrabajadorController;
use Illuminate\Support\Facades\Route;

// MAE · Maestros comunes: trabajadores, medios de pago y comisiones, tipo de cambio, unidades, catálogos SUNAT,
// ubigeo y entidades financieras. Los catálogos globales son de solo lectura aquí (RN-MAE-11).
Route::prefix('mae')->group(function () {
    $emp = 'permiso:mae.employee.manage';
    $pm = 'permiso:mae.payment_method.manage';

    // MAE-01, MAE-02 y MAE-10 Trabajadores
    Route::get('/trabajadores', [TrabajadorController::class, 'index'])->middleware('modulo:MAE');
    Route::get('/trabajadores/resumen', [TrabajadorController::class, 'resumen'])->middleware('modulo:MAE');
    Route::post('/trabajadores', [TrabajadorController::class, 'store'])->middleware(['modulo:MAE,C', $emp]);
    Route::get('/trabajadores/importar/plantilla', [TrabajadorController::class, 'plantilla'])->middleware(['modulo:MAE,C', $emp, 'throttle:20,1']);
    Route::post('/trabajadores/importar/archivo', [TrabajadorController::class, 'leerArchivo'])->middleware(['modulo:MAE,C', $emp, 'throttle:20,1']);
    Route::post('/trabajadores/importar/revisar', [TrabajadorController::class, 'revisarImportacion'])->middleware(['modulo:MAE,C', $emp, 'throttle:20,1']);
    Route::post('/trabajadores/importar', [TrabajadorController::class, 'importar'])->middleware(['modulo:MAE,C', $emp, 'throttle:10,1']);
    Route::get('/trabajadores/{id}', [TrabajadorController::class, 'show'])->middleware('modulo:MAE')->whereUuid('id');
    Route::put('/trabajadores/{id}', [TrabajadorController::class, 'update'])->middleware(['modulo:MAE,E', $emp])->whereUuid('id');
    Route::post('/trabajadores/{id}/baja', [TrabajadorController::class, 'baja'])->middleware(['modulo:MAE,E', $emp])->whereUuid('id');
    Route::get('/trabajadores/{id}/usuarios-libres', [TrabajadorController::class, 'usuariosLibres'])->middleware(['modulo:MAE,E', $emp])->whereUuid('id');
    Route::post('/trabajadores/{id}/usuario', [TrabajadorController::class, 'vincular'])->middleware(['modulo:MAE,E', $emp])->whereUuid('id');

    // MAE-03 Medios de pago y MAE-04 Comisiones
    Route::get('/medios', [MedioPagoController::class, 'index'])->middleware('modulo:MAE');
    Route::post('/medios/validar', [MedioPagoController::class, 'validar'])->middleware('modulo:MAE');
    Route::put('/medios/{id}', [MedioPagoController::class, 'update'])->middleware(['modulo:MAE,E', $pm])->whereUuid('id');
    Route::post('/medios/{id}/estado', [MedioPagoController::class, 'estado'])->middleware(['modulo:MAE,E', $pm])->whereUuid('id');
    Route::get('/comisiones', [MedioPagoController::class, 'comisiones'])->middleware('modulo:MAE');
    Route::get('/comisiones/efectiva', [MedioPagoController::class, 'efectivaDelMes'])->middleware('modulo:MAE');
    Route::get('/comisiones/simular', [MedioPagoController::class, 'simular'])->middleware('modulo:MAE');
    Route::post('/comisiones', [MedioPagoController::class, 'storeComision'])->middleware(['modulo:MAE,C', $pm]);

    // MAE-05 Tipo de cambio: con el módulo MAE o con el permiso (la contadora lo tiene sin el resto de MAE).
    Route::get('/tipo-cambio', [TipoCambioController::class, 'index']);       // revisa el módulo MAE o mae.exchange_rate.edit
    Route::get('/tipo-cambio/registros', [TipoCambioController::class, 'registros']); // ídem
    Route::get('/tipo-cambio/para', [TipoCambioController::class, 'para']);   // ídem
    Route::post('/tipo-cambio', [TipoCambioController::class, 'store'])->middleware('permiso:mae.exchange_rate.edit');
    Route::post('/tipo-cambio/cargar', [TipoCambioController::class, 'cargar'])->middleware(['permiso:mae.exchange_rate.edit', 'throttle:10,1']);

    // MAE-06 Unidades y conversiones
    Route::get('/unidades', [CatalogoController::class, 'unidades'])->middleware('modulo:MAE');
    Route::get('/unidades/convertir', [CatalogoController::class, 'convertir'])->middleware('modulo:MAE');
    Route::post('/unidades', [CatalogoController::class, 'storeUnidad'])->middleware(['modulo:MAE,C', 'permiso:mae.unit.manage']);
    Route::post('/conversiones', [CatalogoController::class, 'storeConversion'])->middleware(['modulo:MAE,C', 'permiso:mae.unit.manage']);

    // MAE-07, MAE-08 y MAE-09: globales, solo lectura
    Route::get('/sunat', [CatalogoController::class, 'sunat'])->middleware('modulo:MAE');
    Route::get('/sunat/validar', [CatalogoController::class, 'validarSunat'])->middleware('modulo:MAE');
    Route::get('/ubigeo', [CatalogoController::class, 'ubigeo'])->middleware('modulo:MAE');
    Route::get('/ubigeo/resumen', [CatalogoController::class, 'ubigeoResumen'])->middleware('modulo:MAE');
    Route::get('/entidades', [CatalogoController::class, 'entidades'])->middleware('modulo:MAE');
});
