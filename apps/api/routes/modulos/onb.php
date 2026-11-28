<?php

use App\Modulos\Onb\Http\Controllers\AsistenteController;
use Illuminate\Support\Facades\Route;

// ONB · Asistente de alta de empresas, plantillas por rubro e importadores (ONB-02 a ONB-15; RN-ONB-03 a 19).
Route::prefix('onb')->group(function () {
    $setup = 'permiso:onb.setup.run';
    $tpl = 'permiso:onb.template.apply';
    $imp = 'permiso:onb.import.run|onb.balance.import|onb.import.release_opening_stock';

    // ONB-02 Lista de pasos
    Route::get('/pasos', [AsistenteController::class, 'pasos'])->middleware('throttle:120,1,onbget-pasos');
    Route::post('/pasos/{code}/completar', [AsistenteController::class, 'completarPaso'])->middleware([$setup, 'throttle:30,1,onbpost-completar']);
    Route::post('/pasos/{code}/omitir', [AsistenteController::class, 'omitirPaso'])->middleware([$setup, 'throttle:30,1,onbpost-omitir']);
    Route::put('/pasos/{code}/obligatorio', [AsistenteController::class, 'cambiarObligatorio'])->middleware([$setup, 'throttle:30,1,onbput-obligatorio']);

    // ONB-03 Empresa
    Route::get('/empresa', [AsistenteController::class, 'verEmpresa'])->middleware('throttle:120,1,onbget-empresa');
    Route::put('/empresa', [AsistenteController::class, 'guardarEmpresa'])->middleware([$setup, 'throttle:30,1,onbput-empresa']);

    // ONB-04 Marcas
    Route::get('/marcas', [AsistenteController::class, 'verMarcas'])->middleware('throttle:120,1,onbget-marcas');
    Route::post('/marcas', [AsistenteController::class, 'crearMarca'])->middleware([$setup, 'throttle:30,1,onbpost-marcas']);

    // ONB-05 Locales y almacenes
    Route::get('/locales', [AsistenteController::class, 'verLocales'])->middleware('throttle:120,1,onbget-locales');
    Route::post('/locales', [AsistenteController::class, 'crearLocal'])->middleware([$setup, 'throttle:30,1,onbpost-locales']);
    Route::post('/almacenes', [AsistenteController::class, 'crearAlmacen'])->middleware([$setup, 'throttle:30,1,onbpost-almacenes']);

    // ONB-06 Series y comprobante electrónico
    Route::get('/series', [AsistenteController::class, 'verSeries'])->middleware('throttle:120,1,onbget-series');
    Route::post('/series/proponer', [AsistenteController::class, 'proponerSeries'])->middleware([$setup, 'throttle:20,1,onbpost-series']);
    Route::put('/series/{series}/correlativo', [AsistenteController::class, 'fijarCorrelativo'])->middleware([$setup, 'throttle:30,1,onbput-correlativo']);
    Route::post('/ose/probar', [AsistenteController::class, 'probarOse'])->middleware([$setup, 'throttle:20,1,onbpost-ose']);

    // ONB-07 Medios de pago y cajas
    Route::get('/pagos', [AsistenteController::class, 'verPagos'])->middleware('throttle:120,1,onbget-pagos');
    Route::post('/pagos', [AsistenteController::class, 'guardarPagos'])->middleware([$setup, 'throttle:30,1,onbpost-pagos']);

    // ONB-08 Números de WhatsApp
    Route::get('/whatsapp', [AsistenteController::class, 'verWhatsapp'])->middleware('throttle:120,1,onbget-whatsapp');
    Route::post('/whatsapp', [AsistenteController::class, 'conectarWhatsapp'])->middleware([$setup, 'throttle:20,1,onbpost-whatsapp']);

    // ONB-09 Zonas de reparto
    Route::get('/zonas', [AsistenteController::class, 'verZonas'])->middleware('throttle:120,1,onbget-zonas');
    Route::post('/zonas', [AsistenteController::class, 'crearZona'])->middleware([$setup, 'throttle:30,1,onbpost-zonas']);

    // ONB-10 Plantilla por rubro
    Route::get('/plantillas', [AsistenteController::class, 'verPlantillas'])->middleware('throttle:120,1,onbget-plantillas');
    Route::post('/plantillas/aplicar', [AsistenteController::class, 'aplicarPlantilla'])->middleware([$tpl, 'throttle:20,1,onbpost-plantillas']);

    // ONB-11, ONB-12 y ONB-13 Importadores
    Route::get('/importaciones', [AsistenteController::class, 'catalogoImportador'])->middleware('throttle:120,1,onbget-importaciones');
    Route::get('/importaciones/plantilla/{type}', [AsistenteController::class, 'plantillaCsv'])->middleware('throttle:60,1,onbget-imp-plantilla');
    Route::post('/importaciones/ejemplo/{type}', [AsistenteController::class, 'ejemploCsv'])->middleware('throttle:30,1,onbpost-imp-ejemplo');
    Route::post('/importaciones', [AsistenteController::class, 'crearImportacion'])->middleware([$imp, 'throttle:20,1,onbpost-importaciones']);
    Route::get('/importaciones/{id}', [AsistenteController::class, 'verImportacion'])->middleware('throttle:120,1,onbget-importacion')->whereUuid('id');
    Route::post('/importaciones/{id}/validar', [AsistenteController::class, 'revalidarImportacion'])->middleware([$imp, 'throttle:20,1,onbpost-imp-validar'])->whereUuid('id');
    Route::post('/importaciones/{id}/ejecutar', [AsistenteController::class, 'ejecutarImportacion'])->middleware([$imp, 'throttle:10,1,onbpost-imp-ejecutar'])->whereUuid('id');
    Route::post('/importaciones/{id}/cancelar', [AsistenteController::class, 'cancelarImportacion'])->middleware([$imp, 'throttle:20,1,onbpost-imp-cancelar'])->whereUuid('id');
    Route::post('/importaciones/{id}/revertir', [AsistenteController::class, 'revertirImportacion'])->middleware([$imp, 'throttle:10,1,onbpost-imp-revertir'])->whereUuid('id');
    Route::post('/importaciones/{id}/liberar-stock', [AsistenteController::class, 'liberarStockInicial'])->middleware(['permiso:onb.import.release_opening_stock', 'throttle:20,1,onbpost-imp-liberar'])->whereUuid('id');
    Route::get('/importaciones/{id}/errores', [AsistenteController::class, 'archivoErrores'])->middleware('throttle:60,1,onbget-imp-errores')->whereUuid('id');

    // ONB-14 Usuarios e invitaciones
    Route::get('/usuarios', [AsistenteController::class, 'verUsuarios'])->middleware('throttle:120,1,onbget-usuarios');
    Route::post('/usuarios', [AsistenteController::class, 'invitarUsuario'])->middleware([$setup, 'throttle:30,1,onbpost-usuarios']);
    Route::post('/usuarios/{id}/aceptar', [AsistenteController::class, 'aceptarInvitacion'])->middleware([$setup, 'throttle:30,1,onbpost-usuarios-aceptar'])->whereUuid('id');

    // ONB-15 Salida a producción
    Route::post('/salida/primer-comprobante', [AsistenteController::class, 'emitirPrimerComprobante'])->middleware([$setup, 'throttle:20,1,onbpost-primer-comp']);
    Route::post('/salida', [AsistenteController::class, 'salirAProduccion'])->middleware([$setup, 'throttle:10,1,onbpost-salida']);
});
