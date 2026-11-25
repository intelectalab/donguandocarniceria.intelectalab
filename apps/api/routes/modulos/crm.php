<?php

use App\Modulos\Crm\Http\Controllers\CanalController;
use App\Modulos\Crm\Http\Controllers\ConversacionController;
use Illuminate\Support\Facades\Route;

// CRM · Bandeja omnicanal, leads y control de vendedoras: bandeja (CRM-01), conversación (CRM-02), números y cuentas (CRM-07) y equipos y turnos (CRM-08).
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

    // CRM-01 Bandeja y CRM-02 Conversación: la vendedora ve los números donde atiende; la supervisión, los de sus marcas (RN-CRM-03).
    $verChats = 'permiso:crm.conversation.view_own|crm.conversation.view_all';
    Route::get('/conversaciones', [ConversacionController::class, 'index'])->middleware(['modulo:CRM', $verChats, 'throttle:120,1']);
    Route::get('/conversaciones/{id}', [ConversacionController::class, 'show'])->middleware(['modulo:CRM', $verChats, 'throttle:240,1'])->whereUuid('id');
    Route::post('/conversaciones/{id}/mensajes', [ConversacionController::class, 'responder'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1'])->whereUuid('id');
    // RN-CRM-04: editar o borrar un mensaje no existe, tampoco por la API.
    Route::match(['put', 'patch', 'delete'], '/conversaciones/{id}/mensajes/{mensaje}', [ConversacionController::class, 'inmutable'])->middleware(['modulo:CRM', $verChats])->whereUuid('id');
    Route::post('/conversaciones/{id}/asignar', [ConversacionController::class, 'reasignar'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reassign', 'throttle:60,1'])->whereUuid('id');
    Route::post('/conversaciones/{id}/cerrar', [ConversacionController::class, 'cerrar'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1'])->whereUuid('id');
    Route::post('/conversaciones/{id}/reabrir', [ConversacionController::class, 'reabrir'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1'])->whereUuid('id');
    Route::post('/conversaciones/{id}/notas', [ConversacionController::class, 'nota'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1'])->whereUuid('id');
    Route::put('/conversaciones/{id}/etiquetas', [ConversacionController::class, 'etiquetas'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1'])->whereUuid('id');
    // Solo fuera de producción (como el simulador de INT): mensajes de prueba del cliente.
    Route::post('/conversaciones/{id}/simular', [ConversacionController::class, 'simular'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1'])->whereUuid('id');
    Route::post('/simular', [ConversacionController::class, 'simularNuevo'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1']);

    // El estado propio de quien atiende chats (para el reparto, RN-CRM-02).
    Route::get('/mi-estado', [CanalController::class, 'miEstado'])->middleware(['modulo:CRM', 'permiso:crm.conversation.view_own|crm.conversation.view_all']);
    Route::post('/mi-estado', [CanalController::class, 'marcarEstado'])->middleware(['modulo:CRM', 'permiso:crm.conversation.view_own', 'throttle:30,1']);
});
