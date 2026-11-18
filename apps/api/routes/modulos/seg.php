<?php

use App\Modulos\Seg\Http\Controllers\DispositivoController;
use App\Modulos\Seg\Http\Controllers\MiCuentaController;
use App\Modulos\Seg\Http\Controllers\PoliticaController;
use App\Modulos\Seg\Http\Controllers\RolController;
use App\Modulos\Seg\Http\Controllers\SesionController;
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

    // SEG-10 Roles, SEG-11 Permisos del rol y SEG-12 Matriz
    Route::get('/roles', [RolController::class, 'index'])->middleware('modulo:SEG');
    Route::get('/roles/{id}', [RolController::class, 'show'])->middleware('modulo:SEG')->whereUuid('id');
    Route::get('/matriz', [RolController::class, 'matriz'])->middleware('modulo:SEG');
    Route::get('/matriz/exportar', [RolController::class, 'exportar'])->middleware(['modulo:SEG', 'throttle:10,1']);
    Route::post('/roles', [RolController::class, 'store'])->middleware(['modulo:SEG,C', 'permiso:seg.role.manage']);
    Route::put('/roles/{id}', [RolController::class, 'update'])->middleware(['modulo:SEG,E', 'permiso:seg.role.manage'])->whereUuid('id');
    Route::delete('/roles/{id}', [RolController::class, 'destroy'])->middleware(['modulo:SEG,E', 'permiso:seg.role.manage'])->whereUuid('id');
    Route::put('/roles/{id}/acceso', [RolController::class, 'acceso'])->middleware(['modulo:SEG,E', 'permiso:seg.role.manage'])->whereUuid('id');
    Route::put('/roles/{id}/permisos', [RolController::class, 'permiso'])->middleware(['modulo:SEG,E', 'permiso:seg.role.manage'])->whereUuid('id');

    // SEG-14 Política de contraseñas y sesiones (los valores se cambian con el editor de parámetros de PLT)
    Route::get('/politica', [PoliticaController::class, 'index'])->middleware('modulo:SEG');
    Route::get('/politica/historial', [PoliticaController::class, 'historial'])->middleware('modulo:SEG');
    Route::post('/politica/probar', [PoliticaController::class, 'probar'])->middleware(['modulo:SEG', 'throttle:30,1']);

    // SEG-15 Sesiones activas de la empresa
    Route::get('/sesiones', [SesionController::class, 'index'])->middleware(['modulo:SEG', 'permiso:seg.session.view_all']);
    Route::delete('/sesiones/{tokenId}', [SesionController::class, 'cerrar'])->middleware(['modulo:SEG,E', 'permiso:seg.session.revoke'])->whereUuid('tokenId');

    // SEG-06 Mi cuenta: cada persona, lo suyo (el cambio de contraseña es POST /me/password).
    Route::get('/mi-cuenta', [MiCuentaController::class, 'show']);
    Route::put('/mi-cuenta/preferencias', [MiCuentaController::class, 'preferencias'])->middleware('throttle:30,1');
    Route::post('/mi-cuenta/probar-clave', [MiCuentaController::class, 'probarClave'])->middleware('throttle:30,1');
    Route::put('/mi-cuenta/menu', [MiCuentaController::class, 'menu'])->middleware('throttle:60,1');  // estrellas del menú

    // SEG-07 Mis sesiones y dispositivos: cada persona las suyas, sin permiso especial ni acceso al módulo.
    Route::get('/mis-sesiones', [SesionController::class, 'mias']);
    Route::delete('/mis-sesiones', [SesionController::class, 'cerrarLasDemas'])->middleware('throttle:20,1');
    Route::delete('/mis-sesiones/{tokenId}', [SesionController::class, 'cerrarMia'])->middleware('throttle:20,1')->whereUuid('tokenId');

    // Dispositivos (SEG-13 y SEG-09). El permiso basta: el coordinador de delivery los aprueba sin gestionar SEG.
    Route::get('/dispositivos', [DispositivoController::class, 'index']);  // revisa el módulo SEG o seg.device.approve
    Route::post('/dispositivos/{id}/aprobar', [DispositivoController::class, 'aprobar'])->middleware('permiso:seg.device.approve')->whereUuid('id');
    Route::post('/dispositivos/{id}/revocar', [DispositivoController::class, 'revocar'])->middleware('permiso:seg.device.approve')->whereUuid('id');
});
