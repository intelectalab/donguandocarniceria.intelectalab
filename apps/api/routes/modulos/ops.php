<?php

use App\Modulos\Ops\Http\Controllers\AccesoEmpresaController;
use App\Modulos\Ops\Http\Controllers\AnuncioEmpresaController;
use App\Modulos\Ops\Http\Controllers\TicketController;
use Illuminate\Support\Facades\Route;

// OPS-15 Mis tickets: cualquier empresa pide ayuda a Intelectalab, aunque su plan no tenga el módulo OPS. Ve los suyos,
// o todos los de su empresa con ops.ticket.view_all (lo filtra el servicio). Se permite también en solo lectura.
Route::prefix('soporte')->middleware('permiso:ops.ticket.create|ops.ticket.view_all')->group(function () {
    Route::get('/tickets', [TicketController::class, 'index']);
    Route::get('/tickets/{id}', [TicketController::class, 'show'])->whereUuid('id');
    Route::post('/tickets', [TicketController::class, 'store'])->middleware(['permiso:ops.ticket.create', 'throttle:10,1']);
    Route::post('/tickets/{id}/responder', [TicketController::class, 'responder'])->middleware('throttle:30,1')->whereUuid('id');
    Route::post('/tickets/{id}/cerrar', [TicketController::class, 'cerrar'])->whereUuid('id');
});

// Anuncios de GestionCarnica para esta empresa (todos los usuarios; RLS deja solo los dirigidos a ella).
Route::get('/anuncios', AnuncioEmpresaController::class);

// OPS-14 Accesos de soporte: la empresa aprueba o rechaza lo que pide el soporte, revoca lo vigente y ve lo que hizo.
Route::prefix('soporte/accesos')->middleware('permiso:ops.support_access.approve|ops.support_access.revoke|ops.support_access.view_log')->group(function () {
    Route::get('/', [AccesoEmpresaController::class, 'index']);
    Route::get('/{id}', [AccesoEmpresaController::class, 'show'])->whereUuid('id');
    Route::post('/{id}/aprobar', [AccesoEmpresaController::class, 'aprobar'])->middleware('permiso:ops.support_access.approve')->whereUuid('id');
    Route::post('/{id}/rechazar', [AccesoEmpresaController::class, 'rechazar'])->middleware('permiso:ops.support_access.approve')->whereUuid('id');
    Route::post('/{id}/revocar', [AccesoEmpresaController::class, 'revocar'])->middleware('permiso:ops.support_access.revoke')->whereUuid('id');
});
