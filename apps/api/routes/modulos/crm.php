<?php

use App\Modulos\Crm\Http\Controllers\CanalController;
use Illuminate\Support\Facades\Route;

// CRM · Bandeja omnicanal, leads y control de vendedoras: números y cuentas (CRM-07) y equipos y turnos (CRM-08).
Route::prefix('crm')->group(function () {
    // Ven los números y equipos quien los administra y la supervisión (con la auditoría); los cambia solo crm.channel.manage (RN-CRM-01).
    $ver = 'permiso:crm.channel.manage|crm.conversation.view_all';
    $gestionar = 'permiso:crm.channel.manage';

    // CRM-07 Números y cuentas
    Route::get('/canales', [CanalController::class, 'index'])->middleware(['modulo:CRM', $ver, 'throttle:60,1']);
    Route::get('/canales/{id}', [CanalController::class, 'show'])->middleware(['modulo:CRM', $ver])->whereUuid('id');
    Route::post('/canales', [CanalController::class, 'store'])->middleware(['modulo:CRM', $gestionar, 'throttle:20,1']);
    Route::put('/canales/{id}', [CanalController::class, 'update'])->middleware(['modulo:CRM', $gestionar, 'throttle:30,1'])->whereUuid('id');
    Route::post('/canales/{id}/probar', [CanalController::class, 'probar'])->middleware(['modulo:CRM', $gestionar, 'throttle:20,1'])->whereUuid('id');

    // CRM-08 Equipos y turnos
    Route::get('/equipos', [CanalController::class, 'equipos'])->middleware(['modulo:CRM', $ver, 'throttle:60,1']);
    Route::post('/canales/{id}/miembros', [CanalController::class, 'agregarMiembro'])->middleware(['modulo:CRM', $gestionar, 'throttle:30,1'])->whereUuid('id');
    Route::put('/canales/{id}/asignacion', [CanalController::class, 'asignacion'])->middleware(['modulo:CRM', $gestionar])->whereUuid('id');
    Route::put('/miembros/{id}', [CanalController::class, 'cambiarMiembro'])->middleware(['modulo:CRM', $gestionar, 'throttle:60,1'])->whereUuid('id');
    Route::put('/miembros/{id}/turnos', [CanalController::class, 'turnos'])->middleware(['modulo:CRM', $gestionar, 'throttle:60,1'])->whereUuid('id');

    // El estado propio de quien atiende chats (para el reparto, RN-CRM-02).
    Route::get('/mi-estado', [CanalController::class, 'miEstado'])->middleware(['modulo:CRM', 'permiso:crm.conversation.view_own|crm.conversation.view_all']);
    Route::post('/mi-estado', [CanalController::class, 'marcarEstado'])->middleware(['modulo:CRM', 'permiso:crm.conversation.view_own', 'throttle:30,1']);
});
