<?php

use App\Modulos\B2b\Http\Controllers\ClienteController;
use App\Modulos\B2b\Http\Controllers\CobranzaController;
use App\Modulos\B2b\Http\Controllers\PortalController;
use App\Modulos\B2b\Http\Controllers\RecurrenteController;
use Illuminate\Support\Facades\Route;

// B2B · Clientes empresariales. Reglas en app/Modulos/B2b/Services.
// Las rutas internas rechazan a los usuarios del portal (portal.fuera). Las del portal (/b2b/portal) exigen
// b2b.portal.access y una cuenta activa, y filtran siempre por el cliente de esa cuenta (RN-B2B-12).
// La vendedora tiene solo lectura del módulo, pero sus permisos (pedir excepciones y programar recurrentes)
// le habilitan esas escrituras: por eso esas rutas piden la lectura del módulo más el permiso.
Route::prefix('b2b/portal')->middleware('portal')->group(function () {
    Route::get('/resumen', [PortalController::class, 'resumen']);
    Route::get('/catalogo', [PortalController::class, 'catalogo']);                                     // B2B-12
    Route::get('/pedidos/{id}/repetir', [PortalController::class, 'repetir'])->whereUuid('id');          // B2B-13
    Route::post('/pedidos', [PortalController::class, 'pedir']);
    Route::get('/pedidos', [PortalController::class, 'pedidos']);                                        // B2B-14
    Route::get('/pedidos/{id}', [PortalController::class, 'pedido'])->whereUuid('id');
    Route::get('/cuenta', [PortalController::class, 'cuentaCorriente']);                                 // B2B-15
    Route::get('/comprobantes/{id}/{tipo}', [PortalController::class, 'descargar'])->whereUuid('id')->whereIn('tipo', ['PDF', 'XML', 'CDR']);
    Route::get('/reclamos', [PortalController::class, 'reclamos']);                                      // B2B-16
    Route::post('/reclamos', [PortalController::class, 'abrirReclamo']);
    Route::get('/reclamos/{id}/foto/{n}', [PortalController::class, 'foto'])->whereUuid('id')->whereNumber('n');
    Route::get('/usuarios', [PortalController::class, 'usuarios']);                                      // B2B-17
    Route::post('/usuarios', [PortalController::class, 'invitar']);
    Route::post('/usuarios/{id}/activo', [PortalController::class, 'activar'])->whereUuid('id');
});

