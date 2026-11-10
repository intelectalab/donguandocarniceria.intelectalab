<?php

use App\Modulos\Seg\Http\Controllers\DispositivoController;
use App\Modulos\Seg\Http\Controllers\UsuarioController;
use Illuminate\Support\Facades\Route;

// SEG · Seguridad: usuarios, roles, permisos, alcance, sesiones y dispositivos. Reglas en app/Modulos/Seg/Services.
Route::prefix('seg')->group(function () {
    // SEG-08 Usuarios y SEG-09 Ficha del usuario
    Route::get('/usuarios', [UsuarioController::class, 'index'])->middleware('modulo:SEG');
    Route::get('/usuarios/resumen', [UsuarioController::class, 'resumen'])->middleware('modulo:SEG');
    Route::get('/usuarios/opciones', [UsuarioController::class, 'opciones'])->middleware('modulo:SEG');
    Route::get('/usuarios/{id}', [UsuarioController::class, 'show'])->middleware('modulo:SEG')->whereUuid('id');
    Route::get('/usuarios/{id}/accesos', [UsuarioController::class, 'accesos'])->middleware('modulo:SEG')->whereUuid('id');
    Route::post('/usuarios', [UsuarioController::class, 'store'])->middleware(['modulo:SEG,C', 'permiso:seg.user.manage']);
    Route::put('/usuarios/{id}', [UsuarioController::class, 'update'])->middleware(['modulo:SEG,E', 'permiso:seg.user.manage'])->whereUuid('id');
    Route::post('/usuarios/{id}/bloquear', [UsuarioController::class, 'bloquear'])->middleware(['modulo:SEG,E', 'permiso:seg.user.manage'])->whereUuid('id');
    Route::post('/usuarios/{id}/desbloquear', [UsuarioController::class, 'desbloquear'])->middleware(['modulo:SEG,E', 'permiso:seg.user.unlock'])->whereUuid('id');
    Route::post('/usuarios/{id}/desactivar', [UsuarioController::class, 'desactivar'])->middleware(['modulo:SEG,E', 'permiso:seg.user.manage'])->whereUuid('id');
    Route::post('/usuarios/{id}/reactivar', [UsuarioController::class, 'reactivar'])->middleware(['modulo:SEG,E', 'permiso:seg.user.manage'])->whereUuid('id');
    Route::post('/usuarios/{id}/reinvitar', [UsuarioController::class, 'reinvitar'])->middleware(['modulo:SEG,E', 'permiso:seg.user.manage', 'throttle:10,1'])->whereUuid('id');
    Route::post('/usuarios/{id}/reiniciar-2fa', [UsuarioController::class, 'reiniciarSegundoFactor'])->middleware(['modulo:SEG,E', 'permiso:seg.user.reset_mfa'])->whereUuid('id');
    Route::delete('/usuarios/{id}/sesiones', [UsuarioController::class, 'cerrarSesiones'])->middleware(['modulo:SEG,E', 'permiso:seg.session.revoke'])->whereUuid('id');
    Route::delete('/usuarios/{id}/sesiones/{tokenId}', [UsuarioController::class, 'cerrarSesiones'])->middleware(['modulo:SEG,E', 'permiso:seg.session.revoke'])->whereUuid(['id', 'tokenId']);

    // Dispositivos (SEG-09; SEG-13 los reutiliza). El permiso basta: el coordinador de delivery los aprueba sin gestionar SEG.
    Route::post('/dispositivos/{id}/aprobar', [DispositivoController::class, 'aprobar'])->middleware('permiso:seg.device.approve')->whereUuid('id');
    Route::post('/dispositivos/{id}/revocar', [DispositivoController::class, 'revocar'])->middleware('permiso:seg.device.approve')->whereUuid('id');
});
