<?php

use App\Modulos\Sus\Http\Controllers\SuscripcionController;
use Illuminate\Support\Facades\Route;

// Mi suscripción (la empresa): plan, uso, comprobantes, medio de pago y cancelar. Valen aunque el plan no tenga el
// módulo SUS (Access::DEL_SERVICIO) y también en solo lectura o cancelada, para poder pagar (SuscripcionVigente).
Route::prefix('suscripcion')->group(function () {
    Route::get('/', [SuscripcionController::class, 'resumen'])
        ->middleware('permiso:sus.subscription.view|sus.invoice.view|sus.payment_method.manage|sus.subscription.cancel');
    Route::get('/comprobantes', [SuscripcionController::class, 'comprobantes'])->middleware('permiso:sus.invoice.view');
    Route::get('/comprobantes/{id}', [SuscripcionController::class, 'comprobante'])->middleware('permiso:sus.invoice.view')->whereUuid('id');
    Route::post('/comprobantes/{id}/pagar', [SuscripcionController::class, 'pagar'])->middleware(['permiso:sus.payment_method.manage', 'throttle:10,1'])->whereUuid('id');
    Route::put('/medio-de-pago', [SuscripcionController::class, 'guardarMedio'])->middleware(['permiso:sus.payment_method.manage', 'throttle:10,1']);
    Route::put('/medio-de-pago/preferencias', [SuscripcionController::class, 'preferencias'])->middleware('permiso:sus.payment_method.manage');
    Route::post('/cancelar', [SuscripcionController::class, 'cancelar'])->middleware('permiso:sus.subscription.cancel');
    Route::post('/cancelar/deshacer', [SuscripcionController::class, 'deshacer'])->middleware('permiso:sus.subscription.cancel');
});
