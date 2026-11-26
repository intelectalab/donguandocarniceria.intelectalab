<?php

use App\Modulos\Cmp\Http\Controllers\AudienciaController;
use App\Modulos\Cmp\Http\Controllers\CampanaController;
use App\Modulos\Cmp\Http\Controllers\FidelizacionController;
use Illuminate\Support\Facades\Route;

// CMP · Campañas y fidelización. Reglas en app/Modulos/Cmp/Services.
// Segmentos: cmp.segment.manage. Campañas: cmp.campaign.manage. Aprobar: cmp.campaign.approve (sobre el umbral,
// cmp.campaign.approve_over_threshold). Cupones: cmp.coupon.manage. Ajustar puntos: cmp.loyalty.adjust.
// Administración aprueba campañas y ajusta puntos sin tener el módulo: esas rutas piden solo el permiso.
Route::prefix('cmp')->middleware('portal.fuera')->group(function () {
    Route::get('/opciones', [AudienciaController::class, 'opciones'])->middleware('permiso:cmp.campaign.approve|cmp.loyalty.adjust|cmp.campaign.manage|cmp.segment.manage|cmp.coupon.manage|crm.consent.manage');
    Route::get('/clientes/buscar', [AudienciaController::class, 'buscarClientes'])->middleware('modulo:CMP');

    // CMP-01 segmentos, CMP-02 constructor
    Route::get('/segmentos', [AudienciaController::class, 'segmentos'])->middleware('modulo:CMP');
    Route::get('/segmentos/{id}', [AudienciaController::class, 'segmento'])->middleware('modulo:CMP')->whereUuid('id');
    Route::post('/segmentos/vista-previa', [AudienciaController::class, 'vistaPrevia'])->middleware('modulo:CMP');
    Route::post('/segmentos', [AudienciaController::class, 'guardarSegmento'])->middleware(['modulo:CMP,C', 'permiso:cmp.segment.manage']);
    Route::put('/segmentos/{id}', [AudienciaController::class, 'actualizarSegmento'])->middleware(['modulo:CMP,E', 'permiso:cmp.segment.manage'])->whereUuid('id');
    Route::post('/segmentos/{id}/actualizar', [AudienciaController::class, 'refrescar'])->middleware(['modulo:CMP', 'permiso:cmp.segment.manage|cmp.campaign.manage'])->whereUuid('id');

    // CMP-03 a CMP-06 campañas
    Route::get('/campanas', [CampanaController::class, 'index'])->middleware('permiso:cmp.campaign.approve|cmp.campaign.manage|cmp.segment.manage|cmp.coupon.manage');
    Route::get('/campanas/{id}', [CampanaController::class, 'show'])->middleware('permiso:cmp.campaign.approve|cmp.campaign.manage|cmp.segment.manage|cmp.coupon.manage')->whereUuid('id');
    Route::post('/campanas', [CampanaController::class, 'store'])->middleware(['modulo:CMP,C', 'permiso:cmp.campaign.manage']);
    Route::put('/campanas/{id}', [CampanaController::class, 'update'])->middleware(['modulo:CMP,E', 'permiso:cmp.campaign.manage'])->whereUuid('id');
    Route::post('/campanas/{id}/estimar', [CampanaController::class, 'estimar'])->middleware('permiso:cmp.campaign.manage|cmp.campaign.approve')->whereUuid('id');
    Route::post('/campanas/{id}/solicitar', [CampanaController::class, 'enviarAAprobacion'])->middleware(['modulo:CMP,E', 'permiso:cmp.campaign.manage'])->whereUuid('id');
    Route::post('/campanas/{id}/aprobar', [CampanaController::class, 'aprobar'])->middleware('permiso:cmp.campaign.approve')->whereUuid('id');
    Route::post('/campanas/{id}/cancelar', [CampanaController::class, 'cancelar'])->middleware('permiso:cmp.campaign.manage|cmp.campaign.approve')->whereUuid('id');
    Route::post('/campanas/{id}/enviar', [CampanaController::class, 'enviar'])->middleware(['modulo:CMP,E', 'permiso:cmp.campaign.manage'])->whereUuid('id');
    Route::post('/atribuir', [CampanaController::class, 'atribuir'])->middleware(['modulo:CMP,E', 'permiso:cmp.campaign.manage']);
    Route::get('/calendario', [CampanaController::class, 'calendario'])->middleware('modulo:CMP');      // CMP-13

    // CMP-07 cupones
    Route::get('/cupones', [FidelizacionController::class, 'cupones'])->middleware('modulo:CMP');
    Route::post('/cupones', [FidelizacionController::class, 'guardarCupon'])->middleware(['modulo:CMP,C', 'permiso:cmp.coupon.manage']);
    Route::put('/cupones/{id}', [FidelizacionController::class, 'actualizarCupon'])->middleware(['modulo:CMP,E', 'permiso:cmp.coupon.manage'])->whereUuid('id');
    Route::post('/cupones/probar', [FidelizacionController::class, 'probarCupon'])->middleware('modulo:CMP');

    // CMP-08 programa, CMP-09 puntos del cliente
    Route::get('/puntos', [FidelizacionController::class, 'programa'])->middleware('permiso:cmp.loyalty.adjust|cmp.campaign.manage|cmp.coupon.manage|cmp.segment.manage');
    Route::put('/puntos', [FidelizacionController::class, 'guardarPrograma'])->middleware(['modulo:CMP,E', 'permiso:cmp.coupon.manage']);
    Route::get('/puntos/clientes', [FidelizacionController::class, 'clientes'])->middleware('permiso:cmp.loyalty.adjust|cmp.campaign.manage|cmp.coupon.manage|cmp.segment.manage');
    Route::get('/puntos/clientes/{id}', [FidelizacionController::class, 'cliente'])->middleware('permiso:cmp.loyalty.adjust|cmp.campaign.manage|cmp.coupon.manage|cmp.segment.manage')->whereUuid('id');
    Route::post('/puntos/clientes/{id}/canje', [FidelizacionController::class, 'canjear'])->middleware(['modulo:CMP,E', 'permiso:cmp.coupon.manage|cmp.loyalty.adjust'])->whereUuid('id');
    Route::post('/puntos/clientes/{id}/ajuste', [FidelizacionController::class, 'ajustar'])->middleware('permiso:cmp.loyalty.adjust')->whereUuid('id');
    Route::post('/puntos/movimientos/{id}/reverso', [FidelizacionController::class, 'reversar'])->middleware('permiso:cmp.loyalty.adjust')->whereUuid('id');

    // CMP-10 referidos
    Route::get('/referidos', [FidelizacionController::class, 'referidos'])->middleware('modulo:CMP');
    Route::post('/referidos', [FidelizacionController::class, 'registrarReferido'])->middleware(['modulo:CMP,C', 'permiso:cmp.coupon.manage|cmp.campaign.manage']);
    Route::post('/referidos/{id}/rechazar', [FidelizacionController::class, 'rechazarReferido'])->middleware(['modulo:CMP,E', 'permiso:cmp.coupon.manage|cmp.campaign.manage'])->whereUuid('id');

    // CMP-11 consentimientos por marca (registro de CRM), CMP-12 recompra esperada
    Route::get('/consentimientos', [AudienciaController::class, 'consentimientos'])->middleware('modulo:CMP');
    Route::post('/consentimientos', [AudienciaController::class, 'registrarConsentimiento'])->middleware(['modulo:CMP', 'permiso:crm.consent.manage|cmp.campaign.manage']);
    Route::post('/mensajes/entrante', [AudienciaController::class, 'entrante'])->middleware(['modulo:CMP', 'permiso:crm.consent.manage|cmp.campaign.manage']);
    Route::get('/recompra', [AudienciaController::class, 'recompra'])->middleware('modulo:CMP');
});
