<?php

use App\Modulos\Gas\Http\Controllers\CajaChicaController;
use App\Modulos\Gas\Http\Controllers\ConfigController;
use App\Modulos\Gas\Http\Controllers\ContadoraController;
use App\Modulos\Gas\Http\Controllers\GastoController;
use App\Modulos\Gas\Http\Controllers\ReporteController;
use Illuminate\Support\Facades\Route;

// GAS · Gastos (GAS-01 a GAS-11). Reglas en app/Modulos/Gas/Services. Cada pantalla pide su permiso de la spec, no
// solo el módulo: la supervisora y el coordinador registran y aprueban nivel 1, la contadora revisa, administración
// paga y maneja la caja chica. Leer una ficha pide cualquiera de los permisos de GAS y el servicio revisa que el gasto
// sea suyo o que vea todos (con su alcance por marca y local). El responsable de un fondo ve y envía su rendición.
Route::prefix('gas')->group(function () {
    $alguno = 'permiso:gas.expense.create|gas.expense.view_all|gas.expense.approve_area|gas.expense.approve_admin|gas.expense.approve_management|gas.category.manage|gas.petty_cash.manage|gas.accounting.review';
    $crear = 'permiso:gas.expense.create';
    $aprobar = 'permiso:gas.expense.approve_area|gas.expense.approve_admin|gas.expense.approve_management';
    $pagar = 'permiso:gas.petty_cash.manage|gas.expense.approve_admin';
    $config = 'permiso:gas.category.manage';
    $contadora = 'permiso:gas.accounting.review';

    Route::get('/opciones', [GastoController::class, 'opciones'])->middleware($alguno);
    Route::get('/proveedor/{ruc}', [GastoController::class, 'proveedor'])->middleware([$crear, 'throttle:60,1'])->where('ruc', '[0-9]{8,15}');

    // GAS-01 Registrar, GAS-02 Mis gastos, GAS-04 Por pagar y pagados (vista=pagar|pagados)
    Route::get('/gastos', [GastoController::class, 'index'])->middleware($alguno);
    Route::post('/gastos', [GastoController::class, 'store'])->middleware([$crear, 'throttle:60,1']);
    Route::get('/gastos/{id}', [GastoController::class, 'show'])->middleware($alguno)->whereUuid('id');
    Route::post('/gastos/{id}', [GastoController::class, 'update'])->middleware([$crear, 'throttle:60,1'])->whereUuid('id');
    Route::post('/gastos/{id}/enviar', [GastoController::class, 'enviar'])->middleware($crear)->whereUuid('id');
    Route::post('/gastos/{id}/corregir', [GastoController::class, 'corregir'])->middleware($crear)->whereUuid('id');
    Route::post('/gastos/{id}/anular', [GastoController::class, 'anular'])->middleware($alguno)->whereUuid('id');
    Route::post('/gastos/{id}/foto', [GastoController::class, 'foto_'])->middleware([$alguno, 'throttle:120,1'])->whereUuid('id');

    // GAS-03 Bandeja de aprobación
    Route::get('/aprobaciones', [GastoController::class, 'bandeja'])->middleware($aprobar);
    Route::post('/gastos/{id}/aprobar', [GastoController::class, 'aprobar'])->middleware($aprobar)->whereUuid('id');
    Route::post('/gastos/{id}/rechazar', [GastoController::class, 'rechazar'])->middleware($aprobar)->whereUuid('id');

    // GAS-04 Pago desde una cuenta de CAJ
    Route::get('/cuentas', [GastoController::class, 'cuentas'])->middleware($pagar);
    Route::post('/gastos/{id}/pagar', [GastoController::class, 'pagar'])->middleware($pagar)->whereUuid('id');
    Route::post('/gastos/{id}/revertir-pago', [GastoController::class, 'revertir'])->middleware($pagar)->whereUuid('id');

    // GAS-10 Reparto entre centros de costo
    Route::get('/gastos/{id}/reparto', [GastoController::class, 'reparto'])->middleware($alguno)->whereUuid('id');
    Route::put('/gastos/{id}/reparto', [GastoController::class, 'repartir'])->middleware($alguno)->whereUuid('id');

    // GAS-05 Categorías y GAS-06 Reglas de aprobación
    Route::get('/categorias', [ConfigController::class, 'categorias'])->middleware($alguno);
    Route::post('/categorias', [ConfigController::class, 'crearCategoria'])->middleware($config);
    Route::put('/categorias/{id}', [ConfigController::class, 'editarCategoria'])->middleware($config)->whereUuid('id');
    Route::get('/reglas', [ConfigController::class, 'reglas'])->middleware($alguno);
    Route::post('/reglas', [ConfigController::class, 'crearRegla'])->middleware($config);
    Route::put('/reglas/{id}', [ConfigController::class, 'editarRegla'])->middleware($config)->whereUuid('id');

    // GAS-07 Caja chica y GAS-08 Rendición (el responsable del fondo ve el suyo; el servicio lo revisa)
    Route::get('/caja-chica', [CajaChicaController::class, 'index'])->middleware($alguno);
    Route::post('/caja-chica', [CajaChicaController::class, 'store'])->middleware('permiso:gas.petty_cash.manage');
    Route::put('/caja-chica/{id}', [CajaChicaController::class, 'update'])->middleware('permiso:gas.petty_cash.manage')->whereUuid('id');
    Route::get('/rendiciones', [CajaChicaController::class, 'rendiciones'])->middleware($alguno);
    Route::get('/rendiciones/{id}', [CajaChicaController::class, 'rendicion'])->middleware($alguno)->whereUuid('id');
    Route::post('/rendiciones/{id}/enviar', [CajaChicaController::class, 'enviar'])->middleware($alguno)->whereUuid('id');
    Route::post('/rendiciones/{id}/aprobar', [CajaChicaController::class, 'aprobar'])->middleware('permiso:gas.petty_cash.manage')->whereUuid('id');
    Route::post('/rendiciones/{id}/devolver', [CajaChicaController::class, 'devolver'])->middleware('permiso:gas.petty_cash.manage')->whereUuid('id');
    Route::post('/rendiciones/{id}/reponer', [CajaChicaController::class, 'reponer'])->middleware('permiso:gas.petty_cash.manage')->whereUuid('id');

    // GAS-09 Bandeja de la contadora
    Route::get('/contadora', [ContadoraController::class, 'index'])->middleware($contadora);
    Route::post('/gastos/{id}/clasificar', [ContadoraController::class, 'clasificar'])->middleware($contadora)->whereUuid('id');
    Route::post('/gastos/{id}/observar', [ContadoraController::class, 'observar'])->middleware($contadora)->whereUuid('id');
    Route::post('/contadora/traer-de-ruta', [ContadoraController::class, 'traer'])->middleware([$contadora, 'throttle:10,1']);

    // GAS-11 Reporte
    Route::get('/reporte', [ReporteController::class, 'index'])->middleware('permiso:gas.expense.view_all|gas.accounting.review');
    Route::get('/reporte/exportar', [ReporteController::class, 'exportar'])->middleware(['permiso:gas.expense.view_all|gas.accounting.review', 'throttle:10,1']);
});
