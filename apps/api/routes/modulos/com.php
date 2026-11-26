<?php

use App\Modulos\Com\Http\Controllers\ComprobanteController;
use App\Modulos\Com\Http\Controllers\OrdenController;
use App\Modulos\Com\Http\Controllers\PagoController;
use App\Modulos\Com\Http\Controllers\PantallaController;
use App\Modulos\Com\Http\Controllers\ProveedorController;
use App\Modulos\Com\Http\Controllers\RecepcionController;
use Illuminate\Support\Facades\Route;

// COM · Compras y cuentas por pagar. Reglas en app/Modulos/Com/Services.
// Comprobantes y pagos piden solo el permiso (la contadora los registra con COM de lectura y aprobación);
// aprobar una OC y aprobar una diferencia del cruce validan en el servicio quién puede (RN-COM-01, RN-COM-07).
Route::prefix('com')->group(function () {
    Route::get('/opciones', [PantallaController::class, 'opciones'])->middleware('modulo:COM');
    Route::get('/variantes', [PantallaController::class, 'variantes'])->middleware('modulo:COM');
    Route::get('/cifras/{pantalla}', [PantallaController::class, 'cifras'])->middleware('modulo:COM')->where('pantalla', '\d{2}');

    // COM-01 Proveedores (la cuenta bancaria la cambia o aprueba el gerente: RN-COM-13)
    Route::get('/proveedores', [ProveedorController::class, 'index'])->middleware('modulo:COM');
    Route::get('/proveedores/{id}', [ProveedorController::class, 'show'])->middleware('modulo:COM')->whereUuid('id');
    Route::post('/proveedores', [ProveedorController::class, 'store'])->middleware('modulo:COM,C');
    Route::put('/proveedores/{id}', [ProveedorController::class, 'update'])->middleware('modulo:COM,E')->whereUuid('id');
    Route::post('/proveedores/{id}/sunat', [ProveedorController::class, 'sunat'])->middleware(['modulo:COM,E', 'throttle:20,1'])->whereUuid('id');
    Route::post('/proveedores/{id}/estado-sunat', [ProveedorController::class, 'estadoSunat'])->middleware('modulo:COM,E')->whereUuid('id');
    Route::post('/proveedores/{id}/cuenta', [ProveedorController::class, 'cuenta'])->middleware('modulo:COM,E')->whereUuid('id');
    Route::post('/proveedores/{id}/cuenta/aprobar', [ProveedorController::class, 'aprobarCuenta'])->middleware(['modulo:COM', 'permiso:com.supplier.bank_change'])->whereUuid('id');
    Route::post('/proveedores/{id}/cuenta/rechazar', [ProveedorController::class, 'rechazarCuenta'])->middleware(['modulo:COM', 'permiso:com.supplier.bank_change'])->whereUuid('id');

    // COM-02 Catálogo por proveedor
    Route::get('/catalogo', [ProveedorController::class, 'catalogo'])->middleware('modulo:COM');
    Route::post('/catalogo', [ProveedorController::class, 'guardarCatalogo'])->middleware('modulo:COM,C');
    Route::put('/catalogo/{id}', [ProveedorController::class, 'guardarCatalogo'])->middleware('modulo:COM,E')->whereUuid('id');

    // COM-03 Requerimientos (PRO-03 los creará con OrdenesService::crearRequerimiento)
    Route::get('/requerimientos', [OrdenController::class, 'requerimientos'])->middleware('modulo:COM');
    Route::post('/requerimientos', [OrdenController::class, 'crearRequerimiento'])->middleware('modulo:COM,C');
    Route::post('/requerimientos/{id}/cancelar', [OrdenController::class, 'cancelarRequerimiento'])->middleware('modulo:COM,E')->whereUuid('id');
    Route::post('/requerimientos/agrupar', [OrdenController::class, 'agrupar'])->middleware(['modulo:COM,C', 'permiso:com.order.create']);

    // COM-04 Órdenes de compra y COM-05 Aprobación
    Route::get('/ordenes', [OrdenController::class, 'index'])->middleware('modulo:COM');
    Route::get('/ordenes/{id}', [OrdenController::class, 'show'])->middleware('modulo:COM')->whereUuid('id');
    Route::post('/ordenes', [OrdenController::class, 'store'])->middleware(['modulo:COM,C', 'permiso:com.order.create']);
    Route::put('/ordenes/{id}', [OrdenController::class, 'update'])->middleware(['modulo:COM,E', 'permiso:com.order.create'])->whereUuid('id');
    Route::post('/ordenes/{id}/enviar', [OrdenController::class, 'enviar'])->middleware(['modulo:COM,E', 'permiso:com.order.create'])->whereUuid('id');
    Route::post('/ordenes/{id}/aprobar', [OrdenController::class, 'aprobar'])->middleware(['modulo:COM', 'permiso:com.order.approve'])->whereUuid('id');
    Route::post('/ordenes/{id}/devolver', [OrdenController::class, 'devolver'])->middleware(['modulo:COM', 'permiso:com.order.approve'])->whereUuid('id');
    Route::post('/ordenes/{id}/anular', [OrdenController::class, 'anular'])->middleware(['modulo:COM,A', 'permiso:com.order.create|com.order.approve'])->whereUuid('id');
    Route::post('/ordenes/{id}/cerrar', [OrdenController::class, 'cerrar'])->middleware(['modulo:COM,E', 'permiso:com.order.create|com.order.approve'])->whereUuid('id');

    // COM-06 Recepción
    Route::get('/recepciones', [RecepcionController::class, 'index'])->middleware('modulo:COM');
    Route::get('/recepciones/{id}', [RecepcionController::class, 'show'])->middleware('modulo:COM')->whereUuid('id');
    Route::get('/recepciones/pendientes/{poId}', [RecepcionController::class, 'pendientes'])->middleware('modulo:COM')->whereUuid('poId');
    Route::post('/recepciones', [RecepcionController::class, 'store'])->middleware(['modulo:COM,C', 'permiso:com.receipt.record']);

    // COM-07 Comprobantes y COM-08 Cruce de tres vías
    Route::get('/comprobantes', [ComprobanteController::class, 'index'])->middleware('modulo:COM');
    Route::get('/comprobantes/duplicado', [ComprobanteController::class, 'duplicado'])->middleware('modulo:COM');
    Route::get('/comprobantes/tipo-cambio', [ComprobanteController::class, 'tipoCambio'])->middleware('modulo:COM');
    Route::get('/comprobantes/{id}', [ComprobanteController::class, 'show'])->middleware('modulo:COM')->whereUuid('id');
    Route::post('/comprobantes', [ComprobanteController::class, 'store'])->middleware(['modulo:COM', 'permiso:com.document.record']);
    Route::post('/comprobantes/{id}/anular', [ComprobanteController::class, 'anular'])->middleware(['modulo:COM', 'permiso:com.document.record'])->whereUuid('id');
    Route::get('/cruces', [ComprobanteController::class, 'cruces'])->middleware('modulo:COM');
    Route::get('/cruces/{id}', [ComprobanteController::class, 'cruce'])->middleware('modulo:COM')->whereUuid('id');
    Route::post('/cruces/{id}/aprobar', [ComprobanteController::class, 'aprobarDiferencia'])->middleware('modulo:COM')->whereUuid('id');

    // COM-09 Cuentas por pagar y COM-10 Pagos
    Route::get('/por-pagar', [PagoController::class, 'porPagar'])->middleware('modulo:COM');
    Route::post('/por-pagar/{id}/programar', [PagoController::class, 'programar'])->middleware(['modulo:COM', 'permiso:com.payment.record'])->whereUuid('id');
    Route::get('/pagos', [PagoController::class, 'index'])->middleware('modulo:COM');
    Route::get('/pagos/{id}', [PagoController::class, 'show'])->middleware('modulo:COM')->whereUuid('id');
    Route::post('/pagos', [PagoController::class, 'store'])->middleware(['modulo:COM', 'permiso:com.payment.record', 'throttle:30,1']);
    Route::post('/pagos/{id}/revertir', [PagoController::class, 'revertir'])->middleware(['modulo:COM,A', 'permiso:com.payment.record'])->whereUuid('id');

    // COM-11 Evaluación de proveedores y COM-12 Tablero
    Route::get('/evaluacion', [PantallaController::class, 'evaluacion'])->middleware('modulo:COM');
    Route::post('/evaluacion/fijar', [PantallaController::class, 'fijarCalificaciones'])->middleware('modulo:COM,A');
    Route::get('/tablero', [PantallaController::class, 'tablero'])->middleware('modulo:COM');
});
