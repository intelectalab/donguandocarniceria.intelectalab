<?php

use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\PasswordResetController;
use App\Http\Controllers\MeController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\PublicoController;
use App\Http\Controllers\TenantController;
use App\Modulos\Cli\Http\Controllers\EnlaceController;
use App\Modulos\Onb\Http\Controllers\RegistroController;
use App\Modulos\Ops\Http\Controllers\ConsolaController;
use App\Modulos\Ops\Http\Controllers\EmpresaController;
use App\Modulos\Ops\Http\Controllers\PlanController;
use App\Modulos\Ops\Http\Controllers\PlataformaController;
use Illuminate\Support\Facades\Route;

/*
| API v1. Toda ruta de empresa pasa por:
|   tenant      → resuelve la empresa (por el correo al ingresar, luego por el token) y fija app.tenant_id (RLS)
|   auth:sanctum → token de esa empresa
|   usuario     → fija app.user_id (bitácora) y corta usuarios inactivos
| Cada módulo agrega sus rutas en routes/modulos/<codigo>.php (se cargan solas, abajo; ver _ejemplo.php)
| y protege cada una con 'modulo:PED,C' o 'permiso:ped.discount.approve'.
*/

// Página pública de GestionCarnica (landing): sin empresa ni sesión. Solo el catálogo de planes y pedidos de demo,
// con límite por IP (los pedidos, además, con trampa contra robots y solo inserción en la base).
Route::prefix('v1/publico')->group(function () {
    Route::get('/planes', [PublicoController::class, 'planes'])->middleware('throttle:60,1');
    Route::post('/demo', [PublicoController::class, 'demo'])->middleware('throttle:5,1');
    // ONB-01: registro de una empresa desde la página (código al correo y alta en prueba al verificarlo).
    Route::post('/registro', [RegistroController::class, 'registrar'])->middleware('throttle:5,1');
    Route::post('/registro/verificar', [RegistroController::class, 'verificar'])->middleware('throttle:10,1');
    // CLI-07: el cliente abre su enlace de ubicación (de un solo uso) y marca su pin. La empresa sale del enlace.
    Route::get('/ubicacion/{token}', [EnlaceController::class, 'publico'])->middleware('throttle:30,1')->where('token', '[A-Za-z0-9]{32}');
    Route::post('/ubicacion/{token}', [EnlaceController::class, 'completar'])->middleware('throttle:10,1')->where('token', '[A-Za-z0-9]{32}');
});

