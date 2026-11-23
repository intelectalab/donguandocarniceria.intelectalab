<?php

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