Route::prefix('b2b')->middleware('portal.fuera')->group(function () {
    Route::get('/opciones', [ClienteController::class, 'opciones'])->middleware('modulo:B2B');

    // B2B-01 clientes, B2B-02 ficha de crédito
    Route::get('/clientes', [ClienteController::class, 'index'])->middleware('modulo:B2B');
    Route::get('/clientes/{id}', [ClienteController::class, 'show'])->middleware('modulo:B2B')->whereUuid('id');
    Route::put('/clientes/{id}/credito', [ClienteController::class, 'guardarFicha'])->middleware(['modulo:B2B,E', 'permiso:b2b.credit.manage'])->whereUuid('id');
    Route::post('/clientes/{id}/bloqueo', [ClienteController::class, 'bloquear'])->middleware(['modulo:B2B,E', 'permiso:b2b.credit.manage'])->whereUuid('id');

    // B2B-03 precios del cliente
    Route::get('/clientes/{id}/precios', [ClienteController::class, 'precios'])->middleware('modulo:B2B')->whereUuid('id');
    Route::get('/clientes/{id}/precios/referencia', [ClienteController::class, 'referenciaPrecio'])->middleware('modulo:B2B')->whereUuid('id');
    Route::post('/clientes/{id}/precios', [ClienteController::class, 'guardarPrecio'])->middleware(['modulo:B2B,C', 'permiso:b2b.price.manage'])->whereUuid('id');
    Route::get('/precios/por-aprobar', [ClienteController::class, 'preciosPorAprobar'])->middleware('modulo:B2B');
    Route::post('/precios/{id}/decidir', [ClienteController::class, 'decidirPrecio'])->middleware(['modulo:B2B', 'permiso:b2b.price.approve_below_margin'])->whereUuid('id');
    Route::post('/precios/{id}/cerrar', [ClienteController::class, 'cerrarPrecio'])->middleware(['modulo:B2B,E', 'permiso:b2b.price.manage'])->whereUuid('id');

    // B2B-04 excepciones de crédito
    Route::get('/excepciones', [ClienteController::class, 'excepciones'])->middleware('modulo:B2B');
    Route::post('/excepciones', [ClienteController::class, 'solicitarExcepcion'])->middleware(['modulo:B2B', 'permiso:b2b.exception.request|b2b.exception.approve']);
    Route::post('/excepciones/{id}/decidir', [ClienteController::class, 'decidirExcepcion'])->middleware(['modulo:B2B', 'permiso:b2b.exception.approve'])->whereUuid('id');
    Route::post('/pedidos/{id}/confirmar', [ClienteController::class, 'confirmarPedido'])->middleware(['modulo:B2B', 'permiso:b2b.exception.request|b2b.exception.approve|b2b.credit.manage'])->whereUuid('id');

    // B2B-05 pedidos recurrentes, B2B-06 calendario de corridas
    Route::get('/recurrentes', [RecurrenteController::class, 'index'])->middleware('modulo:B2B');
    Route::get('/clientes/{id}/direcciones', [RecurrenteController::class, 'direcciones'])->middleware('modulo:B2B')->whereUuid('id');
    Route::post('/recurrentes', [RecurrenteController::class, 'store'])->middleware(['modulo:B2B', 'permiso:b2b.recurring.manage']);
    Route::put('/recurrentes/{id}', [RecurrenteController::class, 'update'])->middleware(['modulo:B2B', 'permiso:b2b.recurring.manage'])->whereUuid('id');
    Route::post('/recurrentes/{id}/estado', [RecurrenteController::class, 'estado'])->middleware(['modulo:B2B', 'permiso:b2b.recurring.manage'])->whereUuid('id');
    Route::get('/corridas', [RecurrenteController::class, 'corridas'])->middleware('modulo:B2B');
    Route::post('/corridas', [RecurrenteController::class, 'correr'])->middleware(['modulo:B2B', 'permiso:b2b.recurring.manage']);

    // B2B-07 estado de cuenta, B2B-08 cartera, B2B-09 recordatorios y promesas
    Route::get('/clientes/{id}/estado-de-cuenta', [CobranzaController::class, 'estadoCuenta'])->middleware('modulo:B2B')->whereUuid('id');
    Route::get('/clientes/{id}/estado-de-cuenta/exportar', [CobranzaController::class, 'exportarEstado'])->middleware('modulo:B2B')->whereUuid('id');
    Route::get('/cartera', [CobranzaController::class, 'antiguedad'])->middleware('modulo:B2B');
    Route::get('/cobranza', [CobranzaController::class, 'recordatorios'])->middleware('modulo:B2B');
    Route::post('/cobranza/enviar', [CobranzaController::class, 'enviar'])->middleware(['modulo:B2B,E', 'permiso:b2b.collection.manage']);
    Route::post('/cobranza/evaluar', [CobranzaController::class, 'evaluar'])->middleware(['modulo:B2B,E', 'permiso:b2b.collection.manage']);
    Route::post('/promesas', [CobranzaController::class, 'prometer'])->middleware(['modulo:B2B,C', 'permiso:b2b.collection.manage']);
    Route::post('/promesas/{id}/cancelar', [CobranzaController::class, 'cancelarPromesa'])->middleware(['modulo:B2B,E', 'permiso:b2b.collection.manage'])->whereUuid('id');

    // B2B-10 reclamos
    Route::get('/reclamos', [CobranzaController::class, 'reclamos'])->middleware('modulo:B2B');
    Route::get('/reclamos/{id}/foto/{n}', [CobranzaController::class, 'foto'])->middleware('modulo:B2B')->whereUuid('id')->whereNumber('n');
    Route::post('/reclamos/{id}/responder', [CobranzaController::class, 'responder'])->middleware(['modulo:B2B', 'permiso:b2b.claim.resolve'])->whereUuid('id');
    Route::post('/reclamos/{id}/resolver', [CobranzaController::class, 'resolver'])->middleware(['modulo:B2B', 'permiso:b2b.claim.resolve'])->whereUuid('id');

    // B2B-11 accesos al portal
    Route::get('/accesos', [CobranzaController::class, 'accesos'])->middleware('modulo:B2B');
    Route::post('/accesos', [CobranzaController::class, 'invitar'])->middleware(['modulo:B2B', 'permiso:b2b.portal.manage_users']);
    Route::post('/accesos/{id}/activo', [CobranzaController::class, 'activar'])->middleware(['modulo:B2B', 'permiso:b2b.portal.manage_users'])->whereUuid('id');
});
