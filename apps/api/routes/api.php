<?php

use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\PasswordResetController;
use App\Http\Controllers\MeController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\TenantController;
use Illuminate\Support\Facades\Route;

/*
| API v1. Toda ruta de empresa pasa por:
|   tenant      → resuelve la empresa (por el correo al ingresar, luego por el token) y fija app.tenant_id (RLS)
|   auth:sanctum → token de esa empresa
|   usuario     → fija app.user_id (bitácora) y corta usuarios inactivos
| Cada módulo agrega sus rutas en routes/modulos/<codigo>.php (se cargan solas, abajo; ver _ejemplo.php)
| y protege cada una con 'modulo:PED,C' o 'permiso:ped.discount.approve'.
*/
Route::prefix('v1')->middleware('tenant')->group(function () {
    Route::get('/tenant', TenantController::class);
    Route::get('/tenant/logo', [TenantController::class, 'logo'])->middleware('throttle:60,1');
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::post('/auth/forgot', [PasswordResetController::class, 'forgot'])->middleware('throttle:5,1');
    Route::post('/auth/reset', [PasswordResetController::class, 'reset'])->middleware('throttle:10,1');
    Route::get('/auth/password-rule', [ProfileController::class, 'passwordRule']);

    Route::middleware(['auth:sanctum', 'usuario'])->group(function () {
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