// OPS · Consola de Intelectalab: sin empresa (no pasa por «tenant» ni por Sanctum). Usuarios de plataforma con
// su propio ingreso, segundo factor obligatorio y sesión «gcc_…» (middleware «consola»). Ver docs/cambios.
Route::prefix('v1/consola')->group(function () {
    Route::post('/ingreso', [ConsolaController::class, 'ingresar'])->middleware('throttle:10,1');
    Route::post('/activar/preparar', [ConsolaController::class, 'prepararActivacion'])->middleware('throttle:10,1');
    Route::post('/activar', [ConsolaController::class, 'activar'])->middleware('throttle:10,1');

    Route::middleware(['consola', 'throttle:120,1'])->group(function () {
        Route::get('/yo', [ConsolaController::class, 'yo']);
        Route::post('/salir', [ConsolaController::class, 'salir']);
        // OPS-12 Usuarios de plataforma (solo PLATFORM_ADMIN cambia; lo valida el servicio, RN-OPS-10)
        Route::get('/usuarios', [ConsolaController::class, 'usuarios']);
        Route::post('/usuarios', [ConsolaController::class, 'crearUsuario'])->middleware('throttle:20,1');
        Route::put('/usuarios/{id}', [ConsolaController::class, 'editarUsuario'])->whereUuid('id');
        Route::post('/usuarios/{id}/estado', [ConsolaController::class, 'estadoUsuario'])->whereUuid('id');
        Route::post('/usuarios/{id}/reiniciar-2fa', [ConsolaController::class, 'reiniciarSegundoFactor'])->whereUuid('id');
        Route::post('/usuarios/{id}/reenviar', [ConsolaController::class, 'reenviarInvitacion'])->middleware('throttle:10,1')->whereUuid('id');
        // OPS-02 Empresas, OPS-03 Ficha y alta de empresa (solo PLATFORM_ADMIN da de alta; lo valida el servicio)
        Route::get('/empresas', [EmpresaController::class, 'index']);
        Route::get('/empresas/opciones', [EmpresaController::class, 'opciones']);
        Route::get('/empresas/{id}', [EmpresaController::class, 'show'])->whereUuid('id');
        Route::post('/empresas', [EmpresaController::class, 'store'])->middleware('throttle:10,1');
        // SUS-09 Catálogo de planes, SUS-11 Suscripciones y OPS-04 Suspender o reactivar (roles: lo valida el servicio)
        Route::get('/planes', [PlanController::class, 'catalogo']);
        Route::post('/planes/borradores', [PlanController::class, 'nuevoBorrador']);
        Route::put('/planes/borradores/{id}', [PlanController::class, 'editarBorrador'])->whereUuid('id');
        Route::delete('/planes/borradores/{id}', [PlanController::class, 'borrarBorrador'])->whereUuid('id');
        Route::post('/planes/borradores/{id}/publicar', [PlanController::class, 'publicar'])->whereUuid('id');
        Route::post('/planes/{codigo}/retirar', [PlanController::class, 'retirar'])->where('codigo', '[A-Z][A-Z0-9_]{1,19}');
        Route::get('/suscripciones', [PlanController::class, 'suscripciones']);
        Route::get('/suscripciones/{id}', [PlanController::class, 'suscripcion'])->whereUuid('id');
        Route::post('/suscripciones/{id}/estado', [PlanController::class, 'estado'])->whereUuid('id');
        Route::post('/suscripciones/{id}/extender', [PlanController::class, 'extender'])->whereUuid('id');
        Route::post('/suscripciones/{id}/descuento', [PlanController::class, 'descuento'])->whereUuid('id');
        // OPS-13 Bitácora, OPS-16 Parámetros de plataforma y catálogos globales (RN-MAE-11)
        Route::get('/bitacora', [PlataformaController::class, 'bitacora']);
        Route::get('/parametros', [PlataformaController::class, 'parametros']);
        Route::put('/parametros/{key}', [PlataformaController::class, 'cambiarParametro'])->where('key', '[a-z0-9_]{3,60}');
        Route::post('/catalogos/revisar', [PlataformaController::class, 'revisarCatalogo'])->middleware('throttle:20,1');
        Route::post('/catalogos/importar', [PlataformaController::class, 'importarCatalogo'])->middleware('throttle:10,1');
        // ONB-16 Registros y altas, y pedidos de demo de la página
        Route::get('/registros', [RegistroController::class, 'lista']);
        Route::post('/registros/{id}/rechazar', [RegistroController::class, 'rechazar'])->whereUuid('id');
        Route::get('/demos', [RegistroController::class, 'demos']);
        Route::post('/demos/{id}/atender', [RegistroController::class, 'atenderDemo'])->whereUuid('id');
    });
});

Route::prefix('v1')->middleware('tenant')->group(function () {
    Route::get('/tenant', TenantController::class);
    Route::get('/tenant/logo', [TenantController::class, 'logo'])->middleware('throttle:60,1');
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::post('/auth/forgot', [PasswordResetController::class, 'forgot'])->middleware('throttle:5,1');
    Route::post('/auth/reset', [PasswordResetController::class, 'reset'])->middleware('throttle:10,1');
    Route::get('/auth/password-rule', [ProfileController::class, 'passwordRule']);

    // suscripcion: en solo lectura o cancelada, la empresa no registra nada (RN-SUS-07).
    Route::middleware(['auth:sanctum', 'usuario', 'suscripcion'])->group(function () {
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/me', MeController::class);
        Route::post('/me/password', [ProfileController::class, 'password'])->middleware('throttle:10,1');

        Route::get('/me/notifications/summary', [NotificationController::class, 'summary']);
        Route::get('/me/notifications', [NotificationController::class, 'index']);
        Route::post('/me/notifications/read-all', [NotificationController::class, 'readAll']);
        Route::post('/me/notifications/{id}/read', [NotificationController::class, 'read'])->whereUuid('id');

        foreach (glob(__DIR__.'/modulos/*.php') as $archivo) {
            if (! str_starts_with(basename($archivo), '_')) {   // _ejemplo.php no se carga
                require $archivo;
            }
        }
    });
});
